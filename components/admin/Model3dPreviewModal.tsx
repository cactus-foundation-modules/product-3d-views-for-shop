'use client'

// Look at one variation's 3D file without leaving the Variations tab.
//
// The 3D column tells you a variation HAS a model - a format badge and a filename
// - and until now that was all it told you. Which of forty near-identically named
// files landed on which row was a question only the storefront could answer, and
// answering it meant saving, opening the shop, and picking that combination by
// hand. So the badge is now a button, and this is what it opens.
//
// It shows the file as a shopper would get it: the site's own viewer settings with
// this product's brightness over the top, and the variation's own materials painted
// on - asked of the same public `/fabric/[child]` resolver the storefront uses, so
// what the admin judges here is what the shopper will see rather than a bare,
// unpainted shell. A product with no fabric configurator simply resolves to null
// and the file draws as it is, which for that product is correct.
//
// The file drawn is the one that was clicked, not the one the resolver would have
// picked for that combination. They are normally the same; where a size rule swaps
// the model out, the admin clicked a particular row to see that particular row.

import { useEffect, useMemo, useState } from 'react'
import { formatLabel } from '@/modules/product-3d-views-for-shop/lib/formats'
import { viewerChromeCss } from '@/modules/product-3d-views-for-shop/lib/viewer-css'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'
import type { P3dProductConfig } from '@/modules/product-3d-views-for-shop/lib/db/product-settings'
import type { FabricBundle, P3dAdminModel } from '@/modules/product-3d-views-for-shop/lib/types'
import { Viewer3d } from '@/modules/product-3d-views-for-shop/components/public/Viewer3d'

export function Model3dPreviewModal({ productId, childProductId, model, label, onClose }: {
  // The parent product, which is what both the settings and the fabric resolver
  // are keyed by.
  productId: string
  // The variant child whose materials paint the model.
  childProductId: string
  model: P3dAdminModel
  // The variation's display name ("Large / Oak"), for the heading.
  label: string
  onClose: () => void
}) {
  const [site, setSite] = useState<P3dConfig | null>(null)
  const [config, setConfig] = useState<P3dProductConfig | null>(null)
  // Null until the resolver answers, then a wrapper round its answer - which is
  // itself null for a product with no fabric config. The wrapper is what tells
  // "not asked yet" from "asked, nothing to paint" without a second flag, and
  // "not asked yet" is what holds the viewer's material skeleton up rather than
  // letting an unpainted first frame through.
  const [resolved, setResolved] = useState<{ bundle: FabricBundle | null } | null>(null)
  const pending = resolved === null
  const bundle = resolved?.bundle ?? null

  // Escape closes, as it does everywhere else in the editor. Bound on the document
  // because focus starts on the dialogue's own close button but moves into the
  // canvas the moment the admin takes hold of the model.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // The site's viewer settings plus this product's brightness override - the same
  // pair the 3D tab's own preview lights itself with, and the same the storefront
  // resolves server-side.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/m/product-3d-views-for-shop/admin/products/${productId}/settings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { config: P3dProductConfig; site: P3dConfig } | null) => {
        if (cancelled || !data) return
        setSite(data.site)
        setConfig(data.config)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [productId])

  // The variation's resolved materials. Asked directly rather than through
  // lib/fabric-fetch's promise cache: an admin who has just changed a fabric
  // mapping and reopened the preview is owed the new answer, not the one from
  // before they changed it.
  useEffect(() => {
    let cancelled = false
    const url = `/api/m/product-3d-views-for-shop/fabric/${encodeURIComponent(childProductId)}`
      + `?parent=${encodeURIComponent(productId)}&child=${encodeURIComponent(childProductId)}`
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<FabricBundle | null>) : null))
      // A product with no material config resolves to null, and the file draws
      // unpainted - which for that product is exactly right.
      .then((data) => { if (!cancelled) setResolved({ bundle: data }) })
      .catch(() => { if (!cancelled) setResolved({ bundle: null }) })
    return () => { cancelled = true }
  }, [productId, childProductId])

  const settings = useMemo(
    () => (site ? { ...site, exposure: config?.exposure ?? site.exposure } : null),
    [site, config?.exposure],
  )

  // The clicked file, not the resolver's choice - see the note at the top.
  const item = useMemo(
    () => ({
      key: model.id,
      productId: childProductId,
      url: model.url,
      format: model.format,
      label: `${formatLabel(model.format)} preview`,
    }),
    [model.id, model.url, model.format, childProductId],
  )

  const fabric = useMemo(
    () => (bundle && bundle.slots.length > 0
      ? { slots: bundle.slots, realCm: bundle.realCm, scaleAxis: bundle.scaleAxis }
      : undefined),
    [bundle],
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`3D preview of ${model.filename}`}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000, background: 'var(--color-overlay)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <style dangerouslySetInnerHTML={{ __html: viewerChromeCss }} />
      <div
        style={{
          background: 'var(--color-surface)', borderRadius: 8, width: '90vw', maxWidth: 860,
          height: '80vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)',
        }}
      >
        <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span
            style={{
              flexShrink: 0, fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.02em',
              padding: '2px 6px', borderRadius: 4, border: '1px solid var(--color-primary)',
              background: 'var(--color-primary-subtle)', color: 'var(--color-primary)',
            }}
          >
            {formatLabel(model.format)}
          </span>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label || model.filename}
          </h3>
          <span style={{ flex: 1, minWidth: 0, fontSize: '0.8125rem', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label ? model.filename : ''}
          </span>
          <button
            type="button"
            aria-label="Close"
            autoFocus
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: 'var(--color-text-secondary)', lineHeight: 1, flexShrink: 0 }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, position: 'relative', background: 'var(--color-bg-subtle)' }}>
          {settings
            ? <Viewer3d item={item} settings={settings} fabric={fabric} fabricPending={pending} />
            : <p className="p3d-note">Loading…</p>}
        </div>

        <p style={{ margin: 0, padding: '0.625rem 1.25rem', borderTop: '1px solid var(--color-border)', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
          {pending
            ? 'Fetching this variation’s materials…'
            : fabric
              ? 'Shown with this variation’s own materials, lit as a shopper would see it. Drag to turn it.'
              : 'Shown exactly as the file is - this product has no material settings, so there is nothing to paint on. Drag to turn it.'}
        </p>
      </div>
    </div>
  )
}
