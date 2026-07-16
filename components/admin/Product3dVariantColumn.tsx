'use client'

// The 3D column on the Variations tab, one cell per variant, contributed through
// shop-variations' `shop-variations.variant-columns` point.
//
// This is the same job the 3D views tab does through its "Attach to" dropdown, put
// where the admin already is: setting a variation's picture and setting its model
// are the same errand, and making someone leave the table, change a dropdown and
// come back to do the second one is the sort of faff that gets a feature ignored.
// The dropdown stays - it is still the only way to attach a model to the whole
// product rather than to one variation.
//
// Saves as it goes, like the 3D tab and unlike the rest of this table: an upload is
// a file transfer that has either happened or not, and holding a 40 MB model in
// memory as an unsaved edit until someone presses Save would be a lie.
//
// Everything here belongs to this module. shop-variations leaves a gap in the row
// and knows nothing about what fills it - a site running variations without this
// module installed has no such column.

import { useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { P3D_ACCEPT, formatLabel } from '@/modules/product-3d-views-for-shop/lib/formats'
import { uploadModel } from '@/modules/product-3d-views-for-shop/lib/upload-model-client'
import { reloadProductModels, useProductModels } from '@/modules/product-3d-views-for-shop/lib/use-product-models'

const box: CSSProperties = {
  width: 36, height: 36, borderRadius: 'var(--radius-md)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.02em',
}

// A drag carrying files reports 'Files' among its types. The editor drags its own
// gallery images about for reordering, and those must not light this cell up as a
// drop target - they carry no files.
function isFileDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types ?? []).includes('Files')
}

export function Product3dVariantColumn({ productId, childProductId, label }: {
  productId: string
  variantId: string
  childProductId: string
  label: string
}) {
  const models = useProductModels(productId)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const mine = (models ?? []).filter((m) => m.productId === childProductId)

  async function upload(file: File) {
    setError(null)
    setUploading(true)
    try {
      await uploadModel(file, { productId, targetProductId: childProductId })
      await reloadProductModels(productId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That model would not upload.')
    } finally {
      setUploading(false)
    }
  }

  async function remove(id: string) {
    setError(null)
    const res = await fetch(`/api/m/product-3d-views-for-shop/admin/models/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? 'Could not remove that model.')
      return
    }
    await reloadProductModels(productId)
  }

  // Only the first drop is taken. A variant can carry several models, but a
  // multi-select drop is far more likely to be a slip than an intention.
  function receiveDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void upload(file)
  }

  return (
    <span
      onDragEnter={(e) => { if (isFileDrag(e)) { e.preventDefault(); setDragOver(true) } }}
      onDragOver={(e) => { if (isFileDrag(e)) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { if (isFileDrag(e)) receiveDrop(e) }}
      style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-start' }}
    >
      <span style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {mine.map((m) => (
          <span key={m.id} style={{ display: 'inline-flex', gap: '0.125rem', alignItems: 'center' }}>
            <span
              title={m.filename}
              style={{
                ...box, width: 'auto', padding: '0 0.375rem',
                border: '1px solid var(--color-primary)', background: 'var(--color-primary-subtle)',
                color: 'var(--color-primary)',
              }}
            >
              {formatLabel(m.format)}
            </span>
            <button
              type="button"
              onClick={() => void remove(m.id)}
              aria-label={`Remove the ${formatLabel(m.format)} model from ${label}`}
              className="spe-icon-btn spe-icon-btn-danger"
            >
              ×
            </button>
          </span>
        ))}

        <input
          ref={fileRef}
          type="file"
          accept={P3D_ACCEPT}
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void upload(f)
            // Cleared so picking the same file twice in a row still fires a change
            // event - re-uploading after a failure is exactly that.
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            ...box,
            border: dragOver ? '2px solid var(--color-primary)' : '1px dashed var(--color-border)',
            background: dragOver ? 'var(--color-primary-subtle)' : 'none',
            color: dragOver ? 'var(--color-primary)' : 'var(--color-text-muted)',
            cursor: uploading ? 'progress' : 'pointer',
          }}
          aria-label={`Add a 3D model to ${label}, or drop one here`}
          title="Click to choose a 3D file, or drop one here"
        >
          {uploading ? '…' : '＋'}
        </button>
      </span>

      {error && (
        <span role="alert" style={{ color: 'var(--color-danger)', fontSize: '0.6875rem', maxWidth: 220, lineHeight: 1.3 }}>
          {error}
        </span>
      )}
    </span>
  )
}
