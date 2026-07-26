// The list of models the open card viewer's own prev/next arrows step through, and
// where they start. Pure, so CardModel3dOverlay can stay a thin client shell and this
// logic - the bit with the fiddly own-model-vs-variation ordering - is unit-tested
// without dragging three.js into the test. See card-slides.test.ts.
import type { P3dCardPayload, P3dCardModel } from '@/modules/product-3d-views-for-shop/lib/types'

// One step of the open viewer's carousel: a variation (or the product's own view), and
// the model to draw for it. `model` is resolved up front for a non-fabric slide and
// null for a fabric one, whose painted bundle is fetched live keyed by `childId`.
// `childId` is undefined only for the product's-own-model slide.
export type Slide = { childId?: string; model: P3dCardModel | null }

// The slides the open viewer steps through, in the same order the card's carousel
// shows the variations.
//   - FABRIC: one slide per enabled variation (`variationChildIds`, matrix order),
//     each fetched live. No model up front.
//   - NON-fabric: the product's own model (when it has one) first, then each variation
//     that carries its own model (`byVariation`, same order) - already resolved.
export function buildSlides(data: P3dCardPayload): Slide[] {
  if (data.hasFabric) {
    const ids = data.variationChildIds ?? (data.defaultChildId ? [data.defaultChildId] : [])
    return ids.map((childId) => ({ childId, model: null }))
  }
  // `fallback` is the product's own model exactly when it belongs to the parent (a
  // variation's own model carries the child's id) - so that is the only case with an
  // own-model slide to lead with. Without one, `fallback` is just the first variation,
  // which `byVariation` already lists, so no separate slide is added for it.
  const ownModel = data.fallback.item.productId === data.parentProductId ? data.fallback : null
  const slides: Slide[] = []
  if (ownModel) slides.push({ model: ownModel })
  for (const [childId, model] of Object.entries(data.byVariation)) slides.push({ childId, model })
  // A payload with no model is never emitted, so this only guards the degenerate case
  // of an own-less product whose byVariation somehow came back empty.
  if (slides.length === 0) slides.push({ model: data.fallback })
  return slides
}

// Which slide to open on: the one for the variation whose photo the shopper tapped
// from, else the opening view (a fabric product's default variation, or slide 0 - the
// product's own model on a non-fabric one).
export function initialIndex(slides: Slide[], activeSourceId: string | undefined, data: P3dCardPayload): number {
  if (activeSourceId) {
    const i = slides.findIndex((s) => s.childId === activeSourceId)
    if (i >= 0) return i
  }
  if (data.hasFabric && data.defaultChildId) {
    const i = slides.findIndex((s) => s.childId === data.defaultChildId)
    if (i >= 0) return i
  }
  return 0
}
