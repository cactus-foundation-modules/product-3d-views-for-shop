import type { P3dItem, P3dPayload } from '@/modules/product-3d-views-for-shop/lib/types'

// Which 3D thumbnails the shopper should see, given everything the product tree
// has and whichever variation is currently chosen. Pure and free of React so the
// rule can be unit-tested on its own - it is the fiddly part of this module, and
// the part a reader is most likely to have to reason about later.
//
// The rule, in the order the cases matter:
//
//  - A model on the product itself describes the product, so it always shows.
//  - Models on variations are narrowed by the shopper's choice. Before a choice
//    is made there is no way to know which is relevant, so all of them show and
//    the shopper can look through them. Once a variation is chosen, only that
//    one's model is right and the rest would be actively misleading - a shopper
//    looking at the oak model having picked walnut.
//  - Where the product has its own model AND a choice has not been made yet, the
//    product's own stands in for the lot: it is the general answer to "what does
//    this look like", and stacking every variation's model beside it just to be
//    thorough would bury it.
//  - Two variations sharing one file are one thumbnail, not two. Sites reuse the
//    same model across a size run constantly (same shape, different dimensions),
//    and the honest reading of two identical thumbnails is that something is
//    broken. Deduplication is by url, since that is what identity means for a
//    file that was uploaded once and pointed at twice.
export function visibleItems(payload: P3dPayload, activeProductId: string | null): P3dItem[] {
  const own = payload.items.filter((i) => i.productId === payload.parentProductId)
  const variation = payload.items.filter((i) => i.productId !== payload.parentProductId)

  const relevant = activeProductId
    ? variation.filter((i) => i.productId === activeProductId)
    : own.length > 0
      ? []
      : variation

  return dedupeByUrl([...own, ...relevant])
}

// First occurrence wins, so the product's own model keeps its place at the front
// of the strip when a variation happens to point at the same file.
function dedupeByUrl(items: P3dItem[]): P3dItem[] {
  const seen = new Set<string>()
  const out: P3dItem[] = []
  for (const item of items) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    out.push(item)
  }
  return out
}
