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

// The library row's storage details, as much of it as a repair needs.
type MediaStorage = { key: string; url: string; provider: string }

/**
 * The model with the library's current storage details, or null when the stored
 * copy already matches and there is nothing to repair. Pure, so the comparison that
 * decides whether a storefront render writes to the database can be tested alone.
 */
export function repairedStorage(model: P3dModel, media: MediaStorage): P3dModel | null {
  const unchanged =
    media.key === model.mediaKey &&
    media.url === model.url &&
    media.provider === model.mediaProvider
  if (unchanged) return null
  return { ...model, url: media.url, mediaKey: media.key, mediaProvider: media.provider }
}

/**
 * Every model's storage details as they are *now*, repairing any stored copy the
 * core library has moved the bytes out from under.
 *
 * Rows with no media_id, or whose library row has since been deleted (a Google
 * Sheet import that stored a url and no id, a blob removed outright), are handed
 * back untouched - the stored url is then the only address we have, and a stale
 * guess still beats no guess.
 *
 * One library read for the whole list. This used to be one findUnique per row that
 * carried a library id, run over every model in a product tree on every product
 * page render - and a big range is thousands of rows (a desk with 480 variations and
 * six add-on files each is 2,880). The ids repeat heavily besides, one file attached
 * across a size run being one id on many rows, so they are de-duplicated first: a
 * tree of any size costs one indexed query, or none at all when no row carries an
 * id. Order in, order out.
 */
export async function withFreshStorageForAll(models: P3dModel[]): Promise<P3dModel[]> {
  const mediaIds = [...new Set(models.flatMap((model) => (model.mediaId ? [model.mediaId] : [])))]
  if (mediaIds.length === 0) return models

  const mediaRows = await prisma.media.findMany({
    where: { id: { in: mediaIds } },
    select: { id: true, key: true, url: true, provider: true },
  })
  const mediaById = new Map<string, MediaStorage>(mediaRows.map((row) => [row.id, row]))

  return Promise.all(
    models.map(async (model) => {
      const media = model.mediaId ? mediaById.get(model.mediaId) : undefined
      if (!media) return model
      const repaired = repairedStorage(model, media)
      if (!repaired) return model
      await writeBackStorage(model.id, media)
      return repaired
    }),
  )
}

/**
 * One model's storage details as they are *now*. The single-row form of
 * withFreshStorageForAll, with exactly its rules.
 */
export async function withFreshStorage(model: P3dModel): Promise<P3dModel> {
  const [fresh] = await withFreshStorageForAll([model])
  return fresh ?? model
}

// Write-back is best effort on purpose. The job of the heal is to serve the model; if
// the UPDATE loses a race with another request healing the same row, or the
// connection drops, the caller still gets the right address and the next read tries
// the repair again. One statement per stale row, as before: stale rows are the rare
// backlog, and each carries its own id.
async function writeBackStorage(modelId: string, media: MediaStorage): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "p3d_models"
    SET "url" = ${media.url}, "media_key" = ${media.key}, "media_provider" = ${media.provider}
    WHERE "id" = ${modelId}
  `.catch((error: unknown) => {
    console.warn(`[product-3d-views-for-shop] could not refresh storage details for ${modelId}:`, error)
  })

  console.info(
    `[product-3d-views-for-shop] model ${modelId} had moved in the media library; url refreshed to ${media.url}`,
  )
}
