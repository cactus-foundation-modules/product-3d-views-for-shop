// Shared between the admin panel (a client component) and the server-side config
// schema, so it lives in a leaf file of its own: importing it from
// lib/db/fabric-config.ts would drag prisma into the browser bundle.

/**
 * The sentinel stored in place of a pat_attributes id when the admin has typed the
 * measurement by hand instead of pointing at an attribute. Deliberately not a valid
 * cuid, so it can never collide with a real attribute id. Used in two places, each
 * with its own typed value beside it: a slot's `sizeAttributeId` (value in
 * `sizeManual`) and the config's `heightAttributeId` (value in `heightManual`).
 */
export const MANUAL_SIZE_ID = '__manual'

/**
 * The same idea for a slot's `colourOptionId`: the sentinel stored when the part is
 * painted a fixed colour typed here rather than from whatever the shopper picks. A
 * plinth, a metal frame or a powder-coated leg is often one colour across the whole
 * range, and inventing a one-value variation option for it is a lot of admin for one
 * hex. The colour itself lives in the slot's `colourManual`. A distinct value from
 * MANUAL_SIZE_ID so the two sentinels can never be read for one another.
 */
export const MANUAL_COLOUR_ID = '__manual_colour'

/**
 * A hex colour normalised to `#rrggbb`, or null when the text is not a colour at
 * all. Accepts a leading hash or not, and the three-digit short form, because an
 * admin pasting a brand colour out of a style guide gets any of those. Shared by
 * the admin panel (to flag a typo before saving) and the resolver (to refuse to
 * paint with nonsense), so the two agree on exactly what counts.
 */
export function parseHexColour(value: string): string | null {
  const trimmed = value.trim().replace(/^#/, '')
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) return null
  const full = trimmed.length === 3 ? [...trimmed].map((c) => c + c).join('') : trimmed
  return `#${full.toLowerCase()}`
}
