'use client'

// The 3D views tab on the product editor.
//
// Unlike the editor's own panels, this one saves as you go rather than through the
// editor's Save button: an upload is a file transfer that has either happened or
// not, and pretending a 50 MB model is an unsaved edit - held in memory, lost on a
// tab change, applied later - would be a lie that costs the admin their upload.
// The Variations tab's file add-ons take the same view.
//
// Only the whole product's own models live here. A variation's model is set from
// the Variations tab's 3D column (Product3dVariantColumn), right next to the
// variation's picture - this tab has no "attach to" picker and does not list
// per-variation models, so there is exactly one place each job is done.

import { useCallback, useEffect, useState } from 'react'
import { P3D_MAX_UPLOAD_MB, formatLabel } from '@/modules/product-3d-views-for-shop/lib/formats'
import type { P3dAdminModel } from '@/modules/product-3d-views-for-shop/lib/types'
import { Model3dPickerModal } from '@/modules/product-3d-views-for-shop/components/admin/Model3dPickerModal'
import { FabricConfigPanel } from '@/modules/product-3d-views-for-shop/components/admin/FabricConfigPanel'

const css = `
.p3d-ed{display:grid;gap:1.25rem}
.p3d-ed-head{display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap}
.p3d-ed-list{display:grid;gap:.5rem}
.p3d-ed-row{display:flex;gap:.75rem;align-items:center;padding:.625rem .75rem;
  border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface)}
.p3d-ed-name{font-size:.875rem;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.p3d-ed-meta{font-size:.75rem;color:var(--color-text-muted);flex:1}
.p3d-ed-empty{padding:1rem;border:1px dashed var(--color-border);border-radius:8px;
  color:var(--color-text-muted);font-size:.875rem}
.p3d-ed-err{color:var(--color-danger);font-size:.8125rem;margin:0}
.p3d-ed-help{color:var(--color-text-muted);font-size:.8125rem;margin:0;line-height:1.5}
`

const fmtSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

export function Product3dEditor({ productId }: { productId: string }) {
  const [models, setModels] = useState<P3dAdminModel[]>([])
  const [hasVariations, setHasVariations] = useState(false)
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A promise chain rather than an async function, and deliberately: an async
  // body's opening statements read as synchronous to the effect lint, so calling
  // one straight from an effect trips set-state-in-effect even though every
  // setState here lands in a callback. Same shape as shop's own MediaPickerModal.
  // Returns its promise so an upload can wait for the list it just changed.
  //
  // The route also returns every variant child's models and the target list the
  // Variations tab needs - both dropped here. This tab only ever shows and adds
  // the whole product's own models; `targets.length > 1` is kept only as the
  // signal that the product has variations, for the fabric panel below.
  const refresh = useCallback((): Promise<void> => {
    return fetch(`/api/m/product-3d-views-for-shop/admin/products/${productId}/models`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { models: P3dAdminModel[]; targets: { productId: string }[] } | null) => {
        if (data) {
          setModels(data.models.filter((m) => m.productId === productId))
          setHasVariations(data.targets.length > 1)
        }
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
          {hasVariations && (
            <> A variation gets its own model from the <strong>Variations</strong> tab, next to its picture - this is
            for a model that shows on the whole product.</>
          )}
        </p>

        <div className="p3d-ed-head">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setPicking(true)}>
            Add a 3D model
          </button>
        </div>

        {picking && (
          <Model3dPickerModal
            productId={productId}
            targetProductId={productId}
            targetLabel=""
            onChanged={() => void refresh()}
            onClose={() => setPicking(false)}
          />
        )}

        {error && <p className="p3d-ed-err">{error}</p>}

        {models.length === 0 ? (
          <div className="p3d-ed-empty">
            No 3D models yet. The product&rsquo;s photographs carry on exactly as they are until you add one.
          </div>
        ) : (
          <div className="p3d-ed-list">
            {models.map((m) => (
              <div key={m.id} className="p3d-ed-row">
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

        {/* The fabric configurator, for a product with variations. Hides itself
            when the size attributes it needs are not installed, so a plain
            variation product sees nothing extra. */}
        {hasVariations && <FabricConfigPanel productId={productId} />}
      </div>
    </div>
  )
}
