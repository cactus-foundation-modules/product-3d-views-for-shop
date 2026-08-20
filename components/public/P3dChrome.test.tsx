import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ViewerChromeStyle, CardChromeStyle } from '@/modules/product-3d-views-for-shop/components/public/P3dChrome'
import { viewerChromeCss, cardChromeCss } from '@/modules/product-3d-views-for-shop/lib/viewer-css'

// The card overlay mounts once per product card, so anything it renders inline
// is multiplied by the size of the grid. It used to render the whole 3D
// stylesheet that way: ~9 KB per card, ~380 KB of identical CSS inside the HTML
// of a 43-product category page. These guard the fix (the `href`/`precedence`
// pair React hoists and de-duplicates on) rather than the styling, because the
// failure mode is silent - drop the href and every card quietly stamps its own
// copy again with nothing on screen looking any different.

const CARDS_ON_A_BIG_CATEGORY_PAGE = 43

describe('3D chrome stylesheets', () => {
  it('ships one copy however many cards mount the overlay', () => {
    const page = renderToStaticMarkup(
      <>
        {Array.from({ length: CARDS_ON_A_BIG_CATEGORY_PAGE }, (_, i) => (
          <div key={i}><ViewerChromeStyle /><CardChromeStyle /></div>
        ))}
      </>,
    )
    expect(page.match(/<style/g)).toHaveLength(1)
    // Both sheets are in it - de-duplicated, not dropped.
    expect(page).toContain('.p3d-card-btn')
    expect(page).toContain('.p3d-thumb')
    // The whole page is now barely longer than one copy of the CSS.
    expect(page.length).toBeLessThan(viewerChromeCss.length + cardChromeCss.length + 2000)
  })

  it('shares the viewer sheet with a detail gallery on the same page', () => {
    const page = renderToStaticMarkup(<><ViewerChromeStyle /><CardChromeStyle /><ViewerChromeStyle /></>)
    expect(page.match(/<style/g)).toHaveLength(1)
  })

  it('emits the CSS verbatim, not HTML-escaped', () => {
    // React escapes text children nearly everywhere else, and a `>` or `~` that
    // came out as an entity would break the selector silently.
    const page = renderToStaticMarkup(<ViewerChromeStyle />)
    expect(page).toContain('.p3d-stage-canvas:focus-visible ~ .p3d-hint-keys')
    expect(page).not.toContain('&gt;')
    expect(page).not.toContain('&amp;')
  })

  it('keeps the two sheets free of shared selectors', () => {
    // They are hoisted separately, so a page may hold the viewer sheet without
    // the card one. Anything the card sheet needed to override in the viewer
    // sheet would then apply on the detail page and not on a card.
    const selectors = (css: string) => new Set(
      [...css.matchAll(/(^|\})\s*([^{}@/][^{}]*?)\s*\{/g)].map((m) => m[2]?.trim() ?? '').filter(Boolean),
    )
    const viewer = selectors(viewerChromeCss)
    const shared = [...selectors(cardChromeCss)].filter((s) => viewer.has(s))
    expect(shared).toEqual([])
  })
})
