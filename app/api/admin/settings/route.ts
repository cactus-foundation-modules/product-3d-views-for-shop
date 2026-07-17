import { NextRequest, NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getP3dConfig, updateP3dConfig, P3dConfigSchema } from '@/modules/product-3d-views-for-shop/lib/config'

// Read and write the viewer settings behind the 3D Viewer sub-tab.
//
// Gated on 'shop.manage', not this module's own permission key - it has none, and
// inventing one would mean every existing site's shop manager silently losing
// access to a tab that sits inside the shop settings they already run. shop is a
// hard dependency, so the key always exists.

export async function GET() {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error

  return NextResponse.json({ config: await getP3dConfig() })
}

export async function PUT(request: NextRequest) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a settings object' }, { status: 400 })
  }

  // Parsed here as well as inside updateP3dConfig so a bad value comes back as a
  // 400 the tab can show against the field, rather than a thrown ZodError the
  // route hands the admin as a 500 that says nothing.
  const parsed = P3dConfigSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' }, { status: 400 })
  }

  return NextResponse.json({ config: await updateP3dConfig(parsed.data) })
}
