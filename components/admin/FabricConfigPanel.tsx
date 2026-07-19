'use client'

// The material configurator's admin panel, shown below the model list on a product
// that has variations. It maps the model's named material slots to the product's
// colour options, points the whole thing at the size and overall-height attributes,
// and saves on its own button (not the editor's), the same as the model list above.
//
// "Material" not "fabric": the same mechanism paints a woven seat, a laminate desk
// top and a veneer side panel - anything whose surface is chosen by the shopper. The
// stored shape still says fabric (FabricConfig, p3d_fabric_configs), because renaming
// a saved column buys nothing; only the words the admin reads have changed.
//
// The tile SCALE is not set by hand. The model's real-world scale is pinned by the
// "Overall height" attribute (a real cm value, set per variation), and the rest is
// measured from the mesh in the browser at config time - each material's texel
// density and each model's height in its own units - since the server never parses
// a GLB. Those measurements are baked into the saved config.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { collectMaterialNamesFrom, loadModel, measureModelHeight, measureTexelDensity } from '@/modules/product-3d-views-for-shop/lib/three/load-model'
import { formatLabel } from '@/modules/product-3d-views-for-shop/lib/formats'
import { MANUAL_COLOUR_ID, MANUAL_SIZE_ID, parseHexColour } from '@/modules/product-3d-views-for-shop/lib/fabric/constants'
import { Viewer3d } from '@/modules/product-3d-views-for-shop/components/public/Viewer3d'
import type { FabricBundle, FabricConfig, P3dAdminModel } from '@/modules/product-3d-views-for-shop/lib/types'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'
import type { FabricColourOption, FabricSizeAttribute } from '@/modules/product-3d-views-for-shop/lib/fabric/resolve'

type FabricSlot = FabricConfig['slots'][number]

const EMPTY: FabricConfig = { heightAttributeId: '', heightManual: '', modelHeights: {}, slots: [] }

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
.p3d-fab-colour{display:flex;gap:.375rem;align-items:center}
.p3d-fab-swatch{width:2.25rem;height:2rem;padding:2px;border:1px solid var(--color-border);border-radius:6px;
  background:var(--color-bg);cursor:pointer;flex:none}
.p3d-fab-hex{min-width:7rem}
.p3d-fab-num{min-width:5.5rem}
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
  const [variationOptions, setVariationOptions] = useState<FabricColourOption[]>([])
  const [colourAttributes, setColourAttributes] = useState<FabricColourOption[]>([])
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
      .then((data: { config: FabricConfig | null; options: FabricColourOption[]; colourAttributes: FabricColourOption[]; attributes: FabricSizeAttribute[]; models: P3dAdminModel[]; settings: P3dConfig } | null) => {
        if (cancelled || !data) { setLoading(false); return }
        // The same GLB is attached once per variation, so the raw model list repeats
        // each file dozens of times (one p3d_models row per variation). A model height
        // is a fact about the FILE, and the storefront reads it by url, so a saved
        // height key that lands on a non-representative row must be pulled back to its
        // file's stand-in row - else its measured height is lost. Canonicalise every
        // modelHeights key to the first-seen row for its url before anything reads it.
        const repByUrl = new Map<string, string>()
        for (const m of data.models) if (!repByUrl.has(m.url)) repByUrl.set(m.url, m.id)
        const canon = (id: string): string => {
          const m = data.models.find((x) => x.id === id)
          return m ? repByUrl.get(m.url) ?? id : id
        }
        const raw = data.config ?? EMPTY
        const saved: FabricConfig = {
          ...raw,
          modelHeights: Object.fromEntries(Object.entries(raw.modelHeights).map(([k, v]) => [canon(k), v])),
        }
        setConfig(saved)
        // Seed the densities from what was measured on the last save, so the panel
        // is usable before a re-detect and a save without one keeps them.
        setDensities(Object.fromEntries(saved.slots.map((s) => [s.materialName, s.texelDensity])))
        setVariationOptions(data.options)
        setColourAttributes(data.colourAttributes ?? [])
        setAttributes(data.attributes)
        setModels(data.models)
        setSettings(data.settings)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [productId])

  // Both colour sources as one list, for everything that only needs to look a slot's
  // stored id up - the preview above all. Picture-swatch attributes are the only thing
  // the dropdown offers now, but a config saved when variation options were on offer
  // still points at one, and it goes on being painted; leaving those out here would
  // blank the preview of a product that works perfectly well on the storefront.
  // Attribute ids arrive prefixed from the server, so the two can never collide.
  const colourSources = useMemo(
    () => [...variationOptions, ...colourAttributes],
    [variationOptions, colourAttributes],
  )

  // One entry per distinct model FILE for the pickers. The raw list carries a row
  // per variation, so the same GLB repeats dozens of times; the configurator only
  // ever names one file, so each url is offered once (its first-seen row as the
  // id). Config ids were canonicalised to these same stand-in rows on load.
  const distinctModels = useMemo(() => {
    const byUrl = new Map<string, P3dAdminModel>()
    for (const m of models) if (!byUrl.has(m.url)) byUrl.set(m.url, m)
    return [...byUrl.values()]
  }, [models])

  // The model to read material names from and to preview against: any attached model
  // as a stand-in. Its fabric parts are assumed shared across the product's models -
  // the storefront paints whichever model the chosen variation carries by the same
  // named slots.
  const faceModel = distinctModels[0]

  // Every attached model's height is measured, so whichever one a variation carries
  // calibrates on the storefront. Heights are keyed and read by file url downstream,
  // so measuring each distinct file once is enough.
  const configuredIds = useMemo(() => distinctModels.map((m) => m.id), [distinctModels])

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

  // Read the model on demand and SAY what happened: the button measures silently
  // in the effect above, so a manual press that changed nothing on screen (the
  // materials were already read on load) read as a dead button. Every press now
  // reports the parts it found, an empty model, or the reason the file would not
  // load - the last of which used to vanish into a swallowed catch.
  const detect = () => {
    setMeasuring(true)
    setMessage(null)
    measureConfigured(faceModel, configuredIds, models)
      .then((m) => {
        applyMeasurement(m)
        setMessage(
          m.names.length > 0
            ? { kind: 'ok', text: `Read ${m.names.length} material ${m.names.length === 1 ? 'part' : 'parts'} from the model: ${m.names.join(', ')}.` }
            : { kind: 'err', text: 'That model has no named materials to texture. Re-export it with its materials named, then try again.' },
        )
      })
      .catch((error) => {
        setMessage({ kind: 'err', text: `Could not read the model: ${error instanceof Error ? error.message : 'the file could not be loaded'}.` })
      })
      .finally(() => setMeasuring(false))
  }

  const setSlot = (i: number, patch: Partial<FabricSlot>) =>
    setConfig((c) => ({ ...c, slots: c.slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }))
  const removeSlot = (i: number) =>
    setConfig((c) => ({ ...c, slots: c.slots.filter((_, idx) => idx !== i) }))
  const addSlot = () => {
    const used = new Set(config.slots.map((s) => s.materialName))
    const name = materialNames.find((n) => !used.has(n)) ?? materialNames[0] ?? ''
    const colour = guessByName(name, colourAttributes, (o) => o.name)
    setConfig((c) => ({
      ...c,
      slots: [
        ...c.slots,
        {
          materialName: name,
          // With no picture-swatch attributes on the site at all, a fixed colour is the
          // only route there is, so a new part lands there rather than on an empty
          // dropdown.
          colourOptionId: colour?.id ?? colourAttributes[0]?.id ?? MANUAL_COLOUR_ID,
          colourManual: '',
          // Legacy fields, kept empty: the swatch's size comes from the material it was
          // picked from, not from anything set here. See lib/db/fabric-config.ts.
          sizeAttributeId: '',
          sizeManual: '',
          rotationDeg: 0,
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
        setMessage({ kind: 'err', text: body.error ?? 'Could not save the material configuration.' })
      }
    } catch {
      setMessage({ kind: 'err', text: 'Could not save the material configuration.' })
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
        .map((slot): FabricBundle['slots'][number] | null => {
          // A fixed colour previews exactly as the storefront will paint it: there
          // is no per-variation swatch involved, so this one is not a ballpark.
          if (slot.colourOptionId === MANUAL_COLOUR_ID) {
            const colour = parseHexColour(slot.colourManual)
            return colour ? { materialName: slot.materialName, textureUrl: '', colour, repeat: 1, rotationDeg: 0 } : null
          }
          const opt = colourSources.find((o) => o.id === slot.colourOptionId)
          const swatch = opt?.values.find((v) => v.swatch && /^https?:\/\//.test(v.swatch))?.swatch
          // A source whose values are plain hex colours rather than pictures paints
          // flat, exactly as the storefront will: its first colour stands in for the
          // choice the shopper has not made yet.
          if (!swatch) {
            const flat = opt?.values.map((v) => parseHexColour(v.swatch ?? '')).find((c): c is string => c !== null)
            return flat ? { materialName: slot.materialName, textureUrl: '', colour: flat, repeat: 1, rotationDeg: 0 } : null
          }
          const density = densities[slot.materialName] ?? 0
          const repeat = density > 0 ? Math.min(50, Math.max(0.01, 1 / (density * 20))) : 1
          return { materialName: slot.materialName, textureUrl: swatch, colour: null, repeat, rotationDeg: slot.rotationDeg }
        })
        .filter((s): s is FabricBundle['slots'][number] => s !== null),
    [config.slots, colourSources, densities],
  )

  // Shown as soon as the product's models can be read. It used to hide itself when
  // the site had no size attributes, on the grounds that there was nothing to scale
  // against - but every measurement can now be typed in by hand, so a site without
  // the product-attributes module can configure the whole thing, and hiding the panel
  // would only leave the admin wondering where it went. (The parent mounts this only
  // for a product with variations.)
  if (loading) return null

  const materialOptions = (current: string): string[] =>
    materialNames.includes(current) || !current ? materialNames : [current, ...materialNames]

  return (
    <div className="p3d-fab">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div>
        <h4 className="p3d-fab-h">Material configurator</h4>
        <p className="p3d-fab-help">
          Re-texture the model live from the shopper&rsquo;s choices instead of uploading a separate file per finish.
          Point each material part of the model - upholstery, wood, laminate, metal, whatever the shopper gets to choose -
          at the picture swatch attribute your finishes live under. On the storefront the model shown is the one attached to the variation the
          shopper picks, painted with their chosen materials. The texture is scaled to true size automatically, from the
          swatch size recorded against each picture swatch on the Attributes screen and the overall height below - no
          fiddling with tile scale by hand. A swatch with no size set simply goes untiled until you give it one.
          A part the shopper does not get a say in -
          a painted frame, a powder-coated leg - can be set to <strong>Manual</strong> and given one fixed colour instead,
          and any part whose grain or weave came out of the modelling software lying the wrong way round can be turned
          with <strong>Rotation</strong> rather than sent back for a re-export.
        </p>
      </div>

      {/* Overall height: the one attribute that pins each model's real-world scale.
          The model shown on the storefront is the variation's own attached file, so
          there is nothing to pick here - only the height to calibrate against. */}
      <div className="p3d-fab-sec">
        <p className="p3d-fab-sub">Overall height</p>
        <div className="p3d-fab-row">
          <div className="p3d-fab-field">
            <label className="p3d-fab-label">Overall height from</label>
            <select className="p3d-fab-select" value={config.heightAttributeId} onChange={(e) => setConfig((c) => ({ ...c, heightAttributeId: e.target.value }))}>
              <option value="">attribute…</option>
              {attributes.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
              <option value={MANUAL_SIZE_ID}>Manual</option>
            </select>
          </div>
          {/* Manual: one height for every variation, typed here. Worth having for a
              product that varies in colour but not in size, and the only route at all
              on a site without the product-attributes module. */}
          {config.heightAttributeId === MANUAL_SIZE_ID && (
            <div className="p3d-fab-field">
              <label className="p3d-fab-label">Overall height</label>
              <input
                type="text"
                className="p3d-fab-select"
                value={config.heightManual}
                placeholder="e.g. 72cm"
                onChange={(e) => setConfig((c) => ({ ...c, heightManual: e.target.value }))}
              />
            </div>
          )}
          <p className="p3d-fab-help" style={{ flex: 1, minWidth: '12rem' }}>
            The product&rsquo;s real overall height in cm. It pins the model&rsquo;s true size so the texture scales
            correctly. Point it at an attribute when the height changes from one variation to the next, or choose
            <strong> Manual</strong> and type it once when every variation stands the same height. An attribute this
            product uses more than once appears once per copy, under the name you gave each. The configurator
            lights up once at least one material part is set below.
          </p>
        </div>
      </div>

      {/* Material parts: named material slots, painted from a colour option. */}
      <div className="p3d-fab-sec">
        <div className="p3d-fab-actions">
          <p className="p3d-fab-sub" style={{ margin: 0 }}>Material parts</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={detect} disabled={measuring || !faceModel}>
            {measuring ? 'Reading model…' : 'Detect from model'}
          </button>
          {!faceModel && <span className="p3d-fab-help">Attach a 3D model to this product first.</span>}
          {message && (
            <p className={`p3d-fab-msg ${message.kind === 'ok' ? 'p3d-fab-msg-ok' : 'p3d-fab-msg-err'}`} style={{ margin: 0 }}>{message.text}</p>
          )}
        </div>
        {materialNames.length === 0 && (
          <p className="p3d-fab-help">
            No material parts read from the model yet. Attach a 3D model to this product, then use <strong>Detect from model</strong>.
          </p>
        )}
        {config.slots.map((slot, i) => {
          const measured = (densities[slot.materialName] ?? 0) > 0
          // A part painted a fixed colour has no swatch and so nothing to scale or
          // turn: its size, rotation and "measured" tag are all beside the point and
          // would only invite the admin to fill in numbers that do nothing.
          const manualColour = slot.colourOptionId === MANUAL_COLOUR_ID
          const hex = parseHexColour(slot.colourManual)
          // A variation option this slot was pointed at before the dropdown narrowed to
          // picture-swatch attributes. Offered back as its own entry so opening the
          // panel does not quietly re-point a working product at something else; there
          // is no way to pick one that is not already stored.
          const legacySource = variationOptions.find((o) => o.id === slot.colourOptionId)
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
                {/* Picture-swatch attributes only, plus a fixed colour. They are the
                    only source that carries both halves of what a real material needs -
                    the picture and the real-world size of it - so a part pointed at one
                    is scaled as well as coloured, with nothing else to keep in step. An
                    attribute the product uses more than once is listed once per helping,
                    under the name that helping goes by, so "Seat fabric" and "Back
                    fabric" off one Fabric vocabulary are pickable apart rather than
                    collapsing into one entry.
                    A config saved when variation options were on offer keeps whatever
                    it points at - shown here as its stored entry so it is not silently
                    re-pointed by opening this panel. */}
                <select className="p3d-fab-select" value={slot.colourOptionId} onChange={(e) => setSlot(i, { colourOptionId: e.target.value })}>
                  <option value="">material…</option>
                  {colourAttributes.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                  {legacySource && <option value={slot.colourOptionId}>{legacySource.name} (variation option)</option>}
                  <option value={MANUAL_COLOUR_ID}>Manual</option>
                </select>
              </div>
              {/* Manual: one fixed colour for this part, the same on every variation.
                  The picker and the box are the same value from two directions - the
                  picker for choosing one, the box for pasting a brand hex. */}
              {manualColour && (
                <div className="p3d-fab-field">
                  <label className="p3d-fab-label">Colour</label>
                  <div className="p3d-fab-colour">
                    <input
                      type="color"
                      className="p3d-fab-swatch"
                      aria-label={`Colour for ${slot.materialName || 'this part'}`}
                      value={hex ?? '#cccccc'}
                      onChange={(e) => setSlot(i, { colourManual: e.target.value })}
                    />
                    <input
                      type="text"
                      className="p3d-fab-select p3d-fab-hex"
                      value={slot.colourManual}
                      placeholder="#7a5c3a"
                      onChange={(e) => setSlot(i, { colourManual: e.target.value })}
                    />
                  </div>
                </div>
              )}
              {/* No size field: the swatch's real-world size is set on the picture
                  swatch itself, over on the Attributes screen, and travels with it. */}
              {/* Which way round the texture lies on this part. Degrees rather than a
                  set of quarter turns, because a grain that runs at an angle across a
                  moulded panel is not always a multiple of 90. */}
              {!manualColour && (
                <div className="p3d-fab-field">
                  <label className="p3d-fab-label">Rotation</label>
                  <input
                    type="number"
                    step={15}
                    className="p3d-fab-select p3d-fab-num"
                    value={slot.rotationDeg}
                    placeholder="0"
                    onChange={(e) => setSlot(i, { rotationDeg: Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0 })}
                  />
                </div>
              )}
              {manualColour ? (
                <span className={`p3d-fab-tag ${hex ? 'p3d-fab-tag-ok' : 'p3d-fab-tag-warn'}`}>
                  {hex ? 'fixed colour' : 'not a colour - use #rrggbb'}
                </span>
              ) : (
                <span className={`p3d-fab-tag ${measured ? 'p3d-fab-tag-ok' : 'p3d-fab-tag-warn'}`}>
                  {measured ? 'texture scale measured' : 'not measured - use Detect'}
                </span>
              )}
              <span className="p3d-fab-spacer" />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeSlot(i)}>Remove</button>
            </div>
          )
        })}
        <div className="p3d-fab-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={addSlot} disabled={materialNames.length === 0}>+ Add material part</button>
          {previewSlots.length > 0 && faceModel && settings && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? 'Hide preview' : 'Preview colours'}
            </button>
          )}
        </div>
      </div>

      {showPreview && faceModel && settings && (
        <>
          <p className="p3d-fab-help">Colour and placement preview. On the storefront the texture scale is set exactly from each part&rsquo;s size and the variation&rsquo;s height.</p>
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
          {saving ? 'Saving…' : 'Save material configuration'}
        </button>
        {message && (
          <p className={`p3d-fab-msg ${message.kind === 'ok' ? 'p3d-fab-msg-ok' : 'p3d-fab-msg-err'}`}>{message.text}</p>
        )}
      </div>
    </div>
  )
}
