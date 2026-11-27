import { describe, it, expect } from 'vitest'
import { animationLabel, hoverLabel, partLabel } from '@/modules/product-3d-views-for-shop/lib/animation-labels'

// The button's text is its accessible name, so these strings are what a screen
// reader reads out - which makes "it says the right thing in the right state" an
// accessibility assertion rather than a copy one.

describe('the 3D animation control’s wording', () => {
  it('names the cupboard’s doors', () => {
    expect(animationLabel('DoorsOpen', false)).toBe('Open the doors')
    expect(animationLabel('DoorsOpen', true)).toBe('Close the doors')
  })

  it('reads the clip name whatever the modeller typed', () => {
    // Blender, the exporter and whoever named the clip all disagree about case and
    // separators; a control that fell back to "Play animation" over a stray space
    // would be a bug nobody would think to look for.
    for (const name of ['doorsopen', 'doors open', 'Doors_Open', 'DOORS-OPEN']) {
      expect(animationLabel(name, false)).toBe('Open the doors')
    }
  })

  it('stays neutral about a mechanism it has never been told about', () => {
    expect(animationLabel('ColumnUp', false)).toBe('Play animation')
    expect(animationLabel('ColumnUp', true)).toBe('Reverse animation')
  })

  it('still says something for a clip with no name at all', () => {
    expect(animationLabel('', false)).toBe('Play animation')
    expect(animationLabel('', true)).toBe('Reverse animation')
  })
})

describe('the click-to-open wording', () => {
  it('offers the opposite of where the part is heading on hover', () => {
    expect(hoverLabel(false)).toBe('Open')
    expect(hoverLabel(true)).toBe('Close')
  })

  it('names marked drawers by position, top first', () => {
    const names = (count: number): string[] =>
      Array.from({ length: count }, (_, i) => partLabel({ name: `Drawer${i + 1}Open`, drawer: i + 1 }, count, false))
    expect(names(2)).toEqual(['Open the top drawer', 'Open the bottom drawer'])
    expect(names(3)).toEqual(['Open the top drawer', 'Open the middle drawer', 'Open the bottom drawer'])
    expect(names(4)).toEqual(['Open the top drawer', 'Open the second drawer', 'Open the third drawer', 'Open the bottom drawer'])
    expect(partLabel({ name: 'Drawer1Open', drawer: 1 }, 2, true)).toBe('Close the top drawer')
  })

  it('falls back to the clip name, without guessing a verb it was not given', () => {
    expect(partLabel({ name: 'Drawer1Open', drawer: null }, 0, false)).toBe('Open drawer 1')
    expect(partLabel({ name: 'lid_open', drawer: null }, 0, true)).toBe('Close lid')
    expect(partLabel({ name: 'DoorsOpen', drawer: null }, 0, false)).toBe('Open the doors')
    expect(partLabel({ name: 'ColumnUp', drawer: null }, 0, false)).toBe('Play animation: column up')
  })

  it('names a cupboard\'s two doors separately', () => {
    expect(partLabel({ name: 'LeftDoorOpen', drawer: null }, 0, false)).toBe('Open the left door')
    expect(partLabel({ name: 'LeftDoorOpen', drawer: null }, 0, true)).toBe('Close the left door')
    expect(partLabel({ name: 'RightDoorOpen', drawer: null }, 0, false)).toBe('Open the right door')
  })
})
