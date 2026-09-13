import { packIdList, unpackIdList, type PackedIdList } from '@/modules/product-3d-views-for-shop/lib/pack/id-list'
import {
  createItemTablesReader,
  createItemTablesWriter,
  type ItemTablesReader,
  type ItemTablesWriter,
  type PackedItem,
  type PackedItemTables,
} from '@/modules/product-3d-views-for-shop/lib/pack/item-tables'
import type { P3dCardModel, P3dCardPayload } from '@/modules/product-3d-views-for-shop/lib/types'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'

// How a product card's "view in 3D" overlay payload travels to the browser.
//
// lib/card-media-provider.ts builds one P3dCardPayload per card, and shop hands it,
// opaque, to CardModel3dOverlay. On a fabric product nearly all of it is
// `variationChildIds` - every enabled variation's child product id, so the open
// viewer's arrows can step through them. Measured on deskwell.co.uk's homepage,
// September 2026: 47 cards carrying 172 KB of child ids between them, the worst single
// card 20.9 KB for a desk range of 536 variations. That list is the same length
// whether or not anybody ever taps the 3D badge.
//
// The ids are random UUIDs, so there is no repetition to table away - but spelled as
// JSON strings they take 39 bytes each for 16 bytes of information. Packed as one
// base64url string (lib/pack/id-list.ts) they take 22. The models the payload names
// go through the same url and kind tables as the gallery's (lib/pack/item-tables.ts).
//
// Unpacked by the overlay the moment it arrives (readCardPayload), so buildSlides,
// initialIndex and the viewer all still see a P3dCardPayload exactly as before. Every
// variation id, model and setting comes back identical: the same slides, in the same
// order, open on the same model.

// Tells a packed payload from the plain P3dCardPayload shape, which a page rendered
// before this shipped may still hold.
export const CARD_PAYLOAD_PACKING = 'p3d-card/1'

// A card model: its row id, its item, and its paints when it has any. The paints are
// left off for a plain model, which is every model the provider writes today.
export type PackedCardModel =
  | [key: string, item: PackedItem]
  | [key: string, item: PackedItem, fabric: NonNullable<P3dCardModel['fabric']>]

export type PackedCardPayload = {
  packing: typeof CARD_PAYLOAD_PACKING
  // Carried by reference, never copied: most cards on a grid share the one settings
  // object, and the flight renderer writes a repeat of it as a short back-reference.
  settings: P3dConfig
  parentProductId: string
  hasFabric: boolean
  tables: PackedItemTables
  // `byVariation`'s entries in their original order, which is the order the open
  // viewer's arrows step through them.
  byVariation: [childId: string, model: PackedCardModel][]
  fallback: PackedCardModel
  defaultChildId?: string
  variationChildIds?: PackedIdList
}

function packCardModel(model: P3dCardModel, writer: ItemTablesWriter): PackedCardModel {
  const item = writer.internItem(model.item)
  return model.fabric ? [model.item.key, item, model.fabric] : [model.item.key, item]
}

function unpackCardModel([key, item, fabric]: PackedCardModel, reader: ItemTablesReader): P3dCardModel {
  return { item: reader.readItem(key, item), fabric: fabric ?? null }
}

export function packCardPayload(payload: P3dCardPayload): PackedCardPayload {
  const writer = createItemTablesWriter()
  const fallback = packCardModel(payload.fallback, writer)
  const byVariation = Object.entries(payload.byVariation).map(
    ([childId, model]): [string, PackedCardModel] => [childId, packCardModel(model, writer)],
  )
  return {
    packing: CARD_PAYLOAD_PACKING,
    settings: payload.settings,
    parentProductId: payload.parentProductId,
    hasFabric: payload.hasFabric,
    tables: writer.finish(),
    byVariation,
    fallback,
    ...(payload.defaultChildId !== undefined ? { defaultChildId: payload.defaultChildId } : {}),
    ...(payload.variationChildIds !== undefined ? { variationChildIds: packIdList(payload.variationChildIds) } : {}),
  }
}

export function unpackCardPayload(packed: PackedCardPayload): P3dCardPayload {
  const reader = createItemTablesReader(packed.tables)
  return {
    settings: packed.settings,
    parentProductId: packed.parentProductId,
    hasFabric: packed.hasFabric,
    // Object.fromEntries keeps the entry order, and lands even a "__proto__" child id
    // as an ordinary property, which is what JSON.parse made of it before.
    byVariation: Object.fromEntries(packed.byVariation.map(([childId, model]) => [childId, unpackCardModel(model, reader)])),
    fallback: unpackCardModel(packed.fallback, reader),
    ...(packed.defaultChildId !== undefined ? { defaultChildId: packed.defaultChildId } : {}),
    ...(packed.variationChildIds !== undefined ? { variationChildIds: unpackIdList(packed.variationChildIds) } : {}),
  }
}

function isPackedCardPayload(payload: unknown): payload is PackedCardPayload {
  return typeof payload === 'object' && payload !== null
    && (payload as { packing?: unknown }).packing === CARD_PAYLOAD_PACKING
}

// One unpack per payload object. The overlay memoises its slide list on the payload,
// so a result that stayed the same object across renders is what keeps that memo
// doing its job rather than rebuilding the slides every time the card re-renders.
const unpackedByPayload = new WeakMap<PackedCardPayload, P3dCardPayload>()

/**
 * The card overlay payload as the rest of the module knows it, whichever shape
 * arrived: packed by a current provider, the plain P3dCardPayload an older render
 * wrote, or nothing at all.
 */
export function readCardPayload(payload: unknown): P3dCardPayload | null {
  if (!isPackedCardPayload(payload)) return (payload as P3dCardPayload | null | undefined) ?? null
  const cached = unpackedByPayload.get(payload)
  if (cached) return cached
  const unpacked = unpackCardPayload(payload)
  unpackedByPayload.set(payload, unpacked)
  return unpacked
}
