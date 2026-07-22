import { describe, it, expect } from 'vitest'
import { isCalibrated } from '@/modules/product-3d-views-for-shop/lib/fabric/calibration'
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

describe('isCalibrated', () => {
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
