import { prisma } from '@/lib/db/prisma'
import { deleteMedia } from '@/lib/media/upload'
import type { MediaProviderType } from '@prisma/client'
import type { P3dAdminModel, P3dModel, P3dTarget } from '@/modules/product-3d-views-for-shop/lib/types'
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
  filename: string
  format: string
  size: number
  position: number
}

const toModel = (r: ModelRow): P3dModel => ({ ...r, format: r.format as P3dFormat })

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
  const rows = await prisma.$queryRaw<{ productId: string; label: string | null }[]>`
    SELECT v."child_product_id" AS "productId",
           string_agg(ov."label", ' / ' ORDER BY o."position", ov."position") AS "label"
    FROM "svr_variants" v
    LEFT JOIN "svr_variant_values" vv ON vv."variant_id" = v."id"
    LEFT JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
    LEFT JOIN "svr_options" o ON o."id" = ov."option_id"
    WHERE v."product_id" = ${productId}
    GROUP BY v."id", v."child_product_id", v."position"
    ORDER BY v."position"
  `
  return new Map(rows.map((r) => [r.productId, r.label ?? 'Variation']))
}

/**
 * Everywhere a model can be attached for this product: the product itself, then
 * each of its variations. The parent is always first and always present.
 */
export async function getTargets(productId: string): Promise<P3dTarget[]> {
  const labels = await getVariationLabels(productId)
  return [
    { productId, variationLabel: null },
    ...[...labels].map(([id, label]) => ({ productId: id, variationLabel: label })),
  ]
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/**
 * Every model belonging to this product or any of its variations, in the order
 * they should appear. One query for the lot: the storefront needs all of them on
 * every product page, and the variation children are found through
 * shop-variations' mapping table where it is installed.
 */
export async function getModelsForProductTree(productId: string): Promise<P3dModel[]> {
  const ids = [productId, ...(await getVariationLabels(productId)).keys()]
  const rows = await prisma.$queryRaw<ModelRow[]>`
    SELECT "id", "product_id" AS "productId", "url", "media_provider" AS "mediaProvider",
           "media_key" AS "mediaKey", "media_id" AS "mediaId", "filename", "format",
           "size", "position"
    FROM "p3d_models"
    WHERE "product_id" = ANY(${ids}::text[])
    ORDER BY "position", "created_at"
  `
  return rows.map(toModel)
}

/** The editor's list: every model for the product tree, each named by its target. */
export async function getAdminModels(productId: string): Promise<P3dAdminModel[]> {
  const [models, labels] = await Promise.all([getModelsForProductTree(productId), getVariationLabels(productId)])
  return models.map((m) => ({ ...m, variationLabel: labels.get(m.productId) ?? null }))
}

export async function getModelById(id: string): Promise<P3dModel | null> {
  const rows = await prisma.$queryRaw<ModelRow[]>`
    SELECT "id", "product_id" AS "productId", "url", "media_provider" AS "mediaProvider",
           "media_key" AS "mediaKey", "media_id" AS "mediaId", "filename", "format",
           "size", "position"
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
  filename: string
  format: P3dFormat
  size: number
}): Promise<P3dModel> {
  // Position appends within the target product, so a second model for a variation
  // lands after its first rather than fighting the parent's numbering.
  const rows = await prisma.$queryRaw<ModelRow[]>`
    INSERT INTO "p3d_models" ("product_id", "url", "media_provider", "media_key", "media_id", "filename", "format", "size", "position")
    VALUES (
      ${input.productId}, ${input.url}, ${input.mediaProvider}, ${input.mediaKey}, ${input.mediaId},
      ${input.filename}, ${input.format}, ${input.size},
      COALESCE((SELECT MAX("position") + 1 FROM "p3d_models" WHERE "product_id" = ${input.productId}), 0)
    )
    RETURNING "id", "product_id" AS "productId", "url", "media_provider" AS "mediaProvider",
              "media_key" AS "mediaKey", "media_id" AS "mediaId", "filename", "format", "size", "position"
  `
  const row = rows[0]
  if (!row) throw new Error('Failed to create 3D model row')
  return toModel(row)
}

export async function deleteModel(id: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "p3d_models" WHERE "id" = ${id}`
}

/** Models attached directly to any of the given products (no variation tree walk). */
export async function getModelsForProducts(productIds: string[]): Promise<P3dModel[]> {
  if (productIds.length === 0) return []
  const rows = await prisma.$queryRaw<ModelRow[]>`
    SELECT "id", "product_id" AS "productId", "url", "media_provider" AS "mediaProvider",
           "media_key" AS "mediaKey", "media_id" AS "mediaId", "filename", "format",
           "size", "position"
    FROM "p3d_models"
    WHERE "product_id" = ANY(${productIds}::text[])
    ORDER BY "position", "created_at"
  `
  return rows.map(toModel)
}

/**
 * Remove a model everywhere: our row, the core library row, and the stored blob.
 * The blob matters - a 3D file runs to tens of megabytes, so a row-only delete
 * would bill the owner for bytes nothing references. Shared by the delete route
 * and the Google Sheet import, which drops a model when its url leaves a variant's
 * cell. Tidying failures are logged, not thrown: the row is already gone, which is
 * what "deleted" means to the shop.
 */
export async function deleteModelCascade(model: P3dModel): Promise<void> {
  await deleteModel(model.id)
  if (model.mediaId) {
    await prisma.media.delete({ where: { id: model.mediaId } }).catch(() => {})
  }
  if (model.mediaKey && model.mediaProvider) {
    await deleteMedia(model.mediaProvider as MediaProviderType, model.mediaKey).catch((error: unknown) => {
      console.error(`[product-3d-views-for-shop] could not delete blob ${model.mediaKey}:`, error)
    })
  }
}
