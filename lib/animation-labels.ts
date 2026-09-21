// What the 3D viewer's animation control says.
//
// The button's visible text IS its accessible name, so these two lines are what a
// screen reader announces as well as what a shopper reads - which is why they are
// worded as instructions ("Open the doors") rather than as states ("Doors closed").
// Whether the control is currently pressed is carried separately, by aria-pressed.
//
// Kept here, in one table, so a site that ships a model with a different mechanism
// can name it without going anywhere near the viewer: add the clip's name and the
// two lines that describe it. Which entry applies is decided BY THE MODEL, because
// the clip name travels inside the GLB - so a desk with a rising column needs a file
// with a clip called `ColumnUp` and a line in this table, not a release.
const WORDING: Record<string, { open: string; close: string }> = {
  // The obvious first one: a cupboard, a wardrobe, a sideboard. Any file whose clip
  // is called DoorsOpen gets this, whoever authored it and whatever it is on.
  doorsopen: { open: 'Open the doors', close: 'Close the doors' },
}

// The pair for a clip nobody has named yet. Deliberately dull: a fallback that
// guessed "Open the drawer" at a clip which actually raises a desk column would be
// worse than one that admits it only knows there is an animation to play.
const NEUTRAL = { open: 'Play animation', close: 'Reverse animation' }

/**
 * Fold a clip name to its lookup key, so `DoorsOpen`, `Doors Open` and `doors_open`
 * all land on the same entry. Modelling tools disagree about separators and case,
 * and the person naming the clip is working in Blender rather than in this file.
 */
function key(clipName: string): string {
  return clipName.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * The label for the animation control.
 *
 * @param clipName the name of the clip the model carries
 * @param open where the toggle is heading: true once it has been pressed open
 */
export function animationLabel(clipName: string, open: boolean): string {
  const wording = WORDING[key(clipName)] ?? NEUTRAL
  // Offers the way back. Pressed open, the useful thing to say next is "Close".
  return open ? wording.close : wording.open
}
