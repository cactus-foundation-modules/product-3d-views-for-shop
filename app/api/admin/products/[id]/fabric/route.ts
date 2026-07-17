import { NextRequest, NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getAdminModels } from '@/modules/product-3d-views-for-shop/lib/db/models'
import { getP3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'
import { FabricConfigSchema, getFabricConfig, saveFabricConfig } from '@/modules/product-3d-views-for-shop/lib/db/fabric-config'
import { listColourOptions, listSizeAttributes } from '@/modules/product-3d-views-for-shop/lib/fabric/resolve'

// The fabric configurator's admin data and save. `id` is always the PARENT product.
//
// GET returns everything the panel needs to build its dropdowns: the saved config,
// the product's variation options + values (for the colour dropdowns), every size
// attribute (for the size dropdowns), the product's attached models, and the viewer
// settings for the panel's live preview. Material names are detected client-side
// from the model itself, so the server never parses a GLB.
//
// The viewer settings ride along here rather than being fetched from the settings
// route because that one is gated on 'shop.manage', which a 'shop.products' admin
// editing this panel need not have.
//
// Same admin gate as this module's other admin routes.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const { id } = await params
  const [config, options, attributes, models, settings] = await Promise.all([
    getFabricConfig(id),
    listColourOptions(id),
    listSizeAttributes(),
    getAdminModels(id),
    getP3dConfig(),
  ])
  return NextResponse.json({ config, options, attributes, models, settings })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const { id } = await params
  const body = await request.json().catch(() => null)

  // Validated at the edge: a bad shape is the client's error to hear as a 400, not
  // a corrupt row to read back later. saveFabricConfig validates again before it
  // writes, but a clear message here beats a 500 from the store.
  const parsed = FabricConfigSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'That fabric configuration is not valid.', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    await saveFabricConfig(id, parsed.data)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: `Could not save the fabric configuration: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    )
  }
}
