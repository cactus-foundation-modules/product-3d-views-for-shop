'use client'

import type { Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { addLights, applyMaxAnisotropy, disposeEnvironment, disposeModel, frameModel } from '@/modules/product-3d-views-for-shop/lib/three/load-model'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'

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
}

let renderer: WebGLRenderer | null = null
let rendererFailed = false
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
    return renderer
  } catch {
    rendererFailed = true
    return null
  }
}

function tick(time: number): void {
  frame = null
  const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0
  lastTime = time

  if (renderer && entries.size > 0) {
    // Held still if the shopper asked their system for less motion, or if the
    // site owner turned the thumbnail spin off. Either one is a "no".
    const spinning = !prefersReducedMotion() && (thumbSettings?.thumbnailAutoRotate ?? true)
    const spin = spinning ? SPIN_RATE * delta : 0
    for (const entry of entries) {
      // A thumbnail scrolled out of the viewport is still being drawn without
      // this check, which on a long category page is a lot of GPU spent on
      // pictures nobody is looking at.
      if (!isVisible(entry.canvas)) continue
      entry.pivot.rotation.y += spin
      const { width, height } = entry.canvas
      if (width === 0 || height === 0) continue
      renderer.setSize(width, height, false)
      renderer.render(entry.scene, entry.camera)
      entry.ctx.clearRect(0, 0, width, height)
      entry.ctx.drawImage(renderer.domElement, 0, 0, width, height)
    }
  }

  if (entries.size > 0) frame = requestAnimationFrame(tick)
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
export async function mountThumb(canvas: HTMLCanvasElement, model: Object3D, settings: P3dConfig): Promise<(() => void) | null> {
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

  const camera = new PerspectiveCamera(40, 1, 0.1, 100)
  camera.position.set(0, 0.6, 4)
  camera.lookAt(0, 0, 0)

  const entry: Entry = { canvas, ctx, scene, camera, pivot, model }
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
