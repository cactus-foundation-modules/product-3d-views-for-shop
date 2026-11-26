import { describe, it, expect } from 'vitest'
import { AnimationClip, AnimationMixer, Group, LoopOnce, Mesh, Object3D, VectorKeyframeTrack } from 'three'
import { clipForHit, createClipSet, describeClips, hasClickTargets, type ClipSet } from '@/modules/product-3d-views-for-shop/lib/three/clip-set'

// Against a real three mixer, for the same reason as animation-toggle.test.ts: what
// can go wrong is three's own behaviour (clamping, reversing, one shared mixer tick),
// and a fake would agree with whatever we believed on the day.

const DURATION = 0.7
const TRAVEL = 0.4

type Cabinet = { root: Object3D; drawers: Object3D[]; handles: Object3D[]; clips: AnimationClip[] }

/** A cabinet laid out the way the click-to-open file contract describes. */
function cabinet(count: number, group: string | null = 'drawers'): Cabinet {
  const root = new Group()
  const drawers: Object3D[] = []
  const handles: Object3D[] = []
  const clips: AnimationClip[] = []
  for (let n = 1; n <= count; n++) {
    const drawer = new Object3D()
    drawer.name = `Drawer${n}`
    drawer.userData = { p3dDrawer: n }
    const handle = new Object3D()
    handle.name = `Drawer${n}Handle`
    handle.userData = group ? { p3dClip: `Drawer${n}Open`, p3dGroup: group } : { p3dClip: `Drawer${n}Open` }
    // The geometry hangs on an unnamed child, as meshopt quantisation can leave it.
    handle.add(new Mesh())
    drawer.add(handle)
    root.add(drawer)
    drawers.push(drawer)
    handles.push(handle)
    clips.push(new AnimationClip(`Drawer${n}Open`, DURATION, [
      new VectorKeyframeTrack(`Drawer${n}.position`, [0, DURATION], [0, 0, 0, 0, 0, TRAVEL]),
    ]))
  }
  return { root, drawers, handles, clips }
}

function setFor(c: Cabinet): ClipSet {
  return createClipSet({ mixer: new AnimationMixer(c.root), root: c.root, clips: c.clips, loopOnce: LoopOnce })
}

function runToRest(set: ClipSet, frames = 300): number {
  let ticked = 0
  while (ticked < frames && set.update(1 / 60)) ticked++
  return ticked
}

const z = (o: Object3D): number => o.position.z

describe('reading the click-to-open markers', () => {
  it('finds the clip from a hit on an unnamed child of the handle', () => {
    const c = cabinet(3)
    expect(clipForHit(c.handles[1]!.children[0]!, c.root)).toBe('Drawer2Open')
    expect(clipForHit(c.drawers[0]!, c.root)).toBeNull()
    expect(clipForHit(null, c.root)).toBeNull()
  })

  it('stops at the model root rather than reading markers above it', () => {
    const c = cabinet(1)
    const outside = new Group()
    outside.userData = { p3dClip: 'NotOurs' }
    outside.add(c.root)
    expect(clipForHit(c.drawers[0]!, c.root)).toBeNull()
  })

  it('knows a marked file from an unmarked one', () => {
    expect(hasClickTargets(cabinet(2).root)).toBe(true)
    const plain = new Group()
    plain.add(new Object3D())
    expect(hasClickTargets(plain)).toBe(false)
  })

  it('reports each clip’s group, target and drawer number', () => {
    const c = cabinet(3)
    const d = describeClips(c.root, c.clips)
    expect(d.drawerCount).toBe(3)
    expect(d.clips).toEqual([
      { name: 'Drawer1Open', group: 'drawers', clickable: true, drawer: 1 },
      { name: 'Drawer2Open', group: 'drawers', clickable: true, drawer: 2 },
      { name: 'Drawer3Open', group: 'drawers', clickable: true, drawer: 3 },
    ])
  })
})

describe('the click-to-open clip set', () => {
  it('sits still until pressed', () => {
    const c = cabinet(2)
    const set = setFor(c)
    expect(set.update(1 / 60)).toBe(false)
    expect(c.drawers.map(z)).toEqual([0, 0])
  })

  it('opens only the pressed drawer, and holds it there', () => {
    const c = cabinet(3)
    const set = setFor(c)
    expect(set.press('Drawer2Open', false)).toBe(true)
    runToRest(set)
    expect(z(c.drawers[0]!)).toBe(0)
    expect(z(c.drawers[1]!)).toBeCloseTo(TRAVEL, 5)
    expect(z(c.drawers[2]!)).toBe(0)
    expect(set.update(1 / 60)).toBe(false)
  })

  it('moves at the authored speed with several clips on one mixer', () => {
    // One mixer tick per frame, not one per clip: per-clip ticks would finish a
    // 0.7s drawer in a fraction of that.
    const c = cabinet(4)
    const set = setFor(c)
    set.press('Drawer1Open', false)
    const frames = runToRest(set)
    expect(frames).toBeGreaterThanOrEqual(Math.floor(DURATION * 60) - 1)
    expect(frames).toBeLessThanOrEqual(Math.ceil(DURATION * 60) + 1)
  })

  it('closes the open drawer when another in its group opens, both moving together', () => {
    const c = cabinet(3)
    const set = setFor(c)
    set.press('Drawer1Open', false)
    runToRest(set)
    set.press('Drawer3Open', false)
    expect(set.isOpen('Drawer1Open')).toBe(false)
    expect(set.isOpen('Drawer3Open')).toBe(true)
    // Halfway: one on its way in, the other on its way out.
    for (let i = 0; i < 21; i++) set.update(1 / 60)
    expect(z(c.drawers[0]!)).toBeGreaterThan(0)
    expect(z(c.drawers[0]!)).toBeLessThan(TRAVEL)
    expect(z(c.drawers[2]!)).toBeGreaterThan(0)
    expect(z(c.drawers[2]!)).toBeLessThan(TRAVEL)
    runToRest(set)
    expect(z(c.drawers[0]!)).toBeCloseTo(0, 5)
    expect(z(c.drawers[2]!)).toBeCloseTo(TRAVEL, 5)
  })

  it('closes the open drawer when it is pressed again', () => {
    const c = cabinet(2)
    const set = setFor(c)
    set.press('Drawer1Open', false)
    runToRest(set)
    expect(set.press('Drawer1Open', false)).toBe(false)
    runToRest(set)
    expect(c.drawers.map(z).map((v) => Math.abs(v) < 1e-6)).toEqual([true, true])
  })

  it('survives mashing: reverses from where it stands, never jumps', () => {
    const c = cabinet(2)
    const set = setFor(c)
    set.press('Drawer1Open', false)
    for (let i = 0; i < 10; i++) set.update(1 / 60)
    const mid = z(c.drawers[0]!)
    set.press('Drawer1Open', false)
    set.update(1 / 60)
    expect(z(c.drawers[0]!)).toBeLessThan(mid)
    expect(z(c.drawers[0]!)).toBeGreaterThan(mid - TRAVEL / 10)
    set.press('Drawer2Open', false)
    set.press('Drawer1Open', false)
    expect(set.isOpen('Drawer2Open')).toBe(false)
    expect(set.isOpen('Drawer1Open')).toBe(true)
    runToRest(set)
    expect(z(c.drawers[0]!)).toBeCloseTo(TRAVEL, 5)
    expect(z(c.drawers[1]!)).toBeCloseTo(0, 5)
  })

  it('lets ungrouped targets open independently', () => {
    const c = cabinet(2, null)
    const set = setFor(c)
    set.press('Drawer1Open', false)
    set.press('Drawer2Open', false)
    runToRest(set)
    expect(z(c.drawers[0]!)).toBeCloseTo(TRAVEL, 5)
    expect(z(c.drawers[1]!)).toBeCloseTo(TRAVEL, 5)
  })

  it('jumps straight to the end poses under reduced motion, auto-close included', () => {
    const c = cabinet(3)
    const set = setFor(c)
    set.press('Drawer1Open', true)
    expect(z(c.drawers[0]!)).toBeCloseTo(TRAVEL, 5)
    expect(set.update(1 / 60)).toBe(false)
    set.press('Drawer2Open', true)
    expect(z(c.drawers[0]!)).toBeCloseTo(0, 5)
    expect(z(c.drawers[1]!)).toBeCloseTo(TRAVEL, 5)
    expect(set.update(1 / 60)).toBe(false)
  })

  it('samples one-open poses and puts everything back as it was', () => {
    const c = cabinet(3)
    const set = setFor(c)
    set.press('Drawer3Open', true)
    const seen = set.sampleOpenPose('Drawer1Open', () => c.drawers.map(z))
    expect(seen[0]).toBeCloseTo(TRAVEL, 5)
    expect(seen[1]).toBeCloseTo(0, 5)
    expect(seen[2]).toBeCloseTo(0, 5)
    expect(z(c.drawers[0]!)).toBeCloseTo(0, 5)
    expect(z(c.drawers[2]!)).toBeCloseTo(TRAVEL, 5)
    expect(set.isOpen('Drawer3Open')).toBe(true)
    expect(set.update(1 / 60)).toBe(false)
  })

  it('restores the pose even when the measurement throws', () => {
    const c = cabinet(2)
    const set = setFor(c)
    expect(() => set.sampleOpenPose('Drawer1Open', () => { throw new Error('boom') })).toThrow('boom')
    expect(z(c.drawers[0]!)).toBeCloseTo(0, 5)
  })

  it('ignores a clip it does not know', () => {
    const set = setFor(cabinet(1))
    expect(set.press('Nope', false)).toBe(false)
    expect(set.isOpen('Nope')).toBe(false)
  })
})
