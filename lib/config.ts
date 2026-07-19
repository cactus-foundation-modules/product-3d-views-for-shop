import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'

// Server-side viewer settings: the reads and writes that need the database.
//
// The schema, type, defaults and parser live in ./config-shared, which imports
// no database, so the settings tab (a client component) can import them without
// pulling prisma into the browser bundle. They are re-exported here so that
// every server-side `from '@/modules/product-3d-views-for-shop/lib/config'`
// import keeps working exactly as before.
export {
  P3dConfigSchema,
  P3D_CONFIG_DEFAULTS,
  parseP3dConfig,
  type P3dConfig,
} from '@/modules/product-3d-views-for-shop/lib/config-shared'

import {
  P3dConfigSchema,
  P3D_CONFIG_DEFAULTS,
  parseP3dConfig,
  type P3dConfig,
} from '@/modules/product-3d-views-for-shop/lib/config-shared'

export async function getP3dConfig(): Promise<P3dConfig> {
  // Probed with to_regclass first, the same way this module reaches the svr_
  // tables (see lib/db/models.ts). p3d_settings arrives in migration 002, so an
  // install running this code against a database that has not had 002 applied yet
  // has no such table - and "no table" means "nothing saved", which is the
  // defaults, not a 500 on the shopper's product page. The window is small (the
  // deploy that ships this code applies the migration) but 001-in-place is
  // exactly how a module update took a live site's pages down once already.
  const [probe] = await prisma.$queryRaw<{ exists: string | null }[]>`
    SELECT to_regclass('public.p3d_settings')::text AS "exists"
  `
  if (!probe?.exists) return P3D_CONFIG_DEFAULTS

  const rows = await prisma.$queryRaw<{ config: unknown }[]>`
    SELECT "config" FROM "p3d_settings" WHERE "id" = 'singleton' LIMIT 1
  `
  return parseP3dConfig(rows[0]?.config)
}

let cachedConfig: P3dConfig | null = null
let cachedConfigAt = 0
const CACHE_TTL_MS = 5_000

/**
 * The read every product page with a model does. Cached for a few seconds because
 * the alternative is a database round-trip per product page for a row that changes
 * about twice a year, and uncached it would sit on the critical path of the page
 * the shopper is waiting for.
 */
export async function getP3dConfigCached(): Promise<P3dConfig> {
  const now = Date.now()
  if (cachedConfig && now - cachedConfigAt < CACHE_TTL_MS) return cachedConfig
  const config = await getP3dConfig()
  cachedConfig = config
  cachedConfigAt = now
  return config
}

export function invalidateP3dConfigCache(): void {
  cachedConfig = null
  cachedConfigAt = 0
}

/** Merge-then-validate partial update, mirroring updateShopConfig. */
export async function updateP3dConfig(patch: Partial<P3dConfig>): Promise<P3dConfig> {
  const current = await getP3dConfig()
  const next = P3dConfigSchema.parse({ ...current, ...patch })
  // Upsert rather than a bare UPDATE: nothing seeds this row, so the first save
  // on every install is an INSERT, and an UPDATE would affect zero rows, return
  // 200, and persist nothing.
  const serialised = JSON.stringify(next)
  await prisma.$executeRaw`
    INSERT INTO "p3d_settings" ("id", "config", "updated_at")
    VALUES ('singleton', ${serialised}::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE
      SET "config" = ${serialised}::jsonb, "updated_at" = CURRENT_TIMESTAMP
  `
  invalidateP3dConfigCache()
  return next
}
