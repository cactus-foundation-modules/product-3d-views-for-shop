'use client'

// The browser halves of shop's `shop.gallery-media` point: extra thumbnails in the
// product gallery's strip, and the viewer that takes over the stage when one is
// picked. Shop hands us its own class names and we render into them, so a 3D
// thumbnail is styled by the layout it sits in - the shopper sees one strip, not
// ours bolted next to shop's.
//
// Both components are handed to shop as props across the RSC boundary, which is
// exactly why they carry their own 'use client' boundary - see the contract note
// in modules/shop/lib/gallery-media.ts.

import { useEffect, useRef, useState } from 'react'
import { visibleItems } from '@/modules/product-3d-views-for-shop/lib/visible-items'
import { loadModel } from '@/modules/product-3d-views-for-shop/lib/three/load-model'
import { mountThumb } from '@/modules/product-3d-views-for-shop/lib/three/thumb-stage'
import { Viewer3d } from '@/modules/product-3d-views-for-shop/components/public/Viewer3d'
import type { P3dItem, P3dPayload, FabricBundle } from '@/modules/product-3d-views-for-shop/lib/types'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'
import type { ShopGalleryExtraStageProps, ShopGalleryExtraThumbsProps } from '@/modules/shop/lib/gallery-media'

// The single synthetic thumbnail the configurator contributes, in place of one per
// model file it owns. Its own reserved key, meaningless to shop, which only ever
// hands it back to Gallery3dStage.
const FABRIC_KEY = 'fabric-configurator'

// The models the configurator drives - its default plus every structural-option
// model. These collapse into one configurator thumbnail rather than listing each.
function configuratorModelKeys(payload: P3dPayload): Set<string> {
  const fabric = payload.fabric
  if (!fabric) return new Set()
  return new Set([fabric.defaultModelId, ...fabric.models.map((m) => m.modelId)].filter(Boolean))
}

// The strip's items when the configurator is on: one configurator thumbnail (drawn
// from the default model so it shows the actual product), followed by any models
// that are NOT part of the configurator, which still list on their own as before.
// Without a fabric config, or before a variation is chosen, this is exactly
// visibleItems - the configurator has nothing to re-texture until the shopper has
// picked a variation, so its thumbnail stays off the strip rather than showing an
// unconfigured guess.
function thumbItems(payload: P3dPayload, activeProductId: string | null): P3dItem[] {
  const raw = visibleItems(payload, activeProductId)
  const fabric = payload.fabric
  if (!fabric || activeProductId === null) return raw

  const owned = configuratorModelKeys(payload)
  const others = raw.filter((i) => !owned.has(i.key))
  // The default model's file backs the configurator thumbnail; failing that, any
  // configurator model that is actually attached, failing that the first item.
  const face =
    payload.items.find((i) => i.key === fabric.defaultModelId) ??
    payload.items.find((i) => owned.has(i.key)) ??
    raw[0]
  const configItem: P3dItem = {
    key: FABRIC_KEY,
    productId: payload.parentProductId,
    url: face?.url ?? '',
    format: face?.format ?? 'glb',
    label: '3D configurator',
  }
  return [configItem, ...others]
}

// The model + empty paints to show before a full variant resolves (activeProductId
// null) or when a resolve turns up nothing: the default model, unpainted. Resolved
// from the payload the page already carries, so no round-trip for the opening view.
function defaultBundle(payload: P3dPayload): FabricBundle | null {
  const fabric = payload.fabric
  if (!fabric) return null
  const item =
    payload.items.find((i) => i.key === fabric.defaultModelId) ??
    payload.items.find((i) => fabric.models.some((m) => m.modelId === i.key)) ??
    payload.items[0]
  if (!item) return null
  return { modelId: item.key, modelUrl: item.url, format: item.format, slots: [] }
}

// Scoped to this module's own class names, so nothing here can reach shop's
// chrome. Colours are tokens throughout - the pill has to stay legible against
// whatever a site's theme puts behind it, in both light and dark.
const css = `
.p3d-thumb{position:relative}
.p3d-thumb-canvas{width:100%;height:100%;display:block;background:var(--color-bg-subtle)}
.p3d-pill{position:absolute;right:3px;bottom:3px;z-index:1;pointer-events:none;
  font-size:9px;font-weight:700;letter-spacing:.03em;line-height:1;padding:2px 4px;border-radius:4px;
  background:var(--color-fg);color:var(--color-bg);opacity:.9}
.p3d-stage{width:100%;height:100%;position:relative;background:var(--color-bg-subtle)}
.p3d-stage-canvas{width:100%;height:100%;display:block;touch-action:none;cursor:grab}
.p3d-stage-canvas:active{cursor:grabbing}
.p3d-note{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  text-align:center;padding:1rem;font-size:.8125rem;color:var(--color-text-muted)}
.p3d-hint{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);z-index:1;pointer-events:none;
  font-size:11px;line-height:1;padding:5px 9px;border-radius:999px;
  background:var(--color-fg);color:var(--color-bg);opacity:.75;white-space:nowrap}
@media (prefers-reduced-motion:reduce){.p3d-stage-canvas{cursor:default}}
`

function Style() {
  return <style dangerouslySetInnerHTML={{ __html: css }} />
}

// One auto-rotating thumbnail. The canvas is plain 2D and is painted by the
// shared renderer (lib/three/thumb-stage.ts) - see there for why every thumbnail
// on the page draws through a single WebGL context rather than one each.
function Thumb3d({ item, settings, active, thumbClass, thumbOnClass, onPick }: {
  item: P3dItem
  settings: P3dConfig
  active: boolean
  thumbClass: string
  thumbOnClass: string
  onPick: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let teardown: (() => void) | null = null
    let cancelled = false

    // Backing store in device pixels; the CSS box is what sizes it on screen.
    // Left at a fixed 64 rather than measured: shop's thumbnails are 64px, this
    // never needs to be sharper than the box it is blitted into, and measuring
    // would mean a layout read per thumbnail on every mount.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(64 * dpr)
    canvas.height = Math.round(64 * dpr)

    loadModel(item.url, item.format)
      .then(async (model) => {
        if (cancelled) return
        teardown = await mountThumb(canvas, model, settings)
        if (!teardown) setFailed(true)
        // Mounted after the await resolved but cancelled meanwhile: tear it
        // straight back down, or a model outlives the thumbnail that asked for it.
        if (cancelled) { teardown?.(); teardown = null }
      })
      .catch(() => { if (!cancelled) setFailed(true) })

    return () => { cancelled = true; teardown?.() }
    // settings is page-static (server-resolved, never changes without a reload
    // that remounts this), so it is read at mount rather than watched - watching a
    // fresh object each render would rebuild every thumbnail on the page on every
    // parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.url, item.format])

  return (
    <button
      type="button"
      onClick={onPick}
      className={`${active ? thumbOnClass : thumbClass} p3d-thumb`}
      aria-label={`Show the ${item.label} of this product`}
      aria-pressed={active}
    >
      <canvas ref={canvasRef} className="p3d-thumb-canvas" aria-hidden="true" />
      {/* The pill is what tells a shopper this thumbnail is not another photo.
          It stays put even when the model could not be drawn - the thumbnail is
          still the way into the viewer, which may yet work on a retry. */}
      <span className="p3d-pill">3D</span>
      {failed && <span className="sr-only">3D preview unavailable</span>}
    </button>
  )
}

export function Gallery3dThumbs({ payload, activeProductId, activeKey, onPick, thumbClass, thumbOnClass }: ShopGalleryExtraThumbsProps) {
  const data = payload as P3dPayload
  const items = thumbItems(data, activeProductId)

  // The shopper had a model on the stage and then changed variation to one that
  // does not offer it. Hand the stage back rather than leaving it showing a model
  // the strip no longer lists - the contract requires this, and it is the case
  // that produces "why am I looking at the oak one, I picked walnut". The
  // configurator thumbnail is never stale - it applies to every variant, and is
  // always in `items` while a fabric config is present, so this drops it never.
  const stale = activeKey !== null && !items.some((i) => i.key === activeKey)
  useEffect(() => {
    if (stale) onPick(null)
  }, [stale, onPick])

  // Lead the stage with the model instead of waiting for a click: a product that
  // carries a 3D view opens on the thing the shopper can spin, not on a flat photo
  // they then have to hunt past. Fires once, on first paint, and only when a model
  // is actually on offer for the opening view - a later variation change that
  // brings a model in must not yank the stage away from a photo the shopper chose.
  const ledWithModel = useRef(false)
  useEffect(() => {
    if (ledWithModel.current) return
    ledWithModel.current = true
    const first = items[0]
    if (activeKey === null && first) onPick(first.key)
    // Read once on mount - the opening view is a one-shot decision, so items,
    // activeKey and onPick are deliberately not dependencies here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (items.length === 0) return null

  return (
    <>
      <Style />
      {items.map((item) => (
        <Thumb3d
          key={item.key}
          item={item}
          settings={data.settings}
          active={item.key === activeKey}
          thumbClass={thumbClass}
          thumbOnClass={thumbOnClass}
          onPick={() => onPick(item.key)}
        />
      ))}
    </>
  )
}

// The stage for the configurator thumbnail: one model, re-textured live from the
// shopper's choices. It fetches the resolved fabric bundle for whichever variant
// child is currently active and hands Viewer3d the model url and the paints; a
// colour change repaints in place, a headrest change swaps the model file, both
// handled inside Viewer3d.
function FabricStage({ payload, activeProductId }: { payload: P3dPayload; activeProductId: string | null }) {
  // Resolved bundles cached by child id, so flicking back to a colour already seen
  // is instant and does not re-hit the endpoint. Held as state (not a ref) so a
  // freshly fetched bundle re-renders the stage; the DISPLAYED bundle is derived in
  // render below rather than set from inside the effect, which keeps the effect's
  // only job the async fetch and its only setState inside a promise callback.
  const [cache, setCache] = useState<Map<string, FabricBundle | null>>(() => new Map())

  useEffect(() => {
    // The opening view (no full combination yet) and any child already resolved
    // need no fetch - both are derived in render below.
    if (activeProductId === null || cache.has(activeProductId)) return

    let cancelled = false
    const url = `/api/m/product-3d-views-for-shop/fabric/x?parent=${encodeURIComponent(payload.parentProductId)}&child=${encodeURIComponent(activeProductId)}`
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<FabricBundle | null>) : null))
      .then((resolved) => {
        if (!cancelled) setCache((prev) => new Map(prev).set(activeProductId, resolved ?? null))
      })
      .catch(() => {
        // A child the resolver could not place (missing config, absent companion
        // tables) is cached as null, and the render below falls it back to the
        // default model rather than leaving an empty stage.
        if (!cancelled) setCache((prev) => new Map(prev).set(activeProductId, null))
      })

    return () => { cancelled = true }
    // payload is page-static (parentProductId, items and fabric are all constant for
    // the life of the page); cache is read only as a guard, so the active child is
    // the one thing that drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProductId])

  // Default model before a combination resolves or while a resolve is in flight,
  // the resolved bundle once it lands, the default again for a child that resolved
  // to nothing.
  const resolved = activeProductId === null ? undefined : cache.get(activeProductId)
  const bundle = resolved ?? defaultBundle(payload)
  if (!bundle) return null
  return (
    <Viewer3d
      item={{ key: FABRIC_KEY, url: bundle.modelUrl, format: bundle.format, productId: payload.parentProductId, label: '3D configurator' }}
      settings={payload.settings}
      fabric={{ slots: bundle.slots }}
    />
  )
}

export function Gallery3dStage({ payload, itemKey, activeProductId }: ShopGalleryExtraStageProps) {
  const data = payload as P3dPayload

  // The configurator takes the stage on its own key, re-texturing one model from
  // the active variant rather than showing a fixed file.
  if (itemKey === FABRIC_KEY && data.fabric) {
    return (
      <>
        <Style />
        <FabricStage payload={data} activeProductId={activeProductId} />
      </>
    )
  }

  // Looked up across every item rather than the visible ones: the strip decides
  // what may be picked, and re-deciding it here would only add a second opinion
  // about which model is on the stage.
  const item = data.items.find((i) => i.key === itemKey) ?? null
  if (!item) return null
  return (
    <>
      <Style />
      <Viewer3d item={item} settings={data.settings} />
    </>
  )
}
