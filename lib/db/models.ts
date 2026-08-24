import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { deleteMedia } from '@/lib/media/upload'
import { signAssetUrl } from '@/lib/media/asset-token'
import { withFreshStorage } from '@/modules/product-3d-views-for-shop/lib/db/heal'
import type { MediaProviderType } from '@prisma/client'
import type { P3dAdminModel, P3dModel, P3dOption, P3dTarget } from '@/modules/product-3d-views-for-shop/lib/types'
import type { P3dFormat } from '@/modules/product-3d-views-for-shop/lib/formats'

// Queries for p3d_models. Raw SQL throughout: module tables are created by this
// module's own migrations and have no Prisma model, which is how every module
// here talks to its own schema.

type ModelRow = {
  id: string
  productId: string
  url: string
  mediaProvider: string | null
  mediaKey: string | null
  mediaId: string | null
  ownsMedia: boolean
  filename: string
  format: string
  size: number
  position: number
  context: string
}

const toModel = (r: ModelRow): P3dModel => ({ ...r, format: r.format as P3dFormat })

// The column list every read shares, so a new column cannot reach one query and
// miss another - which is how `ownsMedia` would have arrived undefined in
// exactly the one place that decides whether to delete a file.
const COLUMNS = Prisma.sql`
  "id", "product_id" AS "productId", "url", "media_provider" AS "mediaProvider",
  "media_key" AS "mediaKey", "media_id" AS "mediaId", "owns_media" AS "ownsMedia",
  "filename", "format", "size", "position", "context"
`

// ---------------------------------------------------------------------------
// Variations
//
// A variation is a hidden child shp_products row that shop-variations maps to its
// parent (svr_variants.child_product_id). This module needs those children for two
// jobs: offering the admin somewhere to attach a model, and naming the row.
//
// shop-variations is an OPTIONAL companion, not a hard dependency - 3D on a plain
// product is half the point of the feature - so everything below talks to the svr_
// tables through raw SQL and never imports from '@/modules/shop-variations/...'.
// That path does not exist on an install without the module, and a static import
// would break the build there. Same bargain, and the same reasoning, as
// product-attributes-for-shop's lib/variations-bridge.ts.
//
// Presence is probed with to_regclass rather than the Module table: the tables are
// what these queries actually need, and a module row can exist while its migration
// has not run yet.
//
// Read-only by design. This module owns its own schema completely (p3d_models) and
// adds not a column nor a control to shop-variations - a site running only
// shop-variations sees no trace of this module anywhere.
// ---------------------------------------------------------------------------

let probe: { value: boolean; at: number } | null = null
const PROBE_TTL_MS = 30_000

async function hasVariationsTables(): Promise<boolean> {
  if (probe && Date.now() - probe.at < PROBE_TTL_MS) return probe.value
  const rows = await prisma.$queryRaw<[{ present: boolean }]>`
    SELECT (
      to_regclass('public.svr_variants') IS NOT NULL
      AND to_regclass('public.svr_options') IS NOT NULL
      AND to_regclass('public.svr_option_values') IS NOT NULL
      AND to_regclass('public.svr_variant_values') IS NOT NULL
    ) AS "present"
  `
  const value = Boolean(rows[0]?.present)
  probe = { value, at: Date.now() }
  return value
}

/**
 * The variations of a product, as { child product id -> display label }, ordered
 * the way the parent's variation matrix is. Empty when shop-variations is not
 * installed, or the product simply has no variations.
 *
 * The label is the option values joined the way the admin reads them ("Large /
 * Red"), built in SQL so naming a hundred variants is one query rather than a
 * hundred. LEFT JOINed so a variant with no option values still appears: it is
 * still somewhere a model can be attached, and dropping it from the list would
 * make it un-editable rather than merely unnamed.
 */
export async function getVariationLabels(productId: string): Promise<Map<string, string>> {
  if (!(await hasVariationsTables())) return new Map()
  const variants = await listVariantRows(productId)
  if (variants.length === 0) return new Map()
  const values = await variantOptionValues(variants.map((v) => v.id))

  // The label is assembled here rather than by string_agg because the values
  // now arrive keyed by variant id (see variantOptionValues). Same ordering as
  // the SQL had - option position, then value position within the option.
  const byVariant = new Map<string, { label: string; optionPosition: number; valuePosition: number }[]>()
  for (const v of values) {
    const list = byVariant.get(v.variant_id) ?? []
    list.push({ label: v.label, optionPosition: v.option_position, valuePosition: v.value_position })
    byVariant.set(v.variant_id, list)
  }

  const out = new Map<string, string>()
  for (const variant of variants) {
    const parts = (byVariant.get(variant.id) ?? [])
      .sort((a, b) => a.optionPosition - b.optionPosition || a.valuePosition - b.valuePosition)
      .map((p) => p.label)
    // A variant with no option values still gets an entry - it is still
    // somewhere a model can be attached, and dropping it would make it
    // un-editable rather than merely unnamed. That is what the LEFT JOIN and
    // the `?? 'Variation'` fallback did before.
    out.set(variant.childProductId, parts.length > 0 ? parts.join(' / ') : 'Variation')
  }
  return out
}

/** A product's variants, in matrix order. */
async function listVariantRows(productId: string): Promise<{ id: string; childProductId: string }[]> {
  const rows = await prisma.$queryRaw<{ id: string; child_product_id: string }[]>`
    SELECT "id", "child_product_id" FROM "svr_variants"
    WHERE "product_id" = ${productId}
    ORDER BY "position", "created_at"
  `
  return rows.map((r) => ({ id: r.id, childProductId: r.child_product_id }))
}

/**
 * The option values carried by a set of variants, keyed by variant id.
 *
 * `= ANY($1::text[])` rather than joining back to svr_variants on product_id,
 * and the difference is not cosmetic. Asked as a join, Postgres costs the two
 * sides, picks a hash join and sequentially scans the WHOLE svr_variant_values
 * table: on a 588-variant desk that is ~70,000 rows read to return ~2,300, and
 * it was the single largest source of wasted reads on the live install. Handed
 * the variant ids it uses the (variant_id, option_value_id) primary key as a
 * covering index instead - measured at roughly 3ms against 25ms, and the plan
 * survives Postgres switching the prepared statement to a generic plan.
 *
 * The extra round trip for the ids costs nothing: svr_variants is indexed on
 * product_id and both callers need the variant rows anyway.
 */
async function variantOptionValues(
  variantIds: string[],
): Promise<{ variant_id: string; option_value_id: string; label: string; option_position: number; value_position: number }[]> {
  if (variantIds.length === 0) return []
  return prisma.$queryRaw`
    SELECT vv."variant_id",
           vv."option_value_id",
           ov."label",
           o."position" AS "option_position",
           ov."position" AS "value_position"
    FROM "svr_variant_values" vv
    JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
    JOIN "svr_options" o ON o."id" = ov."option_id"
    WHERE vv."variant_id" = ANY(${variantIds}::text[])
  `
}

/**
 * Which option values each variation is made of, as { child product id -> value
 * ids }. The editor's preview picker turns a set of dropdown choices into a
 * variation with this; the labels above are for reading, these are for matching.
 */
export async function getVariationValueIds(productId: string): Promise<Map<string, string[]>> {
  if (!(await hasVariationsTables())) return new Map()
  const variants = await listVariantRows(productId)
  if (variants.length === 0) return new Map()
  const childByVariant = new Map(variants.map((v) => [v.id, v.childProductId]))
  const values = await variantOptionValues(variants.map((v) => v.id))
  const byChild = new Map<string, string[]>()
  for (const row of values) {
    const childProductId = childByVariant.get(row.variant_id)
    if (!childProductId) continue
    const list = byChild.get(childProductId) ?? []
    list.push(row.option_value_id)
    byChild.set(childProductId, list)
  }
  return byChild
}

/**
 * The product's variation options and their values, in the order the admin set
 * them, for the preview picker's dropdowns. Empty when shop-variations is not
 * installed or the product has no options.
 */
export async function getProductOptions(productId: string): Promise<P3dOption[]> {
  if (!(await hasVariationsTables())) return []
  const rows = await prisma.$queryRaw<{ optionId: string; name: string; valueId: string; label: string }[]>`
    SELECT o."id" AS "optionId", o."name", ov."id" AS "valueId", ov."label"
    FROM "svr_options" o
    JOIN "svr_option_values" ov ON ov."option_id" = o."id"
    WHERE o."product_id" = ${productId}
    ORDER BY o."position" ASC, ov."position" ASC
  `
  const byId = new Map<string, P3dOption>()
  for (const row of rows) {
    const existing = byId.get(row.optionId) ?? { id: row.optionId, name: row.name, values: [] }
    existing.values.push({ id: row.valueId, label: row.label })
    byId.set(row.optionId, existing)
  }
  return [...byId.values()]
}

/**
 * Everywhere a model can be attached for this product: the product itself, then
 * each of its variations. The parent is always first and always present.
 */
export async function getTargets(productId: string): Promise<P3dTarget[]> {
  const [labels, valueIds] = await Promise.all([getVariationLabels(productId), getVariationValueIds(productId)])
  return [
    { productId, variationLabel: null, valueIds: [] },
    ...[...labels].map(([id, label]) => ({ productId: id, variationLabel: label, valueIds: valueIds.get(id) ?? [] })),
  ]
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

// Whether context-tagged rows (add-on combination files, see migration 006)
// come back. The DEFAULT is base models only: every consumer that predates
// contexts - the card overlays, the planner's resolver - means "the product's
// own model" and a combined desk-with-screens file sorted first would silently
// hijack it. The gallery, the fabric resolver and the admin editor opt in.
type ModelReadOpts = { includeContexts?: boolean }

function filterContexts<T extends { context: string }>(rows: T[], opts?: ModelReadOpts): T[] {
  return opts?.includeContexts ? rows : rows.filter((r) => !r.context)
}

/**
 * Every model belonging to this product or any of its variations, in the order
 * they should appear. One query for the lot: the storefront needs all of them on
 * every product page, and the variation children are found through
 * shop-variations' mapping table where it is installed.
 */
export async function getModelsForProductTree(productId: string, opts?: ModelReadOpts): Promise<P3dModel[]> {
  const ids = [productId, ...(await getVariationLabels(productId)).keys()]
  const rows = await prisma.$queryRaw<ModelRow[]>`
    SELECT ${COLUMNS}
    FROM "p3d_models"
    WHERE "product_id" = ANY(${ids}::text[])
    ORDER BY "position", "created_at"
  `
  // Repair any row the core library moved out from under before the media
  // reference rewriter existed, so the storefront and the editor preview both get
  // the blob's current address rather than a 404. A no-op for rows already in step
  // (the common case), and for url-only Google Sheet imports with no media id.
  return Promise.all(filterContexts(rows, opts).map((r) => withFreshStorage(toModel(r))))
}

/** The editor's list: every model for the product tree, each named by its target. */
export async function getAdminModels(productId: string): Promise<P3dAdminModel[]> {
  // Tagged rows included: the admin is exactly who needs to see and re-tag them.
  const [models, labels] = await Promise.all([getModelsForProductTree(productId, { includeContexts: true }), getVariationLabels(productId)])
  // Signed like the storefront's, and for a duller reason than protection: the
  // editor loads these models into a viewer in the browser exactly as a shopper's
  // page does, so an unsigned url here would simply be refused by the Worker and
  // the admin would get an empty preview.
  return models.map((m) => ({ ...m, url: signAssetUrl(m.url), variationLabel: labels.get(m.productId) ?? null }))
}

export async function getModelById(id: string): Promise<P3dModel | null> {
  const rows = await prisma.$queryRaw<ModelRow[]>`
    SELECT ${COLUMNS}
    FROM "p3d_models"
    WHERE "id" = ${id}
  `
  const row = rows[0]
  return row ? toModel(row) : null
}

/**
 * True when `targetProductId` is this product or one of its variations. The upload
 * route gates on this: the id arrives from the browser, and without the check an
 * admin with rights to one product could attach a model to any other.
 */
export async function isValidTarget(productId: string, targetProductId: string): Promise<boolean> {
  if (targetProductId === productId) return true
  return (await getVariationLabels(productId)).has(targetProductId)
}

export async function createModel(input: {
  productId: string
  url: string
  mediaProvider: string | null
  mediaKey: string | null
  mediaId: string | null
  // Whether this row is what put the file in the library. An upload says true and
  // keeps the right to tidy the bytes away later; a file picked from the library
  // says false, because it was the owner's before this row existed. Defaults to
  // false where a caller has no view: the cost of a wrong false is an orphaned
  // blob, and of a wrong true, someone else's file.
  ownsMedia?: boolean
  filename: string
  format: P3dFormat
  size: number
}): Promise<P3dModel> {
  // Position appends within the target product, so a second model for a variation
  // lands after its first rather than fighting the parent's numbering.
  const rows = await prisma.$queryRaw<ModelRow[]>`
    INSERT INTO "p3d_models" ("product_id", "url", "media_provider", "media_key", "media_id", "owns_media", "filename", "format", "size", "position")
    VALUES (
      ${input.productId}, ${input.url}, ${input.mediaProvider}, ${input.mediaKey}, ${input.mediaId},
      ${input.ownsMedia ?? false},
      ${input.filename}, ${input.format}, ${input.size},
      COALESCE((SELECT MAX("position") + 1 FROM "p3d_models" WHERE "product_id" = ${input.productId}), 0)
    )
    RETURNING ${COLUMNS}
  `
  const row = rows[0]
  if (!row) throw new Error('Failed to create 3D model row')
  return toModel(row)
}

export async function deleteModel(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "p3d_models" WHERE "id" = ${id}`
}

/**
 * Tag a model with the add-on context it shows ('' = the base model). The tag
 * decides WHEN the file is drawn, never whether it exists - see
 * migrations/006_model_context.sql for the matching rules.
 */
export async function updateModelContext(id: string, context: string): Promise<void> {
  await prisma.$executeRaw`UPDATE "p3d_models" SET "context" = ${context} WHERE "id" = ${id}`
}

/**
 * Enabled variation children per parent, in variation order, for a whole batch -
 * one query for the lot. Empty without shop-variations, or for a parent with no
 * (enabled) variations. Used by the card-media provider to find, for a product with
 * no model of its own, a variation that has one to show in the grid. Read-only and
 * guarded by to_regclass, like the rest of the svr_ access above.
 */
export async function getVariationChildrenForProducts(productIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (productIds.length === 0 || !(await hasVariationsTables())) return map
  const rows = await prisma.$queryRaw<{ productId: string; childProductId: string }[]>`
    SELECT "product_id" AS "productId", "child_product_id" AS "childProductId"
    FROM "svr_variants"
    WHERE "product_id" = ANY(${productIds}::text[]) AND "enabled" = true
    ORDER BY "position" ASC, "created_at" ASC
  `
  for (const r of rows) {
    const list = map.get(r.productId) ?? []
    list.push(r.childProductId)
    map.set(r.productId, list)
  }
  return map
}

/** Models attached directly to any of the given products (no variation tree walk). */
export async function getModelsForProducts(productIds: string[], opts?: ModelReadOpts): Promise<P3dModel[]> {
  if (productIds.length === 0) return []
  const rows = await prisma.$queryRaw<ModelRow[]>`
    SELECT ${COLUMNS}
    FROM "p3d_models"
    WHERE "product_id" = ANY(${productIds}::text[])
    ORDER BY "position", "created_at"
  `
  return filterContexts(rows, opts).map(toModel)
}

/**
 * True when some OTHER row still points at the same stored file as `model`.
 *
 * One file can hang off several rows. The picker exists so a model uploaded for
 * the whole product can be attached to a variation as well, and that attach
 * copies no bytes - it writes a second row beside the first, both naming the one
 * object. The Google Sheet import does the same by url alone, with no media ids
 * at all, so all three columns are asked: the library id where there is one, the
 * storage key where there is one, and the url, which every row has.
 *
 * Called after our own row has gone, so it cannot count itself; the id guard is
 * belt and braces.
 */
async function fileStillInUse(model: P3dModel): Promise<boolean> {
  const rows = await prisma.$queryRaw<[{ n: bigint }]>`
    SELECT COUNT(*)::bigint AS "n"
    FROM "p3d_models"
    WHERE "id" <> ${model.id}
      AND (
        ("media_id" IS NOT NULL AND "media_id" = ${model.mediaId})
        OR ("media_key" IS NOT NULL AND "media_key" = ${model.mediaKey})
        OR "url" = ${model.url}
      )
  `
  return Number(rows[0]?.n ?? 0n) > 0
}

/**
 * Remove a model everywhere: our row, the core library row, and the stored blob.
 * The blob matters - a 3D file runs to tens of megabytes, so a row-only delete
 * would bill the owner for bytes nothing references. Shared by the delete route
 * and the Google Sheet import, which drops a model when its url leaves a variant's
 * cell. Tidying failures are logged, not thrown: the row is already gone, which is
 * what "deleted" means to the shop.
 *
 * Two things have to hold before any of that is ours to do, and neither used to
 * be checked:
 *
 *   - Nothing else may point at the file. Attached to the product and to one of
 *     its variations is two rows over one object, so removing either one deleted
 *     the object out from under the other: the survivor kept its row, lost its
 *     file, and showed as a broken model in the editor and a 404 on the shop.
 *   - The file has to have been ours to begin with. A model picked from the
 *     media library rather than uploaded here is the site owner's file, sitting
 *     where they put it; removing the model is not permission to delete it.
 */
export async function deleteModelCascade(model: P3dModel): Promise<void> {
  await deleteModel(model.id)
  if (!model.ownsMedia) return
  if (await fileStillInUse(model)) return

  if (model.mediaId) {
    await prisma.media.delete({ where: { id: model.mediaId } }).catch(() => {})
  }
  if (model.mediaKey && model.mediaProvider) {
    await deleteMedia(model.mediaProvider as MediaProviderType, model.mediaKey).catch((error: unknown) => {
      console.error(`[product-3d-views-for-shop] could not delete blob ${model.mediaKey}:`, error)
    })
  }
}
