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
  // A pair of doors that open on their own, each by clicking its handle: one clip a
  // leaf, so each gets its own button. Left and right are the shopper's, facing it.
  leftdooropen: { open: 'Open the left door', close: 'Close the left door' },
  rightdooropen: { open: 'Open the right door', close: 'Close the right door' },
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

// The small tag that follows the mouse over a part that opens when clicked. Short on
// purpose: it sits beside the cursor, and the part under it already says what it is.
const HOVER = { open: 'Open', close: 'Close' }

/**
 * The hover tag beside the cursor over a click-to-open part.
 *
 * @param open where that part's clip is heading: true while open or opening
 */
export function hoverLabel(open: boolean): string {
  return open ? HOVER.close : HOVER.open
}

// Where a numbered drawer sits, for the accessible buttons. Drawer 1 is the top one
// (the file's own convention), so the last one is the bottom.
const ORDINALS = ['second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth']

function drawerName(drawer: number, count: number): string {
  if (count <= 1) return 'the drawer'
  if (drawer === 1) return 'the top drawer'
  if (drawer === count) return 'the bottom drawer'
  if (count === 3 && drawer === 2) return 'the middle drawer'
  const ordinal = ORDINALS[drawer - 2]
  return ordinal ? `the ${ordinal} drawer` : `drawer ${drawer}`
}

/**
 * Split a clip name into words for a label: `Drawer1Open` -> "drawer 1",
 * `lid_open` -> "lid". A trailing "open" is the verb, which the label supplies.
 */
function clipThing(clipName: string): { thing: string; opens: boolean } {
  const words = clipName
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
  // Only a clip that SAYS it opens something gets "Open ..." - the same refusal to
  // guess as NEUTRAL above: a clip called ColumnUp is not opening anything.
  const opens = words.length > 1 && words[words.length - 1] === 'open'
  if (opens) words.pop()
  return { thing: words.join(' '), opens }
}

/**
 * The label for one part's own button, on a model whose parts open one at a time.
 * A file-marked drawer is named by position ("Open the top drawer"); a clip in the
 * wording table above uses that; anything else is named from the clip itself.
 *
 * @param clip the clip's name, and its drawer number and the file's drawer count if marked
 * @param open where the clip is heading
 */
export function partLabel(clip: { name: string; drawer: number | null }, drawerCount: number, open: boolean): string {
  const verb = open ? 'Close' : 'Open'
  if (clip.drawer !== null) return `${verb} ${drawerName(clip.drawer, drawerCount)}`
  const known = WORDING[key(clip.name)]
  if (known) return open ? known.close : known.open
  const { thing, opens } = clipThing(clip.name)
  if (!thing) return animationLabel(clip.name, open)
  if (opens) return `${verb} ${thing}`
  return `${open ? NEUTRAL.close : NEUTRAL.open}: ${thing}`
}
