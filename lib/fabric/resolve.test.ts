import { describe, it, expect } from 'vitest'
import { composeFabricBundle, parseSwatchCm, tileRepeat } from '@/modules/product-3d-views-for-shop/lib/fabric/resolve'
import type { FabricConfig } from '@/modules/product-3d-views-for-shop/lib/db/fabric-config'
import type { SelectedOptionValue, ChildSizeValue } from '@/modules/product-3d-views-for-shop/lib/fabric/resolve'
import type { P3dFormat } from '@/modules/product-3d-views-for-shop/lib/formats'
import { MANUAL_COLOUR_ID, MANUAL_SIZE_ID, parseHexColour } from '@/modules/product-3d-views-for-shop/lib/fabric/constants'

// Ids kept short and named so a failing assertion reads on its own.
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

// One slot with every field at its neutral value, so a test names only the field
// it is actually about and a new field on the shape lands here rather than in a
// dozen literals.
function slot(overrides: Partial<FabricConfig['slots'][number]> = {}): FabricConfig['slots'][number] {
  return {
    materialName: 'Fabric seat',
    colourOptionId: OPT_SEAT_COLOUR,
    colourManual: '',
    sizeAttributeId: ATTR_SEAT_SIZE,
    sizeManual: '',
    texelDensity: 1,
    rotationDeg: 0,
    ...overrides,
  }
}

function config(overrides: Partial<FabricConfig> = {}): FabricConfig {
  return {
    heightAttributeId: ATTR_HEIGHT,
    heightManual: '',
    // Each model's bounding-box height in its own units, as measured at config time.
    // Read by the resolver by file url; composeFabricBundle takes the resolved number
    // directly, so these are here only to satisfy the config shape.
    modelHeights: { [MODEL_WITH]: 100, [MODEL_NONE]: 80 },
    slots: [
      slot(),
      slot({ materialName: 'Fabric back', colourOptionId: OPT_BACK_COLOUR, sizeAttributeId: ATTR_BACK_SIZE }),
    ],
    ...overrides,
  }
}

// The variation's own model, as the resolver hands it to composeFabricBundle.
const MODEL_WITH_OBJ = { id: MODEL_WITH, url: 'https://cdn.example.com/chiro-with.glb', format: 'glb' as P3dFormat }
const MODEL_NONE_OBJ = { id: MODEL_NONE, url: 'https://cdn.example.com/chiro-none.glb', format: 'glb' as P3dFormat }

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
  it('draws the model it is handed', () => {
    const bundle = composeFabricBundle(config(), MODEL_WITH_OBJ, 100, selected(), [])
    expect(bundle?.modelId).toBe(MODEL_WITH)
    expect(bundle?.modelUrl).toBe('https://cdn.example.com/chiro-with.glb')
  })

  it('returns null when the variation has no model to draw', () => {
    const bundle = composeFabricBundle(config(), null, 0, selected(), [])
    expect(bundle).toBeNull()
  })

  it('maps each slot to its colour swatch and true-scale tile repeat', () => {
    const bundle = composeFabricBundle(
      config(),
      MODEL_WITH_OBJ,
      100,
      selected(
        { optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL },
        { optionId: OPT_BACK_COLOUR, valueId: VAL_TEAL, swatch: TEAL_URL },
      ),
      [
        { attributeId: ATTR_HEIGHT, label: '200cm' },
        { attributeId: ATTR_SEAT_SIZE, label: '20x20cm' },
        { attributeId: ATTR_BACK_SIZE, label: '10x10cm' },
      ],
    )
    // Model height-units 100. Seat: 200/(100*1*20) = 0.1; back 200/(100*1*10) = 0.2.
    const slots = bundle?.slots ?? []
    expect(slots).toHaveLength(2)
    expect(slots[0]).toMatchObject({ materialName: 'Fabric seat', textureUrl: CRAB_URL })
    expect(slots[0]?.repeat).toBeCloseTo(0.1)
    expect(slots[1]).toMatchObject({ materialName: 'Fabric back', textureUrl: TEAL_URL })
    expect(slots[1]?.repeat).toBeCloseTo(0.2)
  })

  it('scales on the shown model height, so each variation calibrates on its own file', () => {
    const bundle = composeFabricBundle(
      config(),
      MODEL_NONE_OBJ,
      80,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [
        { attributeId: ATTR_HEIGHT, label: '160cm' },
        { attributeId: ATTR_SEAT_SIZE, label: '20x20cm' },
      ],
    )
    // Model height-units 80: 160/(80*1*20) = 0.1, not the taller file's 100.
    expect(bundle?.modelId).toBe(MODEL_NONE)
    expect(bundle?.slots[0]?.repeat).toBeCloseTo(0.1)
  })

  it('leaves a slot at repeat 1 when the child has no size or height value', () => {
    const bundle = composeFabricBundle(
      config(),
      MODEL_WITH_OBJ,
      100,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [], // no sizes and no height assigned
    )
    // Seat colour still applies; scale is neutral until the data is filled in. Back
    // has no colour chosen, so it is skipped entirely.
    expect(bundle?.slots).toEqual([{ materialName: 'Fabric seat', textureUrl: CRAB_URL, colour: null, repeat: 1, rotationDeg: 0 }])
  })

  it('takes a hand-typed size for a slot set to Manual, ignoring the attributes', () => {
    const bundle = composeFabricBundle(
      config({
        slots: [slot({ sizeAttributeId: MANUAL_SIZE_ID, sizeManual: '200mm' })],
      }),
      MODEL_WITH_OBJ,
      100,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [
        { attributeId: ATTR_HEIGHT, label: '200cm' },
        // A seat-size attribute value the slot must NOT read now it is manual.
        { attributeId: ATTR_SEAT_SIZE, label: '10x10cm' },
      ],
    )
    // 200mm is 20cm: 200/(100*1*20) = 0.1, not the attribute's 10cm -> 0.2.
    expect(bundle?.slots[0]?.repeat).toBeCloseTo(0.1)
  })

  it('takes a hand-typed overall height, ignoring the height attribute', () => {
    const bundle = composeFabricBundle(
      config({ heightAttributeId: MANUAL_SIZE_ID, heightManual: '2m' }),
      MODEL_WITH_OBJ,
      100,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [
        // A height attribute value the config must NOT read now it is manual.
        { attributeId: ATTR_HEIGHT, label: '400cm' },
        { attributeId: ATTR_SEAT_SIZE, label: '20x20cm' },
      ],
    )
    // 2m is 200cm: 200/(100*1*20) = 0.1, not the attribute's 400cm -> 0.2.
    expect(bundle?.slots[0]?.repeat).toBeCloseTo(0.1)
  })

  it('leaves every slot at repeat 1 when the manual height is blank', () => {
    const bundle = composeFabricBundle(
      config({ heightAttributeId: MANUAL_SIZE_ID, heightManual: '' }),
      MODEL_WITH_OBJ,
      100,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [{ attributeId: ATTR_SEAT_SIZE, label: '20x20cm' }],
    )
    expect(bundle?.slots[0]?.repeat).toBe(1)
  })

  it('leaves a Manual slot at repeat 1 when nothing has been typed yet', () => {
    const bundle = composeFabricBundle(
      config({
        slots: [slot({ sizeAttributeId: MANUAL_SIZE_ID })],
      }),
      MODEL_WITH_OBJ,
      100,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [{ attributeId: ATTR_HEIGHT, label: '200cm' }],
    )
    expect(bundle?.slots[0]?.repeat).toBe(1)
  })

  it('leaves a slot at repeat 1 when the model is not calibrated', () => {
    const bundle = composeFabricBundle(
      config(),
      MODEL_WITH_OBJ,
      0, // height never measured for this file
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [
        { attributeId: ATTR_HEIGHT, label: '200cm' },
        { attributeId: ATTR_SEAT_SIZE, label: '20x20cm' },
      ],
    )
    expect(bundle?.slots[0]?.repeat).toBe(1)
  })

  it('skips a slot whose colour has no usable texture url', () => {
    const bundle = composeFabricBundle(
      config(),
      MODEL_WITH_OBJ,
      100,
      selected(
        // A colour value with an empty swatch, and one with a non-http token.
        { optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: '' },
        { optionId: OPT_BACK_COLOUR, valueId: VAL_TEAL, swatch: '#ff0000' },
      ),
      [],
    )
    expect(bundle?.slots).toEqual([])
  })

  it('paints a Manual-colour slot flat, with no swatch, size or height involved', () => {
    const bundle = composeFabricBundle(
      config({ slots: [slot({ materialName: 'Frame', colourOptionId: MANUAL_COLOUR_ID, colourManual: '#7A5C3A' })] }),
      MODEL_WITH_OBJ,
      100,
      // No colour chosen for it, and no sizes at all - a fixed colour needs neither.
      selected(),
      [],
    )
    expect(bundle?.slots).toEqual([
      { materialName: 'Frame', textureUrl: '', colour: '#7a5c3a', repeat: 1, rotationDeg: 0 },
    ])
  })

  it('accepts the short hex and a missing hash on a Manual colour', () => {
    const bundle = composeFabricBundle(
      config({
        slots: [
          slot({ materialName: 'Frame', colourOptionId: MANUAL_COLOUR_ID, colourManual: '#abc' }),
          slot({ materialName: 'Leg', colourOptionId: MANUAL_COLOUR_ID, colourManual: 'FF0000' }),
        ],
      }),
      MODEL_WITH_OBJ,
      100,
      selected(),
      [],
    )
    expect(bundle?.slots.map((s) => s.colour)).toEqual(['#aabbcc', '#ff0000'])
  })

  it('skips a Manual-colour slot whose colour is blank or not a colour', () => {
    const bundle = composeFabricBundle(
      config({
        slots: [
          slot({ materialName: 'Frame', colourOptionId: MANUAL_COLOUR_ID, colourManual: '' }),
          slot({ materialName: 'Leg', colourOptionId: MANUAL_COLOUR_ID, colourManual: 'oak' }),
        ],
      }),
      MODEL_WITH_OBJ,
      100,
      selected(),
      [],
    )
    expect(bundle?.slots).toEqual([])
  })

  it('carries the per-part rotation through to the viewer', () => {
    const bundle = composeFabricBundle(
      config({ slots: [slot({ rotationDeg: 90 })] }),
      MODEL_WITH_OBJ,
      100,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [{ attributeId: ATTR_HEIGHT, label: '200cm' }, { attributeId: ATTR_SEAT_SIZE, label: '20x20cm' }],
    )
    expect(bundle?.slots[0]?.rotationDeg).toBe(90)
    // The turn is the texture's business alone - it must not disturb the scale.
    expect(bundle?.slots[0]?.repeat).toBeCloseTo(0.1)
  })
})

describe('parseHexColour', () => {
  it('normalises every form an admin might paste', () => {
    expect(parseHexColour('#7A5C3A')).toBe('#7a5c3a')
    expect(parseHexColour('7a5c3a')).toBe('#7a5c3a')
    expect(parseHexColour('  #abc  ')).toBe('#aabbcc')
  })

  it('refuses anything that is not a colour', () => {
    expect(parseHexColour('')).toBeNull()
    expect(parseHexColour('oak')).toBeNull()
    expect(parseHexColour('#12345')).toBeNull()
    expect(parseHexColour('#gggggg')).toBeNull()
  })
})
