import {
  createModel,
  getModelsForProducts,
  deleteModelCascade,
} from '@/modules/product-3d-views-for-shop/lib/db/models'
import { formatFromFilename } from '@/modules/product-3d-views-for-shop/lib/formats'
import { Product3dVariantColumn } from '@/modules/product-3d-views-for-shop/components/admin/Product3dVariantColumn'

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

  async applyImportedRow(_productId: string, childProductId: string, row: Record<string, string>) {
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

    const current = await getModelsForProducts([childProductId])
    const currentUrls = new Set(current.map((m) => m.url))

    // Attach any wanted url not already on this variant. The stored file is not
    // copied - the row points at the url as given - so media keys stay null and
    // its own delete never disturbs a blob it does not own. A url whose extension
    // is not a 3D format is skipped: there is nothing to render from it.
    for (const url of wanted) {
      if (currentUrls.has(url)) continue
      const filename = filenameFromUrl(url)
      const format = formatFromFilename(filename)
      if (!format) continue
      await createModel({ productId: childProductId, url, mediaProvider: null, mediaKey: null, mediaId: null, filename, format, size: 0 })
    }

    // Drop any model whose url the sheet no longer lists.
    for (const model of current) {
      if (!wanted.has(model.url)) await deleteModelCascade(model)
    }
  },

  Cell: Product3dVariantColumn,
}
