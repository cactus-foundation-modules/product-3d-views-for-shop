// Fills shop's `shop.card-media` point with a "view in 3D" overlay for product
// cards. For each product in a grid that has a model somewhere in its tree, this
// hands the CardModel3dOverlay client component what it needs to show the right
// model for whichever photo the shopper is looking at. A product with no model
// anywhere is absent from the map, so its card shows no icon and loads no viewer.
//
// Which model the overlay ends up showing (decided client-side from the card's
// active image):
//   - a variation photo on a FABRIC product -> that variation's model painted with
//     its material, fetched live from `/fabric/[child]` (the same endpoint the detail
//     gallery uses); the provider only flags `hasFabric` so nothing is resolved per
//     variation up front;
//   - a variation photo on a NON-fabric product -> that variation's own model file,
//     from `byVariation` (resolved here, cheap - it is just the model row);
//   - the product's own photo, or a variation with nothing of its own -> `fallback`
//     (the product's own model, else the first variation that has one).
//
// Server-safe and batched: three set-wide queries (parents' models, their variation
// children, the children's models), then a fabric-config + settings read only for
// the few products that actually carry a model - never a per-variation resolve.
import { signAssetUrl } from '@/lib/media/asset-token'
import { getModelsForProducts, getVariationChildrenForProducts } from '@/modules/product-3d-views-for-shop/lib/db/models'
import { getFabricConfig } from '@/modules/product-3d-views-for-shop/lib/db/fabric-config'
import { applyProductOverrides, getP3dProductConfig } from '@/modules/product-3d-views-for-shop/lib/db/product-settings'
import { getP3dConfigCached } from '@/modules/product-3d-views-for-shop/lib/config'
import { CardModel3dOverlay } from '@/modules/product-3d-views-for-shop/components/public/CardModel3dOverlay'
import type { ShopCardMediaProvider, ShopCardMediaPayload } from '@/modules/shop/lib/card-media'
import type { P3dModel, P3dCardModel, P3dCardPayload } from '@/modules/product-3d-views-for-shop/lib/types'

function groupByProduct(models: P3dModel[]): Map<string, P3dModel[]> {
  const map = new Map<string, P3dModel[]>()
  for (const model of models) {
    const list = map.get(model.productId) ?? []
    list.push(model)
    map.set(model.productId, list)
  }
  return map
}

// A plain (unpainted) card model from a stored row - the product's own, or a
// variation's own file on a non-fabric product.
function plainModel(model: P3dModel, productId: string): P3dCardModel {
  return {
    item: { key: model.id, productId, url: signAssetUrl(model.url), format: model.format, label: '3D model' },
    fabric: null,
  }
}

export const product3dCardMedia: ShopCardMediaProvider = {
  async load(productIds): Promise<Map<string, ShopCardMediaPayload>> {
    const out = new Map<string, ShopCardMediaPayload>()
    if (productIds.length === 0) return out

    // Parents' own models, every product's variation children, and those children's
    // models - three set-wide queries for the whole grid.
    const ownByParent = groupByProduct(await getModelsForProducts(productIds))
    const childrenByParent = await getVariationChildrenForProducts(productIds)
    const allChildIds = [...childrenByParent.values()].flat()
    const modelByChild = groupByProduct(allChildIds.length ? await getModelsForProducts(allChildIds) : [])

    // Nothing in the batch has a model, so no product gets an overlay and none of the
    // per-product reads below run.
    if (ownByParent.size === 0 && modelByChild.size === 0) return out

    const siteSettings = await getP3dConfigCached()

    for (const productId of productIds) {
      const children = childrenByParent.get(productId) ?? []
      const own = ownByParent.get(productId)?.[0]
      // The child models this product's variations carry, in variation order.
      const childrenWithModels = children
        .map((childId) => ({ childId, model: modelByChild.get(childId)?.[0] }))
        .filter((c): c is { childId: string; model: P3dModel } => Boolean(c.model))

      // Does the product carry any model at all? If not, no overlay.
      if (!own && childrenWithModels.length === 0) continue

      const fabricConfig = await getFabricConfig(productId)
      const hasFabric = Boolean(fabricConfig && fabricConfig.slots.length > 0)

      // The default view: the product's own model, else the first variation with one.
      // A fabric product's own model shows unpainted here (no variation in view yet).
      const fallback: P3dCardModel = own
        ? plainModel(own, productId)
        : plainModel(childrenWithModels[0]!.model, childrenWithModels[0]!.childId)

      // Per-variation own models, only for NON-fabric products - a fabric product's
      // variation model+material is fetched live by the overlay from /fabric/[child],
      // so listing them here would resolve nothing useful.
      const byVariation: Record<string, P3dCardModel> = {}
      if (!hasFabric) {
        for (const { childId, model } of childrenWithModels) {
          byVariation[childId] = plainModel(model, childId)
        }
      }

      const settings = applyProductOverrides(siteSettings, await getP3dProductConfig(productId))
      const overlay: P3dCardPayload = { settings, parentProductId: productId, hasFabric, byVariation, fallback }
      out.set(productId, { overlay })
    }

    return out
  },
  Overlay: CardModel3dOverlay,
}
