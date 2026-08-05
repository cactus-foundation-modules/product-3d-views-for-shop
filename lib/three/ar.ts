// Augmented reality for the stage viewer: putting the product the shopper is
// looking at onto the floor in front of them, at real-world size.
//
// There is no single "web AR" - there are two entirely separate mechanisms, one
// per platform, and this file is the seam between them:
//
//   - Android (and any Chromium browser on an ARCore device): WebXR's
//     `immersive-ar` session. The model is rendered by OUR three.js renderer into
//     the live camera feed, a reticle tracks a real floor via hit-testing, and a
//     tap drops the model there. Nothing leaves the browser, and the model shown
//     is the exact one on the stage - the shopper's chosen fabric and all.
//
//   - iOS/iPadOS (Safari, and every in-app browser on the platform, which are all
//     WebKit): no WebXR at all. The only route is Apple's AR Quick Look, which
//     takes a USDZ file by URL or blob and takes over the screen. So we bake the
//     CURRENT scene into a USDZ in the browser with three's USDZExporter and hand
//     Quick Look a blob URL. No USDZ is ever stored: it is made from whatever is
//     on the stage at the moment the shopper taps, and thrown away after. That is
//     what keeps a fabric catalogue from needing one baked file per colour.
//
// Both paths therefore reflect the live model and neither adds a stored asset. The
// viewer picks the path with detectArSupport and never has to know which it got
// beyond calling the matching launcher.

import type { Object3D, WebGLRenderer } from 'three'

// Which AR route this device has, or null for "no AR button at all".
export type ArKind = 'webxr' | 'quicklook' | null

// How to size the model in the real world. AR renders at one metre per unit, and
// frameModel has already normalised the model to a 2-unit longest side with no
// real-world scale of its own, so a factor has to be found from something that
// knows the true size.
//
//   - realMetres + axis: the product's actual overall size (height or width) in
//     metres, which the fabric configurator already measures per variation (its
//     `realCm` along `scaleAxis`). When present this is exact: scale so the model's
//     extent along that axis equals realMetres, and every other axis follows.
//   - fallbackMetres: the owner's one global guess (arRealWorldMetres, longest side
//     in metres), used for a product the configurator has no measurement for - a
//     plain 3D product, or a fabric one whose size source did not resolve.
//
// A boardroom table at the 1m fallback lands doll-sized; its real 2.4m width, which
// the shop has already typed in for fabric tiling, lands it right. That is the whole
// reason to prefer the measured value.
export type ArSizing = {
  realMetres: number | null
  axis: 'height' | 'width'
  fallbackMetres: number
}

// The uniform scale to put on the model's holder, from the model's measured size at
// scale 1 (longest side ~2 after frameModel) and the sizing intent above.
function holderScaleFor(size: { x: number; y: number; z: number }, sizing: ArSizing): number {
  if (sizing.realMetres && sizing.realMetres > 0) {
    const axisExtent = sizing.axis === 'width' ? size.x : size.y
    if (axisExtent > 0) return sizing.realMetres / axisExtent
  }
  const longest = Math.max(size.x, size.y, size.z)
  return longest > 0 ? Math.max(sizing.fallbackMetres, 0.05) / longest : 1
}

/**
 * Which AR mechanism this device can use, if any. Cheap enough to call on mount:
 * the WebXR probe is a single async support query and the Quick Look one is a
 * synchronous capability check on an anchor element.
 *
 * Deliberately format-blind. AR does NOT export the uploaded file - it exports the
 * three.js scene the viewer has already built, and by then every format the module
 * accepts has been normalised to the same PBR materials (`normaliseMaterials` in
 * load-model), so an FBX or OBJ that renders on the stage exports to AR exactly as
 * a GLB does. The rule is simply "if you can see it turning, you can see it in your
 * room". The one thing that can still defeat an iOS bake is a model whose textures
 * will not read back (a compressed-texture edge case), and that fails gracefully:
 * the USDZ bake throws, the caller catches it, and the button just does not appear
 * on that device - the WebXR path, which renders the live scene and bakes nothing,
 * is unaffected.
 *
 * WebXR is preferred where both somehow report available (a desktop Chrome with an
 * XR emulator, say): it keeps the render in our own hands and reflects a live
 * fabric change without re-baking anything. Quick Look is the iOS-only fallback.
 */
export async function detectArSupport(): Promise<ArKind> {
  if (typeof window === 'undefined') return null

  // WebXR immersive-ar. `navigator.xr` is absent on every browser that has no
  // WebXR at all (all of iOS, desktop Safari, older Android), so the optional
  // chain does the first half of the filtering for free.
  try {
    const xr = navigator.xr
    if (xr && (await xr.isSessionSupported('immersive-ar'))) return 'webxr'
  } catch {
    // A browser that has navigator.xr but throws on the query (a locked-down
    // permissions policy, an experimental flag half-implemented) has no working
    // AR - fall through and try Quick Look rather than surface the throw.
  }

  // Apple AR Quick Look. The honest feature test is whether an <a> element's
  // relList knows the `ar` relation, which only Safari-family browsers on AR-
  // capable Apple hardware report.
  const anchor = document.createElement('a')
  if (anchor.relList && anchor.relList.supports && anchor.relList.supports('ar')) {
    return 'quicklook'
  }

  return null
}

/**
 * Bake the current model into a USDZ and return a blob URL for it, ready to hang
 * on an <a rel="ar"> that the shopper taps.
 *
 * Why a pre-baked URL and not a launch-on-click. Apple AR Quick Look must be
 * reached by a real tap on an anchor whose href is ALREADY set: Safari only lets
 * an anchor open Quick Look while the tap's user activation is live, and awaiting
 * a USDZ export inside the click handler spends that activation before the launch,
 * which Safari then blocks. So the export happens ahead of the tap (on load, and
 * again whenever the fabric changes), the URL sits waiting on the anchor, and the
 * tap itself does nothing asynchronous. The caller owns the anchor and revokes the
 * URL it gets back when it bakes a fresh one or unmounts.
 *
 * The model is CLONED for export rather than moved: the stage viewer is still live
 * behind the button, and lifting the real model out of its pivot would flash an
 * empty stage. clone(true) shares the geometry and material instances - it makes
 * only new Object3D wrappers, collected when this returns - so the export reads the
 * very same textures the shopper is looking at.
 *
 * Why the holder. USDZExporter walks `scene.children` and writes each child's
 * LOCAL matrix; the root passed in is not itself emitted. The model's framing
 * transform (the scale and centre-offset frameModel put on it) lives on the
 * model's own matrix, so the model has to be a CHILD of what we pass, or that
 * transform is silently dropped and the model exports at its raw authored size.
 * The holder is also where real-world sizing and the base-on-floor lift go.
 */
export async function bakeUsdzUrl(model: Object3D, sizing: ArSizing): Promise<string> {
  const { Scene, Group, Box3, Vector3 } = await import('three')
  const { USDZExporter } = await import('three/examples/jsm/exporters/USDZExporter.js')

  const scene = new Scene()
  const holder = new Group()
  const exportModel = model.clone(true)
  holder.add(exportModel)
  scene.add(holder)

  // Measure the model at scale 1 (longest side ~2 after frameModel) and turn the
  // real-world size into a uniform factor - the product's true height/width when
  // the configurator knows it, the owner's longest-side guess otherwise.
  //
  // PRECISE, and this is the measurement that made it necessary. Box3's cheap form
  // transforms the eight corners of each mesh's own box, which overstates the extent
  // of any part rotated off-axis - and holderScaleFor divides the real height BY this
  // number, so an overstated box shrinks the product by exactly the overstatement.
  // Three desks in this catalogue were landing in the shopper's room 22% short with
  // nothing anywhere reporting a fault. See measureModelHeight in load-model.
  scene.updateMatrixWorld(true)
  const size = new Box3().setFromObject(holder, true).getSize(new Vector3())
  holder.scale.setScalar(holderScaleFor(size, sizing))

  // Sit the model's base on the ground plane rather than its centre, so it lands
  // on the floor the way the real object would. Measured after scaling, off the
  // holder's world box, then pushed up by however far its base sits below zero.
  // Precise again, or the lift is taken from a floor the model does not reach and it
  // hovers by the difference.
  scene.updateMatrixWorld(true)
  const box = new Box3().setFromObject(holder, true)
  holder.position.y = -box.min.y
  scene.updateMatrixWorld(true)

  const exporter = new USDZExporter()
  const arraybuffer = await exporter.parseAsync(scene)

  const blob = new Blob([arraybuffer as BlobPart], { type: 'model/vnd.usdz+zip' })
  return URL.createObjectURL(blob)
}

/**
 * Run a WebXR immersive-ar session: reticle on the floor, tap to drop the model,
 * pinch to resize. Resolves when the session ends (the shopper closes it or backs
 * out), at which point the caller restarts its own render loop.
 *
 * The renderer is BORROWED. WebXR drives frames through renderer.setAnimationLoop
 * and owns renderer.xr for the duration, which cannot coexist with the viewer's
 * own requestAnimationFrame loop - so the caller parks that loop before calling
 * this and unparks it after. On the way out everything touched on the renderer is
 * put back exactly as it was, so the stage viewer resumes unchanged.
 *
 * The model is reparented into a throwaway AR scene and returned to its pivot on
 * teardown, with its transform restored byte-for-byte - moving it (rather than
 * cloning) is right here because the stage is not being drawn while AR is up, so
 * there is no empty-stage flash to avoid and the real model saves a clone of a
 * possibly large tree.
 */
export async function startWebXrAr(
  renderer: WebGLRenderer,
  model: Object3D,
  opts: ArSizing & { registerEnd?: (end: (() => void) | null) => void },
): Promise<void> {
  const THREE = await import('three')
  const { Scene, Group, PerspectiveCamera, Box3, Vector3, RingGeometry, MeshBasicMaterial, Mesh, HemisphereLight, DirectionalLight } = THREE
  const { applyEnvironment } = await import('@/modules/product-3d-views-for-shop/lib/three/load-model')

  const xr = navigator.xr
  if (!xr) return

  // dom-overlay is what puts our own close button and hint over the camera feed
  // while the session runs. Its root has to be in the document before the session
  // starts; it is removed again on teardown.
  const overlay = buildOverlay()
  document.body.appendChild(overlay.root)

  let session: XRSession
  try {
    session = await xr.requestSession('immersive-ar', {
      // hit-test is what finds the floor; without it there is no reticle to place
      // against, so it is required rather than optional - a device that offers
      // immersive-ar but not hit-test cannot do the thing the button promises, and
      // failing here is more honest than dropping the model at a guessed distance.
      requiredFeatures: ['hit-test'],
      // dom-overlay is a nicety (the close button); local is the reference space we
      // frame against. Both are widely supported but neither is worth refusing a
      // session over.
      optionalFeatures: ['dom-overlay', 'local'],
      domOverlay: { root: overlay.root },
    })
  } catch {
    // The commonest cause is the shopper declining the camera permission prompt,
    // which is theirs to decline. Nothing to report - just tidy up and return to
    // the stage as if the button had not been pressed.
    overlay.root.remove()
    return
  }

  // Hand the caller a way to end this session from outside - it uses it to close
  // AR if the shopper navigates away from the product page mid-session, which
  // would otherwise leave the model reparented into a scene about to be disposed.
  opts.registerEnd?.(() => { void session.end() })

  // Everything below runs against a live session and a borrowed renderer, so a
  // single teardown restores both no matter how the session ends. Captured now,
  // before anything is changed.
  const savedParent = model.parent
  const savedPosition = model.position.clone()
  const savedQuaternion = model.quaternion.clone()
  const savedScale = model.scale.clone()
  // The stage viewer drives itself with requestAnimationFrame, not
  // setAnimationLoop, so there is no prior animation loop to restore - parking it
  // is the caller's job. Passing null to setAnimationLoop on teardown is therefore
  // the correct "stop driving frames" for our case.
  const hadAutoLoop: null = null

  const arScene = new Scene()
  // A camera three replaces with the device pose each frame; its own values only
  // matter for the frames before the first pose, which the shopper never sees.
  const camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 40)

  // Metallic and glossy materials need an environment or they render black - the
  // same lesson as the stage (see load-model addLights). Reuse the renderer's
  // studio environment rather than build a second one; the hemisphere and key
  // light on top give the model some directional shape against the real room.
  await applyEnvironment(arScene, renderer, 1)
  arScene.add(new HemisphereLight(0xffffff, 0x808080, 1.5))
  const dir = new DirectionalLight(0xffffff, 1.2)
  dir.position.set(0.5, 1, 0.25)
  arScene.add(dir)

  // The model lives inside a holder so real-world scale, the base-on-floor lift and
  // the shopper's pinch-resize all act on the holder while the model keeps its own
  // framing transform intact for the restore at the end.
  const holder = new Group()
  holder.add(model)
  // Measure the model at scale 1 (holder identity, so pivot rotation is gone and the
  // box is axis-true), turn the real-world size into a factor, and lift so the base
  // sits at the holder's origin - place the holder on the floor and the model stands
  // on it. The lift is in the model's own framed units and survives any later resize,
  // which scales the whole holder, origin included.
  //
  // Precise, exactly as in bakeUsdzUrl above: the WebXR path sizes the product from
  // this box too, so the cheap corner form shrinks an off-axis model here in the same
  // way and by the same amount.
  const localBox = new Box3().setFromObject(model, true)
  const baseScale = holderScaleFor(localBox.getSize(new Vector3()), opts)
  model.position.y -= localBox.min.y
  holder.scale.setScalar(baseScale)
  holder.visible = false
  arScene.add(holder)

  // The reticle: a flat ring that tracks the floor the camera is pointed at until
  // the model is placed. matrixAutoUpdate off because its matrix is written whole
  // from each hit-test pose rather than composed from position/rotation.
  const reticle = new Mesh(
    new RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: 0xffffff }),
  )
  reticle.matrixAutoUpdate = false
  reticle.visible = false
  arScene.add(reticle)

  renderer.xr.enabled = true
  renderer.xr.setReferenceSpaceType('local')
  await renderer.xr.setSession(session)

  // The hit-test source is requested against the VIEWER space (a ray straight out
  // of the device) and its results are read back in the session's LOCAL space each
  // frame - that pairing is what makes the reticle sit where the shopper is
  // looking rather than where they started. requestHitTestSource is guarded by the
  // required 'hit-test' feature above, so it is present on any session that got
  // this far.
  const viewerSpace = await session.requestReferenceSpace('viewer')
  const hitTestSource = (await session.requestHitTestSource?.({ space: viewerSpace })) ?? null
  const localSpace = await session.requestReferenceSpace('local')

  let placed = false
  const placeVec = new Vector3()

  // A tap in AR arrives as a `select`. Before the model is placed it drops it at
  // the reticle; after, it moves it there - "tap somewhere else to move it". The
  // hint text switches on the first placement.
  const onSelect = (): void => {
    if (!reticle.visible) return
    placeVec.setFromMatrixPosition(reticle.matrix)
    holder.position.copy(placeVec)
    holder.visible = true
    if (!placed) {
      placed = true
      overlay.setPlaced()
    }
  }
  session.addEventListener('select', onSelect)

  // Pinch to resize the placed model, within sane bounds so it can neither vanish
  // nor swallow the room. One-finger drags are left to the reticle/tap flow, so a
  // two-pointer gesture is unambiguously a resize.
  const pointers = new Map<number, { x: number; y: number }>()
  let pinchStartDist = 0
  let pinchStartScale = baseScale
  const overlayEl = overlay.root
  const onPointerDown = (e: PointerEvent): void => { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }) }
  const onPointerUp = (e: PointerEvent): void => { pointers.delete(e.pointerId); pinchStartDist = 0 }
  const onPointerMove = (e: PointerEvent): void => {
    if (!pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size !== 2 || !placed) return
    const [a, b] = [...pointers.values()]
    if (!a || !b) return
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    if (pinchStartDist === 0) { pinchStartDist = dist; pinchStartScale = holder.scale.x; return }
    // Clamped to a wide but finite range around the real-world size: an eighth of
    // it to four times it covers "that is too big for my desk" and "let me see the
    // detail" without letting a stray gesture lose the model entirely.
    const next = Math.min(baseScale * 4, Math.max(baseScale / 8, (pinchStartScale * dist) / pinchStartDist))
    holder.scale.setScalar(next)
  }
  overlayEl.addEventListener('pointerdown', onPointerDown)
  overlayEl.addEventListener('pointerup', onPointerUp)
  overlayEl.addEventListener('pointercancel', onPointerUp)
  overlayEl.addEventListener('pointermove', onPointerMove)

  // The session runs until the shopper ends it - the close button, the system back
  // gesture, or removing the headset. Resolved through this promise so the caller
  // awaits the whole AR episode and unparks its loop only once it is truly over.
  return new Promise<void>((resolve) => {
    const teardown = (): void => {
      renderer.setAnimationLoop(hadAutoLoop)
      renderer.xr.enabled = false
      hitTestSource?.cancel?.()
      session.removeEventListener('select', onSelect)
      overlayEl.removeEventListener('pointerdown', onPointerDown)
      overlayEl.removeEventListener('pointerup', onPointerUp)
      overlayEl.removeEventListener('pointercancel', onPointerUp)
      overlayEl.removeEventListener('pointermove', onPointerMove)
      overlay.root.remove()

      // Give the model back to its pivot with its transform exactly as it was, so
      // the stage viewer picks up where it left off. The AR scene's own throwaways
      // (reticle, holder, lights) are dropped with the scene and collected; the
      // model's geometry and materials were never ours to free here.
      holder.remove(model)
      if (savedParent) savedParent.add(model)
      model.position.copy(savedPosition)
      model.quaternion.copy(savedQuaternion)
      model.scale.copy(savedScale)
      reticle.geometry.dispose()
      ;(reticle.material as { dispose(): void }).dispose()

      opts.registerEnd?.(null)
      resolve()
    }
    session.addEventListener('end', teardown)
    overlay.onClose(() => { void session.end() })

    renderer.setAnimationLoop((_time: number, frame?: XRFrame) => {
      if (frame && hitTestSource && !placed) {
        const results = frame.getHitTestResults(hitTestSource)
        const hit = results[0]
        const pose = hit?.getPose(localSpace)
        if (pose) {
          reticle.visible = true
          reticle.matrix.fromArray(pose.transform.matrix)
        } else {
          reticle.visible = false
        }
      }
      renderer.render(arScene, camera)
    })
  })
}

// The dom-overlay UI: a close button always, and a hint line that changes once the
// model is down. Built imperatively (not React) because it has to exist in the DOM
// before the XR session starts and be handed in as domOverlay.root - a React
// subtree would not be mounted in time. Styled inline off the theme's own tokens,
// which cascade from :root to this body-level element like any other.
function buildOverlay(): {
  root: HTMLDivElement
  setPlaced(): void
  onClose(fn: () => void): void
} {
  const root = document.createElement('div')
  root.className = 'p3d-ar-overlay'

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'p3d-ar-close'
  close.setAttribute('aria-label', 'Close AR view')
  close.textContent = '✕'

  const hint = document.createElement('p')
  hint.className = 'p3d-ar-hint'
  hint.textContent = 'Point at the floor, then tap to place'

  root.appendChild(close)
  root.appendChild(hint)

  return {
    root,
    setPlaced() { hint.textContent = 'Tap to move · pinch to resize' },
    onClose(fn) { close.addEventListener('click', fn) },
  }
}
