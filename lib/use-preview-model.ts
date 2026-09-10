'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatLabel } from '@/modules/product-3d-views-for-shop/lib/formats'
import type { FabricBundle, P3dAdminModel, P3dItem, P3dOption, P3dTarget } from '@/modules/product-3d-views-for-shop/lib/types'

// Turning a set of option choices into the model, and the paints, a shopper
// picking those options would actually be shown.
//
// Two admin screens ask exactly this question - the 3D tab's brightness preview
// and the AI photo panel's view capture - and both got it wrong in the same two
// ways before this existed: a part-filled combination guessed at a variation,
// and a variation on a material-configured product drew as an unpainted shell
// because nobody asked the fabric resolver. So it lives here once.

export type PreviewModel = {
  /** One chosen value per option id. Empty string means "not chosen". */
  selection: Record<string, string>
  /** Replaces the whole selection - the dropdowns hand back a merged copy. */
  choose: (next: Record<string, string>) => void
  /** Whether there is anything worth putting dropdowns on screen for. */
  showPicker: boolean
  /** The variation the chosen combination names, or null. */
  chosenTarget: P3dTarget | null
  /** That variation's own model, where it has one. */
  chosenModel: P3dAdminModel | null
  /** What is actually on the stage - the chosen model, or the product's own. */
  previewModel: P3dAdminModel | null
  /** Ready to hand straight to Viewer3d, or null while there is nothing to show. */
  item: P3dItem | null
  /** The paints for this combination, or undefined when there is nothing to paint. */
  fabric: { slots: FabricBundle['slots'] } | undefined
  /** The resolver's whole answer for this combination - null when it had none. */
  bundle: FabricBundle | null
  /** True while this combination's paints are still on their way. */
  pending: boolean
}

/**
 * The model and paints for the currently chosen combination.
 *
 * `models`, `targets` and `options` all come from one GET of the admin models
 * route, which returns the three together for exactly this reason.
 */
export function usePreviewModel({ productId, models, targets, options }: {
  productId: string
  models: P3dAdminModel[]
  targets: P3dTarget[]
  options: P3dOption[]
}): PreviewModel {
  const [choice, setChoice] = useState<Record<string, string>>({})

  // The product's own models first: they are what a shopper sees before choosing
  // anything, so they are what the preview rests on until a combination is picked.
  const ownModels = useMemo(() => models.filter((m) => m.productId === productId), [models, productId])
  const fallbackModel = ownModels[0] ?? models[0] ?? null

  // Which option each value belongs to, so a variation's stored value ids can be
  // laid back out as one choice per dropdown.
  const optionOfValue = useMemo(() => {
    const map = new Map<string, string>()
    for (const option of options) for (const value of option.values) map.set(value.id, option.id)
    return map
  }, [options])

  // The dropdowns start on whatever the preview already shows, so opening the
  // panel and then changing one option is a one-click move rather than a re-pick
  // of the lot. Empty for the parent's own model, which belongs to no combination.
  const defaultChoice = useMemo(() => {
    const target = targets.find((t) => t.productId === fallbackModel?.productId)
    const seed: Record<string, string> = {}
    for (const valueId of target?.valueIds ?? []) {
      const optionId = optionOfValue.get(valueId)
      if (optionId) seed[optionId] = valueId
    }
    return seed
  }, [targets, fallbackModel?.productId, optionOfValue])

  const selection = useMemo(() => ({ ...defaultChoice, ...choice }), [defaultChoice, choice])

  // The variation the chosen combination names, and the model hanging off it. A
  // part-filled combination matches nothing on purpose: half a choice is not a
  // variation, and guessing which of the matching ones was meant would show the
  // admin a model they did not ask for.
  const chosenTarget = useMemo(() => {
    if (options.length === 0) return null
    const wanted = options.map((o) => selection[o.id] ?? '')
    if (wanted.some((v) => !v)) return null
    return targets.find((t) => t.valueIds.length > 0 && wanted.every((v) => t.valueIds.includes(v))) ?? null
  }, [options, selection, targets])

  const chosenModel = useMemo(
    () => (chosenTarget ? models.find((m) => m.productId === chosenTarget.productId) ?? null : null),
    [chosenTarget, models],
  )

  // A chosen combination with no model of its own falls back to the product's own
  // model rather than to an empty stage: something lit is worth more than nothing.
  const previewModel = chosenModel ?? ownModels[0] ?? fallbackModel

  // A variation's model on a material-configured product carries no colours of its
  // own: the shopper's chosen fabrics are painted on at view time, and drawing the
  // file raw shows an unpainted shell rather than the product. So this asks the
  // same public resolver the storefront does and paints the same way.
  //
  // Only a chosen combination is resolved. The parent's own model is what a shopper
  // sees before choosing anything, which is to say unpainted, so there is nothing
  // to ask. The chosen VARIATION is asked about even where it has no model row of
  // its own, because the resolver falls back to the parent's model and paints that
  // - exactly what the storefront shows for such a combination.
  //
  // The variation it was resolved for is kept beside it, so a bundle still in
  // flight can never paint the previous combination's fabrics onto the new model,
  // nor name the previous combination's file.
  const previewChildId = chosenTarget?.productId ?? null
  const [resolved, setResolved] = useState<{ childId: string; bundle: FabricBundle | null } | null>(null)
  const bundle = resolved && resolved.childId === previewChildId ? resolved.bundle : null
  const pending = previewChildId !== null && resolved?.childId !== previewChildId

  useEffect(() => {
    // Nothing to resolve for the parent's own model. The stale bundle is left
    // where it is rather than cleared: the childId guard above already refuses to
    // read it, and clearing it here would be a setState in the effect body for a
    // value nobody can see.
    if (!previewChildId) return
    let cancelled = false
    const childId = previewChildId
    const url = `/api/m/product-3d-views-for-shop/fabric/${encodeURIComponent(previewChildId)}`
      + `?parent=${encodeURIComponent(productId)}&child=${encodeURIComponent(previewChildId)}`
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<FabricBundle | null>) : null))
      // A product with no material config resolves to null, and the model shows
      // unpainted - which for that product is exactly right.
      .then((data) => { if (!cancelled) setResolved({ childId, bundle: data }) })
      .catch(() => { if (!cancelled) setResolved({ childId, bundle: null }) })
    return () => { cancelled = true }
  }, [productId, previewChildId])

  // Stable across a drag: it keys the preview only by which model is on the
  // stage, so changing anything else never remounts the viewer.
  //
  // The resolver has the last word on which file a combination draws where it
  // answered: a size can swap the model out from under a colour, and the row the
  // caller picked is only where the search started.
  const item = useMemo(
    () =>
      previewModel
        ? {
            key: previewModel.id,
            productId: previewModel.productId,
            url: bundle?.modelUrl ?? previewModel.url,
            format: bundle?.format ?? previewModel.format,
            label: `${formatLabel(bundle?.format ?? previewModel.format)} preview`,
          }
        : null,
    [previewModel, bundle?.modelUrl, bundle?.format],
  )

  // Handed on only once the paints for THIS variation have landed. Passing empty
  // slots meanwhile would tell the viewer there is nothing to paint, which is the
  // unpainted shell this hook exists to avoid.
  const fabric = useMemo(
    () => (bundle && bundle.slots.length > 0 ? { slots: bundle.slots } : undefined),
    [bundle],
  )

  const choose = useCallback((next: Record<string, string>) => setChoice(next), [])

  return {
    selection,
    choose,
    showPicker: options.length > 0 && targets.length > 1,
    chosenTarget,
    chosenModel,
    previewModel,
    item,
    fabric,
    bundle,
    pending,
  }
}
