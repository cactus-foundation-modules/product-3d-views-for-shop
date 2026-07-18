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
import type { Object3D, Texture } from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { addLights, addShadowCatcher, applyFabricPaint, applyMaxAnisotropy, disposeEnvironment, disposeModel, frameModel, loadModel } from '@/modules/product-3d-views-for-shop/lib/three/load-model'
import type { P3dItem } from '@/modules/product-3d-views-for-shop/lib/types'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'

type Status = 'loading' | 'ready' | 'failed'

// The fabric configurator's paints for the model on the stage: which named
// material to texture, with what and at what tile density. Optional - a viewer
// with no `fabric` prop behaves exactly as it always has.
type FabricPaints = { slots: Array<{ materialName: string; textureUrl: string; repeat: number }> }

export function Viewer3d({ item, settings, fabric }: { item: P3dItem; settings: P3dConfig; fabric?: FabricPaints }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [touched, setTouched] = useState(false)

  // Kept across renders so the repaint effect below can find the built model and
  // its currently-applied fabric textures without rebuilding the whole viewer. The
  // built model is reachable only inside build()'s closure otherwise, and a colour
  // change must not tear down the WebGL context to swap one map.
  const modelRef = useRef<Object3D | null>(null)
  const builtUrlRef = useRef<string | null>(null)
  // Mirrors builtUrlRef into state purely so the repaint effect re-runs the moment
  // the model finishes building. The fabric fetch can land WHILE the model is still
  // loading: the repaint effect fires then, finds no model yet and bails, and the
  // build's own first paint used the empty slots it was handed at mount. Without a
  // trigger tied to "model is now built", that mid-build paint is lost until the
  // next colour change - which is exactly the "fabric only shows after I change an
  // option" bug on the first, slow load of a model.
  const [builtUrl, setBuiltUrl] = useState<string | null>(null)
  // materialName -> the clone this viewer currently has on that slot, so a swap can
  // dispose the outgoing one (its own per-viewer GPU allocation) without touching
  // the shared master in the texture cache.
  const appliedRef = useRef<Map<string, Texture>>(new Map())

  // A stable signature of the paints, so the repaint effect fires on a colour change
  // (same model, new textures) but not on every parent render handing a fresh object.
  const fabricSignature = JSON.stringify(fabric?.slots ?? [])

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
      // pixelRatioCap caps DOWNWARD (never above the device's own ratio);
      // superSampling then multiplies UP, letting the viewer render above screen
      // resolution and downsample. That is what tames the fabric-weave shimmer a
      // 1x monitor otherwise shows when the model is small on screen - MSAA and
      // anisotropy do not, since this is shaded-surface aliasing, not silhouette
      // or grazing-angle. superSampling defaults to 1, so this stays identical to
      // the old single line until the owner turns it up.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatioCap) * settings.superSampling)
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

        // The configurator's fabric slots, painted onto the freshly built model. A
        // later colour change on the same model url is handled in place by the
        // effect below; this first paint is also the one a headrest switch rebuilds
        // through, since that changes the model url and re-runs this effect.
        const applied = appliedRef.current
        for (const slot of fabric?.slots ?? []) {
          const tex = await applyFabricPaint(model, slot)
          if (tex) applied.set(slot.materialName, tex)
        }

        if (cancelled) {
          for (const tex of applied.values()) tex.dispose()
          applied.clear()
          renderer.dispose(); disposeModel(model); return
        }
        // Reachable by the repaint effect only now the model is built and painted.
        modelRef.current = model
        builtUrlRef.current = item.url
        // Wakes the repaint effect now the model exists, so a fabric fetch that
        // landed mid-build (repaint fired, found no model, bailed) gets painted the
        // moment building finishes rather than waiting for the next colour change.
        if (!cancelled) setBuiltUrl(item.url)

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
        const wantsMotion =
          settings.autoRotate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        // Two ways to satisfy "auto-rotate", picked by spinModel: orbit the camera
        // around a still model (the historic default, shadow holds its place), or
        // spin the model itself under a fixed light so the shadow sweeps with it.
        // Only one is ever live at a time.
        controls.autoRotate = wantsMotion && !settings.spinModel
        controls.autoRotateSpeed = settings.autoRotateSpeed
        // Per-frame turn for the model-spin path, matched to OrbitControls' own
        // auto-rotation step so both modes read at the same speed for a given
        // autoRotateSpeed.
        const spinStep = ((2 * Math.PI) / 60 / 60) * settings.autoRotateSpeed
        let spinModel = wantsMotion && settings.spinModel
        controls.addEventListener('start', () => {
          // First touch stops the idle motion for good, whichever mode it was.
          controls.autoRotate = false
          spinModel = false
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
          // Turn the model, not the camera: the light and shadow-catcher plane are
          // scene-level, so the model spinning under them is what makes the shadow
          // move. The shadow camera's reach is sized off the model's largest
          // dimension, so a full turn stays within it.
          if (spinModel) pivot.rotation.y += spinStep
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
          // This viewer's own fabric clones, freed before the model they hang off.
          // The masters they were cloned from stay in the shared texture cache.
          for (const tex of appliedRef.current.values()) tex.dispose()
          appliedRef.current.clear()
          modelRef.current = null
          builtUrlRef.current = null
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
        for (const tex of appliedRef.current.values()) tex.dispose()
        appliedRef.current.clear()
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
    // fabric is read here for the FIRST paint only; a colour change on the same
    // model is handled by the repaint effect below without rebuilding the context,
    // and a model change (headrest) alters item.url, which does re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.url, item.format])

  // Repaint the fabric slots in place when the colours change but the model does
  // not - the whole point of the configurator: a seat-colour change must not tear
  // down and rebuild the WebGL context. Runs only once the model for the current
  // url is built (modelRef set), and does nothing on a model change, which the
  // build effect above already handles by rebuilding and painting in build().
  useEffect(() => {
    const model = modelRef.current
    // Not built yet, or built for a different url (a rebuild is mid-flight and will
    // paint the new colours itself) - leave it to the build effect.
    if (!model || builtUrlRef.current !== item.url) return
    let cancelled = false
    const applied = appliedRef.current
    ;(async () => {
      for (const slot of fabric?.slots ?? []) {
        const tex = await applyFabricPaint(model, slot)
        if (cancelled) { tex?.dispose(); continue }
        const previous = applied.get(slot.materialName)
        if (previous && previous !== tex) previous.dispose()
        if (tex) applied.set(slot.materialName, tex)
      }
    })()
    return () => { cancelled = true }
    // Keyed on the paints' signature AND builtUrl: item.url is read inside as a
    // guard, not a trigger, so a model change does not fire this (the build effect
    // owns that). builtUrl fires it once when the model finishes building, catching
    // a fabric fetch that resolved mid-build. A fresh `fabric` object each render is
    // why the signature string, not the object, is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fabricSignature, builtUrl])

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
