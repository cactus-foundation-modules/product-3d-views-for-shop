// The control behind a model whose parts open one at a time - a drawer per clip, each
// opened by clicking the part itself rather than by a button on the stage.
//
// The sibling of animation-toggle.ts, and built on the same "one clip, both ways"
// rule: every clip is LoopOnce + clampWhenFinished, forwards opens, timeScale -1
// closes, and a reversal picks the part up wherever it stands. What this adds is
// that each clip has its OWN direction, and that clips can be made mutually
// exclusive: opening one drawer sends every other open drawer in its group home, and
// the new one WAITS until that drawer has finished closing before it opens, so the
// two never travel together (reduced motion skips the wait).
//
// The file decides all of it. A node whose glTF extras read
//   { "p3dClip": "Drawer1Open", "p3dGroup": "drawers" }
// is the click target for that clip; clips whose targets share a p3dGroup are
// exclusive; a target with no group toggles on its own. GLTFLoader copies node
// extras to Object3D.userData, and Object3D.clone() deep-copies userData, so the
// markers survive the loader's cache clone untouched. Nothing here knows what a
// drawer is, or which product this is.
//
// three is passed in rather than imported, for the same chunk-size reason as the
// toggle: everything 3D in this module is behind a dynamic import.

import type { AnimationActionLoopStyles, AnimationClip, AnimationMixer, Object3D } from 'three'

/** One clip the file carries, and what the file says about it. */
export type ClipInfo = {
  name: string
  /** The exclusive group its click target names, or null to toggle on its own. */
  group: string | null
  /** Whether some node in the file is this clip's click target. */
  clickable: boolean
  /**
   * The file's own drawer number for the node this clip moves (1 = top), when the
   * file marks one with `extras.p3dDrawer`. Labelling only.
   */
  drawer: number | null
}

export type ClipSet = {
  clips: ClipInfo[]
  /** How many nodes in the file carry a drawer number - so 1 of 3 can read "top" and 3 of 3 "bottom". */
  drawerCount: number
  /** Where a clip is HEADING: true from the press that opens it (even while it waits its turn), not from the frame it finishes on. */
  isOpen: (clip: string) => boolean
  /**
   * Flip one clip's direction from wherever it stands. Opening it also closes every
   * other open clip in its group; it then waits as the group's one pending clip and
   * starts opening when the last of them is home. Pressing the pending clip again
   * cancels it; pressing another replaces it; pressing the drawer still closing
   * re-opens that one and drops the pending clip. Returns the new intent.
   *
   * @param instant land on the end poses without travelling (reduced motion)
   */
  press: (clip: string, instant: boolean) => boolean
  /** Advance by a real elapsed delta in seconds; true when the picture changed. */
  update: (delta: number) => boolean
  /**
   * Put the model in the pose with ONLY `clip` open (or, given several names, only
   * those), hand it to `measure`, and put every clip back exactly where it was -
   * within one call, nothing drawn between. Build time only, while nothing is in flight.
   */
  sampleOpenPose: <T>(clip: string | string[], measure: () => T) => T
}

const CLIP_KEY = 'p3dClip'
const GROUP_KEY = 'p3dGroup'
const DRAWER_KEY = 'p3dDrawer'

type Marked = { userData: Record<string, unknown> }

function clipMarker(node: Marked): string | null {
  const value = node.userData?.[CLIP_KEY]
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Whether the file opts into click-to-open at all: any node carrying a clip marker.
 * A file with clips and no markers (a cupboard's single DoorsOpen) is not one, and
 * keeps its single button.
 */
export function hasClickTargets(root: Object3D): boolean {
  let found = false
  root.traverse((node) => { if (!found && clipMarker(node)) found = true })
  return found
}

/**
 * The clip a pointer hit belongs to, or null. Walks UP from the mesh that was hit to
 * the first ancestor carrying a clip marker, stopping at `root`: meshopt
 * quantisation can hang the real geometry on an unnamed child of the marked node,
 * so checking the hit object alone would miss.
 */
export function clipForHit(hit: Object3D | null, root: Object3D): string | null {
  for (let node: Object3D | null = hit; node; node = node.parent) {
    const clip = clipMarker(node)
    if (clip) return clip
    if (node === root) break
  }
  return null
}

function drawerNumber(node: Object3D | null | undefined): number | null {
  const value = node?.userData?.[DRAWER_KEY]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The drawer number of whichever node the clip drives carries one. A clip can move
 * several nodes (a drawer and the runner rails that travel half as far with it), in
 * any track order, so every track is checked rather than the first. Track names are
 * `<node>.<property>`, and three strips dots out of node names.
 */
function clipDrawerNumber(clip: AnimationClip, root: Object3D): number | null {
  for (const track of clip.tracks) {
    const name = track.name.slice(0, track.name.indexOf('.'))
    const drawer = name ? drawerNumber(root.getObjectByName(name)) : null
    if (drawer !== null) return drawer
  }
  return null
}

/** Read what the file says about each of its clips. Pure, no mixer: split out so it can be tested and reasoned about alone. */
export function describeClips(root: Object3D, clips: AnimationClip[]): { clips: ClipInfo[]; drawerCount: number } {
  const targets = new Map<string, string | null>()
  let drawerCount = 0
  root.traverse((node) => {
    const clip = clipMarker(node)
    if (clip && !targets.has(clip)) {
      const group = node.userData[GROUP_KEY]
      targets.set(clip, typeof group === 'string' && group !== '' ? group : null)
    }
    if (drawerNumber(node) !== null) drawerCount++
  })
  return {
    drawerCount,
    clips: clips.map((clip) => ({
      name: clip.name,
      group: targets.get(clip.name) ?? null,
      clickable: targets.has(clip.name),
      drawer: clipDrawerNumber(clip, root),
    })),
  }
}

/**
 * The widest poses a shopper can actually reach, as lists of clip names to hold open
 * together: every ungrouped clip (a pair of doors can both stand open) plus ONE clip
 * from each exclusive group (a cabinet only ever has one drawer out). The zoom ceiling
 * is measured on these, so it leaves room for both doors without also pretending that
 * every drawer is out at once. Several groups multiply out, capped so a pathological
 * file cannot make the build-time measuring slow.
 */
export function reachablePoses(clips: ClipInfo[]): string[][] {
  const free = clips.filter((c) => c.group === null).map((c) => c.name)
  const groups = new Map<string, string[]>()
  for (const c of clips) if (c.group !== null) groups.set(c.group, [...(groups.get(c.group) ?? []), c.name])
  let poses: string[][] = [free]
  for (const members of groups.values()) {
    const next = poses.flatMap((pose) => members.map((m) => [...pose, m]))
    if (next.length > 64) break
    poses = next
  }
  return poses.filter((pose) => pose.length > 0)
}

export type ClipSetDeps = {
  mixer: AnimationMixer
  root: Object3D
  clips: AnimationClip[]
  /** three's LoopOnce constant. */
  loopOnce: AnimationActionLoopStyles
}

export function createClipSet({ mixer, root, clips, loopOnce }: ClipSetDeps): ClipSet {
  const described = describeClips(root, clips)
  const info = new Map(described.clips.map((c) => [c.name, c]))

  const actions = new Map(clips.map((clip) => {
    const action = mixer.clipAction(clip)
    action.loop = loopOnce
    // Hold the last frame rather than blinking back to the rest pose.
    action.clampWhenFinished = true
    // Played to register it with the mixer, then held still until pressed.
    action.play()
    action.paused = true
    return [clip.name, action] as const
  }))

  const open = new Map(clips.map((clip) => [clip.name, false]))
  // At most one queued opener per group: group -> clip waiting for the others to close.
  const pending = new Map<string, string>()
  const isPending = (name: string): boolean => {
    for (const queued of pending.values()) if (queued === name) return true
    return false
  }
  // Open, or still travelling either way. A closed clip is paused (clampWhenFinished
  // pauses it on reaching time 0), so `paused` is the robust "has it landed" test.
  const busy = (name: string): boolean => open.get(name) === true || actions.get(name)?.paused === false
  const othersBusy = (group: string, except: string): boolean =>
    described.clips.some((c) => c.group === group && c.name !== except && busy(c.name))

  // Send one clip a given way. Travelling: unpause and point the timeScale. Instant:
  // park it at that end; the caller applies the pose with a zero-length mixer tick.
  const steer = (name: string, toOpen: boolean, instant: boolean): void => {
    const action = actions.get(name)
    if (!action) return
    open.set(name, toOpen)
    if (instant) {
      action.paused = true
      action.time = toOpen ? action.getClip().duration : 0
      return
    }
    action.enabled = true
    action.paused = false
    action.timeScale = toOpen ? 1 : -1
  }

  return {
    clips: described.clips,
    drawerCount: described.drawerCount,
    isOpen: (name) => open.get(name) === true || isPending(name),

    press: (name, instant) => {
      if (!actions.has(name)) return false
      const group = info.get(name)?.group ?? null

      if (group === null) {
        const next = !open.get(name)
        steer(name, next, instant)
        if (instant) mixer.update(0)
        return next
      }

      if (instant) {
        // Reduced motion: no waiting. Close the others, open this one, all at once.
        pending.delete(group)
        const next = !open.get(name)
        if (next) {
          for (const other of described.clips) {
            if (other.name !== name && other.group === group && busy(other.name)) steer(other.name, false, true)
          }
        }
        steer(name, next, true)
        mixer.update(0)
        return next
      }

      // Pressing the queued clip again cancels it.
      if (pending.get(group) === name) {
        pending.delete(group)
        return false
      }
      // Open or opening: close it (from wherever it stands).
      if (open.get(name)) {
        steer(name, false, false)
        return false
      }
      // Closed, maybe still closing. Close any open sibling, then open now if the
      // group is clear, else queue behind whatever is still travelling home.
      for (const other of described.clips) {
        if (other.name !== name && other.group === group && open.get(other.name)) steer(other.name, false, false)
      }
      if (!othersBusy(group, name)) {
        pending.delete(group)
        steer(name, true, false)
        return true
      }
      pending.set(group, name)
      return true
    },

    update: (delta) => {
      // ONE mixer tick for every clip: ticking per clip would run the mixer once per
      // drawer per frame and send them all at several times their authored speed.
      let moving = pending.size > 0
      for (const action of actions.values()) if (!action.paused) { moving = true; break }
      if (!moving) return false
      mixer.update(delta)
      // Once the last sibling has landed, the queued clip starts. Checked after the
      // tick so a clip that reached time 0 this frame releases it this frame.
      for (const [group, queued] of [...pending]) {
        if (!othersBusy(group, queued)) {
          pending.delete(group)
          steer(queued, true, false)
        }
      }
      return true
    },

    sampleOpenPose: (name, measure) => {
      const savedPending = new Map(pending)
      const wanted = new Set(typeof name === 'string' ? [name] : name)
      const saved = [...actions].map(([clip, action]) => ({ action, time: action.time, paused: action.paused, open: wanted.has(clip) }))
      for (const s of saved) {
        s.action.paused = true
        s.action.time = s.open ? s.action.getClip().duration : 0
      }
      mixer.update(0)
      try {
        return measure()
      } finally {
        // Restored in a finally so a measurement that throws cannot leave a drawer
        // standing open that no control believes is open.
        for (const s of saved) {
          s.action.paused = true
          s.action.time = s.time
        }
        mixer.update(0)
        for (const s of saved) s.action.paused = s.paused
        pending.clear()
        for (const [group, queued] of savedPending) pending.set(group, queued)
      }
    },
  }
}
