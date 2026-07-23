import { prisma } from '@/lib/db/prisma'
import type { MediaReferenceChange } from '@/lib/media/reference-rewriters'

// Provider for the core.media-reference-rewriters extension point.
//
// This module keeps a media item's address in its own tables, and core knows
// none of them. A 3D model row (p3d_models) records the blob three ways - its
// public url, its provider storage key and the core Media id - and the fabric
// configurator files each model's measured real-world size inside a JSON config
// blob (p3d_fabric_configs.config), keyed by the model's url. When the library
// moves a blob (optimise to WebP, resize, crop, replace-file, rename/move - a
// product or folder rename re-keys every file under it), the item's url and key
// change, and without this every one of those references still names the old,
// now-deleted blob: the storefront thumbnail and viewer 404, the orphaned blob is
// billed forever, and the fabric calibration key no longer matches the model's
// url so every fabric surface silently drops back to repeat 1.
//
// Core runs this BEFORE it deletes the superseded blob (see
// rewriteMediaReferencesInContent in lib/media/upload.ts), so a throw here aborts
// the whole move with the old blob still serving - a loud, recoverable failure
// rather than a silent 404.

// A model measurement is filed under the model's url with any query string
// removed (see lib/fabric/calibration.ts, modelScaleKey): the admin panel is
// handed SIGNED urls and normalises them to the plain address before saving, and
// the storefront reads the plain p3d_models.url. Core hands us the plain url too,
// so a base-to-base comparison matches the stored key even if a legacy config
// somehow filed a signed one.
const stripQuery = (url: string): string => {
  const q = url.indexOf('?')
  return q === -1 ? url : url.slice(0, q)
}

// Rewrite every string in a parsed config that names the moved blob - whether it
// sits as an OBJECT KEY (which is where modelHeights/modelWidths file their
// measurements) or as a plain value (nothing does today, but a future field
// might). Exact base-to-base equality, never substring: a url is a long unique
// string, and matching on the whole value keeps the swap from touching an id, a
// hex colour or a material name that merely contains the text.
function rewriteConfigUrls(
  value: unknown,
  oldBase: string,
  newBase: string,
): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map((v) => {
      const r = rewriteConfigUrls(v, oldBase, newBase)
      if (r.changed) changed = true
      return r.value
    })
    return { value: out, changed }
  }
  if (value !== null && typeof value === 'object') {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      const r = rewriteConfigUrls(v, oldBase, newBase)
      if (r.changed) changed = true
      const nextKey = stripQuery(key) === oldBase ? newBase : key
      if (nextKey !== key) changed = true
      out[nextKey] = r.value
    }
    return { value: out, changed }
  }
  if (typeof value === 'string') {
    if (stripQuery(value) === oldBase) return { value: newBase, changed: true }
    return { value, changed: false }
  }
  return { value, changed: false }
}

export async function product3dMediaReferenceRewriter(change: MediaReferenceChange): Promise<void> {
  const { oldUrl, newUrl, oldKey, newKey } = change

  // p3d_models. The url column holds the item's url verbatim; the media_key column
  // its storage key. Equality, not substring: each column IS the whole value, so a
  // `= oldUrl` cannot touch an unrelated row, and the same file attached to a
  // product and one of its variations (two rows over one object) is repointed on
  // both.
  const urlMoved = Boolean(oldUrl) && oldUrl !== newUrl
  const keyMoved = Boolean(oldKey) && oldKey !== newKey

  if (urlMoved) {
    await prisma.$executeRaw`
      UPDATE "p3d_models" SET "url" = ${newUrl} WHERE "url" = ${oldUrl}
    `
  }
  if (keyMoved) {
    await prisma.$executeRaw`
      UPDATE "p3d_models" SET "media_key" = ${newKey} WHERE "media_key" = ${oldKey}
    `
    // The dedupe path passes core Media ids in the key slots rather than storage
    // keys (see MediaReferenceChange). media_id holds a cuid, media_key a path, so
    // exactly one of these two statements ever matches a given move: the other is
    // a harmless no-op. Repointing media_id keeps this module's ownership
    // bookkeeping (owns_media, deleteModelCascade) honest after a merge.
    await prisma.$executeRaw`
      UPDATE "p3d_models" SET "media_id" = ${newKey} WHERE "media_id" = ${oldKey}
    `
  }

  // p3d_fabric_configs.config. The only blob address a config holds is the model
  // url that keys its measurements, so there is nothing here to rewrite on a
  // key-only change. Prefilter in SQL to the configs that actually mention the old
  // url - position() is a literal substring search, so the url needs no wildcard
  // escaping - then parse, rewrite and write back only those.
  if (!urlMoved) return
  const oldBase = stripQuery(oldUrl)
  const newBase = stripQuery(newUrl)
  const rows = await prisma.$queryRaw<{ productId: string; config: string }[]>`
    SELECT "product_id" AS "productId", "config"::text AS "config"
    FROM "p3d_fabric_configs"
    WHERE position(${oldBase} in "config"::text) > 0
  `
  for (const row of rows) {
    let parsed: unknown
    try {
      parsed = JSON.parse(row.config)
    } catch {
      // A corrupt config is treated as "not configured" everywhere else (see
      // parseFabricConfig); leave it untouched rather than fail the whole move.
      continue
    }
    const { value, changed } = rewriteConfigUrls(parsed, oldBase, newBase)
    if (!changed) continue
    const serialised = JSON.stringify(value)
    await prisma.$executeRaw`
      UPDATE "p3d_fabric_configs"
      SET "config" = ${serialised}::jsonb, "updated_at" = CURRENT_TIMESTAMP
      WHERE "product_id" = ${row.productId}
    `
  }
}
