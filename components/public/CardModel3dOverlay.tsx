'use client'

// The "view in 3D" control shop mounts over a product card, through the
// `shop.card-media` overlay slot. Closed, it is a small 3D badge pinned bottom-right
// of the card picture; tapped, it swaps in the full Viewer3d in place, filling the
// card's image box, with a close button that hands the picture back.
//
// Open, the stage carries its OWN prev/next arrows - the card's own carousel arrows
// sit behind the stage while it is up, so these stand in for them, stepping the model
// through each variation rather than the still pictures. They walk a list of "slides"
// built from the payload:
//   - a FABRIC product -> one slide per enabled variation (`variationChildIds`, matrix
//     order), each fetched live from `/fabric/[child]` (model + its material), the same
//     endpoint the detail gallery uses. The previous variation's model stays on screen
//     while the next one loads, so a step never blanks to a spinner mid-browse;
//   - a NON-fabric product -> the product's own model (when it has one) first, then one
//     slide per variation that carries its own model (`byVariation`, same order). These
//     are already resolved, so stepping is instant.
//
// Which slide it opens on follows the picture the shopper was looking at when they
// tapped (`activeSourceId`, handed down by shop's carousel): that variation's slide if
// it has one, else the opening view (a fabric product's default variation, or the
// product's own model). Closing hands the card's own picture and arrows back untouched,
// so the browse is a self-contained detour - modal, not a hijack of the carousel.
//
// The painted-fabric bundles are tagged with the variation they resolved for, so a
// stale result (the shopper stepped on) is ignored on render rather than juggled as a
// second reset - which keeps every setState below inside an async callback (the
// react-hooks/set-state-in-effect rule forbids a synchronous one).
//
// Loaded lazily: three.js lives inside Viewer3d's own dynamic imports, so a card
// only pulls the viewer when a shopper actually taps its badge. Single live viewer -
// a grid could hold many, and each open one is a WebGL context (browsers cap around
// sixteen), so opening one broadcasts a window event every other open viewer listens
// for and closes itself.
//
// This is the point's `Overlay`, handed to shop as a prop across the RSC boundary,
// which is why it carries its own 'use client' - see modules/shop/lib/card-media.ts.

import { useEffect, useId, useMemo, useState } from 'react'
import { Viewer3d } from '@/modules/product-3d-views-for-shop/components/public/Viewer3d'
import { viewerChromeCss } from '@/modules/product-3d-views-for-shop/lib/viewer-css'
import { fetchBundle } from '@/modules/product-3d-views-for-shop/lib/fabric-fetch'
import { buildSlides, initialIndex } from '@/modules/product-3d-views-for-shop/lib/card-slides'
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
/* The stage's own carousel arrows: same shape and placement as shop's card arrows, so
   stepping the model reads as the same control the shopper flicked pictures with. Above
   the canvas, clear of the close button (top-right) and the AR/reset chrome (bottom). */
.p3d-card-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:4;display:flex;align-items:center;
  justify-content:center;width:34px;height:34px;padding:0;border-radius:50%;border:1px solid var(--color-border);
  background:var(--color-surface);color:var(--color-fg);cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.18);
  transition:background .15s ease}
.p3d-card-nav:hover,.p3d-card-nav:focus-visible{background:var(--color-bg-subtle)}
.p3d-card-nav:focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}
.p3d-card-nav svg{flex:none}
.p3d-card-nav-prev{left:8px}
.p3d-card-nav-next{right:8px}
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

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  // Points left or right; drawn once, flipped for the other side - matches shop's
  // card arrows so the two controls read as one.
  const d = dir === 'left' ? 'M15 4l-7 8 7 8' : 'M9 4l7 8-7 8'
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CardModel3dOverlay({ payload, activeSourceId }: CardOverlayProps) {
  const data = payload as P3dCardPayload | null
  const [open, setOpen] = useState(false)
  // Where the open viewer's own arrows are in the slide list. Set from the tapped
  // picture when the viewer opens (see openViewer), then moved only by the arrows.
  const [viewIndex, setViewIndex] = useState(0)
  // The fabric bundle once it lands, TAGGED with the variation it resolved for - so a
  // stale result (the shopper stepped on) is ignored on render.
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

  const slides = useMemo(() => (data ? buildSlides(data) : []), [data])
  const count = slides.length
  // Guard the index against a slide list that changed under us (defensive; it is
  // fixed per payload today).
  const at = count ? Math.min(Math.max(viewIndex, 0), count - 1) : 0
  const current = slides[at]

  // A fabric slide needs its painted bundle fetched; a non-fabric slide already
  // carries its model. Only fetch while the viewer is open.
  const fabricChild = open && data?.hasFabric ? current?.childId : undefined
  const needsFabricFetch = !!fabricChild

  useEffect(() => {
    if (!needsFabricFetch || !data || !fabricChild) return
    let cancelled = false
    fetchBundle(data.parentProductId, fabricChild)
      .then((bundle) => {
        if (cancelled) return
        // The variation's own model (or the parent's, per the resolver), painted with
        // this variation's material. No model back -> null, so render falls to fallback.
        setFabricState({
          sourceId: fabricChild,
          model: bundle?.modelUrl
            ? {
                item: { key: bundle.modelId, productId: fabricChild, url: bundle.modelUrl, format: bundle.format, label: '3D model' },
                fabric: { slots: bundle.slots, realCm: bundle.realCm, scaleAxis: bundle.scaleAxis },
              }
            : null,
        })
      })
      .catch(() => { if (!cancelled) setFabricState({ sourceId: fabricChild, model: null }) })
    return () => { cancelled = true }
  }, [needsFabricFetch, fabricChild, data])

  if (!data?.fallback) return null

  // The model to draw for the current slide. A non-fabric slide is instant. A fabric
  // slide shows its painted bundle once it lands; until then the previously shown
  // model stays up (a mid-browse step never blanks), falling to a spinner only on the
  // very first open when nothing has resolved yet.
  const shown: P3dCardModel | null = !data.hasFabric
    ? current?.model ?? data.fallback
    : !fabricChild
      ? data.fallback
      : fabricState?.sourceId === fabricChild
        ? fabricState.model ?? data.fallback
        : fabricState?.model ?? null

  const canPrev = at > 0
  const canNext = at < count - 1

  const step = (delta: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setViewIndex((i) => Math.min(Math.max(i + delta, 0), count - 1))
  }

  const openViewer = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!data) return
    setViewIndex(initialIndex(slides, activeSourceId, data))
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
          {/* Left arrow only once the shopper has stepped off the first model; right
              arrow drops away on the last, so neither control is ever a dead end. */}
          {count > 1 && canPrev && (
            <button type="button" className="p3d-card-nav p3d-card-nav-prev" aria-label="Previous 3D model" onClick={step(-1)}>
              <Chevron dir="left" />
            </button>
          )}
          {count > 1 && canNext && (
            <button type="button" className="p3d-card-nav p3d-card-nav-next" aria-label="Next 3D model" onClick={step(1)}>
              <Chevron dir="right" />
            </button>
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
