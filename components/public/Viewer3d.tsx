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
import type { Object3D, Texture, WebGLRenderer as ThreeRenderer } from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { addLights, addShadowCatcher, applyFabricPaint, applyMaxAnisotropy, disposeEnvironment, disposeModel, frameModel, loadModel, prefetchTexture } from '@/modules/product-3d-views-for-shop/lib/three/load-model'
import type { FabricBundle, P3dItem } from '@/modules/product-3d-views-for-shop/lib/types'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'

type Status = 'loading' | 'ready' | 'failed'

// The view a shopper had when the last stage viewer was torn down: camera framing,
// the model's own turn (spin mode), and the touch latches. Captured in dispose and
// re-applied by the next build, so choosing an option that swaps the model (a
// headrest, a different base) does not snap the view back to the opening framing -
// the shopper zoomed in on a corner stays on that corner while the model changes
// under them. Module-scope, not a ref: a fabric product's stage remounts across the
// painted/unpainted component boundary, which destroys any per-component state, and
// there is only ever one stage viewer on screen at a time. frameModel normalises
// every model into the same 2-unit box at the origin, which is what makes a camera
// position from one model meaningful on another.
type CarriedView = {
  position: { x: number; y: number; z: number }
  target: { x: number; y: number; z: number }
  pivotY: number
  touched: boolean
  moved: boolean
  // Whether the idle turn was actually running when the old viewer was torn
  // down. This, not `touched`, is what the next build resumes: a shopper who
  // stopped the spin and then pressed Reset view asked for the turn back by
  // name, and an option change must not quietly overrule them. `touched` keeps
  // its own job (never re-showing the drag hint) - the two questions parted
  // company the moment Reset could restart the motion without clearing the
  // hint latch.
  spinning: boolean
  // When it was captured. A carry is only honoured moments after the capture -
  // the dispose-then-rebuild of an option change - so a client-side navigation
  // to a different product minutes later opens at the opening framing, not
  // wherever the last product happened to be left.
  at: number
}
let carriedView: CarriedView | null = null

// The carry, if it is fresh enough to be the other half of an option change. Not
// consumed on read: a rapid flick through options can cancel a build before it
// ever owns a disposer, and the next build still deserves the view.
function takeCarriedView(): CarriedView | null {
  if (carriedView && performance.now() - carriedView.at < 3000) return carriedView
  return null
}

// The fabric configurator's paints for the model on the stage: which named
// material to texture, with what and at what tile density. Optional - a viewer
// with no `fabric` prop behaves exactly as it always has.
type FabricPaints = { slots: FabricBundle['slots'] }

export function Viewer3d({ item, settings, fabric }: { item: P3dItem; settings: P3dConfig; fabric?: FabricPaints }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<Status>('loading')
  // Two separate latches, because the hint and the reset button ask different
  // questions. `touched` is "have they ever taken hold of this", and never goes
  // back - the drag hint has made its point and re-showing it would nag someone
  // who has already proved they know. `moved` is "is the view currently away
  // from where it started", which a reset genuinely undoes: the model is back to
  // its opening framing and turning again, so there is nothing left to reset and
  // the button has no reason to be on screen.
  const [touched, setTouched] = useState(false)
  const [moved, setMoved] = useState(false)

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

  // Set by build() once the camera, controls and pivot exist, and nulled on
  // dispose. Same reason as modelRef: those three live only inside build()'s
  // closure, and the Reset view button below needs a handle on them without
  // hoisting the whole WebGL setup into React state.
  const resetRef = useRef<(() => void) | null>(null)

  // The live renderer, kept only so the brightness effect below can reach it.
  // Null before the first build finishes and after a dispose.
  const rendererRef = useRef<ThreeRenderer | null>(null)

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
    // Read here, synchronously after the previous viewer's dispose captured it -
    // the model load inside build() can take seconds, and the freshness window is
    // about the dispose-to-rebuild gap, not the download.
    const carried = takeCarriedView()
    // A carried view carries its latches too: the shopper who dragged the old model
    // has still dragged (no re-showing the hint), and a view away from its opening
    // framing still deserves the Reset button.
    setTouched(carried?.touched ?? false)
    setMoved(carried?.moved ?? false)

    async function build(): Promise<void> {
      const three = await import('three')
      const { Scene, PerspectiveCamera, WebGLRenderer, Color, AnimationMixer, Clock } = three
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
        rendererRef.current = renderer

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
          // In camera-orbit mode nothing in the WORLD ever moves - only the camera
          // does, and a shadow map lives in the light's view, not the camera's - so
          // the map is baked once here and the per-frame shadow pass saved. In spin
          // mode the map stays LIVE: the model is the thing that turns, and with the
          // light and the floor fixed the shadow cannot travel - it stays anchored
          // under the model while its silhouette follows the turning shape, which is
          // what a real object turning on a surface does. (v0.1.24 had this inverted:
          // it froze the map for spin mode, which anchored the shadow by petrifying
          // its shape - the outline never followed the model round.)
          //
          // autoUpdate false stops the per-frame render; needsUpdate true buys exactly
          // one, which the first frame below spends (three clears the flag itself).
          if (!settings.spinModel) {
            renderer.shadowMap.autoUpdate = false
            renderer.shadowMap.needsUpdate = true
          }
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

        // Re-apply the view the previous model was torn down under, AFTER the
        // controls are constructed: OrbitControls saved the default framing above,
        // so Reset view still means the opening view, not the carried one. The
        // next controls.update() clamps the carried distance into this build's
        // own min/max, so a settings change between builds cannot strand the
        // camera out of bounds.
        if (carried) {
          camera.position.set(carried.position.x, carried.position.y, carried.position.z)
          controls.target.set(carried.target.x, carried.target.y, carried.target.z)
          pivot.rotation.y = carried.pivotY
          controls.update()
        }

        // Two kinds of viewer, picked by spinModel. Off (the historic default): the
        // camera does everything - auto-rotate orbits it, and a drag swings it round
        // a still model. On: the MODEL is the thing that turns, idle or dragged,
        // while the camera, the light and the floor hold still - which is what keeps
        // the shadow anchored to the floor while the model turns within it. For that
        // to hold under a drag too, a horizontal drag must NOT orbit the camera:
        // orbiting moves the whole world in view, shadow and floor included, which
        // reads as the shadow travelling round with the model - the exact complaint
        // spin mode exists to fix. So the azimuth is locked to where it starts and
        // horizontal drag is re-pointed at the pivot below; vertical tilt, zoom and
        // pan stay the camera's.
        const spinMode = settings.spinModel
        if (spinMode) {
          const azimuth = controls.getAzimuthalAngle()
          controls.minAzimuthAngle = azimuth
          controls.maxAzimuthAngle = azimuth
        }

        // The site owner's choice, but a shopper who asked their system for less
        // movement still overrides it - reduced motion is theirs to set, not the
        // owner's to switch off. Only the IDLE motion is gated: a drag is the
        // shopper's own hand, and motion they cause is theirs to cause.
        const wantsMotion =
          settings.autoRotate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        // An option change resumes whatever the idle motion was DOING when the
        // old viewer went: still spinning (never touched, or touched then Reset)
        // carries on; stopped stays stopped. Keyed on the carry's `spinning`,
        // not `touched` - a shopper who pressed Reset view asked for the turn
        // back, and swapping a headrest is no reason to take it away again.
        controls.autoRotate = wantsMotion && !spinMode && (carried ? carried.spinning : true)
        controls.autoRotateSpeed = settings.autoRotateSpeed
        // Per-frame turn for the model-spin path, matched to OrbitControls' own
        // auto-rotation step so both modes read at the same speed for a given
        // autoRotateSpeed.
        const spinStep = ((2 * Math.PI) / 60 / 60) * settings.autoRotateSpeed
        let idleSpin = wantsMotion && spinMode && (carried ? carried.spinning : true)
        // Plain booleans shadowing the touched/moved state, because dispose() below
        // captures the view for the NEXT build and React state read from this
        // closure would be frozen at its mount-time value.
        let latchTouched = carried?.touched ?? false
        let latchMoved = carried?.moved ?? false
        controls.addEventListener('start', () => {
          // A touch stops the idle motion, whichever mode it was - only Reset
          // view brings it back, and it is the shopper asking for it by name.
          controls.autoRotate = false
          idleSpin = false
          latchTouched = true
          latchMoved = true
          setTouched(true)
          setMoved(true)
        })

        // The drag half of spin mode: horizontal pointer movement turns the pivot
        // (the camera's azimuth being locked above), scaled so a drag across the
        // stage's full height is one whole turn - the same ratio OrbitControls uses
        // for its own orbit, so the model under the finger feels like the camera
        // used to. A release hands the last frame's motion to the loop as velocity,
        // decayed by the same damping factor the controls use, so a flick glides
        // and settles rather than stopping dead.
        let dragPointer: number | null = null
        let dragLastX = 0
        let spinVelocity = 0
        const onPointerDown = (e: PointerEvent): void => {
          // A second finger is a pinch, and a non-left mouse button is OrbitControls'
          // pan or dolly: hand those to the controls, and stop steering the model so
          // neither jiggles the spin.
          if (!e.isPrimary || e.button !== 0) { dragPointer = null; return }
          idleSpin = false
          latchTouched = true
          latchMoved = true
          setTouched(true)
          setMoved(true)
          dragPointer = e.pointerId
          dragLastX = e.clientX
          spinVelocity = 0
        }
        const onPointerMove = (e: PointerEvent): void => {
          if (dragPointer !== e.pointerId) return
          const turn = (2 * Math.PI * (e.clientX - dragLastX)) / Math.max(host!.clientHeight, 1)
          dragLastX = e.clientX
          pivot.rotation.y += turn
          spinVelocity = turn
        }
        const onPointerEnd = (e: PointerEvent): void => {
          if (dragPointer === e.pointerId) dragPointer = null
        }
        if (spinMode) {
          // OrbitControls captures the pointer on this same canvas when a drag
          // starts, so the move and up events keep arriving here even when the
          // pointer leaves the stage mid-drag.
          canvas!.addEventListener('pointerdown', onPointerDown)
          canvas!.addEventListener('pointermove', onPointerMove)
          canvas!.addEventListener('pointerup', onPointerEnd)
          canvas!.addEventListener('pointercancel', onPointerEnd)
        }

        // Puts the viewer back to how it opened - framing AND motion, since the
        // opening view is a turning one and a model left dead still would only
        // be half of what was asked for.
        //
        // OrbitControls saved the camera's position and target when it was
        // constructed - which is after the camera.position.set above, so its
        // saved state IS the opening framing - and reset() restores both and
        // clears the damping mid-flight, so a click during a glide does not
        // fight the leftover motion. It fires 'change', not 'start', so it
        // cannot trip the latches above and undo what we set here.
        //
        // In spin mode the model itself carries the turn, so the camera reset
        // alone would leave it facing wherever it was dragged to - the pivot and
        // any leftover flick velocity have to go back too. Both are no-ops in
        // camera-orbit mode, where nothing in the world ever moves.
        //
        // The idle turn resumes through the same wantsMotion the build opened
        // with, so a shopper who asked their system for reduced motion still
        // gets a still model back: reset means "how it was for me", not "how it
        // was for someone else".
        resetRef.current = () => {
          controls.reset()
          pivot.rotation.y = 0
          spinVelocity = 0
          controls.autoRotate = wantsMotion && !spinMode
          idleSpin = wantsMotion && spinMode
          latchMoved = false
          setMoved(false)
        }

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

        // A file that ships its own animation plays it on a loop - a desk with a
        // pop-up socket demonstrating itself is the whole reason the shopper opened
        // the viewer. This is the file's motion, not ours: nothing here knows what
        // moves or how far, so a new animated product needs no code.
        //
        // Gated on the same wantsMotion as the idle turn, and for the same reason -
        // but NOT on the touch latch that stops the turn. The spin stops on touch
        // because it fights a shopper trying to look at one corner; the pop-up is
        // the thing they are trying to look at, and stopping it mid-travel would
        // freeze the model in a state the real product never sits in.
        const mixer = wantsMotion && model.animations.length > 0 ? new AnimationMixer(model) : null
        for (const clip of mixer ? model.animations : []) mixer!.clipAction(clip).play()
        // Real elapsed time, not a per-frame constant: a dropped frame on a slow
        // device should cost smoothness, not leave the socket travelling in slow
        // motion against the clock the file was authored to.
        const clock = mixer ? new Clock() : null

        const loop = (): void => {
          frame = requestAnimationFrame(loop)
          if (mixer && clock) mixer.update(clock.getDelta())
          // The model-spin path: the idle turn, or the glide left over from a drag.
          // The light and the shadow-catcher plane are scene-level and never move,
          // so the live shadow map keeps the shadow anchored on the floor while its
          // silhouette follows the model turning above it.
          if (idleSpin) {
            pivot.rotation.y += spinStep
          } else if (dragPointer === null && Math.abs(spinVelocity) > 0.0001) {
            pivot.rotation.y += spinVelocity
            spinVelocity *= 1 - settings.dampingFactor
          }
          controls.update()
          renderer.render(scene, camera)
        }
        loop()
        setStatus('ready')

        dispose = () => {
          // Captured first, while the camera, target and pivot still hold the view
          // the shopper was looking at. The next build (same component on a model
          // swap, or a fresh mount across the painted/unpainted boundary) picks it
          // up, so the viewing angle and zoom survive an option change.
          carriedView = {
            position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
            pivotY: pivot.rotation.y,
            touched: latchTouched,
            moved: latchMoved,
            // Either mode's idle motion counts; a drag mid-flight has already
            // set both to false, so a shopper holding the model as the swap
            // lands does not get it snatched into a spin.
            spinning: controls.autoRotate || idleSpin,
            at: performance.now(),
          }
          if (frame !== null) cancelAnimationFrame(frame)
          // The mixer holds bindings to this model's nodes and three caches them
          // per root, so a shopper flicking between variations would otherwise
          // leave one live binding set per model behind the disposed geometry.
          mixer?.stopAllAction()
          mixer?.uncacheRoot(model)
          observer.disconnect()
          if (spinMode) {
            canvas!.removeEventListener('pointerdown', onPointerDown)
            canvas!.removeEventListener('pointermove', onPointerMove)
            canvas!.removeEventListener('pointerup', onPointerEnd)
            canvas!.removeEventListener('pointercancel', onPointerEnd)
          }
          controls.dispose()
          disposeShadow?.()
          scene.remove(pivot)
          // This viewer's own fabric clones, freed before the model they hang off.
          // The masters they were cloned from stay in the shared texture cache.
          for (const tex of appliedRef.current.values()) tex.dispose()
          appliedRef.current.clear()
          modelRef.current = null
          builtUrlRef.current = null
          resetRef.current = null
          rendererRef.current = null
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
        rendererRef.current = null
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

  // Brightness, pushed straight at the live renderer rather than rebuilt.
  //
  // The build effect above deliberately ignores `settings`, which is right for
  // the storefront - the settings are fixed for the life of the page there. The
  // admin's brightness preview is the one place they do move, and a slider drag
  // that tore down the WebGL context and re-downloaded the model on every step
  // would be no preview at all. Exposure is a single renderer property and the
  // animation loop redraws every frame, so setting it here shows up on the next
  // one. Inert wherever the value never changes.
  useEffect(() => {
    if (rendererRef.current) rendererRef.current.toneMappingExposure = settings.exposure
  }, [settings.exposure])

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
        // The texture is fetched BEFORE the cancelled check, not inside
        // applyFabricPaint alone: applyFabricPaint stamps the material the moment
        // its await resolves, so a slow fetch for a colour the shopper has since
        // left could land after the newer colour's near-instant cached paint and
        // stamp the stale texture over it. Warming the cache first turns the
        // stamp itself near-synchronous, and the cancelled check between the two
        // stops the superseded run before it can touch the material.
        // A flat-colour slot has no texture to warm; the paint below is synchronous
        // for it either way.
        if (slot.textureUrl) await prefetchTexture(slot.textureUrl)
        if (cancelled) return
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
      {/* The way back from a view the shopper has turned, zoomed or panned
          themselves into and cannot easily undo by hand. It appears only once
          they have actually moved something - on an untouched model it would be
          offering to undo nothing - and goes again the moment it is used. Sits
          above the hint, which is centred and can reach under it on a narrow
          stage. */}
      {status === 'ready' && moved && (
        <button type="button" className="p3d-reset" onClick={() => resetRef.current?.()}>
          Reset view
        </button>
      )}
    </div>
  )
}
