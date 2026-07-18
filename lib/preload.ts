'use client'

import { prefetchModel, prefetchTexture } from '@/modules/product-3d-views-for-shop/lib/three/load-model'
import type { P3dPayload } from '@/modules/product-3d-views-for-shop/lib/types'

// Warm the model and fabric-texture caches in the background once a product page has
// settled, so a shopper changing a variation option gets the model and its colours
// from memory rather than watching a few seconds of fetch + parse + decode on every
// switch. Everything here is best-effort and abortable: a real pick that lands mid
// preload shares the same cached promise (see load-model.ts), so preloading never
// competes with the shopper, it only runs ahead of them.

// Bounded so a slow connection is not saturated ahead of anything the shopper
// actually asks for, yet wide enough that a size run of a dozen models warms in a
// sensible time. Models and textures each get their own run at this width.
const CONCURRENCY = 3

// Run `task` over `items` at a bounded width, stopping between items the moment the
// signal aborts (a shopper leaving the page). Failures inside `task` are the task's
// own to swallow - the prefetch helpers already do.
async function pooled<T>(items: T[], signal: AbortSignal, task: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < items.length && !signal.aborted) {
      const item = items[cursor++]
      if (item === undefined) continue
      await task(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
}

/**
 * Preload every model file on the page, then - for a fabric-configured product - every
 * unique swatch texture its variations could paint. Resolves when done or aborted.
 *
 * Models come straight off the gallery payload: every variation's url is already there,
 * deduped here so a size run pointing a dozen variations at one model warms it once.
 * Swatch urls do NOT travel in the payload (it carries option ids, not resolved swatch
 * urls), so they are fetched once from the module's /swatches endpoint, which lists the
 * distinct swatches - a handful - rather than the storefront resolving one bundle per
 * variation child.
 */
export async function preloadProductAssets(payload: P3dPayload, signal: AbortSignal): Promise<void> {
  const seen = new Set<string>()
  const models = payload.items.filter((item) => {
    if (seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })
  await pooled(models, signal, (item) => prefetchModel(item.url, item.format))

  // Only fabric-configured products have swatches to warm; every other product's
  // colours are just the model itself, already covered above.
  if (signal.aborted || !payload.fabric) return

  try {
    const url = `/api/m/product-3d-views-for-shop/swatches?parent=${encodeURIComponent(payload.parentProductId)}`
    const res = await fetch(url, { signal })
    if (!res.ok) return
    const body = (await res.json()) as { urls?: string[] } | null
    const urls = body?.urls ?? []
    if (signal.aborted || urls.length === 0) return
    await pooled(urls, signal, (u) => prefetchTexture(u))
  } catch {
    // Swallowed - a failed list (or an abort mid-fetch) just means no textures are
    // warmed and the first colour pick fetches as it always did. A preload must never
    // surface to the shopper.
  }
}
