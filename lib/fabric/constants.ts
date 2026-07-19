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
 * A slot's colour can come from a variation OPTION (shop-variations, svr_options)
 * or from a product ATTRIBUTE (product-attributes-for-shop, pat_attributes) - the
 * latter since attribute values grew picture swatches of their own, which is often
 * where a range's finishes actually live. Both are cuids out of different tables,
 * so an attribute id is stored with this prefix and an option id bare. Anything
 * without the prefix is an option, which is exactly what every config saved before
 * attributes were offered contains - no migration needed.
 */
export const ATTRIBUTE_COLOUR_PREFIX = 'attr:'

/** The stored id for a colour taken from the attribute `id`. */
export function attributeColourId(id: string): string {
  return `${ATTRIBUTE_COLOUR_PREFIX}${id}`
}

/**
 * What a stored `colourOptionId` points at. One reader shared by the admin panel,
 * the resolver and the swatch preloader, so the three can never disagree about
 * whether a given id is an option, an attribute or the fixed-colour sentinel.
 */
export function readColourSource(
  colourOptionId: string,
): { kind: 'manual' } | { kind: 'option'; id: string } | { kind: 'attribute'; id: string } {
  if (colourOptionId === MANUAL_COLOUR_ID) return { kind: 'manual' }
  if (colourOptionId.startsWith(ATTRIBUTE_COLOUR_PREFIX)) {
    return { kind: 'attribute', id: colourOptionId.slice(ATTRIBUTE_COLOUR_PREFIX.length) }
  }
  return { kind: 'option', id: colourOptionId }
}

/**
 * The overall size can be read off a product ATTRIBUTE (product-attributes-for-shop,
 * pat_attributes) or off a VARIATION OPTION (shop-variations, svr_options) - the
 * latter because plenty of shops record the size a variation comes in as one of the
 * choosers on the Variations screen rather than as an attribute, and a size the
 * configurator cannot see is a model that never scales.
 *
 * The prefixing is the mirror image of the colour one, and for the same reason:
 * whichever source came first keeps the bare id, so nothing saved before the second
 * arrived needs migrating. Colour started on options, so an attribute is prefixed
 * there; size started on attributes, so an option is prefixed here. Both ids are
 * cuids out of different tables, so a stored value is never ambiguous.
 */
export const OPTION_SIZE_PREFIX = 'opt:'

/** The stored id for a size taken from the variation option `id`. */
export function optionSizeId(id: string): string {
  return `${OPTION_SIZE_PREFIX}${id}`
}

/**
 * What a stored `heightAttributeId` points at. One reader shared by the admin panel
 * and the resolver, so the two can never disagree about whether an id is an
 * attribute, a variation option, the hand-typed sentinel or nothing at all.
 */
export function readSizeSource(
  heightAttributeId: string,
): { kind: 'none' } | { kind: 'manual' } | { kind: 'option'; id: string } | { kind: 'attribute'; id: string } {
  if (!heightAttributeId) return { kind: 'none' }
  if (heightAttributeId === MANUAL_SIZE_ID) return { kind: 'manual' }
  if (heightAttributeId.startsWith(OPTION_SIZE_PREFIX)) {
    return { kind: 'option', id: heightAttributeId.slice(OPTION_SIZE_PREFIX.length) }
  }
  return { kind: 'attribute', id: heightAttributeId }
}

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
