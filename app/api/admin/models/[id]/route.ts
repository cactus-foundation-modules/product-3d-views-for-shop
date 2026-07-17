import { NextRequest, NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { deleteModelCascade, getModelById } from '@/modules/product-3d-views-for-shop/lib/db/models'

// Remove a 3D model: our row, the core library row, and the stored blob.
//
// The blob goes too. A 3D model runs to tens of megabytes, so treating a delete as
// "hide it from the gallery" would quietly bill the site owner for every model
// they ever thought better of. The full cascade lives in deleteModelCascade, so
// the Google Sheet import removes a model exactly the same way this route does.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const { id } = await params
  const model = await getModelById(id)
  if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await deleteModelCascade(model)

  return NextResponse.json({ ok: true })
}
