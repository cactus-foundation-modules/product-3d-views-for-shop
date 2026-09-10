'use client'

// "From 3D models": turning this product's 3D model into reference photographs
// for whatever is asking for them.
//
// This module's contribution to the `google-ai-studio.reference-image-sources`
// point. It imports nothing from that module and never will - the AI photo panel
// may not be installed, and on a site without it this file is simply never
// rendered. The whole contract is one documented browser event carrying one
// picture, described below, which is also what lets the two halves be released
// in either order.
//
// The point of it is angles. A product with three photographs has three angles,
// and a model asked for "the same desk from above" has to invent one. A 3D file
// has every angle there is: turn it where you want it, press the button, turn it
// again, press it again - and the AI is working from four real views of the real
// product instead of one.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { viewerChromeCss } from '@/modules/product-3d-views-for-shop/lib/viewer-css'
import { usePreviewModel } from '@/modules/product-3d-views-for-shop/lib/use-preview-model'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'
import type { P3dProductConfig } from '@/modules/product-3d-views-for-shop/lib/db/product-settings'
import type { P3dAdminModel, P3dOption, P3dTarget } from '@/modules/product-3d-views-for-shop/lib/types'
import { Viewer3d } from '@/modules/product-3d-views-for-shop/components/public/Viewer3d'

// The seam. A module that wants extra reference pictures listens for this on the
// window; a module that can produce one dispatches it. `cancelable` and the
// return of dispatchEvent are how the producer learns whether anything actually
// took the picture - a host too old to know the event, or none at all, should be
// told about rather than silently dropped.
//
// The picture travels as a data url because that is what a canvas produces and
// what an <img> consumes, and it never touches this site's media library: a view
// nobody chose to keep is not a file the owner should have to tidy away.
const REFERENCE_EVENT = 'cactus-ai-reference-image'

/** Longest side of a captured view. Comfortably enough for a reference picture,
 * and small enough that half a dozen of them still make an ordinary request. */
const MAX_EDGE = 1280

/** JPEG rather than the canvas's native PNG: a screenshot of a lit 3D model is a
 * photograph, not a diagram, and the PNG of one runs to several megabytes. */
const CAPTURE_TYPE = 'image/jpeg'
const CAPTURE_QUALITY = 0.92

type ModelsResponse = { models: P3dAdminModel[]; targets: P3dTarget[]; options: P3dOption[] }

/**
 * Flatten a captured frame onto white and bring it down to a sensible size.
 *
 * The viewer's canvas is transparent - it draws over whatever the page behind it
 * is - so the raw capture has an alpha channel, and a reference picture with a
 * see-through background tells the AI nothing about what the background should
 * be. White is what a product photograph's background nearly always is, and it is
 * what the house style will be asking for anyway.
 */
async function flatten(dataUrl: string): Promise<string> {
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('capture could not be read back'))
    img.src = dataUrl
  })

  const scale = Math.min(1, MAX_EDGE / Math.max(source.naturalWidth, source.naturalHeight))
  const width = Math.max(1, Math.round(source.naturalWidth * scale))
  const height = Math.max(1, Math.round(source.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0, width, height)
  return canvas.toDataURL(CAPTURE_TYPE, CAPTURE_QUALITY)
}

const capturePanelCss = `
.p3d-cap{display:grid;gap:.75rem}
.p3d-cap-pick{display:flex;gap:.75rem;flex-wrap:wrap}
.p3d-cap-field{display:grid;gap:.25rem}
.p3d-cap-label{font-size:.75rem;font-weight:600;color:var(--color-text-secondary)}
.p3d-cap-select{padding:.375rem .5rem;border:1px solid var(--color-border);border-radius:6px;
  background:var(--color-surface);color:var(--color-text);font-size:.8125rem}
.p3d-cap-stage{height:360px;border:1px solid var(--color-border);border-radius:8px;
  overflow:hidden;position:relative;background:var(--color-bg-subtle)}
.p3d-cap-actions{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}
.p3d-cap-note{font-size:.8125rem;color:var(--color-text-secondary);line-height:1.5;flex:1;min-width:14rem}
`

export function Model3dCapturePanel({ productId }: { productId: string }) {
  const [tree, setTree] = useState<ModelsResponse | null>(null)
  const [site, setSite] = useState<P3dConfig | null>(null)
  const [config, setConfig] = useState<P3dProductConfig | null>(null)
  const [taken, setTaken] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Filled in by the live viewer build, null between builds - see Viewer3d.
  const captureRef = useRef<(() => string | null) | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [modelsRes, settingsRes] = await Promise.all([
          fetch(`/api/m/product-3d-views-for-shop/admin/products/${encodeURIComponent(productId)}/models`),
          fetch(`/api/m/product-3d-views-for-shop/admin/products/${encodeURIComponent(productId)}/settings`),
        ])
        if (cancelled || !modelsRes.ok || !settingsRes.ok) return
        const models = await modelsRes.json() as ModelsResponse
        const settings = await settingsRes.json() as { config: P3dProductConfig; site: P3dConfig }
        if (cancelled) return
        setTree({ models: models.models ?? [], targets: models.targets ?? [], options: models.options ?? [] })
        setSite(settings.site)
        setConfig(settings.config)
      } catch {
        // The panel simply does not offer itself - a product with no models is
        // the ordinary case, not an error worth shouting about.
      }
    })()
    return () => { cancelled = true }
  }, [productId])

  const models = useMemo(() => tree?.models ?? [], [tree])
  const targets = useMemo(() => tree?.targets ?? [], [tree])
  const options = useMemo(() => tree?.options ?? [], [tree])

  const preview = usePreviewModel({ productId, models, targets, options })

  // The site's lighting with this product's brightness over the top, exactly as
  // the storefront resolves it. Memoised so the viewer is handed the same object
  // between renders rather than rebuilding itself for nothing.
  const settings = useMemo(
    () => (site ? { ...site, exposure: config?.exposure ?? site.exposure } : null),
    [site, config?.exposure],
  )

  const label = useMemo(() => {
    const variation = preview.chosenTarget?.variationLabel ?? preview.previewModel?.variationLabel
    return variation ? `3D view - ${variation}` : '3D view'
  }, [preview.chosenTarget?.variationLabel, preview.previewModel?.variationLabel])

  const capture = useCallback(async () => {
    setError('')
    const take = captureRef.current
    if (!take) {
      setError('The model is still loading. Give it a moment and try again.')
      return
    }
    setBusy(true)
    try {
      const raw = take()
      if (!raw) {
        setError('That view could not be captured. Try turning the model and pressing it again.')
        return
      }
      const dataUrl = await flatten(raw)
      const event = new CustomEvent(REFERENCE_EVENT, {
        detail: { dataUrl, label: `${label} ${taken + 1}` },
        cancelable: true,
      })
      // Cancelled means something took it. Nothing listening means the panel this
      // is sitting in is older than this event, and saying so beats a button that
      // appears to do nothing.
      if (window.dispatchEvent(event)) {
        setError('Nothing on this page could take that view. Update the Google AI Studio module.')
        return
      }
      setTaken((n) => n + 1)
    } catch {
      setError('That view could not be captured.')
    } finally {
      setBusy(false)
    }
  }, [label, taken])

  if (!tree || !settings || !preview.item || !preview.previewModel) return null

  return (
    <div className="p3d-cap">
      <style dangerouslySetInnerHTML={{ __html: viewerChromeCss + capturePanelCss }} />

      {preview.showPicker && (
        <div className="p3d-cap-pick">
          {options.map((option) => (
            <div key={option.id} className="p3d-cap-field">
              <label className="p3d-cap-label" htmlFor={`p3d-cap-${option.id}`}>{option.name}</label>
              <select
                id={`p3d-cap-${option.id}`}
                className="p3d-cap-select"
                value={preview.selection[option.id] ?? ''}
                onChange={(e) => preview.choose({ ...preview.selection, [option.id]: e.target.value })}
              >
                <option value="">Any</option>
                {option.values.map((value) => (
                  <option key={value.id} value={value.id}>{value.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      <div className="p3d-cap-stage">
        <Viewer3d
          item={preview.item}
          settings={settings}
          fabric={preview.fabric}
          fabricPending={preview.pending}
          captureRef={captureRef}
        />
      </div>

      <div className="p3d-cap-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || preview.pending}
          onClick={() => { void capture() }}
        >
          Create view
        </button>
        <span className="p3d-cap-note">
          {taken === 0
            ? 'Turn the model to the angle you want, then press Create view. Do it again from another angle for as many as you need.'
            : `${taken} view${taken === 1 ? '' : 's'} added below. Turn the model again and press it once more for another angle.`}
        </span>
      </div>

      {preview.showPicker && !preview.chosenModel && !preview.bundle && (
        <p className="p3d-cap-note">
          {preview.chosenTarget
            ? 'That combination has no 3D model of its own, so this is the product’s.'
            : 'Pick a full set of options above to see a particular variation’s model.'}
        </p>
      )}

      {error && <div className="alert alert-error">{error}</div>}
    </div>
  )
}
