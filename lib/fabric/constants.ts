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
