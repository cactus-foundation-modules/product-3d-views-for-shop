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
import { preloadProductAssets } from '@/modules/product-3d-views-for-shop/lib/preload'
import { mountThumb } from '@/modules/product-3d-views-for-shop/lib/three/thumb-stage'
import { Viewer3d } from '@/modules/product-3d-views-for-shop/components/public/Viewer3d'
import type { P3dItem, P3dPayload, FabricBundle } from '@/modules/product-3d-views-for-shop/lib/types'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'
import type { ShopGalleryExtraStageProps, ShopGalleryExtraThumbsProps } from '@/modules/shop/lib/gallery-media'

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
.p3d-reset{position:absolute;right:8px;bottom:8px;z-index:2;cursor:pointer;border:none;
  font-family:inherit;font-size:11px;line-height:1;padding:5px 9px;border-radius:999px;
  background:var(--color-fg);color:var(--color-bg);opacity:.6;white-space:nowrap;
  transition:opacity .15s ease}
.p3d-reset:hover,.p3d-reset:focus-visible{opacity:.9}
@media (prefers-reduced-motion:reduce){.p3d-reset{transition:none}}
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

  // Hold the last variation the shopper fully settled on. Mid-change - they've
  // switched one option and not yet repicked the others - shop hands us a null
  // activeProductId, since no whole combination resolves. Left to itself that
  // pulls the chosen variation's model straight off the strip and hands the stage
  // back to a photo, so a shopper reconfiguring watches the 3D view they were
  // studying blink out on every partial step. Keep showing the last resolved
  // variation's model through that gap; we only trade the remembered id for a new
  // one once a full variation resolves again (activeProductId goes non-null).
  const [lastResolved, setLastResolved] = useState<string | null>(activeProductId)
  if (activeProductId !== null && activeProductId !== lastResolved) setLastResolved(activeProductId)
  const effectiveProductId = activeProductId ?? lastResolved

  const items = visibleItems(data, effectiveProductId)

  // The shopper had a model on the stage and then changed variation to one that
  // does not offer it. Hand the stage back rather than leaving it showing a model
  // the strip no longer lists - the contract requires this, and it is the case
  // that produces "why am I looking at the oak one, I picked walnut".
  const stale = activeKey !== null && !items.some((i) => i.key === activeKey)
  useEffect(() => {
    if (stale) onPick(null)
  }, [stale, onPick])

  // Lead the stage with the model instead of waiting for a click: a product that
  // carries a 3D view opens on the thing the shopper can spin, not on a flat photo
  // they then have to hunt past. Fires once, on first paint, and only when a model
  // is actually on offer for the opening view - a later variation change is handled
  // by the effect below instead.
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

  // Once the shopper has settled on a full variation that carries its own 3D model,
  // lead the stage with that model - it is the exact thing they configured, painted
  // live below, so it should be what they are looking at rather than the product's
  // generic view. Fires on each variation change (not every render), so a shopper
  // who then clicks a photo is not fought for the stage.
  useEffect(() => {
    if (activeProductId === null) return
    const own = items.find((i) => i.productId === activeProductId)
    if (own && activeKey !== own.key) onPick(own.key)
    // Keyed on the chosen variation alone; items/activeKey/onPick are read as the
    // source, not triggers, and watching them would re-lead on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProductId])

  // Warm the model and swatch caches in the background once the page has settled, so a
  // later variation change paints from memory instead of fetching. Scheduled on idle
  // so it trails first paint rather than competing with it, and aborted on unmount so
  // a shopper who leaves does not leave a preload running. A real pick that lands mid
  // preload is not fought: it shares the same cached promise (see load-model.ts).
  useEffect(() => {
    const controller = new AbortController()
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }
    const w = window as IdleWindow
    let idle: number | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const start = (): void => { void preloadProductAssets(data, controller.signal) }
    // requestIdleCallback where the browser has it (it waits for a genuine lull); a
    // short timeout everywhere else (Safari has no rIC), so the preload always trails
    // first paint rather than landing in the middle of it.
    if (typeof w.requestIdleCallback === 'function') {
      idle = w.requestIdleCallback(start, { timeout: 3000 })
    } else {
      timer = setTimeout(start, 1200)
    }
    return () => {
      controller.abort()
      if (idle !== null) w.cancelIdleCallback?.(idle)
      if (timer !== null) clearTimeout(timer)
    }
    // Runs once on mount. `data` is the server-resolved, page-static payload - it does
    // not change without a navigation that remounts this - so it is read here rather
    // than watched, matching how the thumbnails and viewer treat settings.
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

// Resolved fabric bundles held by parent|child, so flicking back to a colour already
// seen paints from memory rather than re-resolving it server-side. Module-scoped and
// keyed by the pair the resolver itself keys on; a page's worth of colours is a bounded
// set, and the data is per-variation catalogue data that does not change under the
// shopper. Holds the PROMISE, so two picks of the same child in quick succession share
// one request rather than racing - the same bargain the model and texture caches make.
const bundleCache = new Map<string, Promise<FabricBundle | null>>()

function fetchBundle(parentProductId: string, childProductId: string): Promise<FabricBundle | null> {
  const key = `${parentProductId}|${childProductId}`
  let entry = bundleCache.get(key)
  if (!entry) {
    const url = `/api/m/product-3d-views-for-shop/fabric/x?parent=${encodeURIComponent(parentProductId)}&child=${encodeURIComponent(childProductId)}`
    entry = fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<FabricBundle | null>) : null))
      // A failed resolve must not be cached, or a shopper whose connection blipped is
      // handed the same failure for that colour for the rest of their visit.
      .catch((error) => {
        bundleCache.delete(key)
        throw error
      })
    bundleCache.set(key, entry)
  }
  return entry
}

// The stage for a variation's own model: the picked file, re-textured live from the
// shopper's choices. It fetches the resolved fabric slots for the variation the model
// hangs off and hands Viewer3d the paints; a colour change repaints in place, handled
// inside Viewer3d.
//
// This component is NOT remounted on a variation change (see the call site) - it
// persists, so the WebGL context and the model on it survive a colour pick and only
// the painted texture changes. That is what makes a colour change cheap.
function PaintedStage({ payload, item }: { payload: P3dPayload; item: P3dItem }) {
  // The resolved slots, or null before the first fetch lands - rendered unpainted until
  // then. On a LATER colour change the previous colours deliberately stay on screen
  // while the new bundle is in flight: the model is already correct and only its fabric
  // is about to change, so holding the old texture for that moment reads as the colour
  // updating, where blanking to unpainted would read as the model breaking and coming
  // back.
  const [slots, setSlots] = useState<FabricBundle['slots'] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchBundle(payload.parentProductId, item.productId)
      .then((bundle) => {
        // A variation the resolver could not place (missing config, absent companion
        // tables) resolves to no paints, and the model stays on the stage unpainted
        // rather than vanishing.
        if (!cancelled) setSlots(bundle?.slots ?? [])
      })
      .catch(() => { if (!cancelled) setSlots([]) })
    return () => { cancelled = true }
    // payload.parentProductId is page-static; the variation whose model this is drives
    // the fetch, and a cached bundle resolves on the spot.
  }, [payload.parentProductId, item.productId])

  return <Viewer3d item={item} settings={payload.settings} fabric={{ slots: slots ?? [] }} />
}

export function Gallery3dStage({ payload, itemKey }: ShopGalleryExtraStageProps) {
  const data = payload as P3dPayload

  // Looked up across every item rather than the visible ones: the strip decides
  // what may be picked, and re-deciding it here would only add a second opinion
  // about which model is on the stage.
  const item = data.items.find((i) => i.key === itemKey) ?? null
  if (!item) return null

  // A variation's own model, on a product configured for fabric, is painted live
  // from that variation's chosen colours. The product's own models (and any model
  // on a product with no fabric config) show as plain 3D views.
  const painted = Boolean(data.fabric) && item.productId !== data.parentProductId
  return (
    <>
      <Style />
      {painted
        // Deliberately NOT keyed by item.productId. A colour change is a different
        // variant child, so keying on it remounted this whole subtree on every colour
        // pick - tearing down the WebGL context and rebuilding it (new renderer, a
        // freshly generated PMREM environment, the model re-cloned and re-uploaded to
        // the GPU, re-framed, shadow catcher rebuilt) for what is only a change of
        // texture on one material. That rebuild, not the texture fetch, was the bulk
        // of the seconds a shopper waited on each option change, and it made Viewer3d's
        // whole repaint-in-place path unreachable for the exact case it was written
        // for. Unkeyed, the viewer persists: Viewer3d rebuilds only when item.url
        // genuinely changes (a headrest-style model swap), and a plain colour change
        // repaints in place.
        ? <PaintedStage payload={data} item={item} />
        : <Viewer3d item={item} settings={data.settings} />}
    </>
  )
}
