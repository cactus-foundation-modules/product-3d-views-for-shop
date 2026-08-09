'use client'

// Listener for the add-on model-context broadcast.
//
// Another module's page component (a product-accessories box, say) announces
// which add-on combination the shopper has in play and which companion option
// values are chosen, on a documented window event - the same no-import seam as
// shop-variations' variant-selection broadcast, because the announcing module
// may not be installed and neither side may import the other. This file is
// this module's half of the contract; the shape is duplicated structurally at
// the publisher.
//
//   Event:    'cactus-shop-model-context'
//   Snapshot: window.__cactusModelContext
//
// `contextKeys` are matched against p3d_models.context by sorting and joining
// with '+' - and matching is exact-or-base: a combination without its own
// tagged file falls back to the base model, never to a partial guess.
import { useEffect, useState } from 'react'

export const MODEL_CONTEXT_EVENT = 'cactus-shop-model-context'

export type ModelContextDetail = {
  slug: string
  // The listing (parent) product the announcement is about, so a gallery can
  // ignore an event for a page it is not on.
  parentProductId?: string
  contextKeys: string[]
  extraValueIds: string[]
}

declare global {
  interface Window {
    __cactusModelContext?: ModelContextDetail
  }
}

/** Sorted, joined form matched against a model row's stored context. */
export function contextSignature(keys: string[]): string {
  return [...keys].filter(Boolean).sort().join('+')
}

const EMPTY: { signature: string; extraValueIds: string[] } = { signature: '', extraValueIds: [] }

export function useModelContext(parentProductId: string): { signature: string; extraValueIds: string[] } {
  const [state, setState] = useState(() => {
    if (typeof window === 'undefined') return EMPTY
    const snapshot = window.__cactusModelContext
    return snapshot && (!snapshot.parentProductId || snapshot.parentProductId === parentProductId)
      ? { signature: contextSignature(snapshot.contextKeys), extraValueIds: snapshot.extraValueIds }
      : EMPTY
  })

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<ModelContextDetail>).detail
      if (!detail) return
      if (detail.parentProductId && detail.parentProductId !== parentProductId) return
      setState({ signature: contextSignature(detail.contextKeys), extraValueIds: detail.extraValueIds })
    }
    window.addEventListener(MODEL_CONTEXT_EVENT, onChange)
    return () => window.removeEventListener(MODEL_CONTEXT_EVENT, onChange)
  }, [parentProductId])

  return state
}
