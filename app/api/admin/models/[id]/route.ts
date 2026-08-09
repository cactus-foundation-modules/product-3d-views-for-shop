import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import { deleteModelCascade, getModelById, updateModelContext } from '@/modules/product-3d-views-for-shop/lib/db/models'

// Remove a 3D model: our row, the core library row, and the stored blob.
//
// The blob goes too. A 3D model runs to tens of megabytes, so treating a delete as
// "hide it from the gallery" would quietly bill the site owner for every model
// they ever thought better of. The full cascade lives in deleteModelCascade, so
// the Google Sheet import removes a model exactly the same way this route does.
// Tag a model with the add-on combination it shows ('' = the base model).
// Letters, numbers, dashes; keys joined with '+', an optional ':N' quantity.
// The same grammar the storefront matcher speaks - anything else would tag a
// file nothing can ever activate.
const PatchBody = z.object({
  context: z.string().trim().max(120).regex(/^([a-z0-9-]+(:[0-9]+)?(\+[a-z0-9-]+(:[0-9]+)?)*)?$/i, 'Use letters, numbers and dashes, joined with +, e.g. screens or shelves:2'),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const { id } = await params
  const model = await getModelById(id)
  if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = PatchBody.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid context' }, { status: 400 })

  // Stored sorted so the storefront's sorted-join always matches, however the
  // admin happened to type the keys.
  const normalised = parsed.data.context ? parsed.data.context.toLowerCase().split('+').sort().join('+') : ''
  await updateModelContext(id, normalised)
  return NextResponse.json({ ok: true, context: normalised })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const { id } = await params
  const model = await getModelById(id)
  if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await deleteModelCascade(model)

  return NextResponse.json({ ok: true })
}
