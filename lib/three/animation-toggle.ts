// The open/close control behind a model that ships its own animation.
//
// The whole design is "one clip, both ways". A GLB that can open carries a single
// forward clip; closing is that clip run backwards, not a second clip somebody had
// to remember to author and name consistently. In three that is an AnimationAction
// with LoopOnce + clampWhenFinished (so it stops on its last frame and STAYS there,
// rather than snapping back to frame one) and timeScale flipped to -1 to come home.
//
// Flipping timeScale is also what makes the control safe to mash. The action keeps
// its own `time`, so a reversal picks the model up wherever it stands and walks it
// back from there - no jump, no queue of pending presses, and no way for the button's
// label to end up describing a model that is doing something else.
//
// Nothing here knows what the clip moves, how far, or what the product is. That is
// deliberate: the control exists because the FILE has a clip in it, so a new animated
// product is a new upload rather than a code change or a per-product setting.
//
// three is passed in rather than imported. Everything 3D in this module is behind a
// dynamic import (a static `import ... from 'three'` anywhere in this file's import
// graph drags ~180 KB into whichever chunk reaches it), and the one constant this
// needs is cheaper to hand over than to reach for.

import type { AnimationActionLoopStyles, AnimationClip, AnimationMixer } from 'three'

export type AnimationToggle = {
  /** The clip that names the control - the first one the file carries. */
  clipName: string
  /** Where the toggle is HEADING: true from the press that opens it, not from the frame it finishes on. */
  isOpen: () => boolean
  /**
   * Flip direction from wherever the model currently stands, and report the new
   * intent so a caller can relabel its button.
   *
   * @param instant land on the end pose without travelling - what a shopper who
   *   has asked their system for reduced motion gets. The toggle still works; it
   *   just does not perform.
   */
  press: (instant: boolean) => boolean
  /**
   * Advance the clip by a real elapsed delta, in seconds.
   *
   * Returns whether the picture changed, so a render-loop that only draws when it
   * has to can stay asleep while the model sits at either end of its travel. A
   * model with an animation nobody has pressed therefore costs the same per frame
   * as a model with none.
   */
  update: (delta: number) => boolean
}

export type AnimationToggleDeps = {
  mixer: AnimationMixer
  /** The clips the loaded model carries. Every one is driven together, in the same direction. */
  clips: AnimationClip[]
  /** three's LoopOnce constant. See the note above about not importing three here. */
  loopOnce: AnimationActionLoopStyles
}

export function createAnimationToggle({ mixer, clips, loopOnce }: AnimationToggleDeps): AnimationToggle {
  const actions = clips.map((clip) => {
    const action = mixer.clipAction(clip)
    action.loop = loopOnce
    // The reason the doors stay open. Without it the action would switch itself off
    // at the end and the model would blink back to its closed pose.
    action.clampWhenFinished = true
    // Played, then held: `play` is what registers the action with the mixer (an
    // unplayed action is never evaluated, so the jump-to-end path below would move
    // nothing), and `paused` is what stops it running the moment the page loads.
    action.play()
    action.paused = true
    return action
  })

  // What the shopper has ASKED for, which is not always what the model has finished
  // doing - a press mid-travel flips this immediately while the doors are still
  // moving. That is the point: the label follows the press, so mashing the button
  // can never leave "Close the doors" over a model that is closing.
  let open = false

  // Land on an end pose without travelling. Setting `time` alone changes nothing on
  // screen - the pose is written by the mixer, so it needs one tick to apply it, and
  // a zero-length tick is enough because a paused action reads its own `time` rather
  // than advancing.
  const settle = (): void => {
    for (const action of actions) {
      action.paused = true
      action.time = open ? action.getClip().duration : 0
    }
    mixer.update(0)
  }

  return {
    clipName: clips[0]?.name ?? '',
    isOpen: () => open,

    press: (instant) => {
      open = !open
      if (instant) {
        settle()
        return open
      }
      for (const action of actions) {
        // `enabled` matters only if something else has switched the action off;
        // `paused` is what a finished action left true, and is what lets a model
        // sitting at either end set off again.
        action.enabled = true
        action.paused = false
        action.timeScale = open ? 1 : -1
      }
      return open
    },

    update: (delta) => {
      // The actions pause THEMSELVES on their last frame (clampWhenFinished), so
      // this is also how the toggle notices it has arrived.
      if (actions.every((action) => action.paused)) return false
      mixer.update(delta)
      // True even on the frame that finished, so the clamped end pose gets drawn
      // rather than left one frame short of where the shopper asked for it.
      return true
    },
  }
}
