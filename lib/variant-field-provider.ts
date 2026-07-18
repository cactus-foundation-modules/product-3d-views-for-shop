import {
  createModel,
  getModelsForProducts,
  deleteModelCascade,
} from '@/modules/product-3d-views-for-shop/lib/db/models'
import { formatFromFilename } from '@/modules/product-3d-views-for-shop/lib/formats'
import { Product3dVariantColumn } from '@/modules/product-3d-views-for-shop/components/admin/Product3dVariantColumn'
import type { P3dModel } from '@/modules/product-3d-views-for-shop/lib/types'

// Contributes the "3D Files" column to shop-variations' Variations tab through the
// `variant-field-provider` point. One object drives three places at once - the
// admin grid cell, the CSV export and the CSV import - and because it round-trips
// through shop-variations' CSV, the Google Sheet sync carries a variant's 3D files
// for free, the same way it carries a variant's attributes.
//
// The cell in the sheet is a pipe-separated list of the model file urls attached to
// the variant. On import the sheet is treated as the truth: a url in the cell that
// is not yet attached gets attached, and a model whose url has left the cell is
// removed (blob and all). An empty cell therefore clears a variant's models.
//
// shop-variations is an optional companion - 3D on a plain product is half the
// point - so nothing here assumes it is present. When it is absent the point has no
// host and none of this runs.

const COLUMN_KEY = '3d'
const COLUMN_LABEL = '3D Files'

// A variant can carry more than one model, so several urls share one cell.
const CELL_SEPARATOR = '|'

// The variant's own slug is meaningless to a shopper looking at a file; a plain
// leaf name off the url is what the admin recognises. Falls back to the raw tail
// when the url will not parse (a hand-typed relative path, say).
function filenameFromUrl(url: string): string {
  try {
    const tail = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    return decodeURIComponent(tail) || 'model'
  } catch {
    const tail = url.split('?')[0]?.split('/').filter(Boolean).pop() ?? ''
    return tail || 'model'
  }
}

// The current models for a child from the preloaded import context. Returns null
// when there is no context at all (the caller then reads per row, the old path);
// returns [] when a context exists but does not know this child - a variant created
// mid-import - so it is treated as having no models and its urls get attached.
export function resolveCurrentModels(ctx: unknown, childProductId: string): P3dModel[] | null {
  if (!(ctx instanceof Map)) return null
  return (ctx.get(childProductId) as P3dModel[] | undefined) ?? []
}

export const product3dVariantFieldProvider = {
  // Always one column: unlike attributes, whose columns depend on the product, any
  // variant can have a 3D file, so the column is offered on every product. A
  // variant with none simply leaves its cell blank.
  async listColumns() {
    return [{ key: COLUMN_KEY, label: COLUMN_LABEL, order: 10 }]
  },

  async getValues(_productId: string, childProductIds: string[]) {
    const models = await getModelsForProducts(childProductIds)
    const urlsByChild = new Map<string, string[]>()
    for (const m of models) {
      const list = urlsByChild.get(m.productId) ?? []
      list.push(m.url)
      urlsByChild.set(m.productId, list)
    }
    const out: Record<string, Record<string, string>> = {}
    for (const [childId, urls] of urlsByChild) out[childId] = { [COLUMN_KEY]: urls.join(CELL_SEPARATOR) }
    return out
  },

  // Preload every child's current models for this parent in one query, keyed by
  // child id, so applyImportedRow diffs against memory instead of reading per row.
  async beginImport(_productId: string, childProductIds: string[]): Promise<Map<string, P3dModel[]>> {
    const models = await getModelsForProducts(childProductIds)
    const byChild = new Map<string, P3dModel[]>()
    for (const m of models) {
      const list = byChild.get(m.productId) ?? []
      list.push(m)
      byChild.set(m.productId, list)
    }
    return byChild
  },

  async applyImportedRow(_productId: string, childProductId: string, row: Record<string, string>, ctx?: unknown) {
    // The row is keyed by header label; find ours case-insensitively, and do
    // nothing at all when the sheet does not carry the column (so a sheet made
    // before this column existed never wipes a variant's models).
    const entry = Object.entries(row).find(([k]) => k.trim().toLowerCase() === COLUMN_LABEL.toLowerCase())
    if (!entry) return
    const wanted = new Set(
      (entry[1] ?? '')
        .split(CELL_SEPARATOR)
        .map((s) => s.trim())
        .filter(Boolean),
    )

    // Current models from the preloaded context. A context miss - no context, or a
    // child not in the snapshot (a variant created mid-import) - means no current
    // models, so a brand-new variant still gets its urls attached. Only when there
    // is no context at all do we fall back to the per-row read (a caller without
    // beginImport), preserving the old behaviour.
    const preloaded = resolveCurrentModels(ctx, childProductId)
    const current = preloaded ?? (await getModelsForProducts([childProductId]))
    const currentUrls = new Set(current.map((m) => m.url))
    // What this variant's models become, so the context stays correct if the same
    // child appears again (a duplicated combination) later in the import.
    const next = current.filter((m) => wanted.has(m.url))

    // Attach any wanted url not already on this variant. The stored file is not
    // copied - the row points at the url as given - so media keys stay null and
    // its own delete never disturbs a blob it does not own. A url whose extension
    // is not a 3D format is skipped: there is nothing to render from it.
    for (const url of wanted) {
      if (currentUrls.has(url)) continue
      const filename = filenameFromUrl(url)
      const format = formatFromFilename(filename)
      if (!format) continue
      next.push(await createModel({ productId: childProductId, url, mediaProvider: null, mediaKey: null, mediaId: null, filename, format, size: 0 }))
    }

    // Drop any model whose url the sheet no longer lists.
    for (const model of current) {
      if (!wanted.has(model.url)) await deleteModelCascade(model)
    }

    if (ctx instanceof Map) ctx.set(childProductId, next)
  },

  Cell: Product3dVariantColumn,
}
