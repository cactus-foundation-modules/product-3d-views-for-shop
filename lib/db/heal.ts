import { prisma } from '@/lib/db/prisma'
import type { P3dModel } from '@/modules/product-3d-views-for-shop/lib/types'

// ---------------------------------------------------------------------------
// Keeping a 3D model's storage details honest.
//
// p3d_models copies three things off the core Media row when a model is uploaded
// or picked - the provider, the object key and the url - so the storefront can
// hand the viewer a url without a join. That copy is a snapshot, and the core
// library moves files about underneath it: renaming a product or its media folder
// re-keys every file inside, so the bytes get a brand new key and url while our
// row goes on naming the old, now-deleted address and the thumbnail 404s.
//
// The media-reference-rewriter (lib/media-reference-rewriter.ts) keeps every
// reference in step for moves that happen from now on. This is the safety net for
// the rows a move stranded BEFORE the rewriter existed: media_id points at the
// library row rather than at the address, so it survives the move, and the next
// read of a stale model quietly brings its key and url back into line.
//
// Model-row only, on purpose. The fabric config's calibration key is left to the
// rewriter: a stranded backlog row has already lost its measurement (its key no
// longer matches), so it renders at repeat 1 today, and healing the url here
// makes the model appear at repeat 1 rather than not at all - strictly better,
// without mutating a JSON config from a storefront render. Re-saving the config
// in the admin re-measures and restores true scale.
// ---------------------------------------------------------------------------

/**
 * The model's storage details as they are *now*, repairing the stored copy if the
 * core library has moved the bytes since.
 *
 * Rows with no media_id, or whose library row has since been deleted (a Google
 * Sheet import that stored a url and no id, a blob removed outright), are handed
 * back untouched - the stored url is then the only address we have, and a stale
 * guess still beats no guess.
 */
export async function withFreshStorage(model: P3dModel): Promise<P3dModel> {
  if (!model.mediaId) return model

  const media = await prisma.media.findUnique({
    where: { id: model.mediaId },
    select: { key: true, url: true, provider: true },
  })
  if (!media) return model

  const unchanged =
    media.key === model.mediaKey &&
    media.url === model.url &&
    media.provider === model.mediaProvider
  if (unchanged) return model

  // Write-back is best effort on purpose. The job of this function is to serve the
  // model; if the UPDATE loses a race with another request healing the same row,
  // or the connection drops, the caller still gets the right address and the next
  // read tries the repair again.
  await prisma.$executeRaw`
    UPDATE "p3d_models"
    SET "url" = ${media.url}, "media_key" = ${media.key}, "media_provider" = ${media.provider}
    WHERE "id" = ${model.id}
  `.catch((error: unknown) => {
    console.warn(`[product-3d-views-for-shop] could not refresh storage details for ${model.id}:`, error)
  })

  console.info(
    `[product-3d-views-for-shop] model ${model.id} had moved in the media library; url refreshed to ${media.url}`,
  )

  return { ...model, url: media.url, mediaKey: media.key, mediaProvider: media.provider }
}
