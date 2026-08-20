// The 3D chrome stylesheets, as hoisted <style> tags rather than a copy per
// component instance.
//
// Why this file exists: the card overlay is mounted once per product card, and a
// category grid is dozens of cards. Each one used to stamp its own inline
// <style> holding the whole viewer + card chrome - about 9 KB apiece - so a
// 43-product page shipped the same stylesheet 42 times, roughly 380 KB of
// duplicated CSS inside the HTML document.
//
// React 19 de-duplicates and hoists a <style> that carries BOTH `href` and
// `precedence`: every instance past the first is dropped, and the survivor is
// moved into <head>. The href is the identity, so it has to be one shared
// constant rather than a string written out at each call site - which is the
// whole reason these are components and not two literals.
//
// The CSS must be passed as children, not dangerouslySetInnerHTML: React only
// applies the hoisting rules to the former. It is emitted verbatim (React does
// not HTML-escape style children), so child and sibling combinators survive.

import { viewerChromeCss, cardChromeCss } from '@/modules/product-3d-views-for-shop/lib/viewer-css'

/** Viewer + thumbnail chrome. Mounted by the detail gallery and the card overlay. */
export function ViewerChromeStyle() {
  return <style href="p3d-viewer-chrome" precedence="default">{viewerChromeCss}</style>
}

/** The card overlay's badge/stage chrome. Only the card overlay mounts this. */
export function CardChromeStyle() {
  return <style href="p3d-card-chrome" precedence="default">{cardChromeCss}</style>
}
