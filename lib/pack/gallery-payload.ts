import { packIdList, unpackIdList, type PackedIdList } from '@/modules/product-3d-views-for-shop/lib/pack/id-list'
import {
  createItemTablesReader,
  createItemTablesWriter,
  type PackedItem,
  type PackedItemTables,
} from '@/modules/product-3d-views-for-shop/lib/pack/item-tables'
import type { FabricConfig, P3dPayload } from '@/modules/product-3d-views-for-shop/lib/types'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'

// How the product page's 3D gallery payload travels to the browser.
//
// lib/gallery-provider.ts builds a P3dPayload - every model in the product tree, the
// viewer settings, the fabric config - and shop hands it, untouched and opaque, to our
// thumbnail strip and stage. Spelled out, that was 1.41 MB of flight payload on the
// Air standing desk: 1.29 MB of items that repeat a url, a variation id, a format and
// a context over and over (see lib/pack/item-tables.ts), and 114 KB of fabric config
// whose four calibration maps each key 144 models by their full url.
//
// So the provider packs it and the client components unpack it the moment it arrives
// (readGalleryPayload), before anything else looks at it. Every consumer downstream -
// the strip, the stage, visibleItems, the preload - still receives a P3dPayload
// exactly as before, and nothing outside this module ever reads inside the payload:
// shop's contract treats it as opaque.
//
// Nothing is dropped. Every item, key and fabric entry the old shape carried comes
// back identical, so what a shopper can see and pick is unchanged; only the spelling
// on the wire is.

// Tells a packed payload from the plain P3dPayload shape. A page rendered before this
// shipped may still be in someone's browser cache, and its payload must still draw.
export const GALLERY_PAYLOAD_PACKING = 'p3d-gallery/1'

// The fabric config's maps keyed by model url. Each becomes a list of
// [url table index, value], so the url is written once for all four maps and the items.
type UrlKeyedFabricMap = 'modelHeights' | 'modelWidths' | 'modelDensities' | 'modelSizes'
type UrlIndexedEntries<Value> = [urlIndex: number, value: Value][]

export type PackedFabricConfig = Omit<FabricConfig, UrlKeyedFabricMap> & {
  modelHeights: UrlIndexedEntries<FabricConfig['modelHeights'][string]>
  modelWidths: UrlIndexedEntries<FabricConfig['modelWidths'][string]>
  modelDensities: UrlIndexedEntries<FabricConfig['modelDensities'][string]>
  modelSizes: UrlIndexedEntries<FabricConfig['modelSizes'][string]>
}

export type PackedGalleryPayload = {
  packing: typeof GALLERY_PAYLOAD_PACKING
  parentProductId: string
  // Carried by reference, never copied: the flight renderer writes an object it has
  // already written as a short back-reference, and settings is shared.
  settings: P3dConfig
  fabric: PackedFabricConfig | null
  tables: PackedItemTables
  // Each item's row id, in item order. Kept apart from `items` so a list of UUIDs can
  // travel in its compact form (see lib/pack/id-list.ts).
  itemKeys: PackedIdList
  items: PackedItem[]
}

function packUrlKeyedMap<Value>(map: Record<string, Value>, internUrl: (url: string) => number): UrlIndexedEntries<Value> {
  return Object.entries(map).map(([url, value]) => [internUrl(url), value])
}

// Object.fromEntries rather than assigning in a loop, so even a key spelled
// "__proto__" lands as an ordinary property - which is what JSON.parse made of it.
function unpackUrlKeyedMap<Value>(entries: UrlIndexedEntries<Value>, readUrl: (urlIndex: number) => string): Record<string, Value> {
  return Object.fromEntries(entries.map(([urlIndex, value]) => [readUrl(urlIndex), value]))
}

export function packGalleryPayload(payload: P3dPayload): PackedGalleryPayload {
  const writer = createItemTablesWriter()
  // Items first, so the urls a shopper's strip actually loads take the small indices.
  const items = payload.items.map((item) => writer.internItem(item))

  let fabric: PackedFabricConfig | null = null
  if (payload.fabric) {
    const { modelHeights, modelWidths, modelDensities, modelSizes, ...unkeyed } = payload.fabric
    fabric = {
      ...unkeyed,
      modelHeights: packUrlKeyedMap(modelHeights, writer.internUrl),
      modelWidths: packUrlKeyedMap(modelWidths, writer.internUrl),
      modelDensities: packUrlKeyedMap(modelDensities, writer.internUrl),
      modelSizes: packUrlKeyedMap(modelSizes, writer.internUrl),
    }
  }

  return {
    packing: GALLERY_PAYLOAD_PACKING,
    parentProductId: payload.parentProductId,
    settings: payload.settings,
    fabric,
    tables: writer.finish(),
    itemKeys: packIdList(payload.items.map((item) => item.key)),
    items,
  }
}

export function unpackGalleryPayload(packed: PackedGalleryPayload): P3dPayload {
  const reader = createItemTablesReader(packed.tables)
  const keys = unpackIdList(packed.itemKeys)
  if (keys.length !== packed.items.length) {
    throw new Error(`Packed 3D gallery carries ${keys.length} keys for ${packed.items.length} items`)
  }

  let fabric: FabricConfig | null = null
  if (packed.fabric) {
    const { modelHeights, modelWidths, modelDensities, modelSizes, ...unkeyed } = packed.fabric
    fabric = {
      ...unkeyed,
      modelHeights: unpackUrlKeyedMap(modelHeights, reader.readUrl),
      modelWidths: unpackUrlKeyedMap(modelWidths, reader.readUrl),
      modelDensities: unpackUrlKeyedMap(modelDensities, reader.readUrl),
      modelSizes: unpackUrlKeyedMap(modelSizes, reader.readUrl),
    }
  }

  return {
    parentProductId: packed.parentProductId,
    items: packed.items.map((item, position) => {
      const key = keys[position]
      // Cannot happen after the length check above; spelled out because an index
      // read is typed as possibly missing, and a made-up key would be worse than none.
      if (key === undefined) throw new Error(`Packed 3D gallery has no key for item ${position}`)
      return reader.readItem(key, item)
    }),
    settings: packed.settings,
    fabric,
  }
}

function isPackedGalleryPayload(payload: unknown): payload is PackedGalleryPayload {
  return typeof payload === 'object' && payload !== null
    && (payload as { packing?: unknown }).packing === GALLERY_PAYLOAD_PACKING
}

// One unpack per payload object, however many components read it. Shop renders the
// strip more than once on a page and the stage beside it, all handed the same object,
// and a stable result keeps anything memoised on the payload from recomputing.
const unpackedByPayload = new WeakMap<PackedGalleryPayload, P3dPayload>()

/**
 * The gallery payload as the rest of the module knows it, whichever shape arrived:
 * packed by a current provider, or the plain P3dPayload an older render wrote.
 */
export function readGalleryPayload(payload: unknown): P3dPayload {
  if (!isPackedGalleryPayload(payload)) return payload as P3dPayload
  const cached = unpackedByPayload.get(payload)
  if (cached) return cached
  const unpacked = unpackGalleryPayload(payload)
  unpackedByPayload.set(payload, unpacked)
  return unpacked
}
