'use client'

// The pick-a-model dialogue behind the Variations tab's 3D column, and the 3D
// answer to what shop's MediaPickerModal does for images: browse what is already
// in the library and choose one, or upload a new file - both in the one place the
// admin already is.
//
// Browsing is folder-aware, the same shape as shop's image picker: one folder at
// a time with subfolder tiles and a breadcrumb, and a search that spans every
// folder at once. The dialogue opens in the product's own 3d folder
// (Shop / <category> / <product> / 3d - where this module files its uploads),
// resolved by the models/folder route with a look rather than a create, so the
// admin lands on this product's models rather than every 3D file on the site.
//
// A 3D file has no thumbnail worth showing, so this is a list rather than a grid:
// a format badge, the filename and its size, which is what tells one model from
// another. The library's "other" tab holds every non-image upload, so the list is
// filtered down to files whose extension names a format this module can render -
// the same test lib/formats.ts applies everywhere else.
//
// Both paths end the same way: a row in this module's own table pointing at the
// object, saved at once. Choosing an existing file moves no bytes (the server
// reads the media row and writes our row beside it); uploading sends the file the
// way the column's own button always has. Either way the caller is told to refresh
// and the dialogue closes.

import { useEffect, useRef, useState } from 'react'
import { P3D_ACCEPT, formatFromFilename, formatLabel } from '@/modules/product-3d-views-for-shop/lib/formats'
import { ModelUploadCancelled, uploadModel } from '@/modules/product-3d-views-for-shop/lib/upload-model-client'
import { useModelClashPrompt } from '@/modules/product-3d-views-for-shop/components/admin/useModelClashPrompt'

type MediaItem = { id: string; url: string; key: string; originalName: string | null; sizeBytes: number }

// The library API returns more than this per row; only these fields are read.
type ApiItem = { id: string; url: string; key: string; originalName?: string | null; sizeBytes?: number }

type Folder = { id: string; name: string; parentId: string | null }

const fmtSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

const nameOf = (i: MediaItem): string => i.originalName || i.key.split('/').pop() || i.key

export function Model3dPickerModal({ productId, targetProductId, targetLabel, onChanged, onClose }: {
  // The parent product the models route is keyed by.
  productId: string
  // The product or variation the chosen model attaches to - a variant child here.
  targetProductId: string
  // The variation's display name, for the heading so the admin knows which row
  // they are adding to.
  targetLabel: string
  onChanged: () => void
  onClose: () => void
}) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clashPrompt = useModelClashPrompt()
  const [folders, setFolders] = useState<Folder[]>([])
  // null = library root; undefined = still asking where to open.
  const [folderId, setFolderId] = useState<string | null | undefined>(undefined)
  const fileRef = useRef<HTMLInputElement>(null)

  // Folder tree, once. The dialogue assembles each level from parentId.
  useEffect(() => {
    fetch('/api/admin/media/folders')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d?.folders && setFolders(d.folders))
      .catch(() => null)
  }, [])

  // Where to open: the product's 3d folder (or the deepest bit of that path
  // that exists). A failure simply opens the root - browsing must never be the
  // thing that breaks.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/m/product-3d-views-for-shop/admin/products/${productId}/models/folder`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancelled) setFolderId(d?.folderId ?? null) })
      .catch(() => { if (!cancelled) setFolderId(null) })
    return () => { cancelled = true }
  }, [productId])

  // Media scoped to the current folder, or spanning every folder while
  // searching, then a client-side format filter: 3D models are the non-image
  // uploads whose extension this module knows. type has no 3D value of its own,
  // so "other" is the nearest cut the server can make and the extension test
  // does the rest. Debounced so typing doesn't hammer the endpoint per key.
  const trimmed = query.trim()
  useEffect(() => {
    if (folderId === undefined) return
    let cancelled = false
    const params = new URLSearchParams({ perPage: '100', type: 'other' })
    if (trimmed) {
      params.set('folder', 'all')
      params.set('q', trimmed)
    } else {
      params.set('folder', folderId ?? 'root')
    }
    const timer = setTimeout(() => {
      if (!cancelled) setLoading(true)
      fetch(`/api/admin/media?${params.toString()}`)
        .then((r) => r.json())
        .then((d: { items?: ApiItem[] }) => {
          if (cancelled) return
          const models = (d.items ?? [])
            .map((i): MediaItem => ({
              id: i.id, url: i.url, key: i.key,
              originalName: i.originalName ?? null, sizeBytes: i.sizeBytes ?? 0,
            }))
            .filter((i) => formatFromFilename(i.originalName ?? i.key))
          setItems(models)
          setLoading(false)
        })
        .catch(() => { if (!cancelled) setLoading(false) })
    }, trimmed ? 250 : 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [folderId, trimmed])

  // Subfolders of the current level, hidden while searching (search spans all).
  const subfolders = trimmed || folderId === undefined ? [] : folders.filter((f) => f.parentId === folderId)

  // Breadcrumb trail from root down to the current folder.
  const breadcrumb: Folder[] = []
  if (!trimmed && folderId) {
    const byId = new Map(folders.map((f) => [f.id, f]))
    let cur = byId.get(folderId)
    while (cur) {
      breadcrumb.unshift(cur)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
  }

  async function attach() {
    if (!picked) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/m/product-3d-views-for-shop/admin/products/${productId}/models`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mediaId: picked, targetProductId }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not add that model.')
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that model.')
      setBusy(false)
    }
  }

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    try {
      await uploadModel(file, { productId, targetProductId, onClash: clashPrompt.ask })
      onChanged()
      onClose()
    } catch (err) {
      // Cancelling at the name prompt leaves the dialogue open and says nothing -
      // the person just changed their mind, which is not an error.
      if (err instanceof ModelUploadCancelled) { setBusy(false); return }
      setError(err instanceof Error ? err.message : 'That model would not upload.')
      setBusy(false)
    }
  }

  const crumbStyle = { background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '0.8125rem', color: 'var(--color-primary)', fontFamily: 'inherit' } as const

  return (
    <>
    {/* Sits above this dialogue - the question is about the file being uploaded
        from inside it, so it has to be answerable without closing it. */}
    {clashPrompt.dialog}
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'var(--color-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'var(--color-surface)', borderRadius: 8, width: '90vw', maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, flexShrink: 0 }}>
            Add a 3D model{targetLabel ? ` to ${targetLabel}` : ''}
          </h3>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all folders…"
            autoFocus
            style={{ flex: 1, padding: '0.375rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: '0.875rem', fontFamily: 'inherit', background: 'var(--color-bg)', color: 'var(--color-text)' }}
          />
          <input
            ref={fileRef}
            type="file"
            accept={P3D_ACCEPT}
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
              e.target.value = ''
            }}
          />
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Working…' : 'Upload new'}
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: 'var(--color-text-muted)', lineHeight: 1, flexShrink: 0 }}
          >
            ×
          </button>
        </div>

        {error && <p style={{ color: 'var(--color-danger)', margin: '0.5rem 1.25rem 0', fontSize: '0.8125rem' }}>{error}</p>}

        {!trimmed && folderId !== undefined && (
          <div style={{ padding: '0.5rem 1.25rem 0', display: 'flex', gap: '0.375rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
            {breadcrumb.length === 0
              ? <span>All folders</span>
              : <button type="button" style={crumbStyle} onClick={() => setFolderId(null)}>All folders</button>}
            {breadcrumb.map((f, i) => (
              <span key={f.id} style={{ display: 'inline-flex', gap: '0.375rem', alignItems: 'center' }}>
                <span aria-hidden>/</span>
                {i === breadcrumb.length - 1
                  ? <span style={{ color: 'var(--color-text)' }}>{f.name}</span>
                  : <button type="button" style={crumbStyle} onClick={() => setFolderId(f.id)}>{f.name}</button>}
              </span>
            ))}
          </div>
        )}

        <div style={{ padding: '0.75rem 1rem', overflowY: 'auto', flex: 1 }}>
          {subfolders.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.625rem' }}>
              {subfolders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFolderId(f.id)}
                  style={{
                    display: 'inline-flex', gap: '0.375rem', alignItems: 'center', padding: '0.375rem 0.625rem',
                    border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-bg-subtle)',
                    cursor: 'pointer', fontSize: '0.8125rem', color: 'var(--color-text)', fontFamily: 'inherit',
                  }}
                >
                  <span aria-hidden>📁</span>
                  {f.name}
                </button>
              ))}
            </div>
          )}
          {loading || folderId === undefined ? (
            <p style={{ color: 'var(--color-text-muted)', textAlign: 'center' }}>Loading…</p>
          ) : items.length === 0 ? (
            subfolders.length === 0 && (
              <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '1rem', fontSize: '0.875rem' }}>
                {trimmed
                  ? 'No 3D files match that search.'
                  : 'No 3D files in this folder yet. Upload one, or browse the folders above.'}
              </p>
            )
          ) : (
            <div style={{ display: 'grid', gap: '0.375rem' }}>
              {items.map((item) => {
                const selected = picked === item.id
                const format = formatFromFilename(item.originalName ?? item.key)
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPicked(selected ? null : item.id)}
                    style={{
                      display: 'flex', gap: '0.625rem', alignItems: 'center', width: '100%', textAlign: 'left',
                      padding: '0.5rem 0.625rem', borderRadius: 6, cursor: 'pointer',
                      border: `2px solid ${selected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                      background: selected ? 'var(--color-primary-subtle)' : 'var(--color-bg)',
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0, fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.02em',
                        padding: '2px 6px', borderRadius: 4,
                        border: '1px solid var(--color-primary)', background: 'var(--color-primary-subtle)', color: 'var(--color-primary)',
                      }}
                    >
                      {format ? formatLabel(format) : '3D'}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: '0.875rem', color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {nameOf(item)}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      {fmtSize(item.sizeBytes)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!picked || busy} onClick={() => void attach()}>
            {busy ? 'Adding…' : 'Add this model'}
          </button>
        </div>
      </div>
    </div>
    </>
  )
}
