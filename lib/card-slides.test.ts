import { describe, it, expect } from 'vitest'
import { buildSlides, initialIndex } from '@/modules/product-3d-views-for-shop/lib/card-slides'
import type { P3dCardModel, P3dCardPayload } from '@/modules/product-3d-views-for-shop/lib/types'
import { P3D_CONFIG_DEFAULTS } from '@/modules/product-3d-views-for-shop/lib/config'

const PARENT = 'prod-parent'
const OAK = 'prod-variant-oak'
const WALNUT = 'prod-variant-walnut'

function model(key: string, productId: string): P3dCardModel {
  return { item: { key, productId, url: `/${key}.glb`, format: 'glb', label: '3D model' }, fabric: null }
}

function payload(over: Partial<P3dCardPayload>): P3dCardPayload {
  return {
    settings: P3D_CONFIG_DEFAULTS,
    parentProductId: PARENT,
    hasFabric: false,
    byVariation: {},
    fallback: model('own', PARENT),
    ...over,
  }
}

const childIds = (p: P3dCardPayload) => buildSlides(p).map((s) => s.childId)

describe('buildSlides - non-fabric', () => {
  it('leads with the product-own model, then each variation with a model', () => {
    const p = payload({
      fallback: model('own', PARENT),
      byVariation: { [OAK]: model('oak', OAK), [WALNUT]: model('walnut', WALNUT) },
    })
    // own slide (no childId) first, then the variations in byVariation order.
    expect(childIds(p)).toEqual([undefined, OAK, WALNUT])
    expect(buildSlides(p)[0]!.model!.item.key).toBe('own')
  })

  it('omits a separate own slide when the product has no own model', () => {
    // No own model: fallback IS the first variation, already in byVariation - so it is
    // not added twice.
    const p = payload({
      fallback: model('oak', OAK),
      byVariation: { [OAK]: model('oak', OAK), [WALNUT]: model('walnut', WALNUT) },
    })
    expect(childIds(p)).toEqual([OAK, WALNUT])
  })

  it('gives a single own-only slide when no variation carries a model', () => {
    const p = payload({ fallback: model('own', PARENT), byVariation: {} })
    expect(childIds(p)).toEqual([undefined])
  })
})

describe('buildSlides - fabric', () => {
  it('is one slide per enabled variation, in matrix order, with no model up front', () => {
    const p = payload({ hasFabric: true, byVariation: {}, variationChildIds: [OAK, WALNUT], defaultChildId: OAK })
    expect(childIds(p)).toEqual([OAK, WALNUT])
    expect(buildSlides(p).every((s) => s.model === null)).toBe(true)
  })

  it('falls back to the default variation alone when the id list is missing', () => {
    const p = payload({ hasFabric: true, byVariation: {}, defaultChildId: OAK })
    expect(childIds(p)).toEqual([OAK])
  })
})

describe('initialIndex', () => {
  it('opens on the tapped variation when it has a slide', () => {
    const p = payload({ byVariation: { [OAK]: model('oak', OAK), [WALNUT]: model('walnut', WALNUT) } })
    const slides = buildSlides(p)
    expect(initialIndex(slides, WALNUT, p)).toBe(2) // own(0), oak(1), walnut(2)
  })

  it('opens on slide 0 for a non-fabric product with no source in view', () => {
    const p = payload({ byVariation: { [OAK]: model('oak', OAK) } })
    expect(initialIndex(buildSlides(p), undefined, p)).toBe(0)
  })

  it('opens on the default variation for a fabric product with no source in view', () => {
    const p = payload({ hasFabric: true, byVariation: {}, variationChildIds: [OAK, WALNUT], defaultChildId: WALNUT })
    expect(initialIndex(buildSlides(p), undefined, p)).toBe(1)
  })

  it('ignores a source that has no slide and falls to the opening view', () => {
    const p = payload({ byVariation: { [OAK]: model('oak', OAK) } })
    // A variation photo whose variation carries no model: no slide for it, so open on 0.
    expect(initialIndex(buildSlides(p), 'prod-variant-nomdl', p)).toBe(0)
  })
})
