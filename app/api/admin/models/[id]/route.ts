import { NextRequest, NextResponse } from 'next/server'
import { deleteMedia } from '@/lib/media/upload'
import { prisma } from '@/lib/db/prisma'
import { requireShopUser } from '@/modules/shop/lib/access'
import { deleteModel, getModelById } from '@/modules/product-3d-views-for-shop/lib/db/models'
import type { MediaProviderType } from '@prisma/client'

// Remove a 3D model: our row, the core library row, and the stored blob.
//
// The blob goes too. A 3D model runs to tens of megabytes, so treating a delete as
// "hide it from the gallery" would quietly bill the site owner for every model
// they ever thought better of.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const { id } = await params
  const model = await getModelById(id)
  if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Our row first: it is the one the gallery reads, so dropping it is what
  // actually removes the model from the shop. Everything after is tidying, and a
  // failure there must not leave the admin staring at a model they just deleted.
  await deleteModel(id)

  if (model.mediaId) {
    await prisma.media.delete({ where: { id: model.mediaId } }).catch(() => {
      // Already gone - someone deleted it from the library directly. Nothing to do.
    })
  }
  if (model.mediaKey && model.mediaProvider) {
    await deleteMedia(model.mediaProvider as MediaProviderType, model.mediaKey).catch((error: unknown) => {
      // The bytes outliving their row is a bill, not a bug the admin can act on.
      // Logged so it is visible, swallowed so the delete still reads as done.
      console.error(`[product-3d-views-for-shop] could not delete blob ${model.mediaKey}:`, error)
    })
  }

  return NextResponse.json({ ok: true })
}
