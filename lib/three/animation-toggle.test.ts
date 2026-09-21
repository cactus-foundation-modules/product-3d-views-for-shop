import { describe, it, expect } from 'vitest'
import { AnimationClip, AnimationMixer, Group, LoopOnce, Object3D, VectorKeyframeTrack } from 'three'
import { createAnimationToggle, type AnimationToggle } from '@/modules/product-3d-views-for-shop/lib/three/animation-toggle'

// Driven against a REAL three mixer rather than a stand-in, because everything that
// can go wrong here is three's own behaviour rather than ours: whether an action
// holds its last frame or snaps back, whether a negative timeScale walks it home or
// runs it off the end, and whether a paused action still writes a pose. A fake mixer
// would agree with whatever we believed on the day we wrote it.

const DURATION = 1.2

/** A model with one animated node, standing in for the cupboard's door pivots. */
function animatedModel(clipName = 'DoorsOpen'): { root: Object3D; pivot: Object3D; clip: AnimationClip } {
  const root = new Group()
  const pivot = new Object3D()
  pivot.name = 'door pivot'
  root.add(pivot)
  // Position rather than rotation purely so the assertions read as a number line.
  // The mixer does not care which property a track drives.
  const track = new VectorKeyframeTrack(`${pivot.name}.position`, [0, DURATION], [0, 0, 0, 0, 1, 0])
  return { root, pivot, clip: new AnimationClip(clipName, DURATION, [track]) }
}

function toggleFor(clipName?: string): { toggle: AnimationToggle; pivot: Object3D } {
  const { root, pivot, clip } = animatedModel(clipName)
  const toggle = createAnimationToggle({ mixer: new AnimationMixer(root), clips: [clip], loopOnce: LoopOnce })
  return { toggle, pivot }
}

/** Tick at a steady 60fps until the toggle says nothing more is moving. */
function runToRest(toggle: AnimationToggle, frames = 300): number {
  let ticked = 0
  while (ticked < frames && toggle.update(1 / 60)) ticked++
  return ticked
}

describe('the 3D viewer animation toggle', () => {
  it('sits perfectly still until it is pressed', () => {
    const { toggle, pivot } = toggleFor()
    // The whole "no extra render work on an animated model nobody has touched"
    // promise is this returning false: the render loop draws only when asked.
    expect(toggle.update(1 / 60)).toBe(false)
    expect(toggle.isOpen()).toBe(false)
    expect(pivot.position.y).toBe(0)
  })

  it('plays forward on the first press and STAYS at the end pose', () => {
    const { toggle, pivot } = toggleFor()
    expect(toggle.press(false)).toBe(true)
    runToRest(toggle)
    expect(pivot.position.y).toBeCloseTo(1, 5)
    // Held, not snapped back - the difference clampWhenFinished makes, and the
    // difference between a cupboard that opens and one that flickers.
    expect(toggle.update(1 / 60)).toBe(false)
    expect(pivot.position.y).toBeCloseTo(1, 5)
    expect(toggle.isOpen()).toBe(true)
  })

  it('runs the same clip backwards on the second press', () => {
    const { toggle, pivot } = toggleFor()
    toggle.press(false)
    runToRest(toggle)
    expect(toggle.press(false)).toBe(false)
    runToRest(toggle)
    expect(pivot.position.y).toBeCloseTo(0, 5)
    expect(toggle.isOpen()).toBe(false)
  })

  it('reverses from wherever the model stands rather than jumping', () => {
    const { toggle, pivot } = toggleFor()
    toggle.press(false)
    // Half the travel, near enough - far enough in that a jump would be obvious.
    toggle.update(DURATION / 2)
    const midway = pivot.position.y
    expect(midway).toBeGreaterThan(0.3)
    expect(midway).toBeLessThan(0.7)

    toggle.press(false)
    // One frame later it must be BEHIND where it was, not snapped to either end.
    toggle.update(1 / 60)
    expect(pivot.position.y).toBeLessThan(midway)
    expect(pivot.position.y).toBeGreaterThan(0)

    runToRest(toggle)
    expect(pivot.position.y).toBeCloseTo(0, 5)
  })

  it('survives a shopper mashing the button, and ends where the last press asked', () => {
    const { toggle, pivot } = toggleFor()
    let intent = false
    for (let press = 0; press < 7; press++) {
      intent = toggle.press(false)
      // A couple of frames between presses, so each one lands mid-travel.
      toggle.update(1 / 60)
      toggle.update(1 / 60)
    }
    // The label reads off this, so it has to agree with where the model is headed.
    expect(toggle.isOpen()).toBe(intent)
    runToRest(toggle)
    expect(pivot.position.y).toBeCloseTo(intent ? 1 : 0, 5)
  })

  it('jumps straight to the end pose when motion is not wanted', () => {
    const { toggle, pivot } = toggleFor()
    expect(toggle.press(true)).toBe(true)
    // No ticking at all: the pose is already written.
    expect(pivot.position.y).toBeCloseTo(1, 5)
    expect(toggle.update(1 / 60)).toBe(false)

    expect(toggle.press(true)).toBe(false)
    expect(pivot.position.y).toBeCloseTo(0, 5)
    expect(toggle.update(1 / 60)).toBe(false)
  })

  it('animates normally again after a jump, in either direction', () => {
    const { toggle, pivot } = toggleFor()
    toggle.press(true)
    expect(pivot.position.y).toBeCloseTo(1, 5)
    // Closing the long way round from a pose it teleported into: the action's own
    // `time` has to be believed, or this walks off the end of the clip.
    toggle.press(false)
    toggle.update(DURATION / 2)
    expect(pivot.position.y).toBeGreaterThan(0.3)
    expect(pivot.position.y).toBeLessThan(0.7)
    runToRest(toggle)
    expect(pivot.position.y).toBeCloseTo(0, 5)
  })

  it('can be asked how big the model gets, without the shopper seeing it get there', () => {
    // The viewer reads this at build time to work out how far back the camera has
    // to be allowed to go: an open cupboard needs more room than a shut one, and
    // the owner's zoom limit was set against the shut one.
    const { toggle, pivot } = toggleFor()
    const measured = toggle.sampleOpenPose(() => pivot.position.y)

    expect(measured).toBeCloseTo(1, 5)
    // Put straight back, so the model on screen has not moved and the control
    // still offers to open it.
    expect(pivot.position.y).toBeCloseTo(0, 5)
    expect(toggle.isOpen()).toBe(false)
    expect(toggle.update(1 / 60)).toBe(false)
  })

  it('puts the model back even when the measurement throws', () => {
    const { toggle, pivot } = toggleFor()
    expect(() => toggle.sampleOpenPose(() => { throw new Error('no bounding box') })).toThrow('no bounding box')
    // Otherwise the model sits open behind a button offering to open it.
    expect(pivot.position.y).toBeCloseTo(0, 5)
    expect(toggle.isOpen()).toBe(false)
  })

  it('samples the end pose from an already-open model without shutting it', () => {
    const { toggle, pivot } = toggleFor()
    toggle.press(false)
    runToRest(toggle)

    expect(toggle.sampleOpenPose(() => pivot.position.y)).toBeCloseTo(1, 5)
    expect(pivot.position.y).toBeCloseTo(1, 5)
    expect(toggle.isOpen()).toBe(true)
  })

  it('names itself after the file’s own clip', () => {
    expect(toggleFor('DoorsOpen').toggle.clipName).toBe('DoorsOpen')
    expect(toggleFor('ColumnUp').toggle.clipName).toBe('ColumnUp')
  })

  it('drives every clip in a file together', () => {
    // A model authored with one clip per moving part still opens as one product.
    const root = new Group()
    const parts = ['left door pivot', 'right door pivot'].map((name) => {
      const node = new Object3D()
      node.name = name
      root.add(node)
      return node
    })
    const clips = parts.map((node, i) => new AnimationClip(
      `Part${i}`,
      DURATION,
      [new VectorKeyframeTrack(`${node.name}.position`, [0, DURATION], [0, 0, 0, 0, 1, 0])],
    ))
    const toggle = createAnimationToggle({ mixer: new AnimationMixer(root), clips, loopOnce: LoopOnce })

    toggle.press(false)
    runToRest(toggle)
    for (const node of parts) expect(node.position.y).toBeCloseTo(1, 5)
  })
})
