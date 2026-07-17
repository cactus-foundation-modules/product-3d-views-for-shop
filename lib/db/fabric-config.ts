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

const FabricModelSchema = z.object({
  // A p3d_models row id: which attached model file to show...
  modelId: z.string(),
  // ...when this structural option value is the shopper's choice. optionId is an
  // svr_options id (e.g. Headrest), valueId one of its svr_option_values.
  optionId: z.string(),
  valueId: z.string(),
})

const FabricSlotSchema = z.object({
  // The exact glTF material name on the model, e.g. "Fabric seat". This is the
  // contract between the config and the file: the material name, not a mesh index.
  materialName: z.string(),
  // svr_options id whose selected value's swatch gives this slot's texture url.
  colourOptionId: z.string(),
  // pat_attributes id whose value gives the real-world swatch size for tiling.
  sizeAttributeId: z.string(),
  // Calibration: the real-world centimetres one texture tile (repeat = 1) spans on
  // this surface. The admin sets it by eye against a real swatch (see the panel).
  uvSpanCm: z.number().positive(),
  // Used when the child has no size value assigned, so tiling still renders rather
  // than dividing by an absent number.
  defaultSwatchCm: z.number().positive(),
})

export const FabricConfigSchema = z.object({
  models: z.array(FabricModelSchema).default([]),
  // Shown when no full variant is resolved yet, or when the active child's
  // structural option value matches no models[] entry.
  defaultModelId: z.string().default(''),
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
