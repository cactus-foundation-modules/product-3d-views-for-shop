import { NextRequest, NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getP3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'
import {
  P3dProductConfigSchema,
  getP3dProductConfig,
  saveP3dProductConfig,
} from '@/modules/product-3d-views-for-shop/lib/db/product-settings'

// The product editor's per-product viewer overrides (today: brightness).
// `id` is always the PARENT product, matching this module's other admin routes.
//
// GET also returns the whole sitewide config. The panel needs the colour
// handling (brightness is inert while it is 'none', and the panel greys out
// accordingly) and the sitewide brightness (what "use the site setting"
// currently means, shown as the slider's resting value) - and the rest of it to
// light its live preview the way the storefront will, since a preview lit by
// anything other than the site's own lighting would be a preview of nothing.
// They ride along here rather than being fetched from the settings route
// because that one is gated on 'shop.manage', which a 'shop.products' admin
// editing a product need not have - the same reasoning as the fabric route,
// which already hands the same config to the same admin.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const { id } = await params
  const [config, site] = await Promise.all([getP3dProductConfig(id), getP3dConfig()])
  return NextResponse.json({ config, site })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const { id } = await params
  const body = await request.json().catch(() => null)

  // Validated at the edge: a bad shape is the client's error to hear as a 400,
  // not a corrupt row to read back later. saveP3dProductConfig validates again
  // before it writes, but a clear message here beats a 500 from the store.
  const parsed = P3dProductConfigSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'That viewer setting is not valid.', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    await saveP3dProductConfig(id, parsed.data)
    return NextResponse.json({ ok: true, config: parsed.data })
  } catch (error) {
    return NextResponse.json(
      { error: `Could not save the viewer settings: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    )
  }
}
