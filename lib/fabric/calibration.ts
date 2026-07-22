// Whether a saved material config still knows how big the product's models are.
//
// A leaf file with no imports but types, because the admin panel is a client component
// and everything else that talks about fabric scale (lib/fabric/resolve.ts) sits beside
// Prisma - importing that would drag the database client into the browser bundle. Same
// reasoning as lib/fabric/constants.ts.

import type { FabricConfig } from '@/modules/product-3d-views-for-shop/lib/db/fabric-config'

/**
 * The url a measurement is filed under: the model's own address, with any query
 * string removed.
 *
 * The same file reaches the two sides of this by different roads. The admin panel is
 * handed models by `getAdminModels`, which SIGNS every url on the way out (`?t=<expiry>.<token>`)
 * so the browser is allowed to fetch and measure them; the storefront resolver reads
 * `p3d_models.url` straight from the database, which is the plain one - the token is
 * stamped on at the edge and never stored. Key the measurement by the url as it arrives
 * and the two never match, so the storefront finds no calibration and every fabric
 * surface falls back to repeat 1.
 *
 * Dropping the query also means the key cannot rot: an asset token expires, so a signed
 * url is a different string tomorrow for the very same file.
 */
export function modelScaleKey(url: string): string {
  const query = url.indexOf('?')
  return query === -1 ? url : url.slice(0, query)
}

/**
 * Whether `config` carries a measurement for every model file attached to the product,
 * along the axis it actually scales by.
 *
 * This is the difference between a product whose finishes tile at true size and one
 * whose every fabric surface silently falls back to repeat 1 - silently because the
 * colours all still paint correctly, and only the weave comes out the wrong size. The
 * calibration is measured from the mesh in the admin and saved with the config, so it
 * can go missing while everything else about the setup is perfectly sound: a model
 * attached after the last save has never been measured, and configs written before
 * v0.1.60 keyed the measurement by p3d_models row id, which re-attaching a model threw
 * away.
 *
 * The axis matters. `modelWidths` is empty in every config saved before the width axis
 * existed, and such a config is on the height axis, where that emptiness is no fault at
 * all; checking both would call a sound setup broken.
 *
 * A product with no models attached is vacuously calibrated: there is nothing to draw,
 * so nothing to scale.
 */
export function isCalibrated(config: FabricConfig, models: { url: string }[]): boolean {
  const measured = config.scaleAxis === 'width' ? config.modelWidths : config.modelHeights
  const byKey = new Map(Object.entries(measured).map(([k, v]) => [modelScaleKey(k), v]))
  return [...new Set(models.map((m) => modelScaleKey(m.url)))].every((url) => (byKey.get(url) ?? 0) > 0)
}
