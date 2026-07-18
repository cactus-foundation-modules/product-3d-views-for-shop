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
 * The real-world centimetres a size label describes: "20x20cm" -> 20, "137cm" ->
 * 137, "1070mm" -> 107. Takes the first number in the label, so it reads both a
 * square swatch size and an overall-height value; a non-square "10x20" reads as 10
 * (out of scope in v1).
 *
 * The UNIT written after that number is honoured, because an admin enters heights
 * and swatch sizes in whichever they have to hand: a value tagged `mm` is a tenth
 * of the same number in cm, and `m` is a hundred times. A bare number carries no
 * unit and is read as centimetres, which is what the configurator has always
 * assumed. Getting this wrong is a factor-of-ten scale error - a chair entered as
 * "1070mm" would weave ten times too coarse if its mm were treated as cm.
 *
 * Returns null when the label carries no number at all, which the caller treats as
 * "uncalibrated".
 */
export function parseSwatchCm(label: string): number | null {
  // The value is the first number; the unit is read separately as the one that
  // trails a digit anywhere in the label, so "20x20mm" (unit on the second number)
  // still scales as millimetres, while prose that merely contains an "m" - a size
  // named "Medium" - is not mistaken for a metre value. A unit must follow a digit
  // to count.
  const number = label.match(/\d+(?:\.\d+)?/)
  if (!number) return null
  const value = Number.parseFloat(number[0])
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = label.match(/\d\s*(mm|cm|m)\b/i)?.[1]?.toLowerCase()
  const cm = unit === 'mm' ? value / 10 : unit === 'm' ? value * 100 : value
  return cm > 0 ? cm : null
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

  // The shown model's real overall height (cm, per variation) and its height in the
  // model's own units (measured at config time). Together they give cm-per-model-unit,
  // which is what turns a swatch's real size into a true-scale tile repeat. Both are
  // needed and model-specific; either absent leaves tiling uncalibrated (repeat 1).
  const heightLabel = config.heightAttributeId ? sizes.find((z) => z.attributeId === config.heightAttributeId)?.label : undefined
  const heightCm = heightLabel ? parseSwatchCm(heightLabel) : null
  const modelHeightUnits = config.modelHeights[modelId] ?? 0

  const slots = config.slots
    .map((slot) => {
      const choice = selected.find((s) => s.optionId === slot.colourOptionId)
      const textureUrl = choice?.swatch ?? ''
      if (!isHttpUrl(textureUrl)) return null
      const sizeLabel = sizes.find((z) => z.attributeId === slot.sizeAttributeId)?.label ?? ''
      const swatchCm = parseSwatchCm(sizeLabel)
      const repeat = tileRepeat({ heightCm, modelHeightUnits, texelDensity: slot.texelDensity, swatchCm })
      return { materialName: slot.materialName, textureUrl, repeat }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)

  return { modelId, modelUrl: model.url, format: model.format, slots }
}

/**
 * The tile repeat for one fabric surface, at true real-world scale.
 *
 * Derivation: the model's real height (`heightCm`) over its height in the model's
 * own units gives cm-per-model-unit. `texelDensity` (UV units per model-unit,
 * measured from the mesh) times that height-in-units is how many UV units the
 * surface spans; a swatch covering `swatchCm` of real fabric should tile once per
 * `swatchCm`, so
 *
 *   repeat = realHeightCm / (modelHeightUnits * texelDensity * swatchCm)
 *
 * which is dimensionless. Every term must be present and positive; any missing one
 * (an uncalibrated model, a variant with no size or height value) leaves the fabric
 * at repeat 1 - the colour is still correct, only the scale is neutral until the
 * data is filled in. There is deliberately no default size: the size is a
 * per-variation fact, not something this module invents.
 */
export function tileRepeat(input: {
  heightCm: number | null
  modelHeightUnits: number
  texelDensity: number
  swatchCm: number | null
}): number {
  const { heightCm, modelHeightUnits, texelDensity, swatchCm } = input
  if (!heightCm || !swatchCm || modelHeightUnits <= 0 || texelDensity <= 0) return 1
  const repeat = heightCm / (modelHeightUnits * texelDensity * swatchCm)
  return Number.isFinite(repeat) && repeat > 0 ? repeat : 1
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

  // The child's attribute values - both the per-slot swatch sizes and the model's
  // overall height ride in here (all pat_attributes). Without product-attributes
  // there are none, so tiling stays uncalibrated (repeat 1) and only the colour is
  // applied, which composeFabricBundle handles.
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
