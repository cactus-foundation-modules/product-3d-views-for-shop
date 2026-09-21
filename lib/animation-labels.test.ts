import { describe, it, expect } from 'vitest'
import { animationLabel } from '@/modules/product-3d-views-for-shop/lib/animation-labels'

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
