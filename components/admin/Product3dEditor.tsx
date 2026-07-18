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
import type { FabricBundle, P3dAdminModel, P3dOption, P3dTarget } from '@/modules/product-3d-views-for-shop/lib/types'
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
.p3d-ed-pick{display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap}
.p3d-ed-pick-field{display:grid;gap:.25rem}
.p3d-ed-pick-label{font-size:.75rem;font-weight:600;color:var(--color-text-secondary)}
.p3d-ed-pick-select{padding:.375rem .5rem;border:1px solid var(--color-border);border-radius:6px;
  background:var(--color-bg);color:var(--color-text);font-size:.8125rem;font-family:inherit;min-width:150px}
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
  const [targets, setTargets] = useState<P3dTarget[]>([])
  const [options, setOptions] = useState<P3dOption[]>([])
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
  // The route also returns the target list and the product's variation options.
  // This tab only ever shows and adds the whole product's own models, so neither
  // steers the list; they feed the preview picker below, which turns a set of
  // option choices into the variation whose model should be on the stage, and
  // `targets.length > 1` doubles as the signal that the product has variations.
  const refresh = useCallback((): Promise<void> => {
    return fetch(`/api/m/product-3d-views-for-shop/admin/products/${productId}/models`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { models: P3dAdminModel[]; targets: P3dTarget[]; options: P3dOption[] } | null) => {
        if (data) {
          setTreeModels(data.models)
          setTargets(data.targets)
          setOptions(data.options ?? [])
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

  // Whether there is anything at all to light. What the preview actually shows is
  // the panel's own business - it starts on the product's own model where there is
  // one, else the first variation's, and follows the option dropdowns from there.
  const hasAnyModel = models.length > 0 || treeModels.length > 0

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
        {hasAnyModel && (
          <ViewerSettingsPanel
            productId={productId}
            treeModels={treeModels}
            targets={targets}
            options={options}
          />
        )}

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
//
// Which model the preview shows is the admin's to choose where the product has
// variations: one dropdown per option, exactly the choices a shopper makes, so a
// brightness set on a product whose models differ per colour can be judged on the
// one that matters rather than on whichever happened to be first.
function ViewerSettingsPanel({
  productId,
  treeModels,
  targets,
  options,
}: {
  productId: string
  treeModels: P3dAdminModel[]
  targets: P3dTarget[]
  options: P3dOption[]
}) {
  const [config, setConfig] = useState<P3dProductConfig | null>(null)
  const [site, setSite] = useState<P3dConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  // One chosen value per option id. Empty string means "not chosen", which reads
  // as the product's own model rather than as an error.
  const [choice, setChoice] = useState<Record<string, string>>({})
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

  // The product's own models first: they are what a shopper sees before choosing
  // anything, so they are what the preview rests on until a combination is picked.
  const ownModels = useMemo(() => treeModels.filter((m) => m.productId === productId), [treeModels, productId])
  const fallbackModel = ownModels[0] ?? treeModels[0] ?? null

  // Which option each value belongs to, so a variation's stored value ids can be
  // laid back out as one choice per dropdown.
  const optionOfValue = useMemo(() => {
    const map = new Map<string, string>()
    for (const option of options) for (const value of option.values) map.set(value.id, option.id)
    return map
  }, [options])

  // The dropdowns start on whatever the preview already shows, so opening the tab
  // and then changing one option is a one-click move rather than a re-pick of the
  // lot. Empty for the parent's own model, which belongs to no combination.
  const defaultChoice = useMemo(() => {
    const target = targets.find((t) => t.productId === fallbackModel?.productId)
    const seed: Record<string, string> = {}
    for (const valueId of target?.valueIds ?? []) {
      const optionId = optionOfValue.get(valueId)
      if (optionId) seed[optionId] = valueId
    }
    return seed
  }, [targets, fallbackModel?.productId, optionOfValue])

  const selection = useMemo(() => ({ ...defaultChoice, ...choice }), [defaultChoice, choice])

  // The variation the chosen combination names, and the model hanging off it. A
  // part-filled combination matches nothing on purpose: half a choice is not a
  // variation, and guessing which of the matching ones was meant would show the
  // admin a model they did not ask for.
  const chosenTarget = useMemo(() => {
    if (options.length === 0) return null
    const wanted = options.map((o) => selection[o.id] ?? '')
    if (wanted.some((v) => !v)) return null
    return targets.find((t) => t.valueIds.length > 0 && wanted.every((v) => t.valueIds.includes(v))) ?? null
  }, [options, selection, targets])

  const chosenModel = useMemo(
    () => (chosenTarget ? treeModels.find((m) => m.productId === chosenTarget.productId) ?? null : null),
    [chosenTarget, treeModels],
  )

  // A chosen combination with no model of its own falls back to the product's own
  // model rather than to an empty stage: the brightness is a property of the
  // light, and something lit is worth more than nothing.
  const previewModel = chosenModel ?? ownModels[0] ?? fallbackModel
  const showPicker = options.length > 0 && targets.length > 1

  // A variation's model on a material-configured product carries no colours of its
  // own: the shopper's chosen fabrics are painted on at view time, and drawing the
  // file raw shows an unpainted shell rather than the product. So the preview asks
  // the same public resolver the storefront does and paints the same way - without
  // this, picking an option showed a model with nothing on it.
  //
  // Only a chosen combination is resolved. The parent's own model is what a shopper
  // sees before choosing anything, which is to say unpainted, so there is nothing
  // to ask. The chosen VARIATION is asked about even where it has no model row of
  // its own, because the resolver falls back to the parent's model and paints that
  // - exactly what the storefront shows for such a combination.
  //
  // The variation it was resolved for is kept beside it, so a bundle still in
  // flight can never paint the previous combination's fabrics onto the new model,
  // nor name the previous combination's file.
  const previewChildId = chosenTarget?.productId ?? null
  const [resolved, setResolved] = useState<{ childId: string; bundle: FabricBundle | null } | null>(null)
  const bundle = resolved && resolved.childId === previewChildId ? resolved.bundle : null

  useEffect(() => {
    // Nothing to resolve for the parent's own model. The stale bundle is left
    // where it is rather than cleared: the childId guard above already refuses to
    // read it, and clearing it here would be a setState in the effect body for a
    // value nobody can see.
    if (!previewChildId) return
    let cancelled = false
    const childId = previewChildId
    const url = `/api/m/product-3d-views-for-shop/fabric/${encodeURIComponent(previewChildId)}`
      + `?parent=${encodeURIComponent(productId)}&child=${encodeURIComponent(previewChildId)}`
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<FabricBundle | null>) : null))
      // A product with no material config resolves to null, and the model shows
      // unpainted - which for that product is exactly right.
      .then((data) => { if (!cancelled) setResolved({ childId, bundle: data }) })
      .catch(() => { if (!cancelled) setResolved({ childId, bundle: null }) })
    return () => { cancelled = true }
  }, [productId, previewChildId])

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
  //
  // The resolver has the last word on which file a combination draws where it
  // answered: a size can swap the model out from under a colour, and the row this
  // panel picked is only where the search started.
  const previewItem = useMemo(
    () =>
      previewModel
        ? {
            key: previewModel.id,
            productId: previewModel.productId,
            url: bundle?.modelUrl ?? previewModel.url,
            format: bundle?.format ?? previewModel.format,
            label: `${formatLabel(bundle?.format ?? previewModel.format)} preview`,
          }
        : null,
    [previewModel, bundle?.modelUrl, bundle?.format],
  )

  // Handed to the viewer only once the paints for THIS variation have landed.
  // Passing empty slots meanwhile would tell the viewer there is nothing to paint,
  // which is the unpainted shell the admin just reported as blank.
  const previewFabric = useMemo(
    () => (bundle && bundle.slots.length > 0 ? { slots: bundle.slots } : undefined),
    [bundle],
  )

  if (!config || !site || !previewSettings || !previewItem || !previewModel) return null

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
          {showPicker && (
            <div className="p3d-ed-pick">
              {options.map((option) => (
                <div key={option.id} className="p3d-ed-pick-field">
                  <label className="p3d-ed-pick-label" htmlFor={`p3d-pick-${option.id}`}>{option.name}</label>
                  <select
                    id={`p3d-pick-${option.id}`}
                    className="p3d-ed-pick-select"
                    value={selection[option.id] ?? ''}
                    onChange={(e) => setChoice({ ...selection, [option.id]: e.target.value })}
                  >
                    <option value="">Any</option>
                    {option.values.map((value) => (
                      <option key={value.id} value={value.id}>{value.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
          <div className="p3d-ed-preview">
            <Viewer3d item={previewItem} settings={previewSettings} fabric={previewFabric} />
          </div>
          <p className="p3d-ed-help">
            {(chosenTarget?.variationLabel ?? previewModel.variationLabel)
              ? `Lit as a shopper would see it, on this product’s “${chosenTarget?.variationLabel ?? previewModel.variationLabel}” model. Drag to turn it.`
              : 'Lit as a shopper would see it, using the rest of your sitewide 3D settings. Drag to turn it.'}
            {showPicker && !chosenModel && !bundle && (
              chosenTarget
                ? <> That combination has no 3D model of its own yet, so this is the product&rsquo;s.</>
                : <> Pick a full set of options above to see a particular variation&rsquo;s model.</>
            )}
          </p>
        </>
      )}

      {error && <p className="p3d-ed-err">{error}</p>}
    </div>
  )
}
