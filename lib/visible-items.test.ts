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
  return { parentProductId: PARENT, items, settings: P3D_CONFIG_DEFAULTS }
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

  // The spec's first variation case: nothing on the product, models on the
  // variations, no choice made yet.
  it('shows every variation model while no variation is chosen', () => {
    const p = payload([item('oak', OAK, '/oak.glb'), item('walnut', WALNUT, '/walnut.glb')])
    expect(keys(visibleItems(p, null))).toEqual(['oak', 'walnut'])
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
  // file previews" - a size run sharing one model is one thumbnail.
  it('collapses variations that share one file into a single thumbnail', () => {
    const p = payload([
      item('small', 'prod-small', '/chair.glb'),
      item('medium', 'prod-medium', '/chair.glb'),
      item('large', 'prod-large', '/chair.glb'),
    ])
    expect(keys(visibleItems(p, null))).toEqual(['small'])
  })

  it('keeps distinct files distinct', () => {
    const p = payload([item('oak', OAK, '/oak.glb'), item('walnut', WALNUT, '/walnut.glb')])
    expect(visibleItems(p, null)).toHaveLength(2)
  })

  it("lets the product's own model stand in while no variation is chosen", () => {
    const p = payload([item('own', PARENT, '/own.glb'), item('oak', OAK, '/oak.glb')])
    expect(keys(visibleItems(p, null))).toEqual(['own'])
  })

  it("shows the product's own model alongside the chosen variation's", () => {
    const p = payload([item('own', PARENT, '/own.glb'), item('oak', OAK, '/oak.glb')])
    expect(keys(visibleItems(p, null))).toEqual(['own'])
    expect(keys(visibleItems(p, OAK))).toEqual(['own', 'oak'])
  })

  // A variation pointing at the product's own file must not draw it twice, and
  // the product's own entry is the one that survives.
  it('keeps the parent entry when a variation reuses the same file', () => {
    const p = payload([item('own', PARENT, '/chair.glb'), item('oak', OAK, '/chair.glb')])
    expect(keys(visibleItems(p, OAK))).toEqual(['own'])
  })
})
