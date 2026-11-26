// The control behind a model whose parts open one at a time - a drawer per clip, each
// opened by clicking the part itself rather than by a button on the stage.
//
// The sibling of animation-toggle.ts, and built on the same "one clip, both ways"
// rule: every clip is LoopOnce + clampWhenFinished, forwards opens, timeScale -1
// closes, and a reversal picks the part up wherever it stands. What this adds is
// that each clip has its OWN direction, and that clips can be made mutually
// exclusive: opening one drawer sends every other open drawer in its group home at
// the same moment, so the two travel together.
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
  /** Where a clip is HEADING: true from the press that opens it, not from the frame it finishes on. */
  isOpen: (clip: string) => boolean
  /**
   * Flip one clip's direction from wherever it stands. Opening it also closes every
   * other open clip in its group, simultaneously. Returns the new intent.
   *
   * @param instant land on the end poses without travelling (reduced motion)
   */
  press: (clip: string, instant: boolean) => boolean
  /** Advance by a real elapsed delta in seconds; true when the picture changed. */
  update: (delta: number) => boolean
  /**
   * Put the model in the pose with ONLY `clip` open, hand it to `measure`, and put
   * every clip back exactly where it was - within one call, nothing drawn between.
   * Build time only, while nothing is in flight.
   */
  sampleOpenPose: <T>(clip: string, measure: () => T) => T
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

/** The node a clip's tracks drive. Track names are `<node>.<property>`, and three strips dots out of node names. */
function animatedNode(clip: AnimationClip, root: Object3D): Object3D | null {
  for (const track of clip.tracks) {
    const name = track.name.slice(0, track.name.indexOf('.'))
    const node = name ? root.getObjectByName(name) : undefined
    if (node) return node
  }
  return null
}

function drawerNumber(node: Object3D | null): number | null {
  const value = node?.userData?.[DRAWER_KEY]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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
      drawer: drawerNumber(animatedNode(clip, root)),
    })),
  }
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
    isOpen: (name) => open.get(name) === true,

    press: (name, instant) => {
      if (!actions.has(name)) return false
      const next = !open.get(name)
      const group = info.get(name)?.group ?? null
      // Only OPENING closes the others. Closing the open drawer leaves its siblings
      // alone - they are already shut, or (mid-mash) already on their way home.
      if (next && group !== null) {
        for (const other of described.clips) {
          if (other.name !== name && other.group === group && open.get(other.name)) {
            steer(other.name, false, instant)
          }
        }
      }
      steer(name, next, instant)
      // A paused action reads its own `time`, so a zero tick writes the instant
      // poses and moves nothing that is travelling.
      if (instant) mixer.update(0)
      return next
    },

    update: (delta) => {
      // ONE mixer tick for every clip: ticking per clip would run the mixer once per
      // drawer per frame and send them all at several times their authored speed.
      let moving = false
      for (const action of actions.values()) if (!action.paused) { moving = true; break }
      if (!moving) return false
      mixer.update(delta)
      return true
    },

    sampleOpenPose: (name, measure) => {
      const saved = [...actions].map(([clip, action]) => ({ action, time: action.time, paused: action.paused, open: clip === name }))
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
      }
    },
  }
}
