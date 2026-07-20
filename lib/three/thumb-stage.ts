'use client'

import type { Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { addLights, applyEnvironment, applyFabricPaint, applyMaxAnisotropy, disposeEnvironment, disposeModel, frameModel, warmKtx2Support } from '@/modules/product-3d-views-for-shop/lib/three/load-model'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'
import type { FabricBundle } from '@/modules/product-3d-views-for-shop/lib/types'

// Drives every auto-rotating 3D thumbnail on the page from ONE WebGL context.
//
// The obvious build - a <canvas> with its own WebGLRenderer per thumbnail - falls
// over in practice. Browsers cap live WebGL contexts at somewhere around 8 to 16
// per page, and silently kill the oldest to make room once you pass it. A product
// with a dozen variations, each with a model, is past that on its own, and the
// failure is the nastiest kind: the earliest thumbnails go blank at some point
// during scrolling, on some machines, and never in front of the person who built
// the page.
//
// So: one renderer, one canvas, never in the document. Each tick it is resized to
// a thumbnail, told to draw that thumbnail's scene, and the result is blitted into
// that thumbnail's own plain 2D canvas with drawImage. One context, any number of
// thumbnails, and the per-tick cost is a copy of a 64-pixel square - which is
// nothing next to the draw itself.
//
// One rAF loop drives the lot, rather than one per thumbnail: N loops would each
// wake the compositor independently and spend more time scheduling than drawing.

type Entry = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  scene: Scene
  camera: PerspectiveCamera
  /** What spins: the centred pivot frameModel hung the model off, never the model. */
  pivot: Object3D
  /** What gets disposed, and what the pivot has to be emptied of first. */
  model: Object3D
  /**
   * Whether this thumbnail owes a frame. Always true while the strip is spinning, and
   * the only thing that gets drawn when it is not: a still thumbnail is a picture that
   * has already been painted into its own 2D canvas and stays there, so redrawing it
   * sixty times a second produces the same image at full GPU cost. Set again whenever
   * something invalidates it - a mount, or a renderer rebuilt after a context loss.
   */
  needsDraw: boolean
}

let renderer: WebGLRenderer | null = null
let rendererFailed = false
// Set the moment the shared context is lost and cleared once a replacement renderer is
// standing. Nothing is drawn in between: rendering into a dead context is at best a
// no-op and at worst a stream of console errors on every frame.
let contextLost = false
const entries = new Set<Entry>()
let frame: number | null = null
let lastTime = 0

// The site owner's viewer settings, captured from the first thumbnail to mount.
// The strip shares one renderer built once, so the renderer-level choices
// (antialias, pixel-ratio cap) are necessarily settled by whoever gets there
// first; every thumbnail on a page carries the same settings, so "first" and
// "any" are the same value. Null until the first mount, before which the loop
// has nothing to draw anyway.
let thumbSettings: P3dConfig | null = null

// Radians per second. Slow enough to read the shape rather than to advertise that
// it moves; a thumbnail spinning fast enough to notice is a thumbnail nobody can
// actually look at. The site owner can switch it off entirely (thumbnailAutoRotate).
const SPIN_RATE = 0.6

// The shopper asked their operating system for less movement, so the thumbnails
// hold still and show the model's front. The click-through to the full viewer is
// unaffected - this is about what moves without being asked, not about what the
// feature can do.
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

// How long to wait for the browser to volunteer a restored context before rebuilding
// the renderer from scratch. Matches the stage viewer's own wait, and for the same
// reason: most browsers fire 'webglcontextrestored', some quietly never do, and
// rebuilding works either way.
const CONTEXT_RESTORE_TIMEOUT_MS = 1500

async function getRenderer(): Promise<WebGLRenderer | null> {
  if (renderer) return renderer
  // A machine with no working WebGL (an old box, a locked-down browser, a
  // software renderer that gave up) must not be asked again on every thumbnail
  // and every tick. One failure settles it for the page.
  if (rendererFailed) return null
  try {
    const { WebGLRenderer } = await import('three')
    renderer = new WebGLRenderer({ alpha: true, antialias: thumbSettings?.antialias ?? true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, thumbSettings?.pixelRatioCap ?? 2))
    // Lend this context to the KTX2 transcoder's one-off capability check, so it does
    // not open a WebGL context of its own to ask a question this one can answer.
    warmKtx2Support(renderer)
    watchForContextLoss(renderer)
    contextLost = false
    return renderer
  } catch {
    rendererFailed = true
    return null
  }
}

/**
 * Surviving a lost WebGL context - the failure that takes the WHOLE strip out at once,
 * since every thumbnail on the page is drawn through this one context.
 *
 * A context is not the page's to keep: a phone backgrounding the tab, a driver reset,
 * or another tab opening enough contexts to push this one out will all take it. What
 * the shopper is left with is a row of thumbnails frozen on whatever frame they last
 * managed, for the rest of their visit.
 *
 * There is nothing to resume. A restored context hands back the ability to draw but not
 * the geometry, textures or shaders that were uploaded to the dead one, so the honest
 * answer is a new renderer - which also means a new canvas, and no inherited state to
 * wonder about. Everything CPU-side survives (the scenes, the models, the texture
 * images), so the new renderer simply uploads it all again the first time it draws each
 * thumbnail. The one thing that does NOT survive is the studio environment, which was
 * built against the old renderer and is keyed to it: each scene has to be re-pointed at
 * the new one, or every metal surface in the strip goes black.
 */
function watchForContextLoss(target: WebGLRenderer): void {
  const canvas = target.domElement
  let timer: ReturnType<typeof setTimeout> | null = null

  const rebuild = (): void => {
    if (timer !== null) { clearTimeout(timer); timer = null }
    // Only ever rebuild the renderer that was lost. A teardown may have replaced or
    // dropped it while the browser was thinking about restoring.
    if (renderer !== target) return
    disposeEnvironment(target)
    target.dispose()
    renderer = null
    // A lost context is not a browser that cannot do WebGL, so the one-failure-settles-
    // it latch must not be left set by this path.
    rendererFailed = false

    void getRenderer().then(async (active) => {
      if (!active) return
      for (const entry of entries) {
        await applyEnvironment(entry.scene, active, thumbSettings?.environmentIntensity ?? 1)
        entry.needsDraw = true
      }
      start()
    })
  }

  canvas.addEventListener('webglcontextlost', (event) => {
    // Without this the browser is entitled never to offer a restore at all.
    event.preventDefault()
    if (renderer !== target) return
    contextLost = true
    timer = setTimeout(rebuild, CONTEXT_RESTORE_TIMEOUT_MS)
  })
  canvas.addEventListener('webglcontextrestored', rebuild)
}

function tick(time: number): void {
  frame = null
  const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0
  lastTime = time

  // Held still if the shopper asked their system for less motion, or if the
  // site owner turned the thumbnail spin off. Either one is a "no".
  const spinning = !prefersReducedMotion() && (thumbSettings?.thumbnailAutoRotate ?? true)
  const spin = spinning ? SPIN_RATE * delta : 0
  // Whether anything still owes a frame it has not been able to draw yet, which is what
  // keeps the loop alive on a strip that is not spinning.
  let pending = false

  if (renderer && !contextLost) {
    for (const entry of entries) {
      // A thumbnail scrolled out of the viewport is still being drawn without
      // this check, which on a long category page is a lot of GPU spent on
      // pictures nobody is looking at.
      if (!isVisible(entry.canvas)) {
        // One that has never been drawn still owes its first frame, for whenever it
        // scrolls in. One already drawn owes nothing: its 2D canvas is still holding
        // the picture.
        pending ||= entry.needsDraw
        continue
      }
      // A still strip - reduced motion, or the owner's own choice - draws each
      // thumbnail once and then leaves it alone. Redrawing an unchanging picture sixty
      // times a second is a phone's battery spent on nothing whatsoever.
      if (spin === 0 && !entry.needsDraw) continue
      entry.pivot.rotation.y += spin
      const { width, height } = entry.canvas
      if (width === 0 || height === 0) { pending = true; continue }
      renderer.setSize(width, height, false)
      renderer.render(entry.scene, entry.camera)
      entry.ctx.clearRect(0, 0, width, height)
      entry.ctx.drawImage(renderer.domElement, 0, 0, width, height)
      entry.needsDraw = false
    }
  } else if (entries.size > 0) {
    // No renderer yet, or waiting on a context to come back: everything still owes a
    // frame, so keep the loop turning until there is something to draw with.
    pending = true
  }

  if (entries.size > 0 && (spin > 0 || pending)) frame = requestAnimationFrame(tick)
  else lastTime = 0
}

function isVisible(canvas: HTMLCanvasElement): boolean {
  const box = canvas.getBoundingClientRect()
  return box.bottom > 0 && box.top < window.innerHeight && box.width > 0
}

function start(): void {
  if (frame === null && entries.size > 0) frame = requestAnimationFrame(tick)
}

/**
 * Put an auto-rotating model into `canvas`. Returns a teardown that removes it
 * from the loop and frees its GPU memory; callers MUST call it (an effect cleanup
 * is the intended home), or a shopper changing variation piles up models nothing
 * will ever collect.
 *
 * Returns null when this browser cannot render at all, which the caller shows as
 * a plain still rather than a broken box.
 */
export async function mountThumb(
  canvas: HTMLCanvasElement,
  model: Object3D,
  settings: P3dConfig,
  fabric?: FabricBundle['slots'],
): Promise<(() => void) | null> {
  // Captured before the renderer is built, so getRenderer sees the owner's
  // antialias/pixel-ratio choices on the very first thumbnail rather than a frame
  // late. Every thumbnail passes the same settings, so a later mount overwriting
  // this is a no-op in practice.
  thumbSettings = settings
  const active = await getRenderer()
  if (!active) return null
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const { Scene, PerspectiveCamera } = await import('three')
  const scene = new Scene()
  await addLights(scene, active, settings)
  const pivot = await frameModel(scene, model)
  // Same filtering the stage viewer gets: a thumbnail spins, so its surfaces are
  // seen at an angle constantly, and without this the weave on them muddies too.
  applyMaxAnisotropy(model, active)

  // Same paints the stage is showing, or the thumbnail underneath a painted
  // variation shows the file's original colours while the shopper's chosen
  // fabric is only on the big view - the exact "which one is real" confusion the
  // gallery is meant to avoid. disposeModel below frees these same as any other
  // material map, painted or not.
  for (const slot of fabric ?? []) {
    await applyFabricPaint(model, slot)
  }

  const camera = new PerspectiveCamera(40, 1, 0.1, 100)
  camera.position.set(0, 0.6, 4)
  camera.lookAt(0, 0, 0)

  const entry: Entry = { canvas, ctx, scene, camera, pivot, model, needsDraw: true }
  entries.add(entry)
  start()

  return () => {
    entries.delete(entry)
    scene.remove(pivot)
    disposeModel(model)
    // The shared renderer outlives any one thumbnail - it is the page's, not
    // this entry's - but with nothing left to draw there is no reason to hold a
    // WebGL context open, and a product page with a viewer open wants the
    // context budget more than an empty strip does.
    if (entries.size === 0 && renderer) {
      // Before the renderer goes: the environment was built against it and is
      // useless once it is gone, but is a GPU allocation the collector can't see.
      disposeEnvironment(renderer)
      renderer.dispose()
      renderer = null
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      lastTime = 0
    }
  }
}
