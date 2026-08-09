// Client-side fetch for a variation's resolved fabric bundle (its model url + the
// named material slots), shared by the product-detail gallery and the product-card
// 3D overlay so both hit the one public `/fabric/[child]` endpoint through the same
// promise cache - a variation the gallery has already resolved is a memory hit when
// the card asks for it, and vice versa.
import type { FabricBundle } from '@/modules/product-3d-views-for-shop/lib/types'

const bundleCache = new Map<string, Promise<FabricBundle | null>>()

// `context`/`extraValueIds` are the add-on combination in force (see the fabric
// route). Both default to none, which is byte-for-byte the original request -
// and both join the cache key, so the desk-alone bundle and the desk-with-
// screens bundle are distinct entries rather than whichever landed first.
export function fetchBundle(
  parentProductId: string,
  childProductId: string,
  opts?: { context?: string; extraValueIds?: string[] },
): Promise<FabricBundle | null> {
  const context = opts?.context ?? ''
  const extra = (opts?.extraValueIds ?? []).join(',')
  const key = `${parentProductId}|${childProductId}|${context}|${extra}`
  let entry = bundleCache.get(key)
  if (!entry) {
    const url =
      `/api/m/product-3d-views-for-shop/fabric/x?parent=${encodeURIComponent(parentProductId)}&child=${encodeURIComponent(childProductId)}` +
      (context ? `&context=${encodeURIComponent(context)}` : '') +
      (extra ? `&extra=${encodeURIComponent(extra)}` : '')
    entry = fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<FabricBundle | null>) : null))
      // A failed resolve must not be cached, or a shopper whose connection blipped is
      // handed the same failure for that colour for the rest of their visit.
      .catch((error) => {
        bundleCache.delete(key)
        throw error
      })
    bundleCache.set(key, entry)
  }
  return entry
}
