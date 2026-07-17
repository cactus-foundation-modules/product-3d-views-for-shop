'use client'

// The 3D views tab on the product editor.
//
// Unlike the editor's own panels, this one saves as you go rather than through the
// editor's Save button: an upload is a file transfer that has either happened or
// not, and pretending a 50 MB model is an unsaved edit - held in memory, lost on a
// tab change, applied later - would be a lie that costs the admin their upload.
// The Variations tab's file add-ons take the same view.

import { useCallback, useEffect, useState } from 'react'
import { P3D_MAX_UPLOAD_MB, formatLabel } from '@/modules/product-3d-views-for-shop/lib/formats'
import type { P3dAdminModel, P3dTarget } from '@/modules/product-3d-views-for-shop/lib/types'
import { Model3dPickerModal } from '@/modules/product-3d-views-for-shop/components/admin/Model3dPickerModal'

const css = `
.p3d-ed{display:grid;gap:1.25rem}
.p3d-ed-head{display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap}
.p3d-ed-field{display:grid;gap:.25rem}
.p3d-ed-label{font-size:.8125rem;font-weight:600;color:var(--color-text-secondary)}
.p3d-ed-select{padding:.375rem .75rem;border:1px solid var(--color-border);border-radius:6px;
  background:var(--color-bg);color:var(--color-text);font-size:.875rem;font-family:inherit;min-width:220px}
.p3d-ed-list{display:grid;gap:.5rem}
.p3d-ed-row{display:flex;gap:.75rem;align-items:center;padding:.625rem .75rem;
  border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface)}
.p3d-ed-name{font-size:.875rem;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.p3d-ed-meta{font-size:.75rem;color:var(--color-text-muted);flex:1}
.p3d-ed-tag{font-size:.6875rem;font-weight:700;padding:2px 6px;border-radius:4px;
  background:var(--color-bg-subtle);color:var(--color-text-secondary);border:1px solid var(--color-border);flex-shrink:0}
.p3d-ed-tag-var{background:var(--color-primary);color:var(--color-on-primary);border-color:var(--color-primary)}
.p3d-ed-empty{padding:1rem;border:1px dashed var(--color-border);border-radius:8px;
  color:var(--color-text-muted);font-size:.875rem}
.p3d-ed-err{color:var(--color-danger);font-size:.8125rem;margin:0}
.p3d-ed-help{color:var(--color-text-muted);font-size:.8125rem;margin:0;line-height:1.5}
`

const fmtSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

export function Product3dEditor({ productId }: { productId: string }) {
  const [models, setModels] = useState<P3dAdminModel[]>([])
  const [targets, setTargets] = useState<P3dTarget[]>([])
  const [target, setTarget] = useState<string>(productId)
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A promise chain rather than an async function, and deliberately: an async
  // body's opening statements read as synchronous to the effect lint, so calling
  // one straight from an effect trips set-state-in-effect even though every
  // setState here lands in a callback. Same shape as shop's own MediaPickerModal.
  // Returns its promise so an upload can wait for the list it just changed.
  const refresh = useCallback((): Promise<void> => {
    return fetch(`/api/m/product-3d-views-for-shop/admin/products/${productId}/models`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { models: P3dAdminModel[]; targets: P3dTarget[] } | null) => {
        if (data) { setModels(data.models); setTargets(data.targets) }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [productId])

  useEffect(() => { void refresh() }, [refresh])

  async function remove(id: string) {
    setError(null)
    const res = await fetch(`/api/m/product-3d-views-for-shop/admin/models/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? 'Could not delete that model')
      return
    }
    // Dropped from the list here rather than by refetching: the row is gone
    // server-side, and a round-trip would only make the click feel slow.
    setModels((prev) => prev.filter((m) => m.id !== id))
  }

  if (loading) return <p className="p3d-ed-help" style={{ padding: '1rem' }}>Loading…</p>

  const hasVariations = targets.length > 1

  return (
    <div className="spe-panel">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="p3d-ed">
        <p className="p3d-ed-help">
          A 3D model shows in the product gallery as an extra thumbnail with a <strong>3D</strong> badge, turning gently
          on its own. Shoppers who click it get the model in place of the main photograph, and can turn, pan and zoom it.
          {' '}<strong>GLB is the format to use</strong> if you have the choice - it packs the shape, colours and textures
          into one file. glTF, OBJ, FBX and 3DS also work, though OBJ carries no colours of its own and FBX files tend to
          be large. Up to {P3D_MAX_UPLOAD_MB} MB each.
        </p>

        <div className="p3d-ed-head">
          {hasVariations && (
            <div className="p3d-ed-field">
              <label className="p3d-ed-label" htmlFor="p3d-target">Attach to</label>
              <select id="p3d-target" className="p3d-ed-select" value={target} onChange={(e) => setTarget(e.target.value)}>
                {targets.map((t) => (
                  <option key={t.productId} value={t.productId}>
                    {t.variationLabel ?? 'The whole product'}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setPicking(true)}>
            Add a 3D model
          </button>
        </div>

        {picking && (
          <Model3dPickerModal
            productId={productId}
            targetProductId={target}
            targetLabel={targets.find((t) => t.productId === target)?.variationLabel ?? ''}
            onChanged={() => void refresh()}
            onClose={() => setPicking(false)}
          />
        )}

        {error && <p className="p3d-ed-err">{error}</p>}

        {hasVariations && (
          <p className="p3d-ed-help">
            Models on <strong>the whole product</strong> always show. Models on a variation show on their own until a
            shopper picks a variation, and after that only the chosen one&rsquo;s. Where several variations share the same
            model, add it to each - the gallery shows it once, not once per variation.
          </p>
        )}

        {models.length === 0 ? (
          <div className="p3d-ed-empty">
            No 3D models yet. The product&rsquo;s photographs carry on exactly as they are until you add one.
          </div>
        ) : (
          <div className="p3d-ed-list">
            {models.map((m) => (
              <div key={m.id} className="p3d-ed-row">
                <span className={`p3d-ed-tag${m.variationLabel ? ' p3d-ed-tag-var' : ''}`}>
                  {m.variationLabel ?? 'Whole product'}
                </span>
                <span className="p3d-ed-name">{m.filename}</span>
                <span className="p3d-ed-meta">{formatLabel(m.format)} · {fmtSize(m.size)}</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  aria-label={`Remove ${m.filename}`}
                  onClick={() => void remove(m.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
