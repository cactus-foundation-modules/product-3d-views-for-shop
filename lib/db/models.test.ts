import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { P3dModel } from '@/modules/product-3d-views-for-shop/lib/types'

// deleteModelCascade is the one function here that destroys something outside its
// own table - a core library row and the stored bytes - so it is the one worth a
// test. It took a real model off a live shop: the same file attached to a product
// and to one of its variations is two rows over one object, and deleting either
// row deleted the object, leaving the survivor pointing at a 404. Nothing in the
// type checker or the editor would have said a word about it.

const executeRaw = vi.fn(async () => 1)
const queryRaw = vi.fn(async (): Promise<{ n: bigint }[]> => [{ n: 0n }])
const mediaDelete = vi.fn(async () => ({}))
const deleteMedia = vi.fn(async () => {})

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $executeRaw: (...a: unknown[]) => executeRaw(...(a as [])),
    $queryRaw: (...a: unknown[]) => queryRaw(...(a as [])),
    media: { delete: (...a: unknown[]) => mediaDelete(...(a as [])) },
  },
}))

vi.mock('@/lib/media/upload', () => ({
  deleteMedia: (...a: unknown[]) => deleteMedia(...(a as [])),
}))

import { deleteModelCascade } from '@/modules/product-3d-views-for-shop/lib/db/models'

const model = (over: Partial<P3dModel> = {}): P3dModel => ({
  id: 'model-1',
  productId: 'product-1',
  url: 'https://media.example.test/media/shop/thing/3d/chair.glb',
  mediaProvider: 'R2',
  mediaKey: 'media/R2/shop/thing/3d/chair.glb',
  mediaId: 'media-1',
  ownsMedia: true,
  filename: 'chair.glb',
  format: 'glb',
  size: 1234,
  position: 0,
  ...over,
})

beforeEach(() => {
  executeRaw.mockClear()
  queryRaw.mockClear()
  mediaDelete.mockClear()
  deleteMedia.mockClear()
  queryRaw.mockResolvedValue([{ n: 0n }])
})

describe('deleteModelCascade', () => {
  it('removes the library row and the stored file when nothing else points at it', async () => {
    await deleteModelCascade(model())

    expect(executeRaw).toHaveBeenCalledTimes(1)
    expect(mediaDelete).toHaveBeenCalledTimes(1)
    expect(deleteMedia).toHaveBeenCalledTimes(1)
  })

  it('leaves the library row and the file alone while another row still points at them', async () => {
    queryRaw.mockResolvedValue([{ n: 1n }])

    await deleteModelCascade(model())

    // Our own row still goes - that is what "remove this model" means here.
    expect(executeRaw).toHaveBeenCalledTimes(1)
    // The shared file does not, or the row still holding it is left broken.
    expect(mediaDelete).not.toHaveBeenCalled()
    expect(deleteMedia).not.toHaveBeenCalled()
  })

  it('deletes no blob for a row that never owned one (a url from the sheet import)', async () => {
    await deleteModelCascade(model({ ownsMedia: false, mediaId: null, mediaKey: null, mediaProvider: null }))

    expect(executeRaw).toHaveBeenCalledTimes(1)
    expect(mediaDelete).not.toHaveBeenCalled()
    expect(deleteMedia).not.toHaveBeenCalled()
  })

  it('leaves a file picked from the media library exactly where it was found', async () => {
    // The whole row looks deletable - it has a library id, a key and a provider,
    // and nothing else points at it. Only ownsMedia says it was never ours.
    await deleteModelCascade(model({ ownsMedia: false }))

    expect(executeRaw).toHaveBeenCalledTimes(1)
    expect(mediaDelete).not.toHaveBeenCalled()
    expect(deleteMedia).not.toHaveBeenCalled()
  })
})
