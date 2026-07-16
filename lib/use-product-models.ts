'use client'

import { useCallback, useSyncExternalStore } from 'react'
import type { P3dAdminModel } from '@/modules/product-3d-views-for-shop/lib/types'

// One product's models, shared by every cell of the Variations tab's 3D column.
//
// A store rather than a fetch per cell, because a cell per variant means a product
// with fifty variants would otherwise ask the same question fifty times over and
// get the same answer. The route already returns the whole tree in one go - parent
// and every variation - so one request serves the entire column, and an upload in
// any cell refreshes all of them.
//
// Keyed by the PARENT product id, which is what the route is keyed by. A cell picks
// its own models out of the list by child product id.

type Listener = () => void

const models = new Map<string, P3dAdminModel[]>()
const listeners = new Map<string, Set<Listener>>()
const loading = new Set<string>()

function emit(productId: string): void {
  for (const fn of listeners.get(productId) ?? []) fn()
}

/**
 * Refetch a product's models and tell every mounted cell. Exported so a cell can
 * call it after it uploads or removes one: the row it changed is not the only cell
 * that might be showing it.
 */
export async function reloadProductModels(productId: string): Promise<void> {
  const res = await fetch(`/api/m/product-3d-views-for-shop/admin/products/${productId}/models`)
  if (!res.ok) return
  const data: { models: P3dAdminModel[] } = await res.json()
  models.set(productId, data.models)
  emit(productId)
}

/**
 * The models for a product tree, or null while the first fetch is in flight.
 *
 * The snapshot returns the stored array by reference, never a fresh one: React
 * compares snapshots by identity, and a new array each call would spin.
 */
export function useProductModels(productId: string): P3dAdminModel[] | null {
  const subscribe = useCallback((onChange: Listener) => {
    let set = listeners.get(productId)
    if (!set) { set = new Set(); listeners.set(productId, set) }
    set.add(onChange)

    // First cell to subscribe pulls the list; the rest ride along on it.
    if (!models.has(productId) && !loading.has(productId)) {
      loading.add(productId)
      void reloadProductModels(productId).finally(() => loading.delete(productId))
    }

    return () => { set.delete(onChange) }
  }, [productId])

  const snapshot = useCallback(() => models.get(productId) ?? null, [productId])

  return useSyncExternalStore(subscribe, snapshot, () => null)
}
