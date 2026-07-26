// Fills shop's `shop.card-media` point with a "view in 3D" overlay for product
// cards. For each product in a grid that has a model somewhere in its tree, this
// resolves the one model to show on its card and hands it, with the viewer settings,
// to the CardModel3dOverlay client component. A product with no model at all is
// simply absent from the map, so its card shows no icon and loads no viewer.
//
// Which model:
//   - the product's OWN model where it has one (shown unpainted - a card has no
//     chosen combination to paint from); else
//   - the first enabled VARIATION that has a model, painted with that variation's
//     fabric where the product is configured for it (the "including its material"
//     the request asks for), or plain otherwise.
//
// Server-safe and batched: three set-wide queries (parents' models, their variation
// children, the children's models) rather than a walk per card, then the fabric /
// settings reads only for the few products that actually carry a model. Mirrors
// lib/gallery-provider.ts (the detail-page `shop.gallery-media` provider), reshaped
// for a grid.
import { signAssetUrl } from '@/lib/media/asset-token'
import { getModelsForProducts, getVariationChildrenForProducts } from '@/modules/product-3d-views-for-shop/lib/db/models'
import { getFabricConfig } from '@/modules/product-3d-views-for-shop/lib/db/fabric-config'
import { resolveFabricForChild } from '@/modules/product-3d-views-for-shop/lib/fabric/resolve'
import { applyProductOverrides, getP3dProductConfig } from '@/modules/product-3d-views-for-shop/lib/db/product-settings'
import { getP3dConfigCached } from '@/modules/product-3d-views-for-shop/lib/config'
import { CardModel3dOverlay } from '@/modules/product-3d-views-for-shop/components/public/CardModel3dOverlay'
import type { ShopCardMediaProvider, ShopCardMediaPayload } from '@/modules/shop/lib/card-media'
import type { P3dItem, P3dModel, P3dCardPayload } from '@/modules/product-3d-views-for-shop/lib/types'

function groupByProduct(models: P3dModel[]): Map<string, P3dModel[]> {
  const map = new Map<string, P3dModel[]>()
  for (const model of models) {
    const list = map.get(model.productId) ?? []
    list.push(model)
    map.set(model.productId, list)
  }
  return map
}

export const product3dCardMedia: ShopCardMediaProvider = {
  async load(productIds): Promise<Map<string, ShopCardMediaPayload>> {
    const out = new Map<string, ShopCardMediaPayload>()
    if (productIds.length === 0) return out

    // The parents' own models. Products that already have one are done after this,
    // and never need a variation lookup.
    const ownByParent = groupByProduct(await getModelsForProducts(productIds))
    const needVariation = productIds.filter((id) => !ownByParent.has(id))

    // For the rest, their enabled variation children, and which of those carry a
    // model. Two queries for the whole batch.
    const childrenByParent = await getVariationChildrenForProducts(needVariation)
    const allChildIds = [...childrenByParent.values()].flat()
    const modelByChild = groupByProduct(allChildIds.length ? await getModelsForProducts(allChildIds) : [])

    // Nothing here has a model, so nothing to draw and none of the settings/fabric
    // reads below need to run.
    if (ownByParent.size === 0 && modelByChild.size === 0) return out

    const siteSettings = await getP3dConfigCached()

    for (const productId of productIds) {
      let item: P3dItem | null = null
      let fabric: P3dCardPayload['fabric'] = null

      const own = ownByParent.get(productId)?.[0]
      if (own) {
        item = { key: own.id, productId, url: signAssetUrl(own.url), format: own.format, label: '3D model' }
      } else {
        // First enabled variation (in matrix order) that actually has a model.
        const childId = (childrenByParent.get(productId) ?? []).find((id) => (modelByChild.get(id)?.length ?? 0) > 0)
        const childModel = childId ? modelByChild.get(childId)?.[0] : undefined
        if (childId && childModel) {
          const fabricConfig = await getFabricConfig(productId)
          if (fabricConfig && fabricConfig.slots.length > 0) {
            // Painted: resolveFabricForChild returns the (already-signed) model url
            // and the named material slots for this variation's chosen colours.
            const bundle = await resolveFabricForChild(childId, productId, fabricConfig)
            if (bundle) {
              item = { key: bundle.modelId, productId: childId, url: bundle.modelUrl, format: bundle.format, label: '3D model' }
              fabric = { slots: bundle.slots, realCm: bundle.realCm, scaleAxis: bundle.scaleAxis }
            }
          }
          // No fabric config (or it did not resolve): the variation's plain model.
          if (!item) {
            item = { key: childModel.id, productId: childId, url: signAssetUrl(childModel.url), format: childModel.format, label: '3D model' }
          }
        }
      }

      if (!item) continue
      // The product's own viewer overrides (today: brightness) over the sitewide
      // settings, resolved only for the products that will actually show a viewer.
      const settings = applyProductOverrides(siteSettings, await getP3dProductConfig(productId))
      const overlay: P3dCardPayload = { item, settings, fabric }
      out.set(productId, { overlay })
    }

    return out
  },
  Overlay: CardModel3dOverlay,
}
