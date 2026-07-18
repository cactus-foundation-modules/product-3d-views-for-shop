import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'

// Per-parent-product overrides of the sitewide viewer settings, stored as one
// JSON blob on a p3d_product_settings row. Same defensive-parse approach as
// lib/config.ts: a corrupt or partial column reads as "no overrides" rather than
// taking the product page down with it.
//
// Every field here is nullable, and null is the meaningful value: "use the
// sitewide setting". Only brightness is overridable today; anything a product
// might one day want its own value for joins this schema rather than growing a
// column.

export const P3dProductConfigSchema = z.object({
  // The viewer's brightness (tone mapping exposure) for this product alone.
  // Same clamp as the sitewide field - a value outside it breaks the viewer, and
  // whose viewer it breaks does not change that. null means the sitewide value.
  // Meaningless while the sitewide colour handling is 'none', exactly as the
  // sitewide brightness is - the renderer applies exposure as part of the tone
  // curve, so there is nothing for it to scale without one.
  exposure: z.number().min(0.1).max(3).nullable().default(null),
})

export type P3dProductConfig = z.infer<typeof P3dProductConfigSchema>

export const P3D_PRODUCT_CONFIG_DEFAULTS: P3dProductConfig = P3dProductConfigSchema.parse({})

export function parseP3dProductConfig(raw: unknown): P3dProductConfig {
  const result = P3dProductConfigSchema.safeParse(raw ?? {})
  return result.success ? result.data : P3D_PRODUCT_CONFIG_DEFAULTS
}

/**
 * The saved overrides for a parent product. No row, a corrupt row, or - during
 * the deploy window before migration 004 has applied - no table at all, all read
 * as the defaults, i.e. "no overrides". Probed with to_regclass first, the same
 * way lib/config.ts reaches p3d_settings and for the same reason: "no table"
 * must mean defaults, not a 500 on the shopper's product page.
 */
export async function getP3dProductConfig(parentProductId: string): Promise<P3dProductConfig> {
  const [probe] = await prisma.$queryRaw<{ exists: string | null }[]>`
    SELECT to_regclass('public.p3d_product_settings')::text AS "exists"
  `
  if (!probe?.exists) return P3D_PRODUCT_CONFIG_DEFAULTS

  const rows = await prisma.$queryRaw<{ config: unknown }[]>`
    SELECT "config" FROM "p3d_product_settings" WHERE "product_id" = ${parentProductId} LIMIT 1
  `
  return parseP3dProductConfig(rows[0]?.config)
}

/** Upsert the overrides for a parent product. */
export async function saveP3dProductConfig(parentProductId: string, config: P3dProductConfig): Promise<void> {
  // Validated again here rather than trusting the caller: this is the last gate
  // before the blob is persisted. parse throws, which the route turns into a 400.
  const next = P3dProductConfigSchema.parse(config)
  const serialised = JSON.stringify(next)
  await prisma.$executeRaw`
    INSERT INTO "p3d_product_settings" ("product_id", "config", "updated_at")
    VALUES (${parentProductId}, ${serialised}::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT ("product_id") DO UPDATE
      SET "config" = ${serialised}::jsonb, "updated_at" = CURRENT_TIMESTAMP
  `
}

/**
 * The sitewide settings with this product's overrides laid on top. This is the
 * only place the two meet: everything downstream of the gallery payload - the
 * main viewer, the fabric preview - takes one resolved P3dConfig and never
 * learns that part of it came from somewhere else.
 */
export function applyProductOverrides(site: P3dConfig, product: P3dProductConfig): P3dConfig {
  if (product.exposure == null) return site
  return { ...site, exposure: product.exposure }
}
