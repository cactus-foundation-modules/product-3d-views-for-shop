import { packIdList, unpackIdList, type PackedIdList } from '@/modules/product-3d-views-for-shop/lib/pack/id-list'
import type { P3dItem } from '@/modules/product-3d-views-for-shop/lib/types'
import type { P3dFormat } from '@/modules/product-3d-views-for-shop/lib/formats'

// The lookup tables a packed payload's model items point into, shared by the gallery
// payload and the card overlay payload (lib/pack/gallery-payload.ts,
// lib/pack/card-payload.ts).
//
// Measured on deskwell.co.uk's Air standing desk, September 2026: the gallery carried
// 2,880 items, one per model file per variation per add-on combination, and almost
// every byte of each one repeated a byte of the item before it. 144 distinct urls,
// each about 280 characters and all in the same folder, written out 2,880 times; 480
// variation ids written six times each; one format, one label and six add-on contexts
// written 2,880 times. 1.29 MB of flight payload for a strip that shows a handful of
// thumbnails.
//
// So each repeated value is written once, in a table, and an item names it by
// position. Urls are split at their LAST slash into a folder, which is tabled on its
// own (a product's models nearly always share one), and the rest. That split is
// lossless whatever the url looks like - absolute, root-relative, carrying a query,
// no slash at all - because the two halves rejoin by plain concatenation and the
// folder keeps its trailing slash.

// Where an item's values live in the tables. `context` is left off for an item that
// had no context property at all, which is not the same as an empty context: the type
// allows a payload written before contexts existed, and it must come back exactly as
// it went in.
export type PackedItem =
  | [productIndex: number, urlIndex: number, kindIndex: number]
  | [productIndex: number, urlIndex: number, kindIndex: number, contextIndex: number]

export type PackedItemTables = {
  // Every product an item hangs off: the parent and its variation children.
  productIds: PackedIdList
  // Url folders, each INCLUDING its trailing slash.
  folders: string[]
  // Distinct urls as [folder index, everything after the folder].
  urls: [folderIndex: number, remainder: string][]
  // Distinct format + label pairs. The label is worked out from the format
  // server-side, so this is almost always a single entry.
  kinds: [format: P3dFormat, label: string][]
  // Distinct add-on contexts ('' is the base model).
  contexts: string[]
}

// Hands out a value's position in a table, adding it the first time it is seen.
// Pairs are identified by their JSON spelling, which cannot confuse two different
// pairs whatever characters they hold.
function createInterner<Value extends string | [string | number, string]>() {
  const table: Value[] = []
  const positions = new Map<string, number>()
  return {
    table,
    intern(value: Value): number {
      const identity = typeof value === 'string' ? value : JSON.stringify(value)
      const known = positions.get(identity)
      if (known !== undefined) return known
      const position = table.push(value) - 1
      positions.set(identity, position)
      return position
    },
  }
}

export type ItemTablesWriter = {
  internItem: (item: P3dItem) => PackedItem
  internUrl: (url: string) => number
  finish: () => PackedItemTables
}

export function createItemTablesWriter(): ItemTablesWriter {
  const productIds = createInterner<string>()
  const folders = createInterner<string>()
  const urls = createInterner<[number, string]>()
  const kinds = createInterner<[P3dFormat, string]>()
  const contexts = createInterner<string>()

  const internUrl = (url: string): number => {
    // +1 keeps the slash on the folder, so a url with no slash at all interns the
    // empty folder and rejoins to exactly itself.
    const cut = url.lastIndexOf('/') + 1
    return urls.intern([folders.intern(url.slice(0, cut)), url.slice(cut)])
  }

  return {
    internUrl,
    internItem(item) {
      const productIndex = productIds.intern(item.productId)
      const urlIndex = internUrl(item.url)
      const kindIndex = kinds.intern([item.format, item.label])
      if (item.context === undefined) return [productIndex, urlIndex, kindIndex]
      return [productIndex, urlIndex, kindIndex, contexts.intern(item.context)]
    },
    finish: () => ({
      productIds: packIdList(productIds.table),
      folders: folders.table,
      urls: urls.table,
      kinds: kinds.table,
      contexts: contexts.table,
    }),
  }
}

export type ItemTablesReader = {
  readItem: (key: string, packed: PackedItem) => P3dItem
  readUrl: (urlIndex: number) => string
}

// A table index with nothing behind it means the payload was not written by the
// writer above. Thrown rather than read as an empty string: a model with no url is a
// broken viewer on a live product page, and a loud failure says where it came from.
function entryAt<Value>(table: Value[], index: number, tableName: string): Value {
  const value = table[index]
  if (value === undefined) throw new Error(`Packed 3D payload points at ${tableName}[${index}], which does not exist`)
  return value
}

export function createItemTablesReader(tables: PackedItemTables): ItemTablesReader {
  const productIds = unpackIdList(tables.productIds)
  // Rejoined once per distinct url rather than once per item, so the 2,880 items
  // that share 144 urls share 144 strings in memory too.
  const urls = tables.urls.map(([folderIndex, remainder]) => entryAt(tables.folders, folderIndex, 'folders') + remainder)
  const readUrl = (urlIndex: number): string => entryAt(urls, urlIndex, 'urls')

  return {
    readUrl,
    readItem(key, [productIndex, urlIndex, kindIndex, contextIndex]) {
      const [format, label] = entryAt(tables.kinds, kindIndex, 'kinds')
      const item: P3dItem = {
        key,
        productId: entryAt(productIds, productIndex, 'productIds'),
        url: readUrl(urlIndex),
        format,
        label,
      }
      if (contextIndex !== undefined) item.context = entryAt(tables.contexts, contextIndex, 'contexts')
      return item
    },
  }
}
