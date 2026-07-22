// Whether a saved material config still knows how big the product's models are.
//
// A leaf file with no imports but types, because the admin panel is a client component
// and everything else that talks about fabric scale (lib/fabric/resolve.ts) sits beside
// Prisma - importing that would drag the database client into the browser bundle. Same
// reasoning as lib/fabric/constants.ts.

import type { FabricConfig } from '@/modules/product-3d-views-for-shop/lib/db/fabric-config'

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
  return [...new Set(models.map((m) => m.url))].every((url) => (measured[url] ?? 0) > 0)
}
