import { prisma } from '@/lib/db/prisma'
import { getModelById } from '@/modules/product-3d-views-for-shop/lib/db/models'
import type { FabricConfig } from '@/modules/product-3d-views-for-shop/lib/db/fabric-config'
import type { FabricBundle } from '@/modules/product-3d-views-for-shop/lib/types'
import type { P3dFormat } from '@/modules/product-3d-views-for-shop/lib/formats'

// Resolving a variant child to the model + fabric paints the viewer should show.
//
// shop-variations (svr_*) and product-attributes-for-shop (pat_*) are OPTIONAL
// companions, never hard dependencies - this module renders a plain product's 3D
// view without either. So everything below talks to their tables through raw SQL
// behind a to_regclass presence probe and never imports from those modules: those
// paths do not exist on an install without them, and a static import would break
// the build there. Same bargain as lib/db/models.ts and product-attributes'
// variations-bridge.ts.

let svrProbe: { value: boolean; at: number } | null = null
let patProbe: { value: boolean; at: number } | null = null
const PROBE_TTL_MS = 30_000

export async function hasVariationsTables(): Promise<boolean> {
  if (svrProbe && Date.now() - svrProbe.at < PROBE_TTL_MS) return svrProbe.value
  const rows = await prisma.$queryRaw<[{ present: boolean }]>`
    SELECT (
      to_regclass('public.svr_variants') IS NOT NULL
      AND to_regclass('public.svr_options') IS NOT NULL
      AND to_regclass('public.svr_option_values') IS NOT NULL
      AND to_regclass('public.svr_variant_values') IS NOT NULL
    ) AS "present"
  `
  const value = Boolean(rows[0]?.present)
  svrProbe = { value, at: Date.now() }
  return value
}

export async function hasAttributeTables(): Promise<boolean> {
  if (patProbe && Date.now() - patProbe.at < PROBE_TTL_MS) return patProbe.value
  const rows = await prisma.$queryRaw<[{ present: boolean }]>`
    SELECT (
      to_regclass('public.pat_attributes') IS NOT NULL
      AND to_regclass('public.pat_attribute_values') IS NOT NULL
      AND to_regclass('public.pat_product_values') IS NOT NULL
    ) AS "present"
  `
  const value = Boolean(rows[0]?.present)
  patProbe = { value, at: Date.now() }
  return value
}

/**
 * The real-world centimetres a swatch label describes: "20x20cm" -> 20. Takes the
 * first integer in the label; v1 assumes square swatches, so a "10x20" reads as 10
 * and the non-square case is out of scope (noted in the spec). Returns null when
 * the label carries no number at all, which the caller falls back from.
 */
export function parseSwatchCm(label: string): number | null {
  const match = label.match(/\d+/)
  if (!match) return null
  const value = Number.parseInt(match[0], 10)
  return Number.isFinite(value) && value > 0 ? value : null
}

// An http(s) url is the only thing worth painting: a swatch that is empty, or a
// bare colour token rather than a texture file, would give the loader nothing to
// fetch, so the slot is skipped rather than drawn blank.
function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

// One selected option value on a variant child, as the composition needs it.
export type SelectedOptionValue = { optionId: string; valueId: string; swatch: string | null }
// One size attribute value assigned to a variant child.
export type ChildSizeValue = { attributeId: string; label: string }

/**
 * Compose the viewer bundle from a config and a child's resolved selections. Pure
 * and free of the database so the mapping - the fiddly part - is unit-testable on
 * its own: model selection, per-slot texture + tiling, and the fallbacks.
 *
 * `models` is the caller's pre-resolved lookup of the model ids the config names,
 * so this function needs no database of its own.
 */
export function composeFabricBundle(
  config: FabricConfig,
  selected: SelectedOptionValue[],
  sizes: ChildSizeValue[],
  models: Map<string, { url: string; format: P3dFormat }>,
): FabricBundle | null {
  // Model: the models[] entry whose (option, value) the child actually carries,
  // else the default. That is how a structural option (Headrest) switches between
  // whole model files rather than re-texturing one.
  const matched = config.models.find((m) => selected.some((s) => s.optionId === m.optionId && s.valueId === m.valueId))
  const modelId = matched?.modelId || config.defaultModelId
  const model = modelId ? models.get(modelId) : undefined
  if (!model) return null

  const slots = config.slots
    .map((slot) => {
      const choice = selected.find((s) => s.optionId === slot.colourOptionId)
      const textureUrl = choice?.swatch ?? ''
      if (!isHttpUrl(textureUrl)) return null
      const sizeLabel = sizes.find((z) => z.attributeId === slot.sizeAttributeId)?.label ?? ''
      // A missing or unparseable size falls back to the slot's own default rather
      // than skipping tiling: the fabric still renders, just not at true scale
      // until the size is filled in on the child (a data-entry job, not a bug).
      const swatchCm = parseSwatchCm(sizeLabel) ?? slot.defaultSwatchCm
      const repeat = slot.uvSpanCm / swatchCm
      return { materialName: slot.materialName, textureUrl, repeat }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)

  return { modelId, modelUrl: model.url, format: model.format, slots }
}

/**
 * Resolve a variant child to its fabric bundle, or null when it cannot be drawn.
 *
 * Keyed by the child product id because that is all shop's gallery contract hands
 * us (activeProductId) and because the size lives on the child. The joins are done
 * here, server-side, rather than asking shop to widen its contract to pass the
 * selected option-value ids.
 */
export async function resolveFabricForChild(
  childProductId: string,
  config: FabricConfig,
): Promise<FabricBundle | null> {
  // Without shop-variations there is no way to know which colours the child
  // carries, so nothing to compose. The plain default model is the stage's job
  // (see FabricStage), not this resolver's.
  if (!(await hasVariationsTables())) return null

  const selected = await prisma.$queryRaw<{ optionId: string; valueId: string; swatch: string | null }[]>`
    SELECT o."id" AS "optionId", ov."id" AS "valueId", ov."swatch"
    FROM "svr_variants" v
    JOIN "svr_variant_values" vv ON vv."variant_id" = v."id"
    JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
    JOIN "svr_options" o ON o."id" = ov."option_id"
    WHERE v."child_product_id" = ${childProductId}
  `

  // Sizes are a bonus: without product-attributes-for-shop the tiling simply falls
  // back to each slot's default swatch size, which composeFabricBundle handles.
  const sizes = (await hasAttributeTables())
    ? await prisma.$queryRaw<{ attributeId: string; label: string }[]>`
        SELECT a."id" AS "attributeId", av."label"
        FROM "pat_product_values" pv
        JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
        JOIN "pat_attributes" a ON a."id" = av."attribute_id"
        WHERE pv."product_id" = ${childProductId}
      `
    : []

  // Only the model ids the config actually names are looked up, and each once.
  const ids = [...new Set([config.defaultModelId, ...config.models.map((m) => m.modelId)].filter(Boolean))]
  const models = new Map<string, { url: string; format: P3dFormat }>()
  for (const id of ids) {
    const model = await getModelById(id)
    if (model) models.set(id, { url: model.url, format: model.format })
  }

  return composeFabricBundle(config, selected, sizes, models)
}

// ---------------------------------------------------------------------------
// Admin data
//
// The material picker in FabricConfigPanel names slots by their glTF material name
// (detected client-side from the model), but the colour and size dropdowns are fed
// from the companion modules' tables through these read-only helpers.
// ---------------------------------------------------------------------------

export type FabricColourOption = { id: string; name: string; values: { id: string; label: string; swatch: string | null }[] }

/** The product's variation options and their values, for the colour dropdowns. */
export async function listColourOptions(productId: string): Promise<FabricColourOption[]> {
  if (!(await hasVariationsTables())) return []
  const rows = await prisma.$queryRaw<
    { optionId: string; name: string; optionPosition: number; valueId: string; label: string; swatch: string | null; valuePosition: number }[]
  >`
    SELECT o."id" AS "optionId", o."name", o."position" AS "optionPosition",
           ov."id" AS "valueId", ov."label", ov."swatch", ov."position" AS "valuePosition"
    FROM "svr_options" o
    JOIN "svr_option_values" ov ON ov."option_id" = o."id"
    WHERE o."product_id" = ${productId}
    ORDER BY o."position" ASC, ov."position" ASC
  `
  const byId = new Map<string, FabricColourOption>()
  for (const row of rows) {
    const existing = byId.get(row.optionId) ?? { id: row.optionId, name: row.name, values: [] }
    existing.values.push({ id: row.valueId, label: row.label, swatch: row.swatch })
    byId.set(row.optionId, existing)
  }
  return [...byId.values()]
}

export type FabricSizeAttribute = { id: string; name: string; slug: string }

/** Every size/material attribute, for the "Size from" dropdowns. */
export async function listSizeAttributes(): Promise<FabricSizeAttribute[]> {
  if (!(await hasAttributeTables())) return []
  const rows = await prisma.$queryRaw<{ id: string; name: string; slug: string }[]>`
    SELECT "id", "name", "slug" FROM "pat_attributes" ORDER BY "name" ASC
  `
  return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug }))
}
