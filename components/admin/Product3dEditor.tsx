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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { P3D_MAX_UPLOAD_MB, formatLabel } from '@/modules/product-3d-views-for-shop/lib/formats'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'
import type { P3dProductConfig } from '@/modules/product-3d-views-for-shop/lib/db/product-settings'
import type { P3dAdminModel } from '@/modules/product-3d-views-for-shop/lib/types'
import { Model3dPickerModal } from '@/modules/product-3d-views-for-shop/components/admin/Model3dPickerModal'
import { FabricConfigPanel } from '@/modules/product-3d-views-for-shop/components/admin/FabricConfigPanel'
import { Viewer3d } from '@/modules/product-3d-views-for-shop/components/public/Viewer3d'

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
.p3d-ed-viewer{display:grid;gap:.625rem;padding:.75rem;border:1px solid var(--color-border);
  border-radius:8px;background:var(--color-surface)}
.p3d-ed-viewer h4{margin:0;font-size:.875rem;color:var(--color-text)}
.p3d-ed-viewer-row{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}
.p3d-ed-viewer-row label{display:flex;gap:.5rem;align-items:center;font-size:.875rem;
  color:var(--color-text);cursor:pointer}
.p3d-ed-viewer-slider{display:flex;gap:.75rem;align-items:center;flex:1;min-width:14rem}
.p3d-ed-viewer-slider input[type=range]{flex:1}
.p3d-ed-viewer-val{font-size:.8125rem;color:var(--color-text-muted);
  font-variant-numeric:tabular-nums;min-width:2.5rem;text-align:right}
.p3d-ed-preview{height:320px;border:1px solid var(--color-border);border-radius:8px;
  overflow:hidden;position:relative;background:var(--color-bg-subtle)}
.p3d-stage{width:100%;height:100%;position:relative;background:var(--color-bg-subtle)}
.p3d-stage-canvas{width:100%;height:100%;display:block;touch-action:none;cursor:grab}
.p3d-stage-canvas:active{cursor:grabbing}
.p3d-note{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  text-align:center;padding:1rem;font-size:.8125rem;color:var(--color-text-muted)}
.p3d-hint{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);z-index:1;pointer-events:none;
  font-size:11px;line-height:1;padding:5px 9px;border-radius:999px;
  background:var(--color-fg);color:var(--color-bg);opacity:.75;white-space:nowrap}
.p3d-reset{position:absolute;right:8px;bottom:8px;z-index:2;cursor:pointer;border:none;
  font-family:inherit;font-size:11px;line-height:1;padding:5px 9px;border-radius:999px;
  background:var(--color-fg);color:var(--color-bg);opacity:.6;white-space:nowrap;
  transition:opacity .15s ease}
.p3d-reset:hover,.p3d-reset:focus-visible{opacity:.9}
@media (prefers-reduced-motion:reduce){.p3d-reset{transition:none}}
@media (prefers-reduced-motion:reduce){.p3d-stage-canvas{cursor:default}}
`

const fmtSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

export function Product3dEditor({ productId }: { productId: string }) {
  // The whole tree's models, parent and variations alike, kept unsplit: the list
  // below wants the parent's own, while the viewer settings want to know whether
  // there is anything at all to light and need one model to preview it on.
  const [treeModels, setTreeModels] = useState<P3dAdminModel[]>([])
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
  // The route also returns the target list the Variations tab needs, dropped
  // here: this tab only ever shows and adds the whole product's own models, and
  // `targets.length > 1` is kept only as the signal that the product has
  // variations, for the fabric panel below.
  const refresh = useCallback((): Promise<void> => {
    return fetch(`/api/m/product-3d-views-for-shop/admin/products/${productId}/models`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { models: P3dAdminModel[]; targets: { productId: string }[] } | null) => {
        if (data) {
          setTreeModels(data.models)
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
    setTreeModels((prev) => prev.filter((m) => m.id !== id))
  }

  // Only the product's own models are listed and removable here - a variation's
  // is the Variations tab's to manage.
  const models = useMemo(() => treeModels.filter((m) => m.productId === productId), [treeModels, productId])

  // What the brightness preview shows. The product's own model where there is
  // one, else the first variation's: the brightness is a property of the light,
  // not the model, so a product whose models all hang off its variations still
  // has something honest to judge it on. Removing the previewed model moves the
  // preview on to the next, because treeModels is what it is drawn from.
  const previewModel = models[0] ?? treeModels[0] ?? null

  if (loading) return <p className="p3d-ed-help" style={{ padding: '1rem' }}>Loading…</p>

  return (
    <div className="spe-panel">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="p3d-ed">
        <p className="p3d-ed-help">
          A 3D model shows in the product gallery as an extra thumbnail with a <strong>3D</strong> badge, turning gently
          on its own. Shoppers who click it get the model in place of the main photograph, and can turn, pan and zoom it.
          {' '}<strong>GLB is the format to use</strong> if you have the choice - it packs the shape, colours and textures
          into one file. glTF, OBJ, FBX and 3DS also work, though an OBJ carries no colours of its own and so shows in
          plain grey, and FBX files tend to be large. Up to {P3D_MAX_UPLOAD_MB} MB each.
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

        {/* Per-product viewer overrides. Only shown once there is a model
            somewhere on the product for them to act on - the whole tree counts,
            because a variation's model is lit by the parent's override too. */}
        {previewModel && <ViewerSettingsPanel productId={productId} previewModel={previewModel} />}

        {/* The fabric configurator, for a product with variations. Hides itself
            when the size attributes it needs are not installed, so a plain
            variation product sees nothing extra. */}
        {hasVariations && <FabricConfigPanel productId={productId} />}
      </div>
    </div>
  )
}

// The per-product viewer settings (today: brightness alone), saved as you go
// like everything else on this tab - a debounced PUT per change rather than a
// Save button, because one slider with a Save button is more ceremony than
// setting. The sitewide values ride along on the GET so the panel can grey
// itself out while the site's colour handling is None (brightness is inert
// without a tone curve) and can rest the slider on what "the site setting"
// currently is - and, once the override is on, to light the preview below the
// slider exactly as the storefront will.
function ViewerSettingsPanel({ productId, previewModel }: { productId: string; previewModel: P3dAdminModel }) {
  const [config, setConfig] = useState<P3dProductConfig | null>(null)
  const [site, setSite] = useState<P3dConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/m/product-3d-views-for-shop/admin/products/${productId}/settings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { config: P3dProductConfig; site: P3dConfig } | null) => {
        if (cancelled || !data) return
        setConfig(data.config)
        setSite(data.site)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [productId])

  // Update locally at once, persist shortly after the last change. The timer
  // carries the value it was armed with, so a slower earlier save can never
  // overwrite a later drag.
  const apply = useCallback((next: P3dProductConfig) => {
    setConfig(next)
    setError(null)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      fetch(`/api/m/product-3d-views-for-shop/admin/products/${productId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
        .then(async (r) => {
          if (!r.ok) setError((await r.json().catch(() => ({}))).error ?? 'Could not save the brightness.')
        })
        .catch(() => setError('Could not save the brightness. Check your connection.'))
    }, 400)
  }, [productId])

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  // The site's own lighting with this product's brightness dropped over the top,
  // which is precisely what a shopper on this product's page would get. Memoised
  // so the viewer is handed the same object between renders: a fresh one every
  // time would set it re-rendering for nothing.
  const previewSettings = useMemo(
    () => (site ? { ...site, exposure: config?.exposure ?? site.exposure } : null),
    [site, config?.exposure],
  )

  // Stable across a drag: it keys the preview only by which model is on the
  // stage, so changing the brightness never remounts the viewer.
  const previewItem = useMemo(
    () => ({
      key: previewModel.id,
      productId: previewModel.productId,
      url: previewModel.url,
      format: previewModel.format,
      label: `${formatLabel(previewModel.format)} preview`,
    }),
    [previewModel.id, previewModel.productId, previewModel.url, previewModel.format],
  )

  if (!config || !site || !previewSettings) return null

  const toneMappingOff = site.toneMapping === 'none'
  const overridden = config.exposure != null

  return (
    <div className="p3d-ed-viewer">
      <h4>Viewer brightness</h4>
      <div className="p3d-ed-viewer-row">
        <label style={toneMappingOff ? { opacity: 0.5, cursor: 'default' } : undefined}>
          <input
            type="checkbox"
            checked={overridden}
            disabled={toneMappingOff}
            onChange={(e) => apply({ ...config, exposure: e.target.checked ? site.exposure : null })}
          />
          Set a brightness just for this product
        </label>
        <div className="p3d-ed-viewer-slider" style={overridden ? undefined : { opacity: 0.5 }}>
          <input
            type="range"
            min={0.1} max={3} step={0.05}
            value={config.exposure ?? site.exposure}
            disabled={!overridden || toneMappingOff}
            aria-label="Brightness for this product"
            onChange={(e) => apply({ ...config, exposure: Number(e.target.value) })}
          />
          <span className="p3d-ed-viewer-val">{(config.exposure ?? site.exposure).toFixed(2)}</span>
        </div>
      </div>
      <p className="p3d-ed-help">
        {toneMappingOff
          ? 'Brightness needs a colour handling other than None - set one under Shop settings, 3D Viewer tab.'
          : overridden
            ? 'This product uses its own brightness. Untick to go back to the site setting.'
            : `Currently using the site setting (${site.exposure.toFixed(2)}), from Shop settings, 3D Viewer tab.`}
      </p>

      {/* The point of the slider: somewhere to see what it is doing. Mounted only
          while the override is on, because a WebGL context and a model download
          are not a fair price for a tab the admin opened to add a file. */}
      {overridden && !toneMappingOff && (
        <>
          <div className="p3d-ed-preview">
            <Viewer3d item={previewItem} settings={previewSettings} />
          </div>
          <p className="p3d-ed-help">
            {previewModel.variationLabel
              ? `Lit as a shopper would see it, on this product’s “${previewModel.variationLabel}” model. Drag to turn it.`
              : 'Lit as a shopper would see it, using the rest of your sitewide 3D settings. Drag to turn it.'}
          </p>
        </>
      )}

      {error && <p className="p3d-ed-err">{error}</p>}
    </div>
  )
}
