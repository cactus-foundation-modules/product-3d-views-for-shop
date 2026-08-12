import type { P3dItem, P3dPayload } from '@/modules/product-3d-views-for-shop/lib/types'

// Which 3D thumbnails the shopper should see, given everything the product tree
// has and whichever variation is currently chosen. Pure and free of React so the
// rule can be unit-tested on its own - it is the fiddly part of this module, and
// the part a reader is most likely to have to reason about later.
//
// The rule, in the order the cases matter:
//
//  - A model on the product itself describes the product, so it shows while
//    nothing more specific is on offer.
//  - Models on variations stay hidden until the shopper actually chooses that
//    variation. Before a choice, the strip shows only what is attached to the
//    product itself - the same rule the photo gallery already follows (a variant's
//    own image only appears once that variant is picked). Splashing every
//    variation's model up front is misleading: a shopper who has picked nothing is
//    looking at oak, walnut and ash at once with no idea which they will get.
//  - Except for the handful the shop's owner has explicitly promoted, which
//    arrive as `featuredProductIds` and show behind the product's own while
//    nothing is chosen. That is a decision someone made about this range - "the
//    oak one is the one worth showing" - rather than the module guessing, which
//    is the difference between it and the case above. The host narrows the list
//    to the variations the shopper's picks still allow, so it never offers a
//    finish they have ruled out; a chosen variation still wins outright, below.
//  - And, last of all, `candidateProductIds`: the variations a part-made choice
//    has left standing, promoted or not. Used only where the two cases above have
//    come up empty, which on a product with no model of its own and nothing
//    promoted is the difference between a strip and a blank space. The host sends
//    none until the shopper has picked something, so this never fires on the
//    opening view - the "don't splash every variation up front" rule above still
//    holds where it matters.
//  - Once a variation carrying its own model is chosen, that model replaces the
//    product's own rather than sitting beside it. The chosen model is the exact
//    thing being bought; the generic one is then a second, near-identical
//    thumbnail of something the shopper is not ordering, and picking it shows
//    them the wrong item.
//  - Other variations' models are dropped either way - a shopper looking at the
//    oak model having picked walnut.
//  - A chosen variation with no model of its own leaves the product's own model
//    in place; something is better than an empty strip.
//  - Two variations sharing one file are one thumbnail, not two. Sites reuse the
//    same model across a size run constantly (same shape, different dimensions),
//    and the honest reading of two identical thumbnails is that something is
//    broken. Deduplication is by url, since that is what identity means for a
//    file that was uploaded once and pointed at twice.
export function visibleItems(
  payload: P3dPayload,
  activeProductId: string | null,
  featuredProductIds: string[] = [],
  candidateProductIds: string[] = [],
): P3dItem[] {
  const own = payload.items.filter((i) => i.productId === payload.parentProductId)
  const variation = payload.items.filter((i) => i.productId !== payload.parentProductId)

  const relevant = activeProductId
    ? variation.filter((i) => i.productId === activeProductId)
    : []

  if (relevant.length > 0) return dedupeByUrl(relevant)

  // Promoted variations only count while nothing is chosen. A shopper who has
  // settled on walnut and whose choice carries no model of its own is shown the
  // product's generic one, not the oak one somebody promoted - the promotion was
  // about the opening view, and answering their choice with a rival finish is the
  // exact confusion this whole rule exists to avoid.
  if (activeProductId !== null) return dedupeByUrl(own)

  const featured = featuredProductIds.flatMap((id) => variation.filter((i) => i.productId === id))
  // Nothing of the product's own and nothing promoted still standing: the
  // variations the shopper's picks have left are all there is, so show those
  // rather than an empty strip. Reached only mid-choice - the host sends no
  // candidates before the first pick - so the opening view is untouched by it.
  if (own.length === 0 && featured.length === 0) {
    return dedupeByUrl(candidateProductIds.flatMap((id) => variation.filter((i) => i.productId === id)))
  }
  // The product's own first, so a page that has both opens on the model that
  // describes the product rather than on one of the finishes. Deduplicated across
  // the two together: a promoted variation pointing at the same file as the
  // parent is one thumbnail, not two.
  return dedupeByUrl([...own, ...featured])
}

// First occurrence wins, so the strip keeps the order the models were attached in
// when two rows of one variation point at the same file.
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
