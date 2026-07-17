'use client'

// The fabric configurator's admin panel, shown below the model list on a product
// that has variations. It maps the model's named material slots to the product's
// colour options, points the whole thing at the size and overall-height attributes,
// and saves on its own button (not the editor's), the same as the model list above.
//
// The tile SCALE is not set by hand. The model's real-world scale is pinned by the
// "Overall height" attribute (a real cm value, set per variation), and the rest is
// measured from the mesh in the browser at config time - each material's texel
// density and each model's height in its own units - since the server never parses
// a GLB. Those measurements are baked into the saved config.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { collectMaterialNamesFrom, loadModel, measureModelHeight, measureTexelDensity } from '@/modules/product-3d-views-for-shop/lib/three/load-model'
import { formatLabel } from '@/modules/product-3d-views-for-shop/lib/formats'
import { Viewer3d } from '@/modules/product-3d-views-for-shop/components/public/Viewer3d'
import type { FabricConfig, P3dAdminModel } from '@/modules/product-3d-views-for-shop/lib/types'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'
import type { FabricColourOption, FabricSizeAttribute } from '@/modules/product-3d-views-for-shop/lib/fabric/resolve'

type FabricModelRule = FabricConfig['models'][number]
type FabricSlot = FabricConfig['slots'][number]

const EMPTY: FabricConfig = { models: [], defaultModelId: '', heightAttributeId: '', modelHeights: {}, slots: [] }

// Words that describe the KIND of thing rather than which part it is, dropped
// before name-matching so "Fabric seat" pairs with "Seat Colour" on "seat" and not
// on a shared "colour"/"fabric".
const STOPWORDS = new Set(['fabric', 'colour', 'color', 'material', 'size', 'the', 'of'])

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOPWORDS.has(t))
}

// The best name-match in `list`, or undefined when nothing shares a meaningful
// word - used to pre-fill a new slot's colour and size so the admin usually just
// confirms rather than picks from scratch.
function guessByName<T>(name: string, list: T[], getName: (item: T) => string): T | undefined {
  const want = new Set(tokens(name))
  let best: T | undefined
  let bestScore = 0
  for (const item of list) {
    const score = tokens(getName(item)).filter((t) => want.has(t)).length
    if (score > bestScore) {
      bestScore = score
      best = item
    }
  }
  return best
}

// One measurement pass over the configured models: material names + each material's
// texel density from the face model, and every configured model's height in its own
// units. Pure of React state so the effect and the button share it without racing.
type Measurement = { names: string[]; densities: Record<string, number>; heights: Record<string, number> }

async function measureConfigured(
  faceModel: P3dAdminModel | undefined,
  configuredIds: string[],
  allModels: P3dAdminModel[],
): Promise<Measurement> {
  const heights: Record<string, number> = {}
  for (const id of configuredIds) {
    const model = allModels.find((m) => m.id === id)
    if (!model) continue
    heights[id] = await measureModelHeight(await loadModel(model.url, model.format))
  }

  const densities: Record<string, number> = {}
  let names: string[] = []
  if (faceModel) {
    const object = await loadModel(faceModel.url, faceModel.format)
    names = collectMaterialNamesFrom(object)
    for (const name of names) densities[name] = await measureTexelDensity(object, name)
  }
  return { names, densities, heights }
}

const css = `
.p3d-fab{display:grid;gap:1.25rem;margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid var(--color-border)}
.p3d-fab-h{font-size:1rem;font-weight:600;color:var(--color-text);margin:0}
.p3d-fab-sub{font-size:.8125rem;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:var(--color-text-secondary);margin:0}
.p3d-fab-help{color:var(--color-text-muted);font-size:.8125rem;margin:0;line-height:1.5}
.p3d-fab-sec{display:grid;gap:.625rem}
.p3d-fab-row{display:flex;gap:.5rem;align-items:flex-end;flex-wrap:wrap;padding:.625rem .75rem;
  border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface)}
.p3d-fab-field{display:grid;gap:.25rem}
.p3d-fab-label{font-size:.75rem;font-weight:600;color:var(--color-text-secondary)}
.p3d-fab-select{padding:.375rem .5rem;border:1px solid var(--color-border);border-radius:6px;
  background:var(--color-bg);color:var(--color-text);font-size:.8125rem;font-family:inherit;min-width:150px}
.p3d-fab-when{font-size:.8125rem;color:var(--color-text-muted);display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.p3d-fab-spacer{flex:1}
.p3d-fab-tag{font-size:.6875rem;padding:2px 6px;border-radius:4px;white-space:nowrap}
.p3d-fab-tag-ok{background:var(--color-bg-subtle);color:var(--color-text-secondary);border:1px solid var(--color-border)}
.p3d-fab-tag-warn{background:var(--color-bg-subtle);color:var(--color-danger);border:1px solid var(--color-border)}
.p3d-fab-actions{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.p3d-fab-msg{font-size:.8125rem;margin:0}
.p3d-fab-msg-ok{color:var(--color-success,var(--color-primary))}
.p3d-fab-msg-err{color:var(--color-danger)}
.p3d-fab-preview{height:320px;border:1px solid var(--color-border);border-radius:8px;overflow:hidden;position:relative;background:var(--color-bg-subtle)}
.p3d-stage{width:100%;height:100%;position:relative;background:var(--color-bg-subtle)}
.p3d-stage-canvas{width:100%;height:100%;display:block;touch-action:none;cursor:grab}
.p3d-stage-canvas:active{cursor:grabbing}
.p3d-note{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  text-align:center;padding:1rem;font-size:.8125rem;color:var(--color-text-muted)}
.p3d-hint{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);z-index:1;pointer-events:none;
  font-size:11px;line-height:1;padding:5px 9px;border-radius:999px;background:var(--color-fg);color:var(--color-bg);opacity:.75}
`

export function FabricConfigPanel({ productId }: { productId: string }) {
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<FabricConfig>(EMPTY)
  const [options, setOptions] = useState<FabricColourOption[]>([])
  const [attributes, setAttributes] = useState<FabricSizeAttribute[]>([])
  const [models, setModels] = useState<P3dAdminModel[]>([])
  const [settings, setSettings] = useState<P3dConfig | null>(null)
  const [materialNames, setMaterialNames] = useState<string[]>([])
  // materialName -> measured texel density (UV per model-unit). Kept beside the
  // config rather than in each slot, so it survives a slot's material changing and
  // is merged into the slots only at save.
  const [densities, setDensities] = useState<Record<string, number>>({})
  const [measuring, setMeasuring] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/m/product-3d-views-for-shop/admin/products/${productId}/fabric`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { config: FabricConfig | null; options: FabricColourOption[]; attributes: FabricSizeAttribute[]; models: P3dAdminModel[]; settings: P3dConfig } | null) => {
        if (cancelled || !data) { setLoading(false); return }
        const saved = data.config ?? EMPTY
        setConfig(saved)
        // Seed the densities from what was measured on the last save, so the panel
        // is usable before a re-detect and a save without one keeps them.
        setDensities(Object.fromEntries(saved.slots.map((s) => [s.materialName, s.texelDensity])))
        setOptions(data.options)
        setAttributes(data.attributes)
        setModels(data.models)
        setSettings(data.settings)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [productId])

  // The model to read material names from and to preview against: the chosen
  // default, or the first attached model as a stand-in before one is chosen.
  const faceModel = useMemo(
    () => models.find((m) => m.id === config.defaultModelId) ?? models[0],
    [models, config.defaultModelId],
  )

  // Every model the config actually uses - default plus each structural rule - whose
  // height must be measured so its variants calibrate. Falls back to the face model
  // so a not-yet-defaulted product still measures something.
  const configuredIds = useMemo(() => {
    const ids = [...new Set([config.defaultModelId, ...config.models.map((m) => m.modelId)].filter(Boolean))]
    if (ids.length === 0 && faceModel) ids.push(faceModel.id)
    return ids
  }, [config.defaultModelId, config.models, faceModel])

  const modelSignature = JSON.stringify(configuredIds)

  const applyMeasurement = useCallback((m: Measurement) => {
    setMaterialNames(m.names)
    setDensities((prev) => ({ ...prev, ...m.densities }))
    setConfig((c) => ({ ...c, modelHeights: { ...c.modelHeights, ...m.heights } }))
  }, [])

  // Measure the configured models whenever the set of them changes, so the material
  // list, texel densities and model heights track the current selection without the
  // admin asking. A promise chain, so the effect's only setState is in a callback
  // (the manual button below carries the spinner instead).
  useEffect(() => {
    if (models.length === 0) return
    let cancelled = false
    measureConfigured(faceModel, configuredIds, models)
      .then((m) => { if (!cancelled) applyMeasurement(m) })
      .catch(() => {})
    return () => { cancelled = true }
    // Keyed on the configured model ids; faceModel/models are read as the source to
    // measure, not triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelSignature])

  const detect = () => {
    setMeasuring(true)
    measureConfigured(faceModel, configuredIds, models)
      .then(applyMeasurement)
      .catch(() => {})
      .finally(() => setMeasuring(false))
  }

  const setModelRule = (i: number, patch: Partial<FabricModelRule>) =>
    setConfig((c) => ({ ...c, models: c.models.map((m, idx) => (idx === i ? { ...m, ...patch } : m)) }))
  const addModelRule = () =>
    setConfig((c) => ({ ...c, models: [...c.models, { modelId: '', optionId: '', valueId: '' }] }))
  const removeModelRule = (i: number) =>
    setConfig((c) => ({ ...c, models: c.models.filter((_, idx) => idx !== i) }))

  const setSlot = (i: number, patch: Partial<FabricSlot>) =>
    setConfig((c) => ({ ...c, slots: c.slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }))
  const removeSlot = (i: number) =>
    setConfig((c) => ({ ...c, slots: c.slots.filter((_, idx) => idx !== i) }))
  const addSlot = () => {
    const used = new Set(config.slots.map((s) => s.materialName))
    const name = materialNames.find((n) => !used.has(n)) ?? materialNames[0] ?? ''
    const colour = guessByName(name, options, (o) => o.name)
    const size = guessByName(name, attributes, (a) => a.name)
    setConfig((c) => ({
      ...c,
      slots: [
        ...c.slots,
        {
          materialName: name,
          colourOptionId: colour?.id ?? options[0]?.id ?? '',
          sizeAttributeId: size?.id ?? attributes[0]?.id ?? '',
          // Measured on save from `densities`; 0 until then.
          texelDensity: 0,
        },
      ],
    }))
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    // Merge the measured texel densities into the slots at the last moment, so a
    // slot always saves the density of the material it currently names.
    const payload: FabricConfig = {
      ...config,
      slots: config.slots.map((s) => ({ ...s, texelDensity: densities[s.materialName] ?? 0 })),
    }
    try {
      const res = await fetch(`/api/m/product-3d-views-for-shop/admin/products/${productId}/fabric`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setMessage({ kind: 'ok', text: 'Saved.' })
      } else {
        const body = await res.json().catch(() => ({}))
        setMessage({ kind: 'err', text: body.error ?? 'Could not save the fabric configuration.' })
      }
    } catch {
      setMessage({ kind: 'err', text: 'Could not save the fabric configuration.' })
    } finally {
      setSaving(false)
    }
  }

  // A rough preview of each slot's colour on the model. It is a colour/placement
  // check, not a scale one - true scale needs the per-variation height and swatch
  // values, which live on the variants, not here - so the tile density is a ballpark
  // from the measured texel density assuming a ~20cm swatch, and is labelled as such.
  const previewSlots = useMemo(
    () =>
      config.slots
        .map((slot) => {
          const opt = options.find((o) => o.id === slot.colourOptionId)
          const swatch = opt?.values.find((v) => v.swatch && /^https?:\/\//.test(v.swatch))?.swatch
          if (!swatch) return null
          const density = densities[slot.materialName] ?? 0
          const repeat = density > 0 ? Math.min(50, Math.max(0.01, 1 / (density * 20))) : 1
          return { materialName: slot.materialName, textureUrl: swatch, repeat }
        })
        .filter((s): s is { materialName: string; textureUrl: string; repeat: number } => s !== null),
    [config.slots, options, densities],
  )

  // The panel is size-driven: without a size attribute there is nothing to scale the
  // weave against, so it stays hidden and the product's models behave as plain 3D
  // views. (The parent only mounts this for a product with variations.)
  if (loading) return null
  if (attributes.length === 0) return null

  const materialOptions = (current: string): string[] =>
    materialNames.includes(current) || !current ? materialNames : [current, ...materialNames]

  return (
    <div className="p3d-fab">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div>
        <h4 className="p3d-fab-h">Fabric configurator</h4>
        <p className="p3d-fab-help">
          Re-texture one model live from the shopper&rsquo;s choices instead of uploading a separate file per colour.
          Point each fabric part of the model at the colour option that changes it. The weave is scaled to true size
          automatically, from the swatch size and overall height you set per variation - no fiddling with tile scale by hand.
        </p>
      </div>

      {/* Models: which file to show for a structural option like a headrest, plus the
          height attribute that pins each model's real-world scale. */}
      <div className="p3d-fab-sec">
        <p className="p3d-fab-sub">Models</p>
        <p className="p3d-fab-help">
          If an option swaps the shape itself - a headrest on or off - add a rule for each, pointing at the file that has it.
          Colour and texture are handled below on one model; this is only for options that need a different file.
        </p>
        {config.models.map((rule, i) => {
          const opt = options.find((o) => o.id === rule.optionId)
          return (
            <div key={i} className="p3d-fab-row">
              <div className="p3d-fab-field">
                <label className="p3d-fab-label">Model</label>
                <select className="p3d-fab-select" value={rule.modelId} onChange={(e) => setModelRule(i, { modelId: e.target.value })}>
                  <option value="">Choose a model…</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.filename}</option>
                  ))}
                </select>
              </div>
              <div className="p3d-fab-when">
                <span>shown when</span>
                <select className="p3d-fab-select" value={rule.optionId} onChange={(e) => setModelRule(i, { optionId: e.target.value, valueId: '' })}>
                  <option value="">option…</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
                <span>=</span>
                <select className="p3d-fab-select" value={rule.valueId} onChange={(e) => setModelRule(i, { valueId: e.target.value })} disabled={!opt}>
                  <option value="">value…</option>
                  {opt?.values.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </div>
              <span className="p3d-fab-spacer" />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeModelRule(i)}>Remove</button>
            </div>
          )
        })}
        <div className="p3d-fab-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={addModelRule}>+ Add model rule</button>
        </div>
        <div className="p3d-fab-row">
          <div className="p3d-fab-field">
            <label className="p3d-fab-label">Default model</label>
            <select className="p3d-fab-select" value={config.defaultModelId} onChange={(e) => setConfig((c) => ({ ...c, defaultModelId: e.target.value }))}>
              <option value="">Choose a model…</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.filename}</option>
              ))}
            </select>
          </div>
          <div className="p3d-fab-field">
            <label className="p3d-fab-label">Overall height from</label>
            <select className="p3d-fab-select" value={config.heightAttributeId} onChange={(e) => setConfig((c) => ({ ...c, heightAttributeId: e.target.value }))}>
              <option value="">attribute…</option>
              {attributes.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <p className="p3d-fab-help" style={{ flex: 1, minWidth: '12rem' }}>
            The attribute holding the product&rsquo;s real overall height in cm, set per variation. It pins the model&rsquo;s
            true size so the weave scales correctly. The configurator only appears once a default model is set.
          </p>
        </div>
      </div>

      {/* Fabric parts: named material slots, painted from a colour option. */}
      <div className="p3d-fab-sec">
        <div className="p3d-fab-actions">
          <p className="p3d-fab-sub" style={{ margin: 0 }}>Fabric parts</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={detect} disabled={measuring || !faceModel}>
            {measuring ? 'Reading model…' : 'Detect from model'}
          </button>
        </div>
        {materialNames.length === 0 && (
          <p className="p3d-fab-help">
            No fabric parts read from the model yet. Set a default model above, then use <strong>Detect from model</strong>.
          </p>
        )}
        {config.slots.map((slot, i) => {
          const measured = (densities[slot.materialName] ?? 0) > 0
          return (
            <div key={i} className="p3d-fab-row">
              <div className="p3d-fab-field">
                <label className="p3d-fab-label">Part</label>
                <select className="p3d-fab-select" value={slot.materialName} onChange={(e) => setSlot(i, { materialName: e.target.value })}>
                  {slot.materialName === '' && <option value="">Choose a part…</option>}
                  {materialOptions(slot.materialName).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div className="p3d-fab-field">
                <label className="p3d-fab-label">Colour from</label>
                <select className="p3d-fab-select" value={slot.colourOptionId} onChange={(e) => setSlot(i, { colourOptionId: e.target.value })}>
                  <option value="">option…</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
              <div className="p3d-fab-field">
                <label className="p3d-fab-label">Size from</label>
                <select className="p3d-fab-select" value={slot.sizeAttributeId} onChange={(e) => setSlot(i, { sizeAttributeId: e.target.value })}>
                  <option value="">attribute…</option>
                  {attributes.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <span className={`p3d-fab-tag ${measured ? 'p3d-fab-tag-ok' : 'p3d-fab-tag-warn'}`}>
                {measured ? 'weave scale measured' : 'not measured - use Detect'}
              </span>
              <span className="p3d-fab-spacer" />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeSlot(i)}>Remove</button>
            </div>
          )
        })}
        <div className="p3d-fab-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={addSlot} disabled={materialNames.length === 0}>+ Add fabric part</button>
          {previewSlots.length > 0 && faceModel && settings && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? 'Hide preview' : 'Preview colours'}
            </button>
          )}
        </div>
      </div>

      {showPreview && faceModel && settings && (
        <>
          <p className="p3d-fab-help">Colour and placement preview. On the storefront the weave scale is set exactly from each variation&rsquo;s size and height.</p>
          <div className="p3d-fab-preview">
            <Viewer3d
              item={{ key: 'fabric-preview', productId, url: faceModel.url, format: faceModel.format, label: `${formatLabel(faceModel.format)} preview` }}
              settings={settings}
              fabric={{ slots: previewSlots }}
            />
          </div>
        </>
      )}

      <div className="p3d-fab-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save fabric configuration'}
        </button>
        {message && (
          <p className={`p3d-fab-msg ${message.kind === 'ok' ? 'p3d-fab-msg-ok' : 'p3d-fab-msg-err'}`}>{message.text}</p>
        )}
      </div>
    </div>
  )
}
