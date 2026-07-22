// The one-off turn both the stage viewer and the thumbnail strip do when
// autoRotateStyle is 'nudge': the model swings through autoRotateSweep degrees
// once, the first time it is actually on screen, and then holds still.
//
// Shared rather than written twice because the two surfaces have to LOOK like the
// same gesture - a strip nudging over one duration beside a stage nudging over
// another reads as two unrelated things twitching - and because a constant that
// drifts apart between two files is a difference nobody spots until it is on a
// customer's product page.

// Start to stop, in milliseconds. Deliberately NOT derived from autoRotateSpeed:
// that dial paces an endless turn, where slow is restful, and at its default a
// forty degree sweep would take five and a half seconds - long past the point
// where a shopper has decided the picture is simply a picture. A gesture wants to
// be over before it is thought about.
export const NUDGE_DURATION_MS = 1600

/**
 * easeInOutQuad over 0..1. Starts from rest and arrives at rest: a constant rate
 * reads as a mechanism being switched on and off, which is the opposite of the
 * "this is a thing you can turn" the gesture exists to say.
 */
export function easeNudge(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2
}

/** One frame of a nudge in flight. */
export type NudgeState = {
  /** Milliseconds spent so far. */
  elapsed: number
  /** Radians of the sweep already handed to whatever is turning. */
  applied: number
}

/**
 * Advance a nudge by `deltaMs` and say how far to turn THIS frame.
 *
 * The step is the difference between where the eased curve says the sweep should be
 * now and how much of it has already gone out, rather than a per-frame rate. That is
 * what makes a dropped frame cost smoothness and never the finishing angle - which
 * matters because the finishing angle is the one a shopper is left looking at.
 *
 * `elapsed` is clamped to the duration, so `done` is reliable and the total turn is
 * exactly `sweep` however ragged the frames were.
 */
export function nudgeStep(
  state: NudgeState,
  deltaMs: number,
  sweep: number,
): { turn: number; state: NudgeState; done: boolean } {
  const elapsed = Math.min(state.elapsed + Math.max(deltaMs, 0), NUDGE_DURATION_MS)
  const applied = sweep * easeNudge(elapsed / NUDGE_DURATION_MS)
  return {
    turn: applied - state.applied,
    state: { elapsed, applied },
    done: elapsed >= NUDGE_DURATION_MS,
  }
}
