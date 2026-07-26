'use client'

// The "view in 3D" control shop mounts over a product card, through the
// `shop.card-media` overlay slot. Closed, it is a small 3D badge pinned bottom-right
// of the card picture; tapped, it swaps in the full Viewer3d in place, filling the
// card's image box, with a close button that hands the picture back.
//
// Loaded lazily by construction: three.js lives inside Viewer3d's own dynamic
// imports, so a card only ever pulls the viewer when a shopper actually taps its
// badge - the grid stays as light as it was.
//
// Single live viewer. A grid could hold many of these, and each open one is a WebGL
// context (browsers cap around sixteen). Opening one broadcasts on a window event
// that every other open viewer listens for and closes itself, so at most one card
// viewer is ever mounted at a time.
//
// This is the point's `Overlay`, handed to shop as a prop across the RSC boundary,
// which is why it carries its own 'use client' - see modules/shop/lib/card-media.ts.

import { useEffect, useId, useState } from 'react'
import { Viewer3d } from '@/modules/product-3d-views-for-shop/components/public/Viewer3d'
import { viewerChromeCss } from '@/modules/product-3d-views-for-shop/lib/viewer-css'
import type { CardOverlayProps } from '@/modules/shop/lib/card-media'
import type { P3dCardPayload } from '@/modules/product-3d-views-for-shop/lib/types'

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

export function CardModel3dOverlay({ payload }: CardOverlayProps) {
  const data = payload as P3dCardPayload | null
  const [open, setOpen] = useState(false)
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

  if (!data?.item) return null

  const openViewer = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Tell any other open card viewer to stand down before we take a context.
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
          <Viewer3d item={data.item} settings={data.settings} fabric={data.fabric ?? undefined} />
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
