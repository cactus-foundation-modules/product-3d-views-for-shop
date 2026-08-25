import { describe, it, expect } from 'vitest'
import { asked, freshHold, mayLead, showing, type StageHold } from '@/modules/product-3d-views-for-shop/lib/stage-hold'

// The hold is a sequence, not a snapshot - every one of these is a real journey
// through the gallery, written in the order the component sees it: `ask` when the
// module asks the host for something, `showing` when the host reports back what
// ended up on the stage, `mayLead` at the moment a variation change wants it.

type Step = { ask: string | null } | { showing: string | null }

function walk(steps: Step[]): StageHold {
  return steps.reduce<StageHold>(
    (hold, step) => ('ask' in step ? asked(hold, step.ask) : showing(hold, step.showing)),
    freshHold,
  )
}

// React runs an effect twice on mount in development, so every `showing` a
// component reports may arrive twice. Replaying the whole journey with each of
// them doubled must land in the same place.
function doubled(steps: Step[]): Step[] {
  return steps.flatMap<Step>((s) => ('showing' in s ? [s, s] : [s]))
}

function bothWays(steps: Step[]): boolean {
  const once = mayLead(walk(steps))
  expect(mayLead(walk(doubled(steps)))).toBe(once)
  return once
}

describe('gallery stage hold', () => {
  it('lets the module lead on a page nobody has touched', () => {
    expect(mayLead(freshHold)).toBe(true)
  })

  it('lets a chosen variation take the stage from the opening model', () => {
    // Mount leads with the product's own model; the shopper then picks a finish.
    expect(bothWays([{ ask: 'own' }, { showing: 'own' }])).toBe(true)
  })

  it('stands aside once the shopper has clicked a photograph', () => {
    // The bug this exists for: model up, shopper clicks the variation's picture,
    // then changes an option. The picture's replacement wins, not the model.
    expect(bothWays([{ ask: 'own' }, { showing: 'own' }, { showing: null }])).toBe(false)
  })

  it('keeps standing aside through every later option change', () => {
    expect(bothWays([
      { ask: 'own' },
      { showing: 'own' },
      { showing: null },
      { showing: null },
      { showing: null },
    ])).toBe(false)
  })

  it('leads again the moment the shopper clicks a 3D thumbnail back', () => {
    expect(bothWays([
      { ask: 'own' },
      { showing: 'own' },
      { showing: null },
      { ask: 'oak' },
      { showing: 'oak' },
    ])).toBe(true)
  })

  it('still leads after handing the stage back itself', () => {
    // The stale case: the variation moved to does not offer the model that was up,
    // so the module asks for the stage back. That is its own doing, not a decision
    // of the shopper's, and the next variation carrying a model still leads.
    expect(bothWays([{ ask: 'own' }, { showing: 'own' }, { ask: null }, { showing: null }])).toBe(true)
  })

  it('still leads when the opening view had no model to lead with', () => {
    // Nothing on offer on mount (the product carries no model and none is promoted),
    // so the shopper opens on a photograph without having chosen it. The first
    // variation that brings its own model takes the stage.
    expect(bothWays([{ showing: null }])).toBe(true)
  })

  it('still leads when the host clears the stage behind an opening pick', () => {
    // Reset options: the module is remounted and leads with the product's own model,
    // and the host - whose reset runs after ours - clears the stage in the same
    // breath. We asked for a model and never saw one, so nothing was taken from us.
    expect(bothWays([{ showing: null }, { ask: 'own' }, { showing: null }])).toBe(true)
  })

  it('reads a stale handover in the same commit as the variation lead', () => {
    // Both effects run off one render: the stale handover is declared first, the
    // variation lead second. The lead must not read the handover as the shopper
    // walking away from the stage.
    expect(bothWays([{ ask: 'oak' }, { showing: 'oak' }, { ask: null }])).toBe(true)
  })
})
