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
import { addLights, disposeModel, frameModel, loadModel } from '@/modules/product-3d-views-for-shop/lib/three/load-model'
import type { P3dItem } from '@/modules/product-3d-views-for-shop/lib/types'

type Status = 'loading' | 'ready' | 'failed'

export function Viewer3d({ item }: { item: P3dItem }) {
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
    setStatus('loading')
    setTouched(false)

    async function build(): Promise<void> {
      const [{ Scene, PerspectiveCamera, WebGLRenderer }, { OrbitControls: Orbit }] = await Promise.all([
        import('three'),
        import('three/examples/jsm/controls/OrbitControls.js'),
      ])
      const model = await loadModel(item.url, item.format)
      if (cancelled) return

      const renderer = new WebGLRenderer({ canvas: canvas!, alpha: true, antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

      const scene = new Scene()
      await addLights(scene)
      // The pivot, not the model: frameModel centres the model inside it, so
      // OrbitControls' target (the origin) is the middle of the model rather
      // than whatever point its file happened to be authored around.
      const pivot = await frameModel(scene, model)
      if (cancelled) { renderer.dispose(); disposeModel(model); return }

      const camera = new PerspectiveCamera(40, 1, 0.1, 100)
      camera.position.set(0, 0.8, 4.5)

      const controls: OrbitControls = new Orbit(camera, canvas!)
      // Damping is what makes a drag feel like turning an object rather than
      // scrubbing a slider; it needs controls.update() every frame, which the
      // loop below does.
      controls.enableDamping = true
      controls.dampingFactor = 0.08
      controls.enablePan = true
      // Bounded so a shopper cannot lose the model: zoomed through it, or pushed
      // so far away it becomes a dot they then have to hunt for. Both are easy to
      // do by accident on a trackpad and neither has an obvious way back.
      controls.minDistance = 1.5
      controls.maxDistance = 12
      controls.autoRotate = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      controls.autoRotateSpeed = 1.2
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
        scene.remove(pivot)
        disposeModel(model)
        // Frees the WebGL context itself. Without it, a shopper flicking between
        // variations leaks one context per model until the browser starts killing
        // the oldest - which takes the thumbnails out with it.
        renderer.dispose()
      }
    }

    build().catch(() => { if (!cancelled) setStatus('failed') })

    return () => { cancelled = true; dispose?.() }
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
