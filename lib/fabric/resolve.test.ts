import { describe, it, expect } from 'vitest'
import { composeFabricBundle, parseSwatchCm } from '@/modules/product-3d-views-for-shop/lib/fabric/resolve'
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
    slots: [
      { materialName: 'Fabric seat', colourOptionId: OPT_SEAT_COLOUR, sizeAttributeId: ATTR_SEAT_SIZE, uvSpanCm: 40, defaultSwatchCm: 20 },
      { materialName: 'Fabric back', colourOptionId: OPT_BACK_COLOUR, sizeAttributeId: ATTR_BACK_SIZE, uvSpanCm: 40, defaultSwatchCm: 20 },
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

  it('takes the first integer for a non-square label (v1 assumes square)', () => {
    expect(parseSwatchCm('10x20')).toBe(10)
  })

  it('returns null when the label carries no number', () => {
    expect(parseSwatchCm('one size')).toBeNull()
    expect(parseSwatchCm('')).toBeNull()
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

  it('maps each slot to its colour swatch and tile repeat', () => {
    const bundle = composeFabricBundle(
      config(),
      selected(
        { optionId: OPT_HEADREST, valueId: VAL_WITH, swatch: null },
        { optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL },
        { optionId: OPT_BACK_COLOUR, valueId: VAL_TEAL, swatch: TEAL_URL },
      ),
      [
        { attributeId: ATTR_SEAT_SIZE, label: '20x20cm' },
        { attributeId: ATTR_BACK_SIZE, label: '10x10cm' },
      ],
      models,
    )
    expect(bundle?.slots).toEqual([
      // uvSpanCm 40 / swatch 20 = 2 tiles; a 10cm swatch tiles twice as densely.
      { materialName: 'Fabric seat', textureUrl: CRAB_URL, repeat: 2 },
      { materialName: 'Fabric back', textureUrl: TEAL_URL, repeat: 4 },
    ])
  })

  it('falls back to the slot default swatch size when the child has no size assigned', () => {
    const bundle = composeFabricBundle(
      config(),
      selected(
        { optionId: OPT_HEADREST, valueId: VAL_WITH, swatch: null },
        { optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL },
      ),
      [], // no sizes assigned
      models,
    )
    // Seat: default 20 -> 40/20 = 2. Back has no colour chosen, so it is skipped.
    expect(bundle?.slots).toEqual([{ materialName: 'Fabric seat', textureUrl: CRAB_URL, repeat: 2 }])
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
