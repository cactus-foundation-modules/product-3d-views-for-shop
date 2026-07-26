'use client'

// The "view in 3D" control shop mounts over a product card, through the
// `shop.card-media` overlay slot. Closed, it is a small 3D badge pinned bottom-right
// of the card picture; tapped, it swaps in the full Viewer3d in place, filling the
// card's image box, with a close button that hands the picture back.
//
// The model it shows follows the picture the shopper is looking at (`activeSourceId`,
// handed down by shop's carousel):
//   - a variation photo on a fabric product -> that variation's model painted with
//     its material, fetched live from `/fabric/[child]` (shared cache with the detail
//     gallery);
//   - a variation photo on a non-fabric product -> that variation's own model, from
//     the payload's `byVariation`;
//   - the product's own photo, or a variation with nothing of its own -> `fallback`.
//
// Loaded lazily: three.js lives inside Viewer3d's own dynamic imports, so a card
// only pulls the viewer when a shopper actually taps its badge. Single live viewer -
// a grid could hold many, and each open one is a WebGL context (browsers cap around
// sixteen), so opening one broadcasts a window event every other open viewer listens
// for and closes itself.
//
// This is the point's `Overlay`, handed to shop as a prop across the RSC boundary,
// which is why it carries its own 'use client' - see modules/shop/lib/card-media.ts.

import { useEffect, useId, useState } from 'react'
import { Viewer3d } from '@/modules/product-3d-views-for-shop/components/public/Viewer3d'
import { viewerChromeCss } from '@/modules/product-3d-views-for-shop/lib/viewer-css'
import { fetchBundle } from '@/modules/product-3d-views-for-shop/lib/fabric-fetch'
import type { CardOverlayProps } from '@/modules/shop/lib/card-media'
import type { P3dCardPayload, P3dCardModel } from '@/modules/product-3d-views-for-shop/lib/types'

const OPEN_EVENT = 'p3d-card-open'

const cardCss = `
.p3d-card-btn{position:absolute;right:8px;bottom:8px;z-index:2;display:inline-flex;align-items:center;gap:5px;
  padding:5px 9px;border-radius:999px;border:1px solid var(--color-border);background:var(--color-surface);
  color:var(--color-fg);font-family:inherit;font-size:11px;font-weight:700;line-height:1;letter-spacing:.02em;
  cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.18);transition:background .15s ease}
.p3d-card-btn:hover,.p3d-card-btn:focus-visible{background:var(--color-bg-subtle)}
.p3d-card-btn:focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}
.p3d-card-btn svg{flex:none}
.p3d-card-stage{position:absolute;inset:0;z-index:3;background:var(--color-surface)}
.p3d-card-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.p3d-card-close{position:absolute;top:8px;right:8px;z-index:4;display:flex;align-items:center;justify-content:center;
  width:30px;height:30px;padding:0;border-radius:50%;border:1px solid var(--color-border);background:var(--color-surface);
  color:var(--color-fg);cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.18);transition:background .15s ease}
.p3d-card-close:hover,.p3d-card-close:focus-visible{background:var(--color-bg-subtle)}
.p3d-card-close:focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}
`

function CubeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M12 2v18M4 6.5l8 4.5 8-4.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function CardModel3dOverlay({ payload, activeSourceId }: CardOverlayProps) {
  const data = payload as P3dCardPayload | null
  const [open, setOpen] = useState(false)
  // The fabric bundle once it lands, TAGGED with the variation it resolved for - so a
  // stale result (the shopper flicked on) is ignored on render rather than juggled as
  // a second reset, which keeps every setState below inside an async callback (the
  // react-hooks/set-state-in-effect rule forbids a synchronous one).
  const [fabricState, setFabricState] = useState<{ sourceId: string; model: P3dCardModel | null } | null>(null)
  const instanceId = useId()

  // Only an OPEN viewer needs to hear that another has opened; a closed one has
  // nothing to give up. So the listener is only attached while open.
  useEffect(() => {
    if (!open) return
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== instanceId) setOpen(false)
    }
    window.addEventListener(OPEN_EVENT, onOther)
    return () => window.removeEventListener(OPEN_EVENT, onOther)
  }, [open, instanceId])

  // What we can show without a round-trip: a non-fabric variation's own model, else
  // the fallback. For a fabric variation this stands in until the bundle lands.
  const syncPick: P3dCardModel | null = data
    ? (activeSourceId ? data.byVariation[activeSourceId] : undefined) ?? data.fallback
    : null
  // A fabric product with a variation in view needs its painted bundle fetched.
  const needsFabricFetch = open && !!data?.hasFabric && !!activeSourceId

  useEffect(() => {
    if (!needsFabricFetch || !data || !activeSourceId) return
    let cancelled = false
    fetchBundle(data.parentProductId, activeSourceId)
      .then((bundle) => {
        if (cancelled) return
        // The variation's own model (or the parent's, per the resolver), painted with
        // this variation's material. No model back -> null, so render falls to syncPick.
        setFabricState({
          sourceId: activeSourceId,
          model: bundle?.modelUrl
            ? {
                item: { key: bundle.modelId, productId: activeSourceId, url: bundle.modelUrl, format: bundle.format, label: '3D model' },
                fabric: { slots: bundle.slots, realCm: bundle.realCm, scaleAxis: bundle.scaleAxis },
              }
            : null,
        })
      })
      .catch(() => { if (!cancelled) setFabricState({ sourceId: activeSourceId, model: null }) })
    return () => { cancelled = true }
  }, [needsFabricFetch, activeSourceId, data])

  if (!data?.fallback) return null

  // While a fabric bundle for the current variation is still in flight, show a
  // spinner rather than flashing the fallback model and swapping it a moment later.
  const resolvedForCurrent = needsFabricFetch && fabricState?.sourceId === activeSourceId
  const shown: P3dCardModel | null = !needsFabricFetch
    ? syncPick
    : resolvedForCurrent
      ? fabricState!.model ?? syncPick
      : null

  const openViewer = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent<string>(OPEN_EVENT, { detail: instanceId }))
    setOpen(true)
  }
  const closeViewer = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOpen(false)
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: viewerChromeCss + cardCss }} />
      {open ? (
        <div className="p3d-card-stage">
          {shown ? (
            <Viewer3d item={shown.item} settings={data.settings} fabric={shown.fabric ?? undefined} />
          ) : (
            <div className="p3d-card-loading"><span className="p3d-material-spinner" aria-hidden="true" /></div>
          )}
          <button type="button" className="p3d-card-close" aria-label="Close 3D view" onClick={closeViewer}>
            <CloseIcon />
          </button>
        </div>
      ) : (
        <button type="button" className="p3d-card-btn" aria-label="View in 3D" onClick={openViewer}>
          <CubeIcon />
          <span>3D</span>
        </button>
      )}
    </>
  )
}
