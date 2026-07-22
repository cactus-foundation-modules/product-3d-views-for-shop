import { describe, it, expect } from 'vitest'
import { isCalibrated, modelScaleKey } from '@/modules/product-3d-views-for-shop/lib/fabric/calibration'
import type { FabricConfig } from '@/modules/product-3d-views-for-shop/lib/db/fabric-config'

// This is the trip-wire for a whole class of silent breakage, so it is worth testing on
// its own: say "calibrated" when the product is not and the admin panel never offers to
// put it right, and the shop goes on drawing every finish at the wrong size without a
// word anywhere.

const TABLE_180 = 'https://cdn.example.com/table-180.obj'
const TABLE_240 = 'https://cdn.example.com/table-240.obj'

function config(overrides: Partial<FabricConfig> = {}): FabricConfig {
  return {
    scaleAxis: 'height',
    heightAttributeId: 'attr-height',
    heightManual: '',
    modelHeights: { [TABLE_180]: 0.73, [TABLE_240]: 0.85 },
    modelWidths: { [TABLE_180]: 1.8, [TABLE_240]: 2.4 },
    slots: [],
    ...overrides,
  }
}

// The attached models, one row per variation - the same two files over and over.
const MODELS = [
  { url: TABLE_180 },
  { url: TABLE_180 },
  { url: TABLE_240 },
]

// The signed form of the same file, as the admin route hands it to the panel.
const TABLE_180_SIGNED = `${TABLE_180}?t=1784851200000.oo8ik2sJbYYw4SDNyCs_6OJIQLT-KouASYZbw67T1Qk`

describe('modelScaleKey', () => {
  it('files the signed and the plain url under one key', () => {
    // The whole bug in one assertion. The panel measures a SIGNED url (it has to -
    // the browser cannot fetch the file otherwise) and the storefront resolves the
    // plain one out of p3d_models, so keying by the url as it arrives leaves the
    // storefront with no calibration at all and every finish at repeat 1.
    expect(modelScaleKey(TABLE_180_SIGNED)).toBe(TABLE_180)
    expect(modelScaleKey(TABLE_180)).toBe(TABLE_180)
  })

  it('keeps a key that cannot rot as the token expires', () => {
    const tomorrow = `${TABLE_180}?t=1784937600000.adifferenttokenentirely`
    expect(modelScaleKey(tomorrow)).toBe(modelScaleKey(TABLE_180_SIGNED))
  })
})

describe('isCalibrated', () => {
  it('accepts a measurement saved under the signed url', () => {
    // v0.1.60 wrote these. They are right about the file and wrong about the string,
    // so they must read as calibrated rather than send the panel round again.
    expect(isCalibrated(config({ modelHeights: { [TABLE_180_SIGNED]: 0.73, [TABLE_240]: 0.85 } }), MODELS)).toBe(true)
  })

  it('accepts an attached model whose url arrives signed', () => {
    expect(isCalibrated(config(), [{ url: TABLE_180_SIGNED }, { url: TABLE_240 }])).toBe(true)
  })

  it('passes a config that measured every attached file', () => {
    expect(isCalibrated(config(), MODELS)).toBe(true)
  })

  it('fails when a model has been attached since the last save', () => {
    expect(isCalibrated(config({ modelHeights: { [TABLE_180]: 0.73 } }), MODELS)).toBe(false)
  })

  it('fails when the measurements were stranded altogether', () => {
    // What a re-attach did to a config keyed by p3d_models row id: the numbers are all
    // still there, and every one of them describes a row that no longer exists.
    expect(isCalibrated(config({ modelHeights: {} }), MODELS)).toBe(false)
  })

  it('reads the axis the config actually scales by', () => {
    // Widths are empty in every config written before the width axis existed. On the
    // height axis that is no fault; on the width axis it is the whole fault.
    const heightsOnly = config({ modelWidths: {} })
    expect(isCalibrated(heightsOnly, MODELS)).toBe(true)
    expect(isCalibrated({ ...heightsOnly, scaleAxis: 'width' }, MODELS)).toBe(false)
  })

  it('treats a zero measurement as no measurement', () => {
    // A model whose bounding box read 0 is unmeasurable, not measured: tileRepeat
    // divides by it and falls back to 1 exactly as a missing key does.
    expect(isCalibrated(config({ modelHeights: { [TABLE_180]: 0, [TABLE_240]: 0.85 } }), MODELS)).toBe(false)
  })

  it('passes a product with nothing attached to draw', () => {
    expect(isCalibrated(config({ modelHeights: {} }), [])).toBe(true)
  })
})
