import { describe, it, expect } from 'vitest'
import { composeFabricBundle, parseSwatchCm, tileRepeat } from '@/modules/product-3d-views-for-shop/lib/fabric/resolve'
import type { FabricConfig } from '@/modules/product-3d-views-for-shop/lib/db/fabric-config'
import type { SelectedOptionValue, ChildSizeValue } from '@/modules/product-3d-views-for-shop/lib/fabric/resolve'
import type { P3dFormat } from '@/modules/product-3d-views-for-shop/lib/formats'

// Ids kept short and named so a failing assertion reads on its own.
const OPT_HEADREST = 'opt-headrest'
const VAL_NONE = 'val-none'
const VAL_WITH = 'val-with'
const OPT_SEAT_COLOUR = 'opt-seat-colour'
const VAL_CRAB = 'val-crab'
const OPT_BACK_COLOUR = 'opt-back-colour'
const VAL_TEAL = 'val-teal'
const ATTR_SEAT_SIZE = 'attr-seat-size'
const ATTR_BACK_SIZE = 'attr-back-size'
const ATTR_HEIGHT = 'attr-height'
const MODEL_WITH = 'model-with'
const MODEL_NONE = 'model-none'

const CRAB_URL = 'https://cdn.example.com/colours/quest-crab.webp'
const TEAL_URL = 'https://cdn.example.com/colours/quest-teal.webp'

function config(overrides: Partial<FabricConfig> = {}): FabricConfig {
  return {
    models: [
      { modelId: MODEL_NONE, optionId: OPT_HEADREST, valueId: VAL_NONE },
      { modelId: MODEL_WITH, optionId: OPT_HEADREST, valueId: VAL_WITH },
    ],
    defaultModelId: MODEL_WITH,
    heightAttributeId: ATTR_HEIGHT,
    // Each model's bounding-box height in its own units, as measured at config time.
    modelHeights: { [MODEL_WITH]: 100, [MODEL_NONE]: 80 },
    slots: [
      { materialName: 'Fabric seat', colourOptionId: OPT_SEAT_COLOUR, sizeAttributeId: ATTR_SEAT_SIZE, texelDensity: 1 },
      { materialName: 'Fabric back', colourOptionId: OPT_BACK_COLOUR, sizeAttributeId: ATTR_BACK_SIZE, texelDensity: 1 },
    ],
    ...overrides,
  }
}

const models = new Map<string, { url: string; format: P3dFormat }>([
  [MODEL_WITH, { url: 'https://cdn.example.com/chiro-with.glb', format: 'glb' }],
  [MODEL_NONE, { url: 'https://cdn.example.com/chiro-none.glb', format: 'glb' }],
])

function selected(...values: SelectedOptionValue[]): SelectedOptionValue[] {
  return values
}

describe('parseSwatchCm', () => {
  it('reads the centimetres out of a square swatch label', () => {
    expect(parseSwatchCm('20x20cm')).toBe(20)
    expect(parseSwatchCm('10x10cm')).toBe(10)
  })

  it('reads a plain height label too', () => {
    expect(parseSwatchCm('137cm')).toBe(137)
  })

  it('converts a millimetre value to centimetres', () => {
    expect(parseSwatchCm('1070mm')).toBe(107)
    expect(parseSwatchCm('200 mm')).toBe(20)
    expect(parseSwatchCm('20x20mm')).toBe(2)
  })

  it('converts a metre value to centimetres', () => {
    expect(parseSwatchCm('1.07m')).toBeCloseTo(107)
  })

  it('reads a decimal centimetre value', () => {
    expect(parseSwatchCm('72.5cm')).toBeCloseTo(72.5)
  })

  it('reads a bare number as centimetres', () => {
    expect(parseSwatchCm('137')).toBe(137)
  })

  it('takes the first number for a non-square label (v1 assumes square)', () => {
    expect(parseSwatchCm('10x20')).toBe(10)
  })

  it('returns null when the label carries no number', () => {
    expect(parseSwatchCm('one size')).toBeNull()
    expect(parseSwatchCm('')).toBeNull()
  })
})

describe('tileRepeat', () => {
  it('scales the weave to true size from the calibration and swatch', () => {
    // repeat = heightCm / (modelHeightUnits * texelDensity * swatchCm)
    //        = 200 / (100 * 1 * 20) = 0.1
    expect(tileRepeat({ heightCm: 200, modelHeightUnits: 100, texelDensity: 1, swatchCm: 20 })).toBeCloseTo(0.1)
    // A 10cm swatch tiles twice as densely as a 20cm one over the same surface.
    expect(tileRepeat({ heightCm: 200, modelHeightUnits: 100, texelDensity: 1, swatchCm: 10 })).toBeCloseTo(0.2)
  })

  it('falls back to 1 (colour right, scale neutral) when any term is missing', () => {
    const base = { heightCm: 200, modelHeightUnits: 100, texelDensity: 1, swatchCm: 20 }
    expect(tileRepeat({ ...base, heightCm: null })).toBe(1)
    expect(tileRepeat({ ...base, swatchCm: null })).toBe(1)
    expect(tileRepeat({ ...base, texelDensity: 0 })).toBe(1)
    expect(tileRepeat({ ...base, modelHeightUnits: 0 })).toBe(1)
  })
})

describe('composeFabricBundle', () => {
  it('picks the model for the chosen structural option value', () => {
    const withRest = composeFabricBundle(
      config(),
      selected({ optionId: OPT_HEADREST, valueId: VAL_WITH, swatch: null }),
      [],
      models,
    )
    expect(withRest?.modelId).toBe(MODEL_WITH)
    expect(withRest?.modelUrl).toBe('https://cdn.example.com/chiro-with.glb')

    const noRest = composeFabricBundle(
      config(),
      selected({ optionId: OPT_HEADREST, valueId: VAL_NONE, swatch: null }),
      [],
      models,
    )
    expect(noRest?.modelId).toBe(MODEL_NONE)
  })

  it('falls back to the default model when no models[] entry matches', () => {
    const bundle = composeFabricBundle(config(), selected(), [], models)
    expect(bundle?.modelId).toBe(MODEL_WITH)
  })

  it('returns null when the resolved model id is not in the lookup', () => {
    const bundle = composeFabricBundle(config({ defaultModelId: 'missing', models: [] }), selected(), [], models)
    expect(bundle).toBeNull()
  })

  it('maps each slot to its colour swatch and true-scale tile repeat', () => {
    const bundle = composeFabricBundle(
      config(),
      selected(
        { optionId: OPT_HEADREST, valueId: VAL_WITH, swatch: null },
        { optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL },
        { optionId: OPT_BACK_COLOUR, valueId: VAL_TEAL, swatch: TEAL_URL },
      ),
      [
        { attributeId: ATTR_HEIGHT, label: '200cm' },
        { attributeId: ATTR_SEAT_SIZE, label: '20x20cm' },
        { attributeId: ATTR_BACK_SIZE, label: '10x10cm' },
      ],
      models,
    )
    // MODEL_WITH height-units 100. Seat: 200/(100*1*20) = 0.1; back 200/(100*1*10) = 0.2.
    const slots = bundle?.slots ?? []
    expect(slots).toHaveLength(2)
    expect(slots[0]).toMatchObject({ materialName: 'Fabric seat', textureUrl: CRAB_URL })
    expect(slots[0]?.repeat).toBeCloseTo(0.1)
    expect(slots[1]).toMatchObject({ materialName: 'Fabric back', textureUrl: TEAL_URL })
    expect(slots[1]?.repeat).toBeCloseTo(0.2)
  })

  it('uses the shown model height, so the headrest variant scales on its own file', () => {
    const bundle = composeFabricBundle(
      config(),
      selected(
        { optionId: OPT_HEADREST, valueId: VAL_NONE, swatch: null },
        { optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL },
      ),
      [
        { attributeId: ATTR_HEIGHT, label: '160cm' },
        { attributeId: ATTR_SEAT_SIZE, label: '20x20cm' },
      ],
      models,
    )
    // MODEL_NONE height-units 80: 160/(80*1*20) = 0.1, not the with-headrest 100.
    expect(bundle?.modelId).toBe(MODEL_NONE)
    expect(bundle?.slots[0]?.repeat).toBeCloseTo(0.1)
  })

  it('leaves a slot at repeat 1 when the child has no size or height value', () => {
    const bundle = composeFabricBundle(
      config(),
      selected(
        { optionId: OPT_HEADREST, valueId: VAL_WITH, swatch: null },
        { optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL },
      ),
      [], // no sizes and no height assigned
      models,
    )
    // Seat colour still applies; scale is neutral until the data is filled in. Back
    // has no colour chosen, so it is skipped entirely.
    expect(bundle?.slots).toEqual([{ materialName: 'Fabric seat', textureUrl: CRAB_URL, repeat: 1 }])
  })

  it('leaves a slot at repeat 1 when the model is not calibrated', () => {
    const bundle = composeFabricBundle(
      config({ modelHeights: {} }), // never measured
      selected(
        { optionId: OPT_HEADREST, valueId: VAL_WITH, swatch: null },
        { optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL },
      ),
      [
        { attributeId: ATTR_HEIGHT, label: '200cm' },
        { attributeId: ATTR_SEAT_SIZE, label: '20x20cm' },
      ],
      models,
    )
    expect(bundle?.slots[0]?.repeat).toBe(1)
  })

  it('skips a slot whose colour has no usable texture url', () => {
    const bundle = composeFabricBundle(
      config(),
      selected(
        { optionId: OPT_HEADREST, valueId: VAL_WITH, swatch: null },
        // A colour value with an empty swatch, and one with a non-http token.
        { optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: '' },
        { optionId: OPT_BACK_COLOUR, valueId: VAL_TEAL, swatch: '#ff0000' },
      ),
      [],
      models,
    )
    expect(bundle?.slots).toEqual([])
  })
})
