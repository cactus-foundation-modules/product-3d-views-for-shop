import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'

// The fabric configurator's per-parent-product config, stored as one JSON blob on
// a p3d_fabric_configs row. Same defensive-parse approach as lib/config.ts: a
// corrupt or partial column is treated as "not configured" rather than taking the
// product page down with it.
//
// Everything referenced here by id (option, value, attribute, model) lives in
// another module's table or in our own p3d_models, and is resolved at read time
// (see lib/fabric/resolve.ts). The stored JSON is therefore just ids and a couple
// of calibration numbers - no hard link to shop-variations, so the row survives an
// install that later removes it.

const FabricSlotSchema = z.object({
  // The exact glTF material name on the model, e.g. "Fabric seat". This is the
  // contract between the config and the file: the material name, not a mesh index.
  materialName: z.string(),
  // svr_options id whose selected value's swatch gives this slot's texture url, or
  // MANUAL_COLOUR_ID when the part is painted the fixed colour in `colourManual`.
  colourOptionId: z.string(),
  // The hand-typed colour, used only when colourOptionId is MANUAL_COLOUR_ID.
  // Stored as written and normalised at read time (parseHexColour), so a stored
  // "#ABC" and "aabbcc" both resolve; anything that is not a colour leaves the part
  // unpainted rather than guessed at.
  colourManual: z.string().default(''),
  // How far to turn this part's texture on the model, in degrees clockwise, about
  // the middle of its tile. The grain of a veneer, the weave of a cane panel and the
  // brush of a metal are all directional, and one exported model often carries UVs
  // laid out the wrong way round on a single part - which, before this, meant going
  // back to the modeller. Added to whatever rotation the model's own map already
  // carried. Ignored by a part painted a flat colour, which has no direction.
  rotationDeg: z.number().default(0),
  // pat_attributes id whose value gives the real-world swatch size for tiling, or
  // MANUAL_SIZE_ID when the size is typed by hand into `sizeManual` below.
  sizeAttributeId: z.string(),
  // The hand-typed swatch size, used only when sizeAttributeId is MANUAL_SIZE_ID.
  // Read by the same parser as an attribute's label, so "20cm", "200mm" and a bare
  // "20" all work. Not every surface has a per-variation size attribute behind it -
  // a laminate or a veneer finish is often one fixed repeat across the whole range -
  // and inventing an attribute per such surface is a lot of admin for one number.
  sizeManual: z.string().default(''),
  // This material's texel density, measured from the model in the browser at config
  // time (the server never parses a GLB): UV units per model-unit, i.e. how the
  // material's texture is stretched across its geometry. Combined with the model's
  // real height it turns the per-variation swatch size into a true-scale tile
  // repeat - see lib/fabric/resolve.ts. 0 means "not measured yet".
  texelDensity: z.number().nonnegative().default(0),
})

export const FabricConfigSchema = z.object({
  // pat_attributes id whose per-variation value gives the model's REAL overall
  // height in cm. That one real dimension pins the model's real-world scale (the
  // file carries geometry but not reliably its unit - mm vs metres), from which
  // every fabric surface's true size, and so its tile density, is derived.
  // May hold MANUAL_SIZE_ID, in which case the height is the hand-typed
  // `heightManual` below instead.
  heightAttributeId: z.string().default(''),
  // The hand-typed overall height, used only when heightAttributeId is
  // MANUAL_SIZE_ID. A product whose variations differ in colour but not in size
  // has one height for the lot, and a site without the product-attributes module
  // has no attribute to point at at all - either way, typing "72cm" once beats
  // inventing an attribute and setting the same value on every variation.
  heightManual: z.string().default(''),
  // Each attached model's bounding-box height in its OWN units, measured from the
  // mesh at config time. Keyed by p3d_models id, but the height belongs to the FILE
  // (its url), so the resolver reads it by url - the same GLB attached to several
  // variations has one height across all of them. Paired with the real height above
  // to get cm-per-model-unit.
  modelHeights: z.record(z.string(), z.number()).default({}),
  slots: z.array(FabricSlotSchema).default([]),
})

export type FabricConfig = z.infer<typeof FabricConfigSchema>

/**
 * Parse a stored config blob. Returns null on missing or corrupt input - unlike
 * the viewer settings, an unparseable fabric config means "not configured", and
 * the module falls back to its plain gallery behaviour rather than to a set of
 * defaults that would describe no real product.
 */
export function parseFabricConfig(raw: unknown): FabricConfig | null {
  if (raw == null) return null
  const result = FabricConfigSchema.safeParse(raw)
  return result.success ? result.data : null
}

/**
 * The saved fabric config for a parent product, or null when there is no row, the
 * table does not exist yet, or the stored JSON is corrupt.
 *
 * Probed with to_regclass first, the same way lib/config.ts reaches p3d_settings:
 * this table arrives in migration 003, and an install running this code before 003
 * has been applied has no such table - and "no table" means "nothing configured",
 * which is a null and the plain gallery, not a 500 on the shopper's product page.
 */
export async function getFabricConfig(parentProductId: string): Promise<FabricConfig | null> {
  const [probe] = await prisma.$queryRaw<{ exists: string | null }[]>`
    SELECT to_regclass('public.p3d_fabric_configs')::text AS "exists"
  `
  if (!probe?.exists) return null

  const rows = await prisma.$queryRaw<{ config: unknown }[]>`
    SELECT "config" FROM "p3d_fabric_configs" WHERE "product_id" = ${parentProductId} LIMIT 1
  `
  if (rows.length === 0) return null
  return parseFabricConfig(rows[0]?.config)
}

/** Upsert the fabric config for a parent product. */
export async function saveFabricConfig(parentProductId: string, config: FabricConfig): Promise<void> {
  // Validated again here rather than trusting the caller: this is the last gate
  // before the blob is persisted, and a bad shape stored now is a corrupt read
  // later. parse throws, which the route turns into a 400.
  const next = FabricConfigSchema.parse(config)
  const serialised = JSON.stringify(next)
  await prisma.$executeRaw`
    INSERT INTO "p3d_fabric_configs" ("product_id", "config", "updated_at")
    VALUES (${parentProductId}, ${serialised}::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT ("product_id") DO UPDATE
      SET "config" = ${serialised}::jsonb, "updated_at" = CURRENT_TIMESTAMP
  `
}
