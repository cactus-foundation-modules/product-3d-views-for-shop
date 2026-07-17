import { NextRequest, NextResponse } from 'next/server'
import { getFabricConfig } from '@/modules/product-3d-views-for-shop/lib/db/fabric-config'
import { resolveFabricForChild } from '@/modules/product-3d-views-for-shop/lib/fabric/resolve'

// Resolve one variant child to the model + fabric paints the viewer should show.
//
// Public and unauthenticated: this is catalogue data the shopper is already looking
// at, nothing more than the product page itself exposes. Exposed by the core module
// router at /api/m/product-3d-views-for-shop/fabric/... .
//
// Both ids arrive as query params (`parent`, `child`): the browser has the parent
// in the gallery payload and the child in activeProductId, and the child alone does
// not name its parent cheaply. The [child] path segment is a placeholder so the
// route has a concrete path; the query is the source of truth.
//
// A short public cache smooths the common case of a shopper flicking through
// colours and back. On any error the answer is a plain null, so the stage falls
// back to the default model rather than showing a broken viewer.

const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=300' } as const

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CACHE_HEADERS })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ child: string }> }) {
  try {
    const { child: pathChild } = await params
    const query = new URL(request.url).searchParams
    const parent = query.get('parent') ?? ''
    const child = query.get('child') || pathChild

    if (!parent || !child) return json(null, 400)

    const config = await getFabricConfig(parent)
    if (!config) return json(null)

    const bundle = await resolveFabricForChild(child, config)
    return json(bundle)
  } catch (error) {
    console.error('[product-3d-views] fabric resolve failed:', error)
    return json(null)
  }
}
