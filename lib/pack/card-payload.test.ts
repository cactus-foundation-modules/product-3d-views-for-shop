import { describe, it, expect } from 'vitest'
import {
  CARD_PAYLOAD_PACKING,
  packCardPayload,
  readCardPayload,
  unpackCardPayload,
} from '@/modules/product-3d-views-for-shop/lib/pack/card-payload'
import { buildSlides, initialIndex } from '@/modules/product-3d-views-for-shop/lib/card-slides'
import { P3D_CONFIG_DEFAULTS } from '@/modules/product-3d-views-for-shop/lib/config'
import type { P3dCardModel, P3dCardPayload } from '@/modules/product-3d-views-for-shop/lib/types'

// Round trips over both kinds of card the provider writes - a fabric product with its
// long list of variations, and a plain product with a model per variation - plus the
// slides the open viewer builds from each, which is what a shopper actually sees.

const PARENT = '766f9df4-c999-4e3b-adea-bdf3e4f0ac0c'
const FOLDER = 'https://media.example.test/media/shop/chairs/ariel/3d/'

function model(productId: string, file: string, over: Partial<P3dCardModel> = {}): P3dCardModel {
  return {
    item: { key: crypto.randomUUID(), productId, url: `${FOLDER}${file}?t=1789430400000.sig`, format: 'glb', label: '3D model' },
    fabric: null,
    ...over,
  }
}

function fabricCard(childCount: number): P3dCardPayload {
  const children = Array.from({ length: childCount }, () => crypto.randomUUID())
  return {
    settings: P3D_CONFIG_DEFAULTS,
    parentProductId: PARENT,
    hasFabric: true,
    byVariation: {},
    fallback: model(PARENT, 'ariel.glb'),
    defaultChildId: children[0],
    variationChildIds: children,
  }
}

function plainCard(): P3dCardPayload {
  const black = crypto.randomUUID()
  const grey = crypto.randomUUID()
  return {
    settings: P3D_CONFIG_DEFAULTS,
    parentProductId: PARENT,
    hasFabric: false,
    byVariation: { [black]: model(black, 'ariel-black.glb'), [grey]: model(grey, 'ariel-grey.glb') },
    fallback: model(PARENT, 'ariel.glb'),
  }
}

const overTheWire = (value: P3dCardPayload) => unpackCardPayload(JSON.parse(JSON.stringify(packCardPayload(value))))

describe('card payload packing', () => {
  it('round-trips a fabric card with hundreds of variations, in order', () => {
    const original = fabricCard(536)
    expect(overTheWire(original)).toEqual(original)
  })

  it('packs a list of UUID child ids into 22 characters an id', () => {
    const packed = packCardPayload(fabricCard(536))
    expect(packed.packing).toBe(CARD_PAYLOAD_PACKING)
    expect(packed.variationChildIds).toHaveLength(536 * 22)
  })

  it('round-trips a plain card, keeping the variations in their order', () => {
    const original = plainCard()
    const back = overTheWire(original)
    expect(back).toEqual(original)
    expect(Object.keys(back.byVariation)).toEqual(Object.keys(original.byVariation))
  })

  it('round-trips a card whose model carries paints', () => {
    const painted = model(PARENT, 'ariel.glb', {
      fabric: {
        slots: [{ materialName: 'Seat', textureUrl: '/swatch.webp', colour: null, repeat: 3.5, rotationDeg: 0, gloss: 0, autoScale: null }],
        realCm: 98,
        scaleAxis: 'height',
      },
    })
    const original: P3dCardPayload = { ...plainCard(), fallback: painted }
    expect(overTheWire(original)).toEqual(original)
  })

  it('round-trips a fabric card with no variations to default to', () => {
    const original: P3dCardPayload = { ...fabricCard(0), defaultChildId: undefined }
    const back = overTheWire(original)
    expect(back).toEqual(original)
    expect(back.defaultChildId).toBeUndefined()
  })

  it('round-trips child ids that are not UUIDs', () => {
    const original: P3dCardPayload = { ...fabricCard(3), variationChildIds: ['child-a', crypto.randomUUID(), 'child-c'] }
    expect(overTheWire(original)).toEqual(original)
  })

  it('round-trips a card model whose item carries a context', () => {
    const withContext = model(PARENT, 'ariel.glb')
    withContext.item.context = 'headrest'
    const original: P3dCardPayload = { ...plainCard(), fallback: withContext }
    expect(overTheWire(original)).toEqual(original)
  })

  it('carries settings by reference, so a grid of cards shares one settings object', () => {
    const original = fabricCard(2)
    expect(packCardPayload(original).settings).toBe(original.settings)
  })

  // What the shopper sees: the viewer's slides, and where it opens, are the same from
  // the unpacked payload as from the original.
  it('gives the open viewer the same slides and opening slide', () => {
    for (const original of [fabricCard(12), plainCard()]) {
      const back = overTheWire(original)
      expect(buildSlides(back)).toEqual(buildSlides(original))
      const tappedChild = Object.keys(original.byVariation)[1] ?? original.variationChildIds?.[5]
      expect(initialIndex(buildSlides(back), tappedChild, back)).toBe(initialIndex(buildSlides(original), tappedChild, original))
    }
  })
})

describe('readCardPayload', () => {
  it('unpacks a packed payload once, handing every render the same object', () => {
    const packed = JSON.parse(JSON.stringify(packCardPayload(fabricCard(4)))) as unknown
    const first = readCardPayload(packed)
    expect(readCardPayload(packed)).toBe(first)
  })

  it('passes a plain payload from an older render straight through', () => {
    const plain = plainCard()
    expect(readCardPayload(plain)).toBe(plain)
  })

  it('reads a missing payload as null', () => {
    expect(readCardPayload(null)).toBeNull()
    expect(readCardPayload(undefined)).toBeNull()
  })
})
