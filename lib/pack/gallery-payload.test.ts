import { describe, it, expect } from 'vitest'
import {
  GALLERY_PAYLOAD_PACKING,
  packGalleryPayload,
  readGalleryPayload,
  unpackGalleryPayload,
} from '@/modules/product-3d-views-for-shop/lib/pack/gallery-payload'
import { P3D_CONFIG_DEFAULTS } from '@/modules/product-3d-views-for-shop/lib/config'
import type { FabricConfig, P3dItem, P3dPayload } from '@/modules/product-3d-views-for-shop/lib/types'

// Round trips over the shapes the provider really writes. A wire format that loses a
// key, a context or a url loses a model a shopper could otherwise have picked, and
// nothing in the type checker would notice.

const PARENT = '3a933e8f-b4dd-4405-a205-fe96df09a126'
const FOLDER = 'https://media.example.test/media/shop/desks/air-desk/3d/'
const sign = (file: string) => `${FOLDER}${file}?t=1789430400000.mh0ssBQyl4IXcvmf1fVe_ZGf5024ES_p1BcNJaWaS_4`

function item(over: Partial<P3dItem> = {}): P3dItem {
  return {
    key: crypto.randomUUID(),
    productId: PARENT,
    url: sign('desk-1200.glb'),
    format: 'glb',
    label: 'GLB model',
    context: '',
    ...over,
  }
}

function fabric(over: Partial<FabricConfig> = {}): FabricConfig {
  return {
    scaleAxis: 'height',
    heightAttributeId: '__manual',
    heightManual: '82.0cm',
    modelHeights: { [`${FOLDER}desk-1200.glb`]: 0.82, [`${FOLDER}desk-1400.glb`]: 0.82 },
    modelWidths: { [`${FOLDER}desk-1200.glb`]: 1.2, [`${FOLDER}desk-1400.glb`]: 1.4 },
    modelDensities: { [`${FOLDER}desk-1200.glb`]: { 'New Material': 1.0001 }, [`${FOLDER}desk-1400.glb`]: {} },
    modelSizes: { [`${FOLDER}desk-1400-pedestal.glb`]: '82.01cm' },
    slots: [
      { materialName: 'Top', colourOptionId: 'opt-1', colourManual: '', rotationDeg: 90, sizeAttributeId: '', sizeManual: '', texelDensity: 0.9987 },
    ],
    ...over,
  }
}

function payload(over: Partial<P3dPayload> = {}): P3dPayload {
  return { parentProductId: PARENT, items: [], settings: P3D_CONFIG_DEFAULTS, fabric: null, ...over }
}

// Through JSON as well as straight back, because the packed payload crosses the RSC
// boundary as serialised data, not as the object the provider built.
const overTheWire = (value: P3dPayload) => unpackGalleryPayload(JSON.parse(JSON.stringify(packGalleryPayload(value))))

describe('gallery payload packing', () => {
  it('round-trips a large variation tree with add-on contexts, in order', () => {
    const variations = Array.from({ length: 40 }, () => crypto.randomUUID())
    const contexts = ['', 'pedestal-30cm', 'pedestal-39cm', 'desk-high-pedestal-80cm']
    const items = variations.flatMap((variation, v) =>
      contexts.map((context) => item({ productId: variation, url: sign(`desk-${v % 6}-${context || 'base'}.glb`), context })),
    )
    const original = payload({ items, fabric: fabric() })
    expect(overTheWire(original)).toEqual(original)
  })

  it('writes each repeated url, product, kind and context once', () => {
    const variation = crypto.randomUUID()
    const items = Array.from({ length: 12 }, (_, i) => item({ productId: variation, url: sign('desk-1200.glb'), context: i % 2 ? 'screens' : '' }))
    const packed = packGalleryPayload(payload({ items }))
    expect(packed.packing).toBe(GALLERY_PAYLOAD_PACKING)
    expect(packed.tables.folders).toEqual([FOLDER])
    expect(packed.tables.urls).toHaveLength(1)
    expect(packed.tables.kinds).toEqual([['glb', 'GLB model']])
    expect(packed.tables.contexts).toEqual(['', 'screens'])
    // One UUID, packed: 22 characters rather than a quoted array.
    expect(packed.tables.productIds).toHaveLength(22)
  })

  it('keeps an item with no context property apart from one with an empty context', () => {
    const withoutContext: P3dItem = { key: 'k-1', productId: PARENT, url: '/a.glb', format: 'glb', label: 'GLB model' }
    const original = payload({ items: [withoutContext, item({ key: 'k-2', url: '/a.glb' })] })
    const back = overTheWire(original)
    expect(back).toEqual(original)
    expect('context' in back.items[0]!).toBe(false)
    expect(back.items[1]!.context).toBe('')
  })

  it.each([
    ['a root-relative url', '/api/m/p3d/model.glb'],
    ['a url with no slash at all', 'model.glb'],
    ['a url with a slash in its query', 'https://media.example.test/a/model.glb?next=/b/c'],
    ['a data uri', 'data:model/gltf-binary;base64,Z2xURgIAAAA/AB+/'],
    ['an empty url', ''],
  ])('round-trips %s unchanged', (_label, url) => {
    const original = payload({ items: [item({ url }), item({ url: sign('desk.glb') })], fabric: fabric({ modelHeights: { [url]: 1 } }) })
    expect(overTheWire(original)).toEqual(original)
  })

  it('round-trips ids that are not UUIDs', () => {
    const original = payload({
      parentProductId: 'ckl2x9f0x0000abcd1234efgh',
      items: [item({ key: 'row-1', productId: 'ckl2x9f0x0000abcd1234efgh' }), item({ key: crypto.randomUUID(), productId: 'Variation-B' })],
    })
    expect(overTheWire(original)).toEqual(original)
  })

  it('round-trips every format and label pairing', () => {
    const original = payload({
      items: [
        item({ format: 'glb', label: 'GLB model' }),
        item({ format: 'obj', label: 'OBJ model' }),
        item({ format: 'fbx', label: 'FBX model' }),
        item({ format: 'glb', label: 'GLB model' }),
      ],
    })
    expect(overTheWire(original)).toEqual(original)
  })

  it('round-trips a product with no fabric config, and one with empty calibration maps', () => {
    const unconfigured = payload({ items: [item()] })
    expect(overTheWire(unconfigured)).toEqual(unconfigured)
    expect(overTheWire(unconfigured).fabric).toBeNull()
    const empty = payload({ items: [item()], fabric: fabric({ modelHeights: {}, modelWidths: {}, modelDensities: {}, modelSizes: {} }) })
    expect(overTheWire(empty)).toEqual(empty)
  })

  it('keeps a calibration key spelled "__proto__" as an ordinary key', () => {
    const heights = JSON.parse('{"__proto__": 2, "/a.glb": 1}') as Record<string, number>
    const original = payload({ items: [item()], fabric: fabric({ modelHeights: heights }) })
    const back = overTheWire(original)
    expect(Object.keys(back.fabric!.modelHeights)).toEqual(['__proto__', '/a.glb'])
    expect(back).toEqual(original)
  })

  it('round-trips an empty payload', () => {
    const original = payload()
    expect(overTheWire(original)).toEqual(original)
  })

  it('carries settings by reference, so a shared settings object stays shared', () => {
    const original = payload({ items: [item()] })
    expect(packGalleryPayload(original).settings).toBe(original.settings)
  })

  it('throws on a packed payload whose keys and items disagree', () => {
    const packed = packGalleryPayload(payload({ items: [item(), item()] }))
    expect(() => unpackGalleryPayload({ ...packed, itemKeys: ['only-one'] })).toThrow(/2 items/)
  })

  it('throws on an item pointing at a url that is not in the table', () => {
    const packed = packGalleryPayload(payload({ items: [item()] }))
    expect(() => unpackGalleryPayload({ ...packed, items: [[0, 7, 0, 0]] })).toThrow(/urls\[7\]/)
  })
})

describe('readGalleryPayload', () => {
  it('unpacks a packed payload once, handing every reader the same object', () => {
    const packed = JSON.parse(JSON.stringify(packGalleryPayload(payload({ items: [item()] })))) as unknown
    const first = readGalleryPayload(packed)
    expect(readGalleryPayload(packed)).toBe(first)
  })

  it('passes a plain payload from an older render straight through', () => {
    const plain = payload({ items: [item()] })
    expect(readGalleryPayload(plain)).toBe(plain)
  })
})
