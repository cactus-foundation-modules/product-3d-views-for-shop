import { describe, expect, it } from 'vitest'
import { NUDGE_DURATION_MS, easeNudge, nudgeStep, type NudgeState } from '@/modules/product-3d-views-for-shop/lib/nudge'

const SWEEP = (40 * Math.PI) / 180

/** Run a nudge to completion at a given frame rate and report what happened. */
function run(frameMs: number): { total: number; frames: number; done: boolean } {
  let state: NudgeState = { elapsed: 0, applied: 0 }
  let total = 0
  let frames = 0
  let done = false
  // Generously bounded: a nudge that has not finished within a thousand frames at
  // any sane rate is the runaway this guards against, and the assertions below
  // would rather fail on `done` than hang the suite.
  while (!done && frames < 1000) {
    const next = nudgeStep(state, frameMs, SWEEP)
    total += next.turn
    state = next.state
    done = next.done
    frames++
  }
  return { total, frames, done }
}

describe('easeNudge', () => {
  it('starts at rest and finishes at the full sweep', () => {
    expect(easeNudge(0)).toBe(0)
    expect(easeNudge(1)).toBe(1)
    expect(easeNudge(0.5)).toBeCloseTo(0.5, 10)
  })

  it('never runs backwards', () => {
    let previous = -1
    for (let i = 0; i <= 100; i++) {
      const value = easeNudge(i / 100)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  it('eases: slower at both ends than in the middle', () => {
    const opening = easeNudge(0.1) - easeNudge(0)
    const middle = easeNudge(0.55) - easeNudge(0.45)
    const closing = easeNudge(1) - easeNudge(0.9)
    expect(middle).toBeGreaterThan(opening)
    expect(middle).toBeGreaterThan(closing)
  })
})

describe('nudgeStep', () => {
  it('lands on exactly the sweep whatever the frame rate', () => {
    for (const frameMs of [16.67, 33.3, 100, 250]) {
      const { total, done } = run(frameMs)
      expect(done).toBe(true)
      // The finishing angle is what a shopper is left looking at, so a dropped
      // frame may cost smoothness and must never cost the destination.
      expect(total).toBeCloseTo(SWEEP, 10)
    }
  })

  it('takes about the same wall-clock time however ragged the frames', () => {
    for (const frameMs of [16.67, 50]) {
      const { frames } = run(frameMs)
      expect(frames * frameMs).toBeGreaterThanOrEqual(NUDGE_DURATION_MS)
      expect(frames * frameMs).toBeLessThan(NUDGE_DURATION_MS + frameMs)
    }
  })

  it('turns nothing on a zero-length frame, and is not finished by it', () => {
    // The first frame of any run has no previous timestamp to measure from, so its
    // delta is zero. A nudge that treated that as "nothing to do, we must be done"
    // is precisely how the thumbnail strip ended up frozen on its first picture.
    const first = nudgeStep({ elapsed: 0, applied: 0 }, 0, SWEEP)
    expect(first.turn).toBe(0)
    expect(first.done).toBe(false)
  })

  it('never overshoots when a backgrounded tab hands it an enormous gap', () => {
    const jump = nudgeStep({ elapsed: 0, applied: 0 }, 60_000, SWEEP)
    expect(jump.done).toBe(true)
    expect(jump.turn).toBeCloseTo(SWEEP, 10)
    // And a further frame after finishing adds nothing at all.
    const after = nudgeStep(jump.state, 16.67, SWEEP)
    expect(after.turn).toBeCloseTo(0, 10)
  })
})
