import { prisma } from '@/lib/db/prisma'
import { signAssetUrl } from '@/lib/media/asset-token'
import { getModelsForProductTree } from '@/modules/product-3d-views-for-shop/lib/db/models'
import { MANUAL_SIZE_ID, attributeColourId, parseHexColour, readColourSource } from '@/modules/product-3d-views-for-shop/lib/fabric/constants'
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
let helpingProbe: { value: boolean; at: number } | null = null
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
 * Whether the companion attributes module is new enough to let one product use the
 * same attribute more than once (its migration 005: a surrogate id and a
 * `name_override` on each helping, and an `assignment_id` on each ticked value).
 *
 * Probed by column rather than assumed from the table, because this module pins no
 * version of product-attributes-for-shop and an install can be a deploy behind. On
 * an older one the configurator simply offers one entry per attribute, exactly as it
 * always did - so nothing here is a hard dependency.
 */
export async function hasAttributeHelpings(): Promise<boolean> {
  if (helpingProbe && Date.now() - helpingProbe.at < PROBE_TTL_MS) return helpingProbe.value
  const rows = await prisma.$queryRaw<[{ present: boolean }]>`
    SELECT (
      to_regclass('public.pat_product_attributes') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pat_product_attributes' AND column_name = 'name_override'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pat_product_values' AND column_name = 'assignment_id'
      )
    ) AS "present"
  `
  const value = Boolean(rows[0]?.present)
  helpingProbe = { value, at: Date.now() }
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
// One attribute value assigned to a variant child. Carries both halves of what an
// attribute value can say: its `label` (the real-world size or overall height, read
// by parseSwatchCm) and its `swatch` (the picture that paints a material part).
// Which of the two is used depends on where the config points at the attribute, not
// on the value itself - an "Oak" finish attribute has no useful number in its label
// and a "20x20cm" swatch-size attribute has no picture.
// `assignmentId` is which HELPING of that attribute the value was ticked under, on
// a product that uses the same attribute more than once ("Top material" and "Frame
// material" both off one Material vocabulary). Null on a value written before
// helpings existed, or by an older product-attributes install.
export type ChildSizeValue = { attributeId: string; assignmentId?: string | null; label: string; swatch?: string | null }

/**
 * Whether a child's attribute value answers to the id a config points at.
 *
 * A config stores a HELPING's id when the product uses that attribute more than
 * once, and the bare ATTRIBUTE id otherwise - see listAttributeChoices for why the
 * unambiguous case keeps its old id rather than being migrated. Both are read here
 * so one lookup serves either, and so every config saved before helpings existed
 * keeps resolving untouched.
 */
function matchesSource(value: ChildSizeValue, id: string): boolean {
  return value.assignmentId === id || value.attributeId === id
}

/**
 * Compose the viewer bundle for a resolved model and a child's selections. Pure and
 * free of the database so the mapping - the fiddly part, per-slot texture + tiling -
 * is unit-testable on its own.
 *
 * The model to draw is the caller's business: it is the variation's own attached
 * model (see resolveFabricForChild), not something this function picks. `model` is
 * that model, or null when the variation has none to draw, and `modelHeightUnits`
 * is its measured bounding-box height in its own units (0 when uncalibrated).
 */
export function composeFabricBundle(
  config: FabricConfig,
  model: { id: string; url: string; format: P3dFormat } | null,
  modelHeightUnits: number,
  selected: SelectedOptionValue[],
  sizes: ChildSizeValue[],
): FabricBundle | null {
  if (!model) return null

  // The shown model's real overall height (cm, per variation) and its height in the
  // model's own units (measured at config time). Together they give cm-per-model-unit,
  // which is what turns a swatch's real size into a true-scale tile repeat. Both are
  // needed; either absent leaves tiling uncalibrated (repeat 1).
  const heightLabel =
    config.heightAttributeId === MANUAL_SIZE_ID
      ? config.heightManual
      : config.heightAttributeId
        ? sizes.find((z) => matchesSource(z, config.heightAttributeId))?.label
        : undefined
  const heightCm = heightLabel ? parseSwatchCm(heightLabel) : null

  const slots = config.slots
    .map((slot) => {
      // A fixed colour is settled here and goes no further: there is no swatch to
      // fetch, no size to read and nothing to tile, so the part is painted flat and
      // the whole scale derivation below is skipped. A colour that will not parse
      // leaves the part alone rather than painting it some guessed shade.
      const source = readColourSource(slot.colourOptionId)
      if (source.kind === 'manual') {
        const colour = parseHexColour(slot.colourManual)
        if (!colour) return null
        return { materialName: slot.materialName, textureUrl: '', colour, repeat: 1, rotationDeg: 0 }
      }
      // Either route ends in one swatch url: a variation option's selected value, or
      // the value of an attribute set on this variation. Everything past this point
      // (scale, rotation) is the same for both.
      const swatch =
        source.kind === 'attribute'
          ? sizes.find((z) => matchesSource(z, source.id))?.swatch ?? ''
          : selected.find((s) => s.optionId === source.id)?.swatch ?? ''
      // Both modules store one visual per value in the same column: a media url for
      // a picture swatch, a hex colour for a plain colour one. A picture is a texture
      // and tiles at true scale; a hex is a flat paint, with nothing to tile and no
      // direction to turn, so it settles here exactly as a hand-typed colour does.
      if (!isHttpUrl(swatch)) {
        const colour = parseHexColour(swatch)
        if (!colour) return null
        return { materialName: slot.materialName, textureUrl: '', colour, repeat: 1, rotationDeg: 0 }
      }
      const textureUrl = swatch
      // A hand-typed size is a fact about the SURFACE, not about the variation, so
      // it applies to every child alike - a laminate's repeat does not change with
      // the seat colour. Read by the same parser as an attribute label, so the two
      // routes behave identically from here on.
      const sizeLabel =
        slot.sizeAttributeId === MANUAL_SIZE_ID
          ? slot.sizeManual
          : sizes.find((z) => matchesSource(z, slot.sizeAttributeId))?.label ?? ''
      const swatchCm = parseSwatchCm(sizeLabel)
      const repeat = tileRepeat({ heightCm, modelHeightUnits, texelDensity: slot.texelDensity, swatchCm })
      return { materialName: slot.materialName, textureUrl, colour: null, repeat, rotationDeg: slot.rotationDeg }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)

  // Signed here as well as in the gallery payload, because this bundle reaches the
  // browser by a second road: the public /fabric/<child> endpoint, which hands out
  // a model url to anyone who asks. Same treatment, same reasoning - the token is
  // stamped on the way out and the stored row keeps the plain url.
  return { modelId: model.id, modelUrl: signAssetUrl(model.url), format: model.format, slots }
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
 * The model shown is the variation's OWN attached model, falling back to a model on
 * the parent product when the variation has none of its own. Keyed by the child
 * product id because that is what shop's gallery contract hands us (activeProductId)
 * and because the size lives on the child; the parent id comes alongside so the
 * fallback and the model-height lookup have the whole product tree to read.
 */
export async function resolveFabricForChild(
  childProductId: string,
  parentProductId: string,
  config: FabricConfig,
): Promise<FabricBundle | null> {
  // Without shop-variations there is no way to know which colours the child
  // carries, so nothing to compose. The plain model is the stage's job, not this
  // resolver's.
  if (!(await hasVariationsTables())) return null

  const selected = await prisma.$queryRaw<{ optionId: string; valueId: string; swatch: string | null }[]>`
    SELECT o."id" AS "optionId", ov."id" AS "valueId", ov."swatch"
    FROM "svr_variants" v
    JOIN "svr_variant_values" vv ON vv."variant_id" = v."id"
    JOIN "svr_option_values" ov ON ov."id" = vv."option_value_id"
    JOIN "svr_options" o ON o."id" = ov."option_id"
    WHERE v."child_product_id" = ${childProductId}
  `

  // The child's attribute values - the per-slot swatch sizes, the model's overall
  // height and any material picture set as an attribute rather than as a variation
  // option all ride in here (all pat_attributes). Without product-attributes
  // there are none, so tiling stays uncalibrated (repeat 1) and only the colour is
  // applied, which composeFabricBundle handles.
  // `assignment_id` says which HELPING the value was ticked under, so a product
  // using one attribute twice ("Seat fabric" and "Back fabric" off one Fabric
  // vocabulary) resolves each part from its own value instead of whichever row the
  // database happened to return first. Read only where the companion module is new
  // enough to have the column - on an older one every value comes back unattributed
  // and the config's bare attribute ids still match, which is what they always did.
  const sizes: ChildSizeValue[] = !(await hasAttributeTables())
    ? []
    : (await hasAttributeHelpings())
      ? await prisma.$queryRaw<ChildSizeValue[]>`
          SELECT a."id" AS "attributeId", pv."assignment_id" AS "assignmentId", av."label", av."swatch"
          FROM "pat_product_values" pv
          JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
          JOIN "pat_attributes" a ON a."id" = av."attribute_id"
          WHERE pv."product_id" = ${childProductId}
        `
      : await prisma.$queryRaw<ChildSizeValue[]>`
          SELECT a."id" AS "attributeId", av."label", av."swatch"
          FROM "pat_product_values" pv
          JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
          JOIN "pat_attributes" a ON a."id" = av."attribute_id"
          WHERE pv."product_id" = ${childProductId}
        `

  // The whole product tree in one read: the model to draw (the child's own, else the
  // parent's) and the map that turns a config's model-height entry into a per-url
  // fact both come from it.
  const tree = await getModelsForProductTree(parentProductId)
  const shown =
    tree.find((m) => m.productId === childProductId) ??
    tree.find((m) => m.productId === parentProductId)
  if (!shown) return null

  // modelHeights is keyed by p3d_models id, but the same GLB is attached once per
  // variation (many rows, one url), so the shown child's row id is not the id the
  // height was measured against. The height belongs to the FILE - resolve it by url,
  // so whichever row is shown finds the height measured for its file.
  const urlById = new Map(tree.map((m) => [m.id, m.url]))
  const heightByUrl = new Map<string, number>()
  for (const [id, height] of Object.entries(config.modelHeights)) {
    const url = urlById.get(id)
    if (url) heightByUrl.set(url, height)
  }
  const modelHeightUnits = heightByUrl.get(shown.url) ?? 0

  return composeFabricBundle(
    config,
    { id: shown.id, url: shown.url, format: shown.format },
    modelHeightUnits,
    selected,
    sizes,
  )
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

/**
 * The site's attributes that could paint a material, for the colour dropdowns
 * alongside the product's variation options. Returned in the same shape as an
 * option, with its id already prefixed (see ATTRIBUTE_COLOUR_PREFIX), so the panel
 * and the preloader treat the two sources alike.
 *
 * Only attributes with at least one picture-swatch value are offered: an attribute
 * of plain words - a size, a warranty, a material NAME with no picture behind it -
 * has nothing to paint with, and listing it would only invite a slot that silently
 * renders nothing. Site-wide rather than per-product, because attribute values are
 * assigned to a variation rather than declared on the parent the way options are.
 */
export async function listColourAttributes(productId: string): Promise<FabricColourOption[]> {
  if (!(await hasAttributeTables())) return []
  const rows = await prisma.$queryRaw<
    { attributeId: string; valueId: string; label: string; swatch: string | null }[]
  >`
    SELECT a."id" AS "attributeId", av."id" AS "valueId", av."label", av."swatch"
    FROM "pat_attributes" a
    JOIN "pat_attribute_values" av ON av."attribute_id" = a."id"
    WHERE av."swatch" IS NOT NULL AND av."swatch" <> ''
    ORDER BY a."name" ASC, av."position" ASC
  `
  const valuesByAttribute = new Map<string, FabricColourOption['values']>()
  for (const row of rows) {
    const list = valuesByAttribute.get(row.attributeId) ?? []
    list.push({ id: row.valueId, label: row.label, swatch: row.swatch })
    valuesByAttribute.set(row.attributeId, list)
  }
  // One entry per HELPING rather than per attribute, so a product that paints two
  // parts off one finish vocabulary can point each at the helping that carries its
  // own values. The values offered are the attribute's - a helping narrows which
  // block a value was ticked in, not which values exist.
  const choices = await listAttributeChoices(productId)
  return choices
    .filter((choice) => valuesByAttribute.has(choice.attributeId))
    .map((choice) => ({
      id: attributeColourId(choice.id),
      name: choice.name,
      values: valuesByAttribute.get(choice.attributeId) ?? [],
    }))
}

export type FabricSizeAttribute = { id: string; name: string; slug: string }

/** Every size/material attribute, for the "Size from" dropdowns. */
export async function listSizeAttributes(productId: string): Promise<FabricSizeAttribute[]> {
  if (!(await hasAttributeTables())) return []
  const choices = await listAttributeChoices(productId)
  return choices.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))
}

// One thing a config's "Overall height from" / "Size from" / "Colour from" dropdown
// can point at, with the id it is stored under.
type AttributeChoice = { id: string; attributeId: string; name: string; slug: string }

/**
 * What this product's attribute dropdowns offer, one entry per helping.
 *
 * A product may now use the same attribute more than once, each helping under a name
 * of its own, and a variation's value is ticked under one helping in particular. So
 * "Material" appearing twice on the product has to appear twice here too - otherwise
 * the configurator can only say "paint this part from Material" and the resolver is
 * left guessing which of the two it meant.
 *
 * The id a choice is stored under depends on whether there is anything to tell apart:
 *
 *  - Used more than once -> the HELPING's id, which is the only thing that
 *    distinguishes "Top material" from "Frame material".
 *  - Used once (or not declared on this product at all) -> the ATTRIBUTE's id, exactly
 *    as before. There is nothing ambiguous to resolve, and it means every config saved
 *    before helpings existed keeps pointing at the same thing without a migration of
 *    the stored JSON. The name still shows the helping's override where it has one.
 *
 * Attributes with no helping on this product are listed after the product's own, but
 * only where this product actually carries values for them: a shop can tick values on
 * the variations without ever declaring the attribute on the parent, and dropping those
 * would silently blank a working config. An attribute that has nothing to do with this
 * product is NOT offered - a shop's whole vocabulary in one dropdown is noise, and every
 * entry in it resolves to nothing.
 */
async function listAttributeChoices(productId: string): Promise<AttributeChoice[]> {
  const all = await prisma.$queryRaw<{ id: string; name: string; slug: string }[]>`
    SELECT "id", "name", "slug" FROM "pat_attributes" ORDER BY "name" ASC
  `
  const inUse = await attributesWithValuesOnProduct(productId)
  if (!(await hasAttributeHelpings())) {
    return all
      .filter((a) => inUse.has(a.id))
      .map((a) => ({ id: a.id, attributeId: a.id, name: a.name, slug: a.slug }))
  }

  const helpings = await prisma.$queryRaw<
    { assignmentId: string; attributeId: string; name: string; slug: string; helpings: number }[]
  >`
    SELECT ppa."id" AS "assignmentId", a."id" AS "attributeId",
           COALESCE(NULLIF(TRIM(ppa."name_override"), ''), a."name") AS "name",
           a."slug",
           (
             SELECT COUNT(*)::int FROM "pat_product_attributes" other
             WHERE other."product_id" = ppa."product_id" AND other."attribute_id" = ppa."attribute_id"
           ) AS "helpings"
    FROM "pat_product_attributes" ppa
    JOIN "pat_attributes" a ON a."id" = ppa."attribute_id"
    WHERE ppa."product_id" = ${productId}
    ORDER BY ppa."position" ASC, a."name" ASC
  `

  const declared = new Set(helpings.map((h) => h.attributeId))
  return [
    ...helpings.map((h) => ({
      id: h.helpings > 1 ? h.assignmentId : h.attributeId,
      attributeId: h.attributeId,
      name: h.name,
      slug: h.slug,
    })),
    ...all
      .filter((a) => !declared.has(a.id) && inUse.has(a.id))
      .map((a) => ({ id: a.id, attributeId: a.id, name: a.name, slug: a.slug })),
  ]
}

/**
 * The attributes this product has values ticked for, on the parent itself or on any of
 * its variant children. Undeclared attributes are only worth offering when there is
 * something behind them; without this the dropdowns list the shop's entire attribute
 * vocabulary, most of which the product has never heard of.
 *
 * The variant-child half is where the real answer usually lives: per-variation values
 * are ticked on the hidden child products, and a size that changes from one variation
 * to the next is exactly what these dropdowns are for. Skipped when shop-variations is
 * absent, since then there are no children to look at.
 */
async function attributesWithValuesOnProduct(productId: string): Promise<Set<string>> {
  const rows = (await hasVariationsTables())
    ? await prisma.$queryRaw<{ attributeId: string }[]>`
        SELECT DISTINCT av."attribute_id" AS "attributeId"
        FROM "pat_product_values" pv
        JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
        WHERE pv."product_id" = ${productId}
           OR pv."product_id" IN (
             SELECT v."child_product_id" FROM "svr_variants" v WHERE v."product_id" = ${productId}
           )
      `
    : await prisma.$queryRaw<{ attributeId: string }[]>`
        SELECT DISTINCT av."attribute_id" AS "attributeId"
        FROM "pat_product_values" pv
        JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
        WHERE pv."product_id" = ${productId}
      `
  return new Set(rows.map((r) => r.attributeId))
}
