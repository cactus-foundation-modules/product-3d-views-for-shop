'use client'

// The full viewer: the thing that takes over the gallery's main image when a
// shopper picks a 3D thumbnail. Orbit (tilt), pan and zoom, on its own WebGL
// context - unlike the thumbnails, there is only ever one of these on screen, so
// it can have a renderer to itself and drive it straight into a real canvas.
//
// It auto-rotates until the shopper touches it, and then stops for good. A model
// that keeps spinning while someone is trying to look at one corner of it is
// fighting them; the rotation is there to say "this moves", and once they have
// taken it up it has done its job.

import { useEffect, useRef, useState } from 'react'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { addLights, addShadowCatcher, applyMaxAnisotropy, disposeEnvironment, disposeModel, frameModel, loadModel } from '@/modules/product-3d-views-for-shop/lib/three/load-model'
import type { P3dItem } from '@/modules/product-3d-views-for-shop/lib/types'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'

type Status = 'loading' | 'ready' | 'failed'

export function Viewer3d({ item, settings }: { item: P3dItem; settings: P3dConfig }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return

    let cancelled = false
    let frame: number | null = null
    let dispose: (() => void) | null = null
    let disposeShadow: (() => void) | null = null
    setStatus('loading')
    setTouched(false)

    async function build(): Promise<void> {
      const three = await import('three')
      const { Scene, PerspectiveCamera, WebGLRenderer, Color } = three
      const { OrbitControls: Orbit } = await import('three/examples/jsm/controls/OrbitControls.js')
      const model = await loadModel(item.url, item.format)
      if (cancelled) return

      const renderer = new WebGLRenderer({ canvas: canvas!, alpha: true, antialias: settings.antialias })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatioCap))
      // Everything from here to the dispose assignment builds on a live WebGL
      // context. A throw partway (addLights, frameModel, addShadowCatcher, or a
      // machine that loses its context) would otherwise leave that context open
      // with no `dispose` for the cleanup to call - and a leaked context is the
      // one that eventually takes the thumbnails down. So on any failure, free the
      // context and the model here and rethrow to the .catch that sets "failed".
      try {
        // NoToneMapping is the renderer's own default and matches how this viewer
        // has always drawn; the other two are the curves a model authored elsewhere
        // was likely previewed through. Exposure only means anything under a curve.
        const toneMap = {
          none: three.NoToneMapping,
          aces: three.ACESFilmicToneMapping,
          neutral: three.NeutralToneMapping,
        }[settings.toneMapping]
        renderer.toneMapping = toneMap
        renderer.toneMappingExposure = settings.exposure

        const scene = new Scene()
        const keyLight = await addLights(scene, renderer, settings)
        // The pivot, not the model: frameModel centres the model inside it, so
        // OrbitControls' target (the origin) is the middle of the model rather
        // than whatever point its file happened to be authored around.
        const pivot = await frameModel(scene, model)
        // Filter textures at the GPU's best, or a fine weave washes to a flat
        // colour the moment the surface tilts away from the camera - which, on a
        // model that turns, is most of the time. Needs the renderer for its ceiling.
        applyMaxAnisotropy(model, renderer)
        if (cancelled) { renderer.dispose(); disposeModel(model); return }

        // Transparent lets the page's own background through (the default, and why
        // this suits every theme untold); a colour paints behind the model; the
        // environment shows the studio the model is lit by, softly blurred so a
        // reflective product's reflections have somewhere to come from.
        if (settings.background === 'colour') {
          scene.background = new Color(settings.backgroundColour)
        } else if (settings.background === 'environment') {
          scene.background = scene.environment
          scene.backgroundBlurriness = 0.3
        }

        // Shadows are the stage's alone (see addShadowCatcher). Off by default, and
        // torn down with the rest below.
        if (settings.shadowsEnabled) {
          disposeShadow = await addShadowCatcher(scene, renderer, keyLight, model, {
            softness: settings.shadowSoftness,
            opacity: settings.shadowOpacity,
          })
        }

        const camera = new PerspectiveCamera(settings.fieldOfView, 1, 0.1, 100)
        camera.position.set(0, 0.8, 4.5)

        const controls: OrbitControls = new Orbit(camera, canvas!)
        // Damping is what makes a drag feel like turning an object rather than
        // scrubbing a slider; it needs controls.update() every frame, which the
        // loop below does.
        controls.enableDamping = true
        controls.dampingFactor = settings.dampingFactor
        controls.enablePan = settings.enablePan
        // Bounded so a shopper cannot lose the model: zoomed through it, or pushed
        // so far away it becomes a dot they then have to hunt for. Both are easy to
        // do by accident on a trackpad and neither has an obvious way back.
        controls.minDistance = settings.minDistance
        controls.maxDistance = settings.maxDistance
        // The site owner's choice, but a shopper who asked their system for less
        // movement still overrides it - reduced motion is theirs to set, not the
        // owner's to switch off.
        controls.autoRotate = settings.autoRotate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        controls.autoRotateSpeed = settings.autoRotateSpeed
        controls.addEventListener('start', () => {
          controls.autoRotate = false
          setTouched(true)
        })

        // The stage is square-ish but sized by shop's layout, so the canvas follows
        // the box rather than the other way round - a fixed size here would letterbox
        // on one theme and overflow on another.
        const resize = (): void => {
          const { clientWidth: w, clientHeight: h } = host!
          if (w === 0 || h === 0) return
          renderer.setSize(w, h, false)
          camera.aspect = w / h
          camera.updateProjectionMatrix()
        }
        resize()
        const observer = new ResizeObserver(resize)
        observer.observe(host!)

        const loop = (): void => {
          frame = requestAnimationFrame(loop)
          controls.update()
          renderer.render(scene, camera)
        }
        loop()
        setStatus('ready')

        dispose = () => {
          if (frame !== null) cancelAnimationFrame(frame)
          observer.disconnect()
          controls.dispose()
          disposeShadow?.()
          scene.remove(pivot)
          disposeModel(model)
          disposeEnvironment(renderer)
          // Frees the WebGL context itself. Without it, a shopper flicking between
          // variations leaks one context per model until the browser starts killing
          // the oldest - which takes the thumbnails out with it.
          renderer.dispose()
        }
      } catch (err) {
        // Reached only when build threw before assigning `dispose`, so the cleanup
        // cannot free any of this - do it here. Idempotent enough to be safe: a
        // shadow that was never added leaves disposeShadow null, and three's
        // dispose() calls tolerate being the last thing to touch a resource.
        disposeShadow?.()
        disposeModel(model)
        disposeEnvironment(renderer)
        renderer.dispose()
        throw err
      }
    }

    build().catch(() => { if (!cancelled) setStatus('failed') })

    return () => { cancelled = true; dispose?.() }
    // settings is resolved server-side and constant for the life of the page, so
    // it is read at build time rather than watched: adding the object to the deps
    // would rebuild the whole viewer on every parent render (a fresh object each
    // time), and it never changes without a reload that remounts this anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.url, item.format])

  return (
    <div className="p3d-stage" ref={hostRef}>
      <canvas ref={canvasRef} className="p3d-stage-canvas" />
      {status === 'loading' && <p className="p3d-note">Loading the 3D model…</p>}
      {status === 'failed' && (
        <p className="p3d-note">
          This 3D model could not be loaded. The product&rsquo;s photographs are still in the strip below.
        </p>
      )}
      {/* Says the thing that is not discoverable: that this picture can be
          dragged. Goes the moment they do it, having made its point. */}
      {status === 'ready' && !touched && <span className="p3d-hint">Drag to turn · scroll to zoom</span>}
    </div>
  )
}
