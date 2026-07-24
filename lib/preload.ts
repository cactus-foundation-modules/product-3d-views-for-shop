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

// The most VARIATION models the background warm-up will fetch ahead of the shopper.
// The parent's own models (the opening view) are always warmed and do not count
// against this - only the per-variation files a shape/width change would swap in do.
//
// A big product breaks the old "warm everything" assumption badly: an Impulse screen
// range is five shapes across a dozen widths, so payload.items carried ~48 distinct
// GLBs and the preload fetched all of them on first paint - tens of megabytes racing
// the swatch textures for one cold connection. Since a COLOUR change (the commonest
// thing a shopper does, and the one they complained was slow) repaints the SAME model
// in place and needs no new file at all, those models were starving the very fetch the
// shopper was waiting on. Capped, the swatches get the pipe; a shape past the ceiling
// simply loads on demand when picked (the model cache shares that fetch), which costs
// the one shopper who reaches it one wait rather than every shopper the whole matrix.
//
// Twelve, because a single shape's full width run is about that, so a typical product
// still warms completely and only a large multi-shape matrix is trimmed.
const PRELOAD_MODEL_CEILING = 12

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
 * Preload the model files and swatch textures a shopper is most likely to reach, so a
 * variation change paints from memory rather than fetching. Resolves when done or aborted.
 *
 * Ordered by what the opening view and the commonest action actually need, not by what
 * exists. The parent's own models (what the strip shows before any pick) and the swatch
 * textures (what a colour change paints with) go first and together; the per-variation
 * models a shape/width change would swap in trail behind, capped, since on a large matrix
 * they are tens of megabytes the shopper is not yet waiting on and every one fetched now
 * is bandwidth taken from the swatch they are.
 *
 * Models come straight off the gallery payload, deduped by url so a size run pointing a
 * dozen variations at one file warms it once. Swatch urls do NOT travel in the payload
 * (it carries option ids, not resolved swatch urls), so they are fetched once from the
 * module's /swatches endpoint, which lists the distinct swatches - a handful.
 */
export async function preloadProductAssets(payload: P3dPayload, signal: AbortSignal): Promise<void> {
  // Distinct model files, split by whether they belong to the product itself or to a
  // variation. The parent's own are the opening view and are always warmed; the
  // variation files are the ones a big matrix has too many of.
  const seen = new Set<string>()
  const parentModels: P3dPayload['items'] = []
  const variationModels: P3dPayload['items'] = []
  for (const item of payload.items) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    ;(item.productId === payload.parentProductId ? parentModels : variationModels).push(item)
  }

  // What the shopper is looking at now (the parent's own model) and what a colour change
  // needs (the swatches), side by side and ahead of everything else. Neither is capped:
  // the parent models are a small set, and the swatches are the whole point on a fabric
  // product - starving them behind a size run of GLBs was the original complaint.
  await Promise.all([
    pooled(parentModels, signal, (item) => prefetchModel(item.url, item.format)),
    preloadSwatchTextures(payload, signal),
  ])
  if (signal.aborted) return

  // Then the variation models a shape/width change would swap in, capped so a large
  // multi-shape range does not flood the connection on first paint. Anything past the
  // ceiling loads on demand when its variation is picked (the model cache shares that
  // fetch), so nothing is lost - only deferred off the cold-cache critical path.
  const warm = variationModels.slice(0, PRELOAD_MODEL_CEILING)
  const deferred = variationModels.length - warm.length
  if (deferred > 0) {
    // Not silent: a bounded preload that quietly dropped two-thirds of a catalogue would
    // read as "everything is warm" when it is not.
    console.info(`[product-3d-views] preloading ${warm.length} of ${variationModels.length} variation models; ${deferred} load on demand`)
  }
  await pooled(warm, signal, (item) => prefetchModel(item.url, item.format))
}

/**
 * Warm the texture cache for every swatch the product's variations could paint.
 *
 * Where the picker already shows a swatch, this is nearly free: the browser has the
 * file and the loader adopts the picture straight off the page (see load-model.ts), so
 * the warm-up is a GPU upload rather than a download. Where it does not - a colour on
 * an option the shopper has yet to open - this is what fetches it ahead of time.
 */
async function preloadSwatchTextures(payload: P3dPayload, signal: AbortSignal): Promise<void> {
  // Only fabric-configured products have swatches to warm; every other product's
  // colours are just the model itself, already covered by the model pass.
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
