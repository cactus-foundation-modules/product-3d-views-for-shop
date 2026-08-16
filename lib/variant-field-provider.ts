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

type RowPlan = {
  /** Models the sheet still lists, kept as-is. */
  keep: P3dModel[]
  /** Urls to attach, with the filename and format derived for each. */
  toAttach: Array<{ url: string; filename: string; format: NonNullable<ReturnType<typeof formatFromFilename>> }>
  /** Models whose url has left the cell. */
  toDelete: P3dModel[]
}

// What this row would do to a variant's models, decided without writing anything.
// Both applyImportedRow and rowChanged run it, so the preview's count and the
// import's effect cannot drift apart. Returns null when the sheet does not carry
// the column at all - a sheet made before this column existed must never wipe a
// variant's models, and must not be counted as a change either.
async function planRow(childProductId: string, row: Record<string, string>, ctx?: unknown): Promise<RowPlan | null> {
  // The row is keyed by header label; find ours case-insensitively.
  const entry = Object.entries(row).find(([k]) => k.trim().toLowerCase() === COLUMN_LABEL.toLowerCase())
  if (!entry) return null
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

  const toAttach: RowPlan['toAttach'] = []
  for (const url of wanted) {
    if (currentUrls.has(url)) continue
    const filename = filenameFromUrl(url)
    const format = formatFromFilename(filename)
    // A url whose extension is not a 3D format is skipped: there is nothing to
    // render from it, so it is not a change either.
    if (!format) continue
    toAttach.push({ url, filename, format })
  }

  return {
    keep: current.filter((m) => wanted.has(m.url)),
    toAttach,
    toDelete: current.filter((m) => !wanted.has(m.url)),
  }
}

// Every child's current models, keyed by child id. Shared by both preload forms:
// the per-parent one and the batched one differ only in how many children they
// are handed, which is the whole of the difference between one query and 349.
async function modelsByChild(childProductIds: string[]): Promise<Map<string, P3dModel[]>> {
  const byChild = new Map<string, P3dModel[]>()
  const unique = [...new Set(childProductIds)].filter(Boolean)
  if (unique.length === 0) return byChild
  for (const m of await getModelsForProducts(unique)) {
    const list = byChild.get(m.productId) ?? []
    list.push(m)
    byChild.set(m.productId, list)
  }
  return byChild
}

export const product3dVariantFieldProvider = {
  // Always one column: unlike attributes, whose columns depend on the product, any
  // variant can have a 3D file, so the column is offered on every product. A
  // variant with none simply leaves its cell blank.
  // `kind: 'file'` tells shop-variations the cell holds file urls rather than a
  // label, which is what lets its cross-product browser offer a "lost 3D files"
  // filter for models whose blob has gone missing. Nothing here checks urls.
  async listColumns() {
    return [{ key: COLUMN_KEY, label: COLUMN_LABEL, order: 10, kind: 'file' as const }]
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
    return modelsByChild(childProductIds)
  },

  // The same, for many parents at once. This provider never cared which parent a
  // child belonged to - the models are looked up by child id - so batching is
  // simply one query over every child instead of one per parent. On a catalogue
  // of 349 variable products that was 148 seconds of round trips for an answer
  // that fits in a single query.
  async beginImportMany(parents: Array<{ productId: string; childProductIds: string[] }>): Promise<Map<string, P3dModel[]>> {
    return modelsByChild(parents.flatMap((p) => p.childProductIds))
  },

  async applyImportedRow(_productId: string, childProductId: string, row: Record<string, string>, ctx?: unknown) {
    const plan = await planRow(childProductId, row, ctx)
    if (!plan) return

    // What this variant's models become, so the context stays correct if the same
    // child appears again (a duplicated combination) later in the import.
    const next = plan.keep

    // Attach any wanted url not already on this variant. The stored file is not
    // copied - the row points at the url as given - so media keys stay null and
    // its own delete never disturbs a blob it does not own.
    for (const { url, filename, format } of plan.toAttach) {
      next.push(await createModel({ productId: childProductId, url, mediaProvider: null, mediaKey: null, mediaId: null, filename, format, size: 0 }))
    }

    // Drop any model whose url the sheet no longer lists.
    for (const model of plan.toDelete) await deleteModelCascade(model)

    if (ctx instanceof Map) ctx.set(childProductId, next)
  },

  // Read-only twin of applyImportedRow, for the import preview's change count.
  // Same plan, nothing written - so a Pull that would swap a variant's 3D file is
  // counted as an update instead of being reported as "nothing to do" and then
  // quietly doing it anyway.
  async rowChanged(_productId: string, childProductId: string, row: Record<string, string>, ctx?: unknown) {
    const plan = await planRow(childProductId, row, ctx)
    if (!plan) return false
    return plan.toAttach.length > 0 || plan.toDelete.length > 0
  },

  Cell: Product3dVariantColumn,
}
