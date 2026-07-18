import { NextRequest, NextResponse } from 'next/server'
import { getFabricConfig } from '@/modules/product-3d-views-for-shop/lib/db/fabric-config'
import { listColourAttributes, listColourOptions } from '@/modules/product-3d-views-for-shop/lib/fabric/resolve'

// Every unique fabric-swatch texture url a product's variations could paint, so the
// storefront can warm its texture cache in the background once the product page has
// settled (see lib/preload.ts). A later colour switch then paints from memory rather
// than waiting on a first fetch + decode of the swatch.
//
// Scales with the number of DISTINCT swatches on the product's fabric colour options
// - a handful - NOT with the number of variation combinations, which can run to
// hundreds. That is the whole reason this exists as its own endpoint rather than the
// storefront prefetching one /fabric/<child> bundle per child: one light query here
// instead of a background storm of per-child resolves through the throttled module
// route.
//
// Public and unauthenticated, same as the fabric resolver: these urls are the swatch
// images the shopper already sees in the colour picker. Exposed by the core module
// router at /api/m/product-3d-views-for-shop/swatches .
//
// A short public cache smooths a reload or a second page of the same product. On any
// error the answer is an empty list, so the preload simply warms nothing rather than
// the shopper's page carrying a failure it never asked for.

const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=300' } as const

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CACHE_HEADERS })
}

// An http(s) url is the only thing worth warming: an empty swatch, or a bare colour
// token rather than a texture file, gives the loader nothing to fetch - the same test
// resolve.ts applies before it paints a slot.
function isHttpUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))
}

export async function GET(request: NextRequest) {
  try {
    const parent = new URL(request.url).searchParams.get('parent') ?? ''
    if (!parent) return json({ urls: [] }, 400)

    const config = await getFabricConfig(parent)
    if (!config) return json({ urls: [] })

    // Only the options the config actually paints from: a product's other variation
    // options (a non-fabric choice) carry no swatch worth warming.
    const colourOptionIds = new Set(config.slots.map((s) => s.colourOptionId))
    if (colourOptionIds.size === 0) return json({ urls: [] })

    // Both colour sources, since a slot may be painted from a variation option or
    // from an attribute; the id in the config already says which, so the two lists
    // are simply searched together.
    const [variationOptions, colourAttributes] = await Promise.all([
      listColourOptions(parent),
      listColourAttributes(),
    ])
    const urls = new Set<string>()
    for (const option of [...variationOptions, ...colourAttributes]) {
      if (!colourOptionIds.has(option.id)) continue
      for (const value of option.values) {
        if (isHttpUrl(value.swatch)) urls.add(value.swatch)
      }
    }

    return json({ urls: [...urls] })
  } catch (error) {
    console.error('[product-3d-views] swatch preload list failed:', error)
    return json({ urls: [] })
  }
}
