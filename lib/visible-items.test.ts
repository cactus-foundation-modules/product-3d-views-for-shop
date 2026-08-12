import { describe, it, expect } from 'vitest'
import { visibleItems } from '@/modules/product-3d-views-for-shop/lib/visible-items'
import { P3D_CONFIG_DEFAULTS } from '@/modules/product-3d-views-for-shop/lib/config'
import type { P3dItem, P3dPayload } from '@/modules/product-3d-views-for-shop/lib/types'

const PARENT = 'prod-parent'
const OAK = 'prod-variant-oak'
const WALNUT = 'prod-variant-walnut'

function item(key: string, productId: string, url: string): P3dItem {
  return { key, productId, url, format: 'glb', label: key }
}

function payload(items: P3dItem[]): P3dPayload {
  return { parentProductId: PARENT, items, settings: P3D_CONFIG_DEFAULTS, fabric: null }
}

const keys = (items: P3dItem[]) => items.map((i) => i.key)

describe('visibleItems', () => {
  it('shows nothing when the product tree has no models', () => {
    expect(visibleItems(payload([]), null)).toEqual([])
  })

  it("shows the product's own model", () => {
    const p = payload([item('a', PARENT, '/a.glb')])
    expect(keys(visibleItems(p, null))).toEqual(['a'])
  })

  // Nothing on the product, models on the variations, no choice made yet: the
  // strip stays empty until the shopper picks a variation, matching the photo
  // gallery, which shows only the parent's own images until a variant is chosen.
  it('shows no variation models while no variation is chosen', () => {
    const p = payload([item('oak', OAK, '/oak.glb'), item('walnut', WALNUT, '/walnut.glb')])
    expect(visibleItems(p, null)).toEqual([])
  })

  // The spec's second: a choice narrows the strip to that variation alone.
  it('shows only the chosen variation model once a variation is chosen', () => {
    const p = payload([item('oak', OAK, '/oak.glb'), item('walnut', WALNUT, '/walnut.glb')])
    expect(keys(visibleItems(p, WALNUT))).toEqual(['walnut'])
  })

  it('shows nothing extra when the chosen variation has no model of its own', () => {
    const p = payload([item('oak', OAK, '/oak.glb')])
    expect(visibleItems(p, WALNUT)).toEqual([])
  })

  // "if lots of variations use the same 3d files, then don't duplicate the 3d
  // file previews" - a chosen variation carrying two rows on one file is one
  // thumbnail, not two.
  it('collapses two rows sharing one file into a single thumbnail', () => {
    const p = payload([item('a', OAK, '/chair.glb'), item('b', OAK, '/chair.glb')])
    expect(keys(visibleItems(p, OAK))).toEqual(['a'])
  })

  it('keeps distinct files of one chosen variation distinct', () => {
    const p = payload([item('a', OAK, '/a.glb'), item('b', OAK, '/b.glb')])
    expect(visibleItems(p, OAK)).toHaveLength(2)
  })

  it("lets the product's own model stand in while no variation is chosen", () => {
    const p = payload([item('own', PARENT, '/own.glb'), item('oak', OAK, '/oak.glb')])
    expect(keys(visibleItems(p, null))).toEqual(['own'])
  })

  // The point of this change: a chosen variation that brings its own model takes
  // the strip over, so the shopper is not offered the generic product model next
  // to the one they configured.
  it("hides the product's own model once the chosen variation brings one", () => {
    const p = payload([item('own', PARENT, '/own.glb'), item('oak', OAK, '/oak.glb')])
    expect(keys(visibleItems(p, OAK))).toEqual(['oak'])
  })

  it('hides every parent model, not just the first, when a variation brings one', () => {
    const p = payload([
      item('own1', PARENT, '/own1.glb'),
      item('own2', PARENT, '/own2.glb'),
      item('oak', OAK, '/oak.glb'),
    ])
    expect(keys(visibleItems(p, OAK))).toEqual(['oak'])
  })

  // A chosen variation with nothing of its own leaves the product's model up -
  // an empty stage would be a downgrade on picking a size.
  it("keeps the product's own model when the chosen variation has none", () => {
    const p = payload([item('own', PARENT, '/own.glb'), item('oak', OAK, '/oak.glb')])
    expect(keys(visibleItems(p, WALNUT))).toEqual(['own'])
  })

  it('shows one thumbnail when a variation reuses the product own file', () => {
    const p = payload([item('own', PARENT, '/chair.glb'), item('oak', OAK, '/chair.glb')])
    expect(keys(visibleItems(p, OAK))).toEqual(['oak'])
  })

  // ---- Promoted variations ------------------------------------------------
  // The owner has ticked "show up front" against a variation, so its model joins
  // the opening view instead of waiting to be chosen.
  describe('promoted variations', () => {
    it('shows a promoted variation model while nothing is chosen', () => {
      const p = payload([item('oak', OAK, '/oak.glb'), item('walnut', WALNUT, '/walnut.glb')])
      expect(keys(visibleItems(p, null, [OAK]))).toEqual(['oak'])
    })

    it("puts the product's own model first and the promoted ones behind it", () => {
      const p = payload([item('own', PARENT, '/own.glb'), item('oak', OAK, '/oak.glb')])
      expect(keys(visibleItems(p, null, [OAK]))).toEqual(['own', 'oak'])
    })

    it('promotes several variations in the order it is given them', () => {
      const p = payload([item('oak', OAK, '/oak.glb'), item('walnut', WALNUT, '/walnut.glb')])
      expect(keys(visibleItems(p, null, [WALNUT, OAK]))).toEqual(['walnut', 'oak'])
    })

    it('leaves an unpromoted variation hidden', () => {
      const p = payload([item('oak', OAK, '/oak.glb'), item('walnut', WALNUT, '/walnut.glb')])
      expect(keys(visibleItems(p, null, [OAK]))).toEqual(['oak'])
    })

    // The rule the whole feature turns on: promotion is about the opening view,
    // so a chosen variation takes the strip over exactly as it always did.
    it('drops a promoted variation once another variation is chosen', () => {
      const p = payload([item('oak', OAK, '/oak.glb'), item('walnut', WALNUT, '/walnut.glb')])
      expect(keys(visibleItems(p, WALNUT, [OAK]))).toEqual(['walnut'])
    })

    // And it must not sneak back in through the "chosen variation has no model"
    // fallback: that shows the product's own, never a rival finish.
    it("keeps a promoted variation out when the chosen one has no model", () => {
      const p = payload([item('own', PARENT, '/own.glb'), item('oak', OAK, '/oak.glb')])
      expect(keys(visibleItems(p, WALNUT, [OAK]))).toEqual(['own'])
    })

    it('shows one thumbnail when a promoted variation reuses the product own file', () => {
      const p = payload([item('own', PARENT, '/chair.glb'), item('oak', OAK, '/chair.glb')])
      expect(keys(visibleItems(p, null, [OAK]))).toEqual(['own'])
    })

    it('collapses two promoted variations sharing one file', () => {
      const p = payload([item('oak', OAK, '/wood.glb'), item('walnut', WALNUT, '/wood.glb')])
      expect(keys(visibleItems(p, null, [OAK, WALNUT]))).toEqual(['oak'])
    })

    it('ignores a promoted id with no model attached', () => {
      const p = payload([item('own', PARENT, '/own.glb')])
      expect(keys(visibleItems(p, null, [OAK]))).toEqual(['own'])
    })

    // A gallery written before this shipped passes nothing at all.
    it('behaves exactly as before when given no promoted ids', () => {
      const p = payload([item('own', PARENT, '/own.glb'), item('oak', OAK, '/oak.glb')])
      expect(keys(visibleItems(p, null))).toEqual(['own'])
    })
  })

  // The last resort: a part-made choice, nothing on the product itself and
  // nothing promoted still standing. Without these the strip went blank between
  // the shopper's first pick and their last.
  describe('surviving variations', () => {
    it('shows the surviving variations when there is nothing else to show', () => {
      const p = payload([item('oak', OAK, '/oak.glb'), item('walnut', WALNUT, '/walnut.glb')])
      expect(keys(visibleItems(p, null, [], [OAK, WALNUT]))).toEqual(['oak', 'walnut'])
    })

    it("leaves the product's own model to speak for it", () => {
      const p = payload([item('own', PARENT, '/own.glb'), item('oak', OAK, '/oak.glb')])
      expect(keys(visibleItems(p, null, [], [OAK]))).toEqual(['own'])
    })

    it('yields to a promoted variation', () => {
      const p = payload([item('oak', OAK, '/oak.glb'), item('walnut', WALNUT, '/walnut.glb')])
      expect(keys(visibleItems(p, null, [OAK], [OAK, WALNUT]))).toEqual(['oak'])
    })

    it('is beaten outright by a chosen variation', () => {
      const p = payload([item('oak', OAK, '/oak.glb'), item('walnut', WALNUT, '/walnut.glb')])
      expect(keys(visibleItems(p, WALNUT, [], [OAK, WALNUT]))).toEqual(['walnut'])
    })

    it('collapses two survivors sharing one file', () => {
      const p = payload([item('oak', OAK, '/wood.glb'), item('walnut', WALNUT, '/wood.glb')])
      expect(keys(visibleItems(p, null, [], [OAK, WALNUT]))).toEqual(['oak'])
    })

    it('changes nothing for a gallery that passes none', () => {
      const p = payload([item('oak', OAK, '/oak.glb')])
      expect(visibleItems(p, null, [])).toEqual([])
    })
  })
})
