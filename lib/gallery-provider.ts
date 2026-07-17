import { getModelsForProductTree } from '@/modules/product-3d-views-for-shop/lib/db/models'
import { getP3dConfigCached } from '@/modules/product-3d-views-for-shop/lib/config'
import { formatLabel } from '@/modules/product-3d-views-for-shop/lib/formats'
import { Gallery3dThumbs, Gallery3dStage } from '@/modules/product-3d-views-for-shop/components/public/Gallery3d'
import type { ShopGalleryMediaProvider } from '@/modules/shop/lib/gallery-media'
import type { P3dPayload } from '@/modules/product-3d-views-for-shop/lib/types'

// The `shop.gallery-media` provider. Shop asks, once per product page, whether we
// have anything to add to the gallery; when we do, our thumbnails join the strip
// and picking one hands us the stage. Shop never learns what a 3D model is - see
// modules/shop/lib/gallery-media.ts for the contract.
//
// Why this point and not `shop.product-detail-parts`: that one hands the whole
// gallery to a single winner, and on a product with options shop-variations has
// already won it. 3D has to work on those products too, so it contributes to
// whichever gallery is rendering rather than trying to be a second gallery.
//
// `load` is server-only (prisma below); Thumbs and Stage carry their own
// 'use client' boundary, which the contract requires - shop passes them down to a
// client island as props, and a server component cannot travel that way.
export const product3dGalleryProvider: ShopGalleryMediaProvider = {
  // Returns null - "nothing here" - for the overwhelming majority of products,
  // which have no 3D model at all. Shop then renders exactly as it did before,
  // and the shopper's browser is never asked to load a viewer it has no use for.
  async load(productId: string): Promise<P3dPayload | null> {
    const models = await getModelsForProductTree(productId)
    if (models.length === 0) return null
    // Read only once we know there is a model to draw, and cached, so a product
    // page with no model never touches the settings table at all.
    const settings = await getP3dConfigCached()
    return {
      parentProductId: productId,
      settings,
      items: models.map((m) => ({
        // The row id: stable across renders, unique within the payload, and
        // meaningless to shop, which only ever passes it back to us.
        key: m.id,
        productId: m.productId,
        url: m.url,
        format: m.format,
        label: `${formatLabel(m.format)} model`,
      })),
    }
  },
  Thumbs: Gallery3dThumbs,
  Stage: Gallery3dStage,
}
