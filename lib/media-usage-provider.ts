import { prisma } from '@/lib/db/prisma'

// Provider for the core.media-usage-providers extension point.
//
// A 3D model row records the same blob three ways (url, storage key, Media id),
// and the fabric configurator keeps its texture and swatch picks inside a JSONB
// config blob. The blob is handed back whole and unparsed: core scans it as text
// for any media url, key or id it contains, which is exactly the same treatment
// core gives its own Puck builder JSON, and it cannot go stale when the config's
// shape changes.
export async function product3dMediaUsageProvider(): Promise<string[]> {
  const models = await prisma.$queryRaw<{ ref: string | null }[]>`
    SELECT "url" AS ref FROM "p3d_models" WHERE "url" IS NOT NULL
    UNION ALL
    SELECT "media_key" AS ref FROM "p3d_models" WHERE "media_key" IS NOT NULL
    UNION ALL
    SELECT "media_id" AS ref FROM "p3d_models" WHERE "media_id" IS NOT NULL
  `
  const configs = await prisma.$queryRaw<{ ref: string | null }[]>`
    SELECT "config"::text AS ref FROM "p3d_fabric_configs"
  `
  return [...models, ...configs].map((r) => r.ref).filter((r): r is string => !!r)
}
