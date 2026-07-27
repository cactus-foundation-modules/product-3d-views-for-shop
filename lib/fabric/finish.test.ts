import { describe, it, expect } from 'vitest'
import { detectGloss } from '@/modules/product-3d-views-for-shop/lib/fabric/finish'

// The whole feature turns on which words count and which do not: too eager and a
// wool seat comes out looking wet, too strict and the leather the shopper is paying
// extra for renders as flat as the cloth beside it. Nothing else in the suite has an
// opinion about either, so these are the tests that hold the line.

describe('detectGloss', () => {
  it('finds leather in the words the shop put on the swatch', () => {
    expect(detectGloss({ label: 'Soft Leather - Black' })).toBeGreaterThan(0)
  })

  it('reads it case-insensitively, however the supplier wrote it', () => {
    expect(detectGloss({ label: 'BONDED LEATHER' })).toBeGreaterThan(0)
    expect(detectGloss({ label: 'faux leather' })).toBeGreaterThan(0)
  })

  it('counts leather-look names, which catch the light the same way', () => {
    expect(detectGloss({ label: 'Leatherette Navy' })).toBeGreaterThan(0)
  })

  it('finds it in the picture filename, for a value labelled by colour alone', () => {
    expect(detectGloss({ label: 'Black', textureUrl: 'https://cdn.test/media/shop/black-leather.webp' })).toBeGreaterThan(0)
  })

  it('reads a filename through its signing token and its escapes', () => {
    expect(
      detectGloss({ textureUrl: 'https://cdn.test/media/shop/black%20leather.webp?t=1789.abc' }),
    ).toBeGreaterThan(0)
  })

  it('ignores the folders a swatch is filed under', () => {
    // A shop's media keys carry the category and the product, so a wool swatch under
    // a product filed as "leather-chairs" must not come out shiny - the folder
    // describes the range, the filename describes this one swatch.
    expect(detectGloss({ label: 'Wool Grey', textureUrl: 'https://cdn.test/media/shop/leather-chairs/orion/grey.webp' })).toBe(0)
  })

  it('leaves an ordinary fabric alone', () => {
    expect(detectGloss({ label: 'Quest Charcoal', textureUrl: 'https://cdn.test/quest-charcoal.webp' })).toBe(0)
  })

  it('leaves a swatch with nothing to read alone', () => {
    expect(detectGloss({})).toBe(0)
    expect(detectGloss({ label: '', textureUrl: '' })).toBe(0)
    expect(detectGloss({ label: null, textureUrl: null })).toBe(0)
  })

  it('never asks for a mirror', () => {
    // A gloss of 1 is a chrome, which is not what any of these words mean. The paint
    // path turns this straight into a roughness, so a runaway value here is a seat
    // that reflects the room.
    expect(detectGloss({ label: 'Leather' })).toBeLessThan(0.8)
  })
})
