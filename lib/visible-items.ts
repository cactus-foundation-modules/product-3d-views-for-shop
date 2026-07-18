import type { P3dItem, P3dPayload } from '@/modules/product-3d-views-for-shop/lib/types'

// Which 3D thumbnails the shopper should see, given everything the product tree
// has and whichever variation is currently chosen. Pure and free of React so the
// rule can be unit-tested on its own - it is the fiddly part of this module, and
// the part a reader is most likely to have to reason about later.
//
// The rule, in the order the cases matter:
//
//  - A model on the product itself describes the product, so it always shows.
//  - Models on variations stay hidden until the shopper actually chooses that
//    variation. Before a choice, the strip shows only what is attached to the
//    product itself - the same rule the photo gallery already follows (a variant's
//    own image only appears once that variant is picked). Splashing every
//    variation's model up front is misleading: a shopper who has picked nothing is
//    looking at oak, walnut and ash at once with no idea which they will get.
//  - Once a variation is chosen, that one's model joins the product's own. The
//    rest would be actively misleading - a shopper looking at the oak model having
//    picked walnut.
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
    : []

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
