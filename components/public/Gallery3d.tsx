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
import type { P3dItem, P3dPayload } from '@/modules/product-3d-views-for-shop/lib/types'
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
  const items = visibleItems(data, activeProductId)

  // The shopper had a model on the stage and then changed variation to one that
  // does not offer it. Hand the stage back rather than leaving it showing a model
  // the strip no longer lists - the contract requires this, and it is the case
  // that produces "why am I looking at the oak one, I picked walnut".
  const stale = activeKey !== null && !items.some((i) => i.key === activeKey)
  useEffect(() => {
    if (stale) onPick(null)
  }, [stale, onPick])

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

export function Gallery3dStage({ payload, itemKey, activeProductId }: ShopGalleryExtraStageProps) {
  const data = payload as P3dPayload
  // Looked up across every item rather than the visible ones: the strip decides
  // what may be picked, and re-deciding it here would only add a second opinion
  // about which model is on the stage.
  const item = data.items.find((i) => i.key === itemKey) ?? null
  void activeProductId

  if (!item) return null
  return (
    <>
      <Style />
      <Viewer3d item={item} settings={data.settings} />
    </>
  )
}
