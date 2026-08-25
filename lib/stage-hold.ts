// Who the product gallery's stage belongs to at any moment: the 3D module, or the
// shopper who clicked a photograph.
//
// The module leads the stage twice - once on first paint, and again whenever the
// shopper settles on a variation carrying its own model - and both are right up
// until the shopper has said otherwise by clicking a photograph. From then on the
// stage is theirs: they change a finish and get that finish's first picture, not
// the model dragged back over the top of it.
//
// The catch is that the host only tells us `activeKey`, and a null one means no
// more than "an image is showing". That is true of a shopper's click, and equally
// true of the two handovers the module makes itself: the stale case (the variation
// they moved to does not offer the model that was up) and a first paint with no
// model on offer for the opening view. Neither is a decision of theirs, and
// treating them as one would strand a shopper on photographs on exactly the
// products where the model arrives late - or, worse, on the next page they reset,
// where the module leads and the host immediately clears the stage behind it.
//
// So the hold watches the stage change hands rather than reading any single
// moment: only a model that was demonstrably up and then went away, without the
// module asking for that, was taken. Pure and free of React so the sequence can be
// tested as the sequence it is - the same bargain visible-items.ts makes, and for
// the same reason: this is the fiddly part, and the failure mode is silent.
//
// Every transition is idempotent, because React runs effects twice on mount in
// development and a rule that counted its own steps would read the second run as
// the shopper doing something.

export type StageHold = {
  /** A model of ours is on the stage - observed from the host, not assumed from asking. */
  readonly ours: boolean
  /** The last thing the module asked for was the stage back, so an image is its own doing. */
  readonly handedBack: boolean
  /** The shopper has taken the stage for a photograph, and keeps it until they hand it back. */
  readonly yielded: boolean
}

export const freshHold: StageHold = { ours: false, handedBack: false, yielded: false }

/** The module asked the host for something - one of its thumbnails, or (null) the stage back. */
export function asked(hold: StageHold, key: string | null): StageHold {
  return { ...hold, handedBack: key === null }
}

/**
 * What the host ended up showing. Our own key means the stage is ours again; a null
 * one only counts as the shopper taking it if it was ours to take and we did not
 * ask to be rid of it.
 */
export function showing(hold: StageHold, activeKey: string | null): StageHold {
  if (activeKey !== null) return { ...hold, ours: true, yielded: false }
  if (!hold.ours) return hold
  return { ...hold, ours: false, yielded: !hold.handedBack }
}

/** Whether the module may take the stage for a newly chosen variation's model. */
export function mayLead(hold: StageHold): boolean {
  return !hold.yielded
}
