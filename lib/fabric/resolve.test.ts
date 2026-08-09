import { describe, it, expect } from 'vitest'
import { autoScaleFor, composeFabricBundle, measuredDensityFor, measuredUnitsFor, parseSwatchCm, tileRepeat } from '@/modules/product-3d-views-for-shop/lib/fabric/resolve'
import type { FabricConfig } from '@/modules/product-3d-views-for-shop/lib/db/fabric-config'
import type { SelectedOptionValue, ChildSizeValue } from '@/modules/product-3d-views-for-shop/lib/fabric/resolve'
import type { P3dFormat } from '@/modules/product-3d-views-for-shop/lib/formats'
import { MANUAL_COLOUR_ID, MANUAL_SIZE_ID, attributeColourId, optionSizeId, parseHexColour } from '@/modules/product-3d-views-for-shop/lib/fabric/constants'

// Ids kept short and named so a failing assertion reads on its own.
const OPT_SEAT_COLOUR = 'opt-seat-colour'
const VAL_CRAB = 'val-crab'
const OPT_BACK_COLOUR = 'opt-back-colour'
const VAL_TEAL = 'val-teal'
// A variation option carrying the product's overall size as its value label - the
// shop that never set the measurement up as an attribute at all.
const OPT_SIZE = 'opt-size'
const VAL_140 = 'val-140'
const ATTR_SEAT_SIZE = 'attr-seat-size'
const ATTR_BACK_SIZE = 'attr-back-size'
const ATTR_HEIGHT = 'attr-height'
// An attribute used as a COLOUR source rather than as a measurement.
const ATTR_FINISH = 'attr-finish'
// One attribute used twice on the same product, and the id of each helping - what a
// config points at when "Fabric" appears as both "Seat fabric" and "Back fabric".
const ATTR_FABRIC = 'attr-fabric'
const HELP_SEAT_FABRIC = 'help-seat-fabric'
const HELP_BACK_FABRIC = 'help-back-fabric'
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
    scaleAxis: 'height',
    heightAttributeId: ATTR_HEIGHT,
    heightManual: '',
    // Each model's bounding-box height and width in its own units, as measured at
    // config time. Read by the resolver by file url; composeFabricBundle takes the
    // resolved number directly, so these are here only to satisfy the config shape.
    modelHeights: { [MODEL_WITH]: 100, [MODEL_NONE]: 80 },
    modelWidths: { [MODEL_WITH]: 60, [MODEL_NONE]: 45 },
    modelDensities: {},
    modelSizes: {},
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

// tileRepeat returning 1 is indistinguishable, at the call site, between "this genuinely
// tiles once" and "I could not work it out" - and the second silently mis-drew the weave
// on any model attached since the last Detect+Save. autoScaleFor is what separates the
// two, and says so to the viewer, which can measure the missing half for itself.
describe('autoScaleFor', () => {
  const CALIBRATED = { realCm: 200, modelUnits: 100, texelDensity: 1, swatchCm: 20 }

  it('says nothing when the config measured everything', () => {
    // The working case must stay untouched: a null here is what keeps the resolver's
    // own number final for every product already tiling correctly.
    expect(autoScaleFor(CALIBRATED, 'height')).toBeNull()
  })

  it('asks the viewer to measure a model the config never measured', () => {
    // A model attached after the last save - exactly the Eclipse folding-arms case.
    expect(autoScaleFor({ ...CALIBRATED, modelUnits: 0 }, 'height')).toEqual({
      realCm: 200,
      scaleAxis: 'height',
      swatchCm: 20,
    })
  })

  it('asks the viewer to measure when the material has no density recorded', () => {
    expect(autoScaleFor({ ...CALIBRATED, texelDensity: 0 }, 'width')).toEqual({
      realCm: 200,
      scaleAxis: 'width',
      swatchCm: 20,
    })
  })

  it('stays silent when the shop has not said how big the product is', () => {
    // Not something any amount of looking at the mesh can answer, so this stays
    // uncalibrated exactly as it always did rather than inventing a size.
    expect(autoScaleFor({ ...CALIBRATED, realCm: null, modelUnits: 0 }, 'height')).toBeNull()
  })

  it('stays silent when the swatch has no real size', () => {
    expect(autoScaleFor({ ...CALIBRATED, swatchCm: null, modelUnits: 0 }, 'height')).toBeNull()
  })
})

describe('tileRepeat', () => {
  it('scales the weave to true size from the calibration and swatch', () => {
    // repeat = realCm / (modelUnits * texelDensity * swatchCm)
    //        = 200 / (100 * 1 * 20) = 0.1
    expect(tileRepeat({ realCm: 200, modelUnits: 100, texelDensity: 1, swatchCm: 20 })).toBeCloseTo(0.1)
    // A 10cm swatch tiles twice as densely as a 20cm one over the same surface.
    expect(tileRepeat({ realCm: 200, modelUnits: 100, texelDensity: 1, swatchCm: 10 })).toBeCloseTo(0.2)
  })

  it('gives the same repeat off the width as off the height, at the same ratio', () => {
    // Only the real-to-model ratio matters, never which dimension it was taken along:
    // a model 100 units tall standing 200cm high and the same model 60 units wide
    // measuring 120cm across are the same 2cm per unit, so the weave comes out
    // identical. This is why one dimension is enough and why either one will do.
    const byHeight = tileRepeat({ realCm: 200, modelUnits: 100, texelDensity: 1, swatchCm: 20 })
    const byWidth = tileRepeat({ realCm: 120, modelUnits: 60, texelDensity: 1, swatchCm: 20 })
    expect(byWidth).toBeCloseTo(byHeight)
  })

  it('falls back to 1 (colour right, scale neutral) when any term is missing', () => {
    const base = { realCm: 200, modelUnits: 100, texelDensity: 1, swatchCm: 20 }
    expect(tileRepeat({ ...base, realCm: null })).toBe(1)
    expect(tileRepeat({ ...base, swatchCm: null })).toBe(1)
    expect(tileRepeat({ ...base, texelDensity: 0 })).toBe(1)
    expect(tileRepeat({ ...base, modelUnits: 0 })).toBe(1)
  })
})

describe('measuredUnitsFor', () => {
  // One file, attached to three variations: three rows, one url, one measurement.
  const TREE = [
    { id: 'row-a', url: 'https://cdn.example.com/table-180.obj' },
    { id: 'row-b', url: 'https://cdn.example.com/table-180.obj' },
    { id: 'row-c', url: 'https://cdn.example.com/table-240.obj' },
  ]

  it('reads a measurement by the file it was taken from, whichever row is shown', () => {
    const measured = { 'https://cdn.example.com/table-180.obj': 0.73, 'https://cdn.example.com/table-240.obj': 0.85 }
    expect(measuredUnitsFor(measured, TREE, 'https://cdn.example.com/table-180.obj')).toBe(0.73)
    expect(measuredUnitsFor(measured, TREE, 'https://cdn.example.com/table-240.obj')).toBe(0.85)
  })

  it('survives the models being re-attached, which is what row ids never did', () => {
    // The whole point of keying by url. Detaching and re-attaching the same file
    // across a product's variations writes a new p3d_models row per variation; an
    // id-keyed config lost its calibration on the spot and every variation dropped
    // to repeat 1 without a word, which is exactly how it went unnoticed.
    const measured = { 'https://cdn.example.com/table-180.obj': 0.73 }
    const reattached = [{ id: 'row-new', url: 'https://cdn.example.com/table-180.obj' }]
    expect(measuredUnitsFor(measured, reattached, 'https://cdn.example.com/table-180.obj')).toBe(0.73)
  })

  it('reads a measurement saved under the signed url', () => {
    // What v0.1.60 wrote: the admin panel measures the url it was handed, which the
    // admin route signs, while the tree here carries the plain url from p3d_models.
    // Normalised on read, so those configs come right where they lie rather than
    // needing every configured product opened and saved a second time.
    const signed = 'https://cdn.example.com/table-180.obj?t=1784851200000.sometokenhere'
    expect(measuredUnitsFor({ [signed]: 0.73 }, TREE, 'https://cdn.example.com/table-180.obj')).toBe(0.73)
  })

  it('still honours a legacy id-keyed measurement while its row is there', () => {
    expect(measuredUnitsFor({ 'row-a': 0.73 }, TREE, 'https://cdn.example.com/table-180.obj')).toBe(0.73)
  })

  it('prefers the url key when a legacy id key describes the same file', () => {
    const measured = { 'row-a': 0.5, 'https://cdn.example.com/table-180.obj': 0.73 }
    expect(measuredUnitsFor(measured, TREE, 'https://cdn.example.com/table-180.obj')).toBe(0.73)
  })

  it('leaves the model uncalibrated rather than borrowing another file\'s number', () => {
    // A stranded id key names a row that is gone, so nothing remains to say which file
    // it measured. 0 leaves tiling neutral; a guess would scale the weave by a number
    // belonging to some other model.
    expect(measuredUnitsFor({ 'row-deleted': 0.73 }, TREE, 'https://cdn.example.com/table-180.obj')).toBe(0)
    expect(measuredUnitsFor({}, TREE, 'https://cdn.example.com/table-180.obj')).toBe(0)
  })
})

describe('measuredDensityFor', () => {
  // The two files of one range, unwrapped differently to each other - which is the
  // case a single shared density can never describe, and the case that had every
  // Impulse desk drawing its wood grain about a third small.
  const NARROW = 'https://cdn.example.com/desk-1200.glb'
  const WIDE = 'https://cdn.example.com/desk-1600.glb'
  const SLOT = { materialName: 'Desktop', texelDensity: 1.41 }

  it('tiles each file by its own measurement', () => {
    const config = { modelDensities: { [NARROW]: { Desktop: 2.2222 }, [WIDE]: { Desktop: 1.0 } } }
    expect(measuredDensityFor(config, NARROW, SLOT)).toBeCloseTo(2.2222)
    expect(measuredDensityFor(config, WIDE, SLOT)).toBeCloseTo(1.0)
  })

  it('falls back to the shared density for a config saved before per-file ones', () => {
    expect(measuredDensityFor({ modelDensities: {} }, NARROW, SLOT)).toBe(1.41)
  })

  it('falls back for a model attached since the last measurement', () => {
    const config = { modelDensities: { [NARROW]: { Desktop: 2.2222 } } }
    expect(measuredDensityFor(config, WIDE, SLOT)).toBe(1.41)
  })

  it('falls back for a part this file has no reading for', () => {
    const config = { modelDensities: { [NARROW]: { 'Desk Edge': 2.16 } } }
    expect(measuredDensityFor(config, NARROW, SLOT)).toBe(1.41)
  })

  it('honours a measured zero rather than borrowing another mesh’s number', () => {
    // 0 is what a material with no UVs measures. There is genuinely nothing to tile
    // by, and tileRepeat reads it as uncalibrated - whereas falling through to the
    // shared number would scale this mesh by some other file's unwrap and call it
    // calibrated, which is the silent wrong answer this whole map exists to stop.
    const config = { modelDensities: { [NARROW]: { Desktop: 0 } } }
    expect(measuredDensityFor(config, NARROW, SLOT)).toBe(0)
  })

  it('reads a measurement saved under the signed url', () => {
    // Same trap as the heights: the admin panel measures signed urls, the storefront
    // resolves plain ones.
    const signed = `${NARROW}?t=1784851200000.sometokenhere`
    expect(measuredDensityFor({ modelDensities: { [signed]: { Desktop: 2.2222 } } }, NARROW, SLOT)).toBeCloseTo(2.2222)
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

  // An add-on-context file shows the product WITH something else on it, so it is a
  // different size from the product - and since the measured half of the calibration
  // comes off that same combined box, the real half has to as well. Without this the
  // whole file, the product's own parts included, tiles by the ratio of the two.
  it('scales a file that declares its own real size by that size', () => {
    const withScreens = { ...MODEL_WITH_OBJ, url: 'https://cdn.example.com/chiro-with-screens.glb' }
    const bundle = composeFabricBundle(
      // The product is 200cm; this file measures 300 units because of what is on it,
      // and says so.
      config({ modelSizes: { [withScreens.url]: '600cm' } }),
      withScreens,
      300,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [
        { attributeId: ATTR_HEIGHT, label: '200cm' },
        { attributeId: ATTR_SEAT_SIZE, label: '20x20cm' },
      ],
    )
    // 600/(300*1*20) = 0.1 - the same 2cm per model unit the base file scales at,
    // which is the whole point. The product-level 200cm would have given 0.033.
    expect(bundle?.realCm).toBe(600)
    expect(bundle?.slots[0]?.repeat).toBeCloseTo(0.1)
  })

  it('ignores a declared size that is not a size, rather than guessing at one', () => {
    const bundle = composeFabricBundle(
      config({ modelSizes: { [MODEL_WITH_OBJ.url]: 'as exported' } }),
      MODEL_WITH_OBJ,
      100,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [
        { attributeId: ATTR_HEIGHT, label: '200cm' },
        { attributeId: ATTR_SEAT_SIZE, label: '20x20cm' },
      ],
    )
    expect(bundle?.realCm).toBe(200)
    expect(bundle?.slots[0]?.repeat).toBeCloseTo(0.1)
  })

  it('leaves a file with no declared size on the product-level size', () => {
    const bundle = composeFabricBundle(
      config({ modelSizes: { 'https://cdn.example.com/some-other.glb': '600cm' } }),
      MODEL_WITH_OBJ,
      100,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [
        { attributeId: ATTR_HEIGHT, label: '200cm' },
        { attributeId: ATTR_SEAT_SIZE, label: '20x20cm' },
      ],
    )
    expect(bundle?.realCm).toBe(200)
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

  it('scales on the shown model’s OWN unwrap, not the face model’s', () => {
    // The Impulse desk case. Every width of a range shares one slot, so one shared
    // texelDensity was applied to files unwrapped differently to each other - and to
    // files re-unwrapped since the face model was last measured. The finish still
    // painted, so nothing looked broken; the grain merely came out a third small.
    const bundle = composeFabricBundle(
      config({
        // Shared reading says 1, this file measures 2 - the weave should halve.
        modelDensities: { [MODEL_NONE_OBJ.url]: { 'Fabric seat': 2 } },
      }),
      MODEL_NONE_OBJ,
      80,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [
        { attributeId: ATTR_HEIGHT, label: '160cm' },
        { attributeId: ATTR_SEAT_SIZE, label: '20x20cm' },
      ],
    )
    // 160/(80*2*20) = 0.05, half the 0.1 the shared density of 1 would have given.
    expect(bundle?.slots[0]?.repeat).toBeCloseTo(0.05)
    // Calibrated, so the viewer must not go measuring for itself and override it.
    expect(bundle?.slots[0]?.autoScale).toBeNull()
  })

  it('asks the viewer to measure a file whose own density is a measured zero', () => {
    // No UVs on that part in THIS file, whatever the shared number says. Tiling by
    // another mesh's unwrap would be a confident wrong answer.
    const bundle = composeFabricBundle(
      config({ modelDensities: { [MODEL_NONE_OBJ.url]: { 'Fabric seat': 0 } } }),
      MODEL_NONE_OBJ,
      80,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [
        { attributeId: ATTR_HEIGHT, label: '160cm' },
        { attributeId: ATTR_SEAT_SIZE, label: '20x20cm' },
      ],
    )
    expect(bundle?.slots[0]?.repeat).toBe(1)
    expect(bundle?.slots[0]?.autoScale).toEqual({ realCm: 160, scaleAxis: 'height', swatchCm: 20 })
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
    expect(bundle?.slots).toEqual([{ materialName: 'Fabric seat', textureUrl: CRAB_URL, colour: null, repeat: 1, rotationDeg: 0, gloss: 0, autoScale: null }])
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

  it('reads the overall size off a variation option when the config points at one', () => {
    const bundle = composeFabricBundle(
      config({ heightAttributeId: optionSizeId(OPT_SIZE) }),
      MODEL_WITH_OBJ,
      100,
      selected(
        { optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL },
        { optionId: OPT_SIZE, valueId: VAL_140, swatch: null, label: '200cm' },
      ),
      [
        // An attribute of the same id-shape the config must NOT fall back to.
        { attributeId: ATTR_HEIGHT, label: '400cm' },
        { attributeId: ATTR_SEAT_SIZE, label: '20x20cm' },
      ],
    )
    // 200/(100*1*20) = 0.1 - the option's label, not the height attribute's 400cm.
    expect(bundle?.slots[0]?.repeat).toBeCloseTo(0.1)
  })

  it('leaves the scale uncalibrated when the size option is not one this variation carries', () => {
    const bundle = composeFabricBundle(
      config({ heightAttributeId: optionSizeId(OPT_SIZE) }),
      MODEL_WITH_OBJ,
      100,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [{ attributeId: ATTR_SEAT_SIZE, label: '20x20cm' }],
    )
    expect(bundle?.slots[0]?.repeat).toBe(1)
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

  it('skips a slot whose colour value carries nothing to paint with', () => {
    const bundle = composeFabricBundle(
      config(),
      MODEL_WITH_OBJ,
      100,
      // Both chosen values have an empty swatch: no picture and no colour, so there
      // is nothing to paint either part with.
      selected(
        { optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: '' },
        { optionId: OPT_BACK_COLOUR, valueId: VAL_TEAL, swatch: null },
      ),
      [],
    )
    expect(bundle?.slots).toEqual([])
  })

  it('paints a hex-swatch colour value flat, with nothing to tile', () => {
    const bundle = composeFabricBundle(
      config({ slots: [slot({ materialName: 'Fabric seat', colourOptionId: OPT_SEAT_COLOUR, rotationDeg: 90 })] }),
      MODEL_WITH_OBJ,
      100,
      // A plain colour option rather than a picture one: the shopper's choice is a
      // hex, so the part is painted flat and its rotation is beside the point.
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: '#FF0000' }),
      [{ attributeId: ATTR_HEIGHT, label: '200cm' }],
    )
    expect(bundle?.slots).toEqual([
      { materialName: 'Fabric seat', textureUrl: '', colour: '#ff0000', repeat: 1, rotationDeg: 0, gloss: 0, autoScale: null },
    ])
  })

  // A range with a leather in it used to mean a second model file, its seat authored
  // shinier, kept in step with the first by hand for the life of the product. The
  // swatch's own name settles it instead - so what matters here is that the name gets
  // as far as the bundle, from either place a swatch can come from, and that an
  // ordinary fabric beside it is composed exactly as it always was.
  it('gives a part a sheen when the swatch picked for it says leather', () => {
    const bundle = composeFabricBundle(
      config({ slots: [slot({ sizeAttributeId: MANUAL_SIZE_ID, sizeManual: '20cm' })] }),
      MODEL_WITH_OBJ,
      100,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL, label: 'Soft Leather - Black' }),
      [{ attributeId: ATTR_HEIGHT, label: '200cm' }],
    )
    expect(bundle?.slots[0]?.gloss).toBeGreaterThan(0)
  })

  it('gives one from an attribute-painted part just the same', () => {
    const bundle = composeFabricBundle(
      config({ slots: [slot({ colourOptionId: attributeColourId(ATTR_FINISH), sizeAttributeId: MANUAL_SIZE_ID, sizeManual: '20cm' })] }),
      MODEL_WITH_OBJ,
      100,
      selected(),
      [
        { attributeId: ATTR_HEIGHT, label: '200cm' },
        { attributeId: ATTR_FINISH, label: 'Italian Leather Tan', swatch: CRAB_URL },
      ],
    )
    expect(bundle?.slots[0]?.gloss).toBeGreaterThan(0)
  })

  it('gives one to a leather offered as a plain colour swatch', () => {
    const bundle = composeFabricBundle(
      config({ slots: [slot()] }),
      MODEL_WITH_OBJ,
      100,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: '#1A1A1A', label: 'Leather Black' }),
      [{ attributeId: ATTR_HEIGHT, label: '200cm' }],
    )
    expect(bundle?.slots[0]?.colour).toBe('#1a1a1a')
    expect(bundle?.slots[0]?.gloss).toBeGreaterThan(0)
  })

  it('leaves an ordinary fabric on the same product matte', () => {
    const bundle = composeFabricBundle(
      config(),
      MODEL_WITH_OBJ,
      100,
      selected(
        { optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL, label: 'Black Leather' },
        { optionId: OPT_BACK_COLOUR, valueId: VAL_TEAL, swatch: TEAL_URL, label: 'Quest Teal' },
      ),
      [
        { attributeId: ATTR_HEIGHT, label: '200cm' },
        { attributeId: ATTR_SEAT_SIZE, label: '20cm' },
        { attributeId: ATTR_BACK_SIZE, label: '20cm' },
      ],
    )
    expect(bundle?.slots.map((s) => s.gloss)).toEqual([expect.any(Number), 0])
    expect(bundle?.slots[0]?.gloss).toBeGreaterThan(0)
  })

  it('paints from an ATTRIBUTE value when the slot points at one', () => {
    const bundle = composeFabricBundle(
      config({
        slots: [slot({ materialName: 'Fabric seat', colourOptionId: attributeColourId(ATTR_FINISH), sizeAttributeId: MANUAL_SIZE_ID, sizeManual: '20cm' })],
      }),
      MODEL_WITH_OBJ,
      100,
      // Nothing selected on the variation options at all: the finish lives on an
      // attribute set against this variation instead.
      selected(),
      [
        { attributeId: ATTR_HEIGHT, label: '200cm' },
        { attributeId: ATTR_FINISH, label: 'Oak', swatch: CRAB_URL },
      ],
    )
    expect(bundle?.slots).toEqual([
      { materialName: 'Fabric seat', textureUrl: CRAB_URL, colour: null, repeat: 0.1, rotationDeg: 0, gloss: 0, autoScale: null },
    ])
  })

  it('scales an attribute-painted part from the swatch size recorded on the value', () => {
    const bundle = composeFabricBundle(
      // No size pointed at at all - the swatch brings its own, which is the whole
      // point of the field. 200cm real / (100 units * 1 density * 20cm swatch) = 0.1.
      config({ slots: [slot({ colourOptionId: attributeColourId(ATTR_FINISH), sizeAttributeId: '', sizeManual: '' })] }),
      MODEL_WITH_OBJ,
      100,
      selected(),
      [
        { attributeId: ATTR_HEIGHT, label: '200cm' },
        { attributeId: ATTR_FINISH, label: 'Oak', swatch: CRAB_URL, swatchSize: '20cm' },
      ],
    )
    expect(bundle?.slots).toEqual([
      { materialName: 'Fabric seat', textureUrl: CRAB_URL, colour: null, repeat: 0.1, rotationDeg: 0, gloss: 0, autoScale: null },
    ])
  })

  it('prefers the swatch own size over a size the config still points at', () => {
    const bundle = composeFabricBundle(
      // A config saved before swatches carried sizes: its hand-typed 40cm is ignored
      // now the material itself says 20cm, so one edit on the attributes screen is
      // the whole job. 200 / (100 * 1 * 20) = 0.1, not the 0.05 the 40cm would give.
      config({
        slots: [slot({ colourOptionId: attributeColourId(ATTR_FINISH), sizeAttributeId: MANUAL_SIZE_ID, sizeManual: '40cm' })],
      }),
      MODEL_WITH_OBJ,
      100,
      selected(),
      [
        { attributeId: ATTR_HEIGHT, label: '200cm' },
        { attributeId: ATTR_FINISH, label: 'Oak', swatch: CRAB_URL, swatchSize: '20cm' },
      ],
    )
    expect(bundle?.slots[0]?.repeat).toBe(0.1)
  })

  it('leaves the tiling uncalibrated when the swatch has no size and the config names none', () => {
    const bundle = composeFabricBundle(
      config({ slots: [slot({ colourOptionId: attributeColourId(ATTR_FINISH), sizeAttributeId: '', sizeManual: '' })] }),
      MODEL_WITH_OBJ,
      100,
      selected(),
      [
        { attributeId: ATTR_HEIGHT, label: '200cm' },
        // A picture swatch whose real-world size was never filled in: the colour is
        // still right, only the scale is neutral until somebody says how big it is.
        { attributeId: ATTR_FINISH, label: 'Oak', swatch: CRAB_URL },
      ],
    )
    expect(bundle?.slots).toEqual([
      { materialName: 'Fabric seat', textureUrl: CRAB_URL, colour: null, repeat: 1, rotationDeg: 0, gloss: 0, autoScale: null },
    ])
  })

  it('hands the viewer the terms to measure a model the config was never told the size of', () => {
    // modelUnits 0 is a model attached since the last Detect+Save. The Eclipse chair
    // shipped exactly this: four of its five models measured, the folding-arms one
    // not, so that one variation alone drew its weave at a fraction of true size with
    // nothing anywhere to say why. The size facts are both here, so the only missing
    // half is the one the viewer can read off the file itself.
    const bundle = composeFabricBundle(
      config({ slots: [slot({ colourOptionId: attributeColourId(ATTR_FINISH), sizeAttributeId: MANUAL_SIZE_ID, sizeManual: '20cm' })] }),
      MODEL_WITH_OBJ,
      0,
      selected(),
      [
        { attributeId: ATTR_HEIGHT, label: '200cm' },
        { attributeId: ATTR_FINISH, label: 'Oak', swatch: CRAB_URL },
      ],
    )
    expect(bundle?.slots).toEqual([
      {
        materialName: 'Fabric seat',
        textureUrl: CRAB_URL,
        colour: null,
        // Still 1 from the resolver, which cannot do better - but no longer the last
        // word, because autoScale tells the viewer to work it out from the mesh.
        repeat: 1,
        rotationDeg: 0,
        gloss: 0,
        autoScale: { realCm: 200, scaleAxis: 'height', swatchCm: 20 },
      },
    ])
  })

  it('scales an OPTION-painted part from the swatch size recorded against the same picture', () => {
    // The shop's finishes live in variation options, and the size lives on the
    // attribute value showing the same photograph - the arrangement on the live
    // Deskwell chair, whose config predates attributes being a colour source at all.
    // 200cm / (100 units * 1 density * 20cm) = 0.1.
    const bundle = composeFabricBundle(
      config({ slots: [slot({ colourOptionId: OPT_SEAT_COLOUR, sizeAttributeId: '', sizeManual: '' })] }),
      MODEL_WITH_OBJ,
      100,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [{ attributeId: ATTR_HEIGHT, label: '200cm' }],
      { [CRAB_URL]: '20x20cm' },
    )
    expect(bundle?.slots).toEqual([
      { materialName: 'Fabric seat', textureUrl: CRAB_URL, colour: null, repeat: 0.1, rotationDeg: 0, gloss: 0, autoScale: null },
    ])
  })

  it('scales each part by its own picture, not one size for the whole product', () => {
    // The same chair in two fabrics whose swatches are photographed at different real
    // sizes - 10cm on the seat, 20cm on the back. A per-product size cannot express
    // this; a per-picture one falls out of it.
    const bundle = composeFabricBundle(
      config({
        slots: [
          slot({ materialName: 'Fabric seat', colourOptionId: OPT_SEAT_COLOUR, sizeAttributeId: '', sizeManual: '' }),
          slot({ materialName: 'Fabric back', colourOptionId: OPT_BACK_COLOUR, sizeAttributeId: '', sizeManual: '' }),
        ],
      }),
      MODEL_WITH_OBJ,
      100,
      selected(
        { optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL },
        { optionId: OPT_BACK_COLOUR, valueId: VAL_TEAL, swatch: TEAL_URL },
      ),
      [{ attributeId: ATTR_HEIGHT, label: '200cm' }],
      { [CRAB_URL]: '10x10cm', [TEAL_URL]: '20x20cm' },
    )
    expect(bundle?.slots.map((s) => s.repeat)).toEqual([0.2, 0.1])
  })

  it('prefers the attribute value own size over the by-picture lookup', () => {
    // Both roads available and disagreeing: the value the part was actually painted
    // from is the more specific fact, so it wins. 200 / (100 * 1 * 20) = 0.1.
    const bundle = composeFabricBundle(
      config({ slots: [slot({ colourOptionId: attributeColourId(ATTR_FINISH), sizeAttributeId: '', sizeManual: '' })] }),
      MODEL_WITH_OBJ,
      100,
      selected(),
      [
        { attributeId: ATTR_HEIGHT, label: '200cm' },
        { attributeId: ATTR_FINISH, label: 'Oak', swatch: CRAB_URL, swatchSize: '20cm' },
      ],
      { [CRAB_URL]: '40cm' },
    )
    expect(bundle?.slots[0]?.repeat).toBe(0.1)
  })

  it('leaves an attribute-painted part alone when this variation carries no value for it', () => {
    const bundle = composeFabricBundle(
      config({ slots: [slot({ colourOptionId: attributeColourId(ATTR_FINISH) })] }),
      MODEL_WITH_OBJ,
      100,
      selected(),
      // The height is set, the finish is not - so there is no swatch to paint with.
      [{ attributeId: ATTR_HEIGHT, label: '200cm' }],
    )
    expect(bundle?.slots).toEqual([])
  })

  it('does not read an attribute id as an option id, or the other way round', () => {
    // The same raw id in both tables must not cross over: a slot pointing at the
    // ATTRIBUTE must ignore an option value that happens to share its id.
    const bundle = composeFabricBundle(
      config({ slots: [slot({ colourOptionId: attributeColourId(OPT_SEAT_COLOUR) })] }),
      MODEL_WITH_OBJ,
      100,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [{ attributeId: ATTR_HEIGHT, label: '200cm' }],
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
      { materialName: 'Frame', textureUrl: '', colour: '#7a5c3a', repeat: 1, rotationDeg: 0, gloss: 0, autoScale: null },
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

  // A product may use one attribute more than once, each helping under a name of its
  // own, and a variation's value is ticked under one helping in particular. A config
  // that points at a HELPING must read that helping's value and no other - matching
  // on the attribute alone would take whichever row came back first.
  it('reads the helping a part points at, not the other helping of the same attribute', () => {
    const bundle = composeFabricBundle(
      config({
        heightAttributeId: ATTR_HEIGHT,
        slots: [
          slot({ materialName: 'Fabric seat', colourOptionId: attributeColourId(HELP_SEAT_FABRIC), sizeAttributeId: HELP_SEAT_FABRIC }),
          slot({ materialName: 'Fabric back', colourOptionId: attributeColourId(HELP_BACK_FABRIC), sizeAttributeId: HELP_BACK_FABRIC }),
        ],
      }),
      MODEL_WITH_OBJ,
      100,
      selected(),
      [
        { attributeId: ATTR_HEIGHT, assignmentId: null, label: '200cm' },
        { attributeId: ATTR_FABRIC, assignmentId: HELP_SEAT_FABRIC, label: '20x20cm', swatch: CRAB_URL },
        { attributeId: ATTR_FABRIC, assignmentId: HELP_BACK_FABRIC, label: '10x10cm', swatch: TEAL_URL },
      ],
    )
    expect(bundle?.slots).toEqual([
      { materialName: 'Fabric seat', textureUrl: CRAB_URL, colour: null, repeat: 0.1, rotationDeg: 0, gloss: 0, autoScale: null },
      { materialName: 'Fabric back', textureUrl: TEAL_URL, colour: null, repeat: 0.2, rotationDeg: 0, gloss: 0, autoScale: null },
    ])
  })

  it('reads a helping for the overall height too', () => {
    const bundle = composeFabricBundle(
      config({ heightAttributeId: HELP_BACK_FABRIC, slots: [slot({ sizeAttributeId: MANUAL_SIZE_ID, sizeManual: '20cm' })] }),
      MODEL_WITH_OBJ,
      100,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [
        { attributeId: ATTR_FABRIC, assignmentId: HELP_SEAT_FABRIC, label: '100cm' },
        { attributeId: ATTR_FABRIC, assignmentId: HELP_BACK_FABRIC, label: '200cm' },
      ],
    )
    // 200 / (100 * 1 * 20) = 0.1 - the second helping's height, not the first's.
    expect(bundle?.slots[0]?.repeat).toBeCloseTo(0.1)
  })

  // The unambiguous case keeps storing the bare attribute id, and every config saved
  // before helpings existed holds one, so a bare id must still match a value that now
  // arrives stamped with its helping.
  it('still resolves a config that names the attribute rather than a helping', () => {
    const bundle = composeFabricBundle(
      config({ slots: [slot({ sizeAttributeId: ATTR_SEAT_SIZE })] }),
      MODEL_WITH_OBJ,
      100,
      selected({ optionId: OPT_SEAT_COLOUR, valueId: VAL_CRAB, swatch: CRAB_URL }),
      [
        { attributeId: ATTR_HEIGHT, assignmentId: 'help-height', label: '200cm' },
        { attributeId: ATTR_SEAT_SIZE, assignmentId: 'help-seat-size', label: '20x20cm' },
      ],
    )
    expect(bundle?.slots[0]?.repeat).toBeCloseTo(0.1)
  })

  // A product-level helping - a leg finish that never changes across the range, an
  // overall height that is the same on every variation - is ticked once on the parent
  // product rather than per variant, so the resolver hands those values over beside the
  // variation's own (see resolveFabricForChild). A part pointed at one has to paint from
  // it; before the parent was read at all, the slot was dropped from the bundle entirely
  // and the legs on Deskwell's Oslo desks rendered unpainted.
  it('paints from a product-level value the variation does not carry itself', () => {
    const bundle = composeFabricBundle(
      config({
        heightAttributeId: ATTR_HEIGHT,
        slots: [slot({ materialName: 'Legs', colourOptionId: attributeColourId(ATTR_FINISH) })],
      }),
      MODEL_WITH_OBJ,
      100,
      selected(),
      // Both inherited from the parent: this variation has no attribute values of its own.
      [
        { attributeId: ATTR_HEIGHT, assignmentId: 'help-height', label: '200cm' },
        { attributeId: ATTR_FINISH, assignmentId: 'help-leg-finish', label: 'Natural Wood', swatch: CRAB_URL, swatchSize: '10x10cm' },
      ],
    )
    // 200 / (100 * 1 * 10) = 0.2 - painted AND scaled off the product-level values.
    expect(bundle?.slots).toEqual([
      { materialName: 'Legs', textureUrl: CRAB_URL, colour: null, repeat: 0.2, rotationDeg: 0, gloss: 0, autoScale: null },
    ])
  })

  // The ordering the resolver relies on: it lists the variation's own values first and
  // the parent's after, and every lookup here takes the first match. A variation that
  // overrides a product-level finish must show its own, not the parent's.
  it('prefers the variation own value over the product-level one for the same attribute', () => {
    const bundle = composeFabricBundle(
      config({
        heightAttributeId: ATTR_HEIGHT,
        slots: [slot({ materialName: 'Legs', colourOptionId: attributeColourId(ATTR_FINISH) })],
      }),
      MODEL_WITH_OBJ,
      100,
      selected(),
      [
        { attributeId: ATTR_FINISH, assignmentId: 'help-leg-finish', label: 'Teal', swatch: TEAL_URL, swatchSize: '10x10cm' },
        { attributeId: ATTR_HEIGHT, assignmentId: 'help-height', label: '200cm' },
        { attributeId: ATTR_FINISH, assignmentId: 'help-leg-finish', label: 'Natural Wood', swatch: CRAB_URL, swatchSize: '10x10cm' },
      ],
    )
    expect(bundle?.slots[0]?.textureUrl).toBe(TEAL_URL)
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
