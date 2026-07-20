import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { P3dModel } from '@/modules/product-3d-views-for-shop/lib/types'

// The provider imports its admin Cell (a client component) and the db layer. Both
// are irrelevant to the import batching under test, so stub them: the Cell to a
// bare marker, the db calls to spies we assert against.
vi.mock('@/modules/product-3d-views-for-shop/components/admin/Product3dVariantColumn', () => ({
  Product3dVariantColumn: () => null,
}))

const createModel = vi.fn(async (input: { productId: string; url: string; filename: string }) => ({
  id: `m-${input.url}`,
  productId: input.productId,
  url: input.url,
  mediaProvider: null,
  mediaKey: null,
  mediaId: null,
  filename: input.filename,
  format: 'glb',
  size: 0,
  position: 0,
} as P3dModel))
const getModelsForProducts = vi.fn(async (_ids: string[]): Promise<P3dModel[]> => [])
const deleteModelCascade = vi.fn(async (_m: P3dModel) => {})

vi.mock('@/modules/product-3d-views-for-shop/lib/db/models', () => ({
  createModel: (...a: unknown[]) => createModel(...(a as [{ productId: string; url: string; filename: string }])),
  getModelsForProducts: (...a: unknown[]) => getModelsForProducts(...(a as [string[]])),
  deleteModelCascade: (...a: unknown[]) => deleteModelCascade(...(a as [P3dModel])),
}))

import {
  product3dVariantFieldProvider as provider,
  resolveCurrentModels,
} from '@/modules/product-3d-views-for-shop/lib/variant-field-provider'

const COL = '3D Files'
const model = (productId: string, url: string): P3dModel => ({
  id: `m-${url}`, productId, url, mediaProvider: null, mediaKey: null, mediaId: null,
  ownsMedia: false, filename: url, format: 'glb', size: 0, position: 0,
})

beforeEach(() => {
  createModel.mockClear()
  getModelsForProducts.mockClear()
  deleteModelCascade.mockClear()
})

describe('resolveCurrentModels', () => {
  it('returns null when there is no context (caller reads per row)', () => {
    expect(resolveCurrentModels(undefined, 'child')).toBeNull()
  })

  it('returns [] for a child missing from the context (a new variant)', () => {
    expect(resolveCurrentModels(new Map(), 'new-child')).toEqual([])
  })

  it('returns the preloaded models for a known child', () => {
    const m = model('child', 'a.glb')
    expect(resolveCurrentModels(new Map([['child', [m]]]), 'child')).toEqual([m])
  })
})

describe('product3dVariantFieldProvider import batching', () => {
  it('beginImport groups preloaded models by child in one read', async () => {
    getModelsForProducts.mockResolvedValueOnce([model('a', 'a1.glb'), model('a', 'a2.glb'), model('b', 'b1.glb')])
    const ctx = (await provider.beginImport!('parent', ['a', 'b'])) as Map<string, P3dModel[]>
    expect(getModelsForProducts).toHaveBeenCalledTimes(1)
    expect(ctx.get('a')?.map((m) => m.url)).toEqual(['a1.glb', 'a2.glb'])
    expect(ctx.get('b')?.map((m) => m.url)).toEqual(['b1.glb'])
  })

  it('diffs against the context without a per-row read', async () => {
    const ctx = new Map<string, P3dModel[]>([['child', [model('child', 'keep.glb'), model('child', 'drop.glb')]]])
    await provider.applyImportedRow('parent', 'child', { [COL]: 'keep.glb|add.glb' }, ctx)
    expect(getModelsForProducts).not.toHaveBeenCalled() // read happened once in beginImport, not here
    expect(createModel).toHaveBeenCalledTimes(1)
    expect(createModel.mock.calls[0]![0].url).toBe('add.glb')
    expect(deleteModelCascade).toHaveBeenCalledTimes(1)
    expect(deleteModelCascade.mock.calls[0]![0].url).toBe('drop.glb')
    // Context updated to the resulting set for a repeat of the same child.
    expect(ctx.get('child')?.map((m) => m.url).sort()).toEqual(['add.glb', 'keep.glb'])
  })

  it('attaches to a brand-new variant (context miss) with no per-row read', async () => {
    const ctx = new Map<string, P3dModel[]>() // child not present: created mid-import
    await provider.applyImportedRow('parent', 'fresh-child', { [COL]: 'new.glb' }, ctx)
    expect(getModelsForProducts).not.toHaveBeenCalled()
    expect(createModel).toHaveBeenCalledTimes(1)
    expect(createModel.mock.calls[0]![0].url).toBe('new.glb')
    expect(deleteModelCascade).not.toHaveBeenCalled()
  })

  it('falls back to a per-row read when no context is given (back-compat)', async () => {
    getModelsForProducts.mockResolvedValueOnce([])
    await provider.applyImportedRow('parent', 'child', { [COL]: 'x.glb' })
    expect(getModelsForProducts).toHaveBeenCalledTimes(1)
    expect(createModel).toHaveBeenCalledTimes(1)
  })

  it('leaves models untouched when the sheet lacks the column', async () => {
    const ctx = new Map<string, P3dModel[]>([['child', [model('child', 'a.glb')]]])
    await provider.applyImportedRow('parent', 'child', { 'Some Other Column': 'x' }, ctx)
    expect(createModel).not.toHaveBeenCalled()
    expect(deleteModelCascade).not.toHaveBeenCalled()
  })

  it('an empty but present cell clears the variant models', async () => {
    const ctx = new Map<string, P3dModel[]>([['child', [model('child', 'a.glb')]]])
    await provider.applyImportedRow('parent', 'child', { [COL]: '' }, ctx)
    expect(deleteModelCascade).toHaveBeenCalledTimes(1)
    expect(createModel).not.toHaveBeenCalled()
  })
})

describe('product3dVariantFieldProvider.rowChanged (preview, read-only)', () => {
  it('is true when a url would be attached', async () => {
    const ctx = new Map<string, P3dModel[]>([['child', [model('child', 'keep.glb')]]])
    expect(await provider.rowChanged!('parent', 'child', { [COL]: 'keep.glb|add.glb' }, ctx)).toBe(true)
  })

  it('is true when a url would be dropped', async () => {
    const ctx = new Map<string, P3dModel[]>([['child', [model('child', 'keep.glb'), model('child', 'drop.glb')]]])
    expect(await provider.rowChanged!('parent', 'child', { [COL]: 'keep.glb' }, ctx)).toBe(true)
  })

  it('is false when the cell already matches what is stored', async () => {
    const ctx = new Map<string, P3dModel[]>([['child', [model('child', 'a.glb'), model('child', 'b.glb')]]])
    expect(await provider.rowChanged!('parent', 'child', { [COL]: 'a.glb|b.glb' }, ctx)).toBe(false)
  })

  it('is false when the sheet lacks the column', async () => {
    const ctx = new Map<string, P3dModel[]>([['child', [model('child', 'a.glb')]]])
    expect(await provider.rowChanged!('parent', 'child', { 'Other': 'x' }, ctx)).toBe(false)
  })

  it('ignores a non-3D url (nothing to render, not a change)', async () => {
    const ctx = new Map<string, P3dModel[]>([['child', []]])
    expect(await provider.rowChanged!('parent', 'child', { [COL]: 'notes.txt' }, ctx)).toBe(false)
  })

  it('writes nothing while deciding', async () => {
    const ctx = new Map<string, P3dModel[]>([['child', [model('child', 'keep.glb')]]])
    await provider.rowChanged!('parent', 'child', { [COL]: 'keep.glb|add.glb' }, ctx)
    expect(createModel).not.toHaveBeenCalled()
    expect(deleteModelCascade).not.toHaveBeenCalled()
  })
})
