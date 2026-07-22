import { describe, it, expect } from 'vitest'
import { composeFabricBundle, measuredUnitsFor, parseSwatchCm, tileRepeat } from '@/modules/product-3d-views-for-shop/lib/fabric/resolve'
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
      { materialName: 'Fabric seat', textureUrl: '', colour: '#ff0000', repeat: 1, rotationDeg: 0 },
    ])
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
      { materialName: 'Fabric seat', textureUrl: CRAB_URL, colour: null, repeat: 0.1, rotationDeg: 0 },
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
      { materialName: 'Fabric seat', textureUrl: CRAB_URL, colour: null, repeat: 0.1, rotationDeg: 0 },
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
      { materialName: 'Fabric seat', textureUrl: CRAB_URL, colour: null, repeat: 1, rotationDeg: 0 },
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
      { materialName: 'Fabric seat', textureUrl: CRAB_URL, colour: null, repeat: 0.1, rotationDeg: 0 },
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
      { materialName: 'Fabric seat', textureUrl: CRAB_URL, colour: null, repeat: 0.1, rotationDeg: 0 },
      { materialName: 'Fabric back', textureUrl: TEAL_URL, colour: null, repeat: 0.2, rotationDeg: 0 },
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
