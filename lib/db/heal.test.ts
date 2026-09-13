import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { P3dModel } from '@/modules/product-3d-views-for-shop/lib/types'

// The heal runs on every product page render, over every model in the tree, and it
// can write to the database from a storefront request. So two things are worth
// pinning down: that a tree of any size asks the library ONCE, and that the batch
// repairs exactly the rows the old one-row-at-a-time version did - no more, no fewer.

type MediaRow = { id: string; key: string; url: string; provider: string }

const findMany = vi.fn(async (_args: { where: { id: { in: string[] } } }): Promise<MediaRow[]> => [])
const executeRaw = vi.fn(async (..._args: unknown[]) => 1)

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    media: { findMany: (args: { where: { id: { in: string[] } } }) => findMany(args) },
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
  },
}))

import { repairedStorage, withFreshStorage, withFreshStorageForAll } from '@/modules/product-3d-views-for-shop/lib/db/heal'

const model = (over: Partial<P3dModel> = {}): P3dModel => ({
  id: 'model-1',
  productId: 'product-1',
  url: 'https://media.example.test/media/shop/desk/3d/desk.glb',
  mediaProvider: 'R2',
  mediaKey: 'media/shop/desk/3d/desk.glb',
  mediaId: 'media-1',
  ownsMedia: true,
  filename: 'desk.glb',
  format: 'glb',
  size: 1234,
  position: 0,
  context: '',
  ...over,
})

const inStep = (over: Partial<MediaRow> = {}): MediaRow => ({
  id: 'media-1',
  key: 'media/shop/desk/3d/desk.glb',
  url: 'https://media.example.test/media/shop/desk/3d/desk.glb',
  provider: 'R2',
  ...over,
})

const moved = (over: Partial<MediaRow> = {}): MediaRow => inStep({
  key: 'media/shop/desk-renamed/3d/desk.glb',
  url: 'https://media.example.test/media/shop/desk-renamed/3d/desk.glb',
  ...over,
})

// Silenced: the heal logs every repair, which is right in production and noise here.
const info = vi.spyOn(console, 'info').mockImplementation(() => {})
const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

beforeEach(() => {
  findMany.mockReset()
  findMany.mockResolvedValue([])
  executeRaw.mockReset()
  executeRaw.mockResolvedValue(1)
  info.mockClear()
  warn.mockClear()
})

describe('repairedStorage', () => {
  it('says nothing needs repairing when the stored copy matches the library', () => {
    expect(repairedStorage(model(), inStep())).toBeNull()
  })

  it.each([
    ['the key', { key: 'media/other.glb' }],
    ['the url', { url: 'https://media.example.test/other.glb' }],
    ['the provider', { provider: 'B2' }],
  ])('repairs a row when %s has moved', (_label, change) => {
    const media = inStep(change)
    expect(repairedStorage(model(), media)).toEqual({ ...model(), url: media.url, mediaKey: media.key, mediaProvider: media.provider })
  })
})

describe('withFreshStorageForAll', () => {
  it('asks the library once for a whole tree, each distinct id once', async () => {
    // A size run sharing one file, beside a second file - thousands of rows in real life.
    const models = [
      ...Array.from({ length: 50 }, (_, i) => model({ id: `shared-${i}`, mediaId: 'media-1' })),
      model({ id: 'other', mediaId: 'media-2' }),
    ]
    findMany.mockResolvedValue([inStep(), inStep({ id: 'media-2' })])

    const fresh = await withFreshStorageForAll(models)

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0]![0].where.id.in).toEqual(['media-1', 'media-2'])
    expect(fresh).toEqual(models)
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it('does not touch the database at all when no row carries a library id', async () => {
    // Null and empty ids both mean "no library row" - the sheet import writes either.
    const models = [model({ id: 'a', mediaId: null }), model({ id: 'b', mediaId: '' })]
    expect(await withFreshStorageForAll(models)).toEqual(models)
    expect(findMany).not.toHaveBeenCalled()
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it('does not query for an empty list', async () => {
    expect(await withFreshStorageForAll([])).toEqual([])
    expect(findMany).not.toHaveBeenCalled()
  })

  it('repairs and writes back only the rows whose file moved, keeping the order', async () => {
    const models = [
      model({ id: 'untagged', mediaId: null }),
      model({ id: 'stale', mediaId: 'media-moved' }),
      model({ id: 'fine', mediaId: 'media-1' }),
      model({ id: 'gone', mediaId: 'media-deleted' }),
    ]
    const relocated = moved({ id: 'media-moved' })
    findMany.mockResolvedValue([inStep(), relocated])

    const fresh = await withFreshStorageForAll(models)

    expect(fresh.map((m) => m.id)).toEqual(['untagged', 'stale', 'fine', 'gone'])
    expect(fresh[0]).toBe(models[0])
    expect(fresh[1]).toEqual({ ...models[1], url: relocated.url, mediaKey: relocated.key, mediaProvider: relocated.provider })
    expect(fresh[2]).toBe(models[2])
    // A deleted library row leaves the stored url as the only address there is.
    expect(fresh[3]).toBe(models[3])

    expect(executeRaw).toHaveBeenCalledTimes(1)
    const values = executeRaw.mock.calls[0]!.slice(1)
    expect(values).toEqual([relocated.url, relocated.key, relocated.provider, 'stale'])
  })

  it('writes back every stale row that shares a moved file, one statement each', async () => {
    const models = [model({ id: 'a' }), model({ id: 'b' }), model({ id: 'c' })]
    findMany.mockResolvedValue([moved()])

    const fresh = await withFreshStorageForAll(models)

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(fresh.every((m) => m.url === moved().url)).toBe(true)
    expect(executeRaw.mock.calls.map((call) => call.at(-1))).toEqual(['a', 'b', 'c'])
  })

  it('still serves the repaired address when the write-back fails', async () => {
    findMany.mockResolvedValue([moved()])
    executeRaw.mockRejectedValue(new Error('connection dropped'))

    const [fresh] = await withFreshStorageForAll([model()])

    expect(fresh?.url).toBe(moved().url)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledTimes(1)
  })
})

describe('withFreshStorage', () => {
  it('heals a single row by the same rules', async () => {
    findMany.mockResolvedValue([moved()])
    expect((await withFreshStorage(model())).url).toBe(moved().url)
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it('hands back a row with no library id untouched, without a query', async () => {
    const untagged = model({ mediaId: null })
    expect(await withFreshStorage(untagged)).toBe(untagged)
    expect(findMany).not.toHaveBeenCalled()
  })
})
