'use client'

import type { BufferGeometry, DirectionalLight, Material, Matrix4, Object3D, Scene, Texture, WebGLRenderer } from 'three'
import type { P3dFormat } from '@/modules/product-3d-views-for-shop/lib/formats'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'

// The lighting numbers addLights needs, pulled out of the full config so this
// file - shared by the stage viewer and the thumbnail strip - depends on the
// four intensities it actually uses rather than the whole settings shape. Every
// default is the value this module hardcoded before the settings existed, so a
// caller that passes nothing lights a scene exactly as it always did.
export type P3dLighting = Pick<
  P3dConfig,
  'environmentIntensity' | 'ambientIntensity' | 'keyLightIntensity' | 'fillLightIntensity'
>

const DEFAULT_LIGHTING: P3dLighting = {
  environmentIntensity: 1,
  ambientIntensity: 0.6,
  keyLightIntensity: 1.2,
  fillLightIntensity: 0.4,
}

// Loading and framing a model, kept apart from the React components so both the
// thumbnails and the stage viewer frame a model identically - a thumbnail that
// sat at a different distance from its own stage would read as a different model.
//
// Everything here imports three dynamically. three plus a loader is the better
// part of a megabyte, and a shop's product page must not carry that for the sake
// of the products that have no model - which is nearly all of them. These
// functions are only ever called from inside an effect, on a page that has
// already established it has a model to draw, so the cost lands on the shoppers
// who actually get something for it.

// Loaded once and shared: two thumbnails of the same file should not fetch and
// parse it twice, and a size run pointing every variation at one model is the
// normal case, not the exotic one. Keyed by url, holding the promise rather than
// the result so concurrent callers share one parse rather than racing.
const cache = new Map<string, Promise<Object3D>>()

async function parse(url: string, format: P3dFormat): Promise<Object3D> {
  switch (format) {
    case 'glb':
    case 'gltf': {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
      const gltf = await new GLTFLoader().loadAsync(url)
      return gltf.scene
    }
    case 'obj': {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
      // No .mtl is fetched: the admin uploaded one file, and an OBJ's materials
      // live in a sibling that was never uploaded with it. The loader's default
      // white material is what an unaccompanied OBJ honestly looks like, and the
      // editor's help text says so rather than letting it surprise anyone.
      return await new OBJLoader().loadAsync(url)
    }
    case 'fbx': {
      const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')
      return await new FBXLoader().loadAsync(url)
    }
    case '3ds': {
      const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js')
      return await new TDSLoader().loadAsync(url)
    }
  }
}

export async function loadModel(url: string, format: P3dFormat): Promise<Object3D> {
  let entry = cache.get(url)
  if (!entry) {
    // A failed load must not poison the cache: a shopper who reopens the tab
    // after their connection came back should get a fresh attempt, not the old
    // rejection handed straight back.
    entry = parse(url, format).catch((error) => {
      cache.delete(url)
      throw error
    })
    cache.set(url, entry)
  }
  // Every caller gets its own copy. The cached object is a shared parse result;
  // handing the same instance to two scenes would have them fight over one
  // transform, so the thumbnail and the stage would drag each other around.
  return (await entry).clone(true)
}

// Fabric textures cached by url, so re-selecting a colour is instant - no second
// fetch, no second decode. The MASTER texture stays here and is never disposed: a
// fabric range is a few dozen colours, which is a bounded, acceptable cache. Each
// application clones the master (see applyFabricPaint), so a viewer owns a Texture
// it can set its own tiling on and dispose when it swaps colour, without touching
// the shared master another viewer may still be holding. Same "hold the promise"
// trick as the model cache above, so concurrent callers share one load.
const textureCache = new Map<string, Promise<Texture>>()

async function loadTexture(url: string): Promise<Texture> {
  let entry = textureCache.get(url)
  if (!entry) {
    const { TextureLoader } = await import('three')
    // A failed load must not poison the cache, so a reselect after the connection
    // came back gets a fresh attempt rather than the old rejection handed back.
    entry = new TextureLoader().loadAsync(url).catch((error) => {
      textureCache.delete(url)
      throw error
    })
    textureCache.set(url, entry)
  }
  return entry
}

/**
 * Paint one named material slot with an external texture at a given tile repeat.
 * Only the baseColor (`map`) is replaced; the material's normalMap, roughness and
 * the rest are left untouched, so the fabric keeps the model's own surface relief
 * and lighting response and only its colour and weave change.
 *
 * Matches by the glTF material NAME, not a mesh index: that name is the contract
 * between a saved config and the file (see lib/db/fabric-config.ts). One glTF
 * material can back several meshes (a loader splits a multi-primitive mesh into one
 * material each), so every material carrying the name is painted with one shared
 * clone.
 *
 * Returns the Texture it set - or null when the model has no material of that name -
 * so the caller can dispose it when it swaps it out. The caller owns that disposal;
 * the shared master in the cache above is not ours to free here.
 */
export async function applyFabricPaint(
  model: Object3D,
  paint: { materialName: string; textureUrl: string; repeat: number },
): Promise<Texture | null> {
  const three = await import('three')
  const master = await loadTexture(paint.textureUrl)

  const build = (existing: Texture | null | undefined): Texture => {
    const tex = master.clone()
    tex.colorSpace = three.SRGBColorSpace
    tex.wrapS = three.RepeatWrapping
    tex.wrapT = three.RepeatWrapping
    // glTF's UV origin is top-left, so its baseColor maps load flipY=false, while
    // TextureLoader defaults to flipY=true - which would mirror the weave against
    // the model's UVs. Copy the slot's own existing map where there is one (the
    // safest match against an odd export), and default to the glTF convention where
    // there is not.
    if (existing) {
      tex.flipY = existing.flipY
      tex.channel = existing.channel
      tex.center.copy(existing.center)
      tex.rotation = existing.rotation
      tex.offset.copy(existing.offset)
    } else {
      tex.flipY = false
    }
    tex.repeat.set(paint.repeat, paint.repeat)
    return tex
  }

  let texture: Texture | null = null
  model.traverse((child) => {
    const mesh = child as Object3D & { material?: unknown }
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const material of materials) {
      const mat = material as { name?: string; map?: Texture | null; needsUpdate?: boolean }
      if (mat.name !== paint.materialName) continue
      // Built lazily off the first matched material, then shared with the rest.
      const tex = texture ?? (texture = build(mat.map))
      mat.map = tex
      mat.needsUpdate = true
    }
  })

  return texture
}

/**
 * The unique glTF material names in a model. The fabric configurator offers these
 * as the slot options, since a material name is the contract between a saved config
 * and the file (see applyFabricPaint).
 */
export function collectMaterialNamesFrom(model: Object3D): string[] {
  const names = new Set<string>()
  model.traverse((child) => {
    const mesh = child as Object3D & { material?: unknown }
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const material of materials) {
      const name = (material as { name?: string }).name
      if (name) names.add(name)
    }
  })
  return [...names]
}

/**
 * The model's bounding-box height (its Y extent) in the model's OWN units,
 * world-space. One of the two numbers the fabric configurator measures from the
 * mesh at config time: paired with the product's real height (a per-variation
 * attribute value) it fixes the model's real-world scale, which the file itself
 * does not reliably state - the same mm-vs-metres ambiguity frameModel works around.
 */
export async function measureModelHeight(model: Object3D): Promise<number> {
  const { Box3, Vector3 } = await import('three')
  return new Box3().setFromObject(model).getSize(new Vector3()).y
}

/**
 * The texel density of a named material: UV units per model-unit (linear),
 * area-weighted across every triangle carrying that material. This is how the
 * material's texture is stretched over its geometry, and the other number the
 * configurator measures at config time (see tileRepeat in lib/fabric/resolve.ts).
 *
 * Measured per triangle, NEVER from the global UV bounding box: a real product model
 * is unwrapped into islands scattered across UV space, so the span is meaningless
 * while the per-triangle ratio of texture area to real (world-space) area is exact -
 * the lesson the flat-weave saga in FIELD_NOTES paid for. 3D area is taken in world
 * space, so a node scale on the mesh counts; UV area is the raw geometry UVs, since
 * the tile repeat applyFabricPaint later sets REPLACES any KHR_texture_transform
 * rather than compounding with it.
 *
 * Returns 0 when the material is absent or its meshes carry no UVs, which the config
 * stores as "not measured" and tileRepeat treats as uncalibrated.
 */
export async function measureTexelDensity(model: Object3D, materialName: string): Promise<number> {
  const { Vector3 } = await import('three')
  model.updateMatrixWorld(true)

  const pa = new Vector3()
  const pb = new Vector3()
  const pc = new Vector3()
  const eab = new Vector3()
  const eac = new Vector3()
  const cross = new Vector3()
  let uvArea = 0
  let worldArea = 0

  model.traverse((child) => {
    const mesh = child as Object3D & {
      isMesh?: boolean
      geometry?: BufferGeometry
      material?: Material | Material[]
      matrixWorld: Matrix4
    }
    if (!mesh.isMesh || !mesh.geometry) return
    const geometry = mesh.geometry
    if (!geometry.hasAttribute('position') || !geometry.hasAttribute('uv')) return

    const position = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')
    const index = geometry.index
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    const refCount = index ? index.count : position.count
    const vertexAt = (i: number): number => (index ? index.getX(i) : i)

    // A multi-material mesh splits its triangles into groups by materialIndex, so
    // only the groups whose material carries the name count. A plain single-material
    // mesh (what GLTFLoader gives) has no groups, so treat it as one group over
    // material[0].
    const groups = geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count: refCount, materialIndex: 0 }]

    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0]
      if (!material || material.name !== materialName) continue
      const stop = Math.min(group.start + group.count, refCount)
      for (let i = group.start; i + 3 <= stop; i += 3) {
        const i0 = vertexAt(i)
        const i1 = vertexAt(i + 1)
        const i2 = vertexAt(i + 2)

        pa.fromBufferAttribute(position, i0).applyMatrix4(mesh.matrixWorld)
        pb.fromBufferAttribute(position, i1).applyMatrix4(mesh.matrixWorld)
        pc.fromBufferAttribute(position, i2).applyMatrix4(mesh.matrixWorld)
        worldArea += 0.5 * cross.crossVectors(eab.subVectors(pb, pa), eac.subVectors(pc, pa)).length()

        const ax = uv.getX(i0)
        const ay = uv.getY(i0)
        const bx = uv.getX(i1)
        const by = uv.getY(i1)
        const cx = uv.getX(i2)
        const cy = uv.getY(i2)
        uvArea += 0.5 * Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay))
      }
    }
  })

  if (worldArea <= 0 || uvArea <= 0) return 0
  return Math.sqrt(uvArea / worldArea)
}

/**
 * Centre a model on the origin and scale it to a predictable size, then drop it
 * into the scene. Models arrive in wildly different units - a chair authored in
 * millimetres and one authored in metres differ by a thousand - so framing by the
 * model's own bounding box is the only way one camera position suits them all.
 * Without this, half of what an admin uploads renders as either a speck or an
 * invisible wall of polygons filling the near plane.
 *
 * Returns the PIVOT the model now hangs off, not the model: rotate that. The
 * model's own origin is wherever the exporter left it, which for a real product
 * file is nowhere near the middle of the thing - the Chiro Plus's chair sits a
 * metre and a half off its file's origin, because the authoring tool wrote out
 * the whole showroom's coordinates. Turning the model itself therefore swings it
 * round a point out in space like a rider on a carousel: it leaves the frame
 * entirely and comes back, which is why the thumbnails looked empty most of the
 * time. Centring inside a pivot puts the axis through the model's own middle, so
 * turning it looks like turning it.
 */
export async function frameModel(scene: Scene, model: Object3D, fitTo = 2): Promise<Object3D> {
  const { Box3, Group, Vector3 } = await import('three')
  const size = new Box3().setFromObject(model).getSize(new Vector3())

  const largest = Math.max(size.x, size.y, size.z)
  // A degenerate box (an empty or unparseable model) would divide by zero and
  // scale the thing to infinity, so leave it alone and let it render as whatever
  // it is rather than as NaN.
  if (largest > 0 && Number.isFinite(largest)) model.scale.setScalar(fitTo / largest)

  // Re-measured after scaling rather than multiplying the old centre through:
  // the two agree for a plain scale and stop agreeing the moment a loader hands
  // back a model with a transform already on its root, which FBX routinely does.
  const centre = new Box3().setFromObject(model).getCenter(new Vector3())
  model.position.sub(centre)

  const pivot = new Group()
  pivot.add(model)
  scene.add(pivot)
  return pivot
}

/**
 * Turn anisotropic texture filtering up to the GPU's maximum for every texture in
 * a model. three loads textures at anisotropy 1 - its own default, and the one
 * thing GLTFLoader never sets - which means any surface seen at a grazing angle
 * samples a heavily-downsampled mip and washes its detail out to a single flat
 * colour. A chair's seat and back are exactly that: large, and mostly viewed
 * obliquely as the model turns. A fine fabric weave is the first thing to
 * disappear, leaving one blob of colour where the texture should be. Tone mapping
 * (Filmic and friends) does nothing for this - it remaps brightness, not sharpness.
 *
 * Every other viewer (Blender, macOS Quick Look, the pCon catalogue) filters this
 * way as a matter of course; without it we drew the same file softer than the
 * software it was authored in - the same "we were the odd one out" story as the
 * missing environment that turned chrome black.
 *
 * Needs the renderer only to ask the GPU its ceiling (getMaxAnisotropy, typically
 * 16). It costs nothing at draw time beyond a sampler flag: no extra geometry, no
 * bigger texture, just a better read of the one already uploaded. Applied to every
 * map, not only the base colour, so a normal map's relief holds up at an angle too.
 */
export function applyMaxAnisotropy(model: Object3D, renderer: WebGLRenderer): void {
  const max = renderer.capabilities.getMaxAnisotropy()
  // 1 means the GPU offers no anisotropic filtering (or is capped to none); there
  // is nothing to raise, and writing it back would only force a pointless re-upload.
  if (max <= 1) return
  model.traverse((child) => {
    const mesh = child as Object3D & { material?: unknown }
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const material of materials) {
      const m = material as Record<string, unknown>
      // Same structural probe disposeModel uses: the loaders hand back materials
      // whose texture slots (map, normalMap, roughnessMap, …) are the only values
      // flagged isTexture, so walking the properties catches every map by shape
      // rather than naming each one and missing whatever a model happens to carry.
      for (const value of Object.values(m)) {
        const tex = value as { isTexture?: boolean; anisotropy?: number; needsUpdate?: boolean } | null
        if (tex && typeof tex === 'object' && tex.isTexture && tex.anisotropy !== max) {
          tex.anisotropy = max
          // Textures are shared across the clones loadModel hands out, so this may
          // touch one already raised by another mount; the guard above keeps that a
          // no-op. When it does change, needsUpdate re-uploads it once with the new
          // sampler state, then three clears the flag itself.
          tex.needsUpdate = true
        }
      }
    }
  })
}

/**
 * Release a model's GPU memory. Geometries and textures live in the GPU and are
 * not reachable by the garbage collector, so a shopper flicking through the
 * variations of a product would otherwise pile up every model they had looked at
 * until the tab fell over.
 */
export function disposeModel(model: Object3D): void {
  model.traverse((child) => {
    const mesh = child as Object3D & {
      geometry?: { dispose?: () => void }
      material?: unknown
    }
    mesh.geometry?.dispose?.()
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const material of materials) {
      const m = material as { dispose?: () => void } & Record<string, unknown>
      // A material's texture maps are separate GPU allocations and are not freed
      // by disposing the material itself.
      for (const value of Object.values(m)) {
        const maybeTexture = value as { isTexture?: boolean; dispose?: () => void } | null
        if (maybeTexture && typeof maybeTexture === 'object' && maybeTexture.isTexture) maybeTexture.dispose?.()
      }
      m.dispose?.()
    }
  })
}

// The environment is generated once per renderer and shared by every scene it
// draws: PMREM is a real cost (it renders and filters a small cubemap), and the
// thumbnail strip builds one scene per thumbnail off a single shared renderer.
// Keyed weakly so a disposed renderer takes its entry with it rather than
// pinning a GPU texture for the life of the page.
const environments = new WeakMap<WebGLRenderer, Texture>()

/**
 * Light a scene the way glTF expects: an image-based environment, plus a gentle
 * directional rig for definition.
 *
 * The environment is not a nicety, it is most of the point. A PBR material with
 * `metallic: 1` has NO diffuse term - a metal's colour is *entirely* what it
 * reflects. Lights alone give it nothing to reflect but a pinprick specular, so
 * without an environment every chrome, steel and aluminium surface renders
 * BLACK. Deskwell's Chiro Plus has a polished chrome base (metallic 1, roughness
 * 0) that came out black on the site and silver in every desktop viewer, which
 * is what put us onto this: measured 9.3 brightness without an environment, 195.4
 * with, and the model file makes no difference either way. Every other viewer
 * (macOS Quick Look, Blender, the pCon catalogue) supplies a default environment
 * as a matter of course; we were the odd one out.
 *
 * `RoomEnvironment` is three's own procedural studio - a few emissive boxes in a
 * white room, built in code. No asset to host, nothing to fetch, no licence.
 *
 * The lights are much weaker than they were. They previously carried the whole
 * scene alone and had to be cranked to do it (ambient 2, key 2.5), which flooded
 * out the very shading that makes a normal map read as texture. With the
 * environment doing the ambient work, these only add direction.
 *
 * Returns the key light so a caller that wants shadows (the stage viewer, never
 * the thumbnails) can turn it into the caster - see addShadowCatcher. The
 * intensities and the environment's contribution are the site owner's, defaulting
 * to the values above.
 */
export async function addLights(
  scene: Scene,
  renderer: WebGLRenderer,
  lighting: P3dLighting = DEFAULT_LIGHTING,
): Promise<DirectionalLight> {
  const { AmbientLight, DirectionalLight, PMREMGenerator } = await import('three')

  let environment = environments.get(renderer)
  if (!environment) {
    const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js')
    const pmrem = new PMREMGenerator(renderer)
    environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    // The generator's own scratch targets, not the texture it handed back.
    pmrem.dispose()
    environments.set(renderer, environment)
  }
  scene.environment = environment
  // Scales the environment's contribution without rebuilding the PMREM texture,
  // so the cache above still holds and only this scalar changes per scene. This
  // is the dial that decides whether chrome reads as metal or as a black hole.
  scene.environmentIntensity = lighting.environmentIntensity

  scene.add(new AmbientLight(0xffffff, lighting.ambientIntensity))
  const key = new DirectionalLight(0xffffff, lighting.keyLightIntensity)
  key.position.set(3, 5, 4)
  scene.add(key)
  const fill = new DirectionalLight(0xffffff, lighting.fillLightIntensity)
  fill.position.set(-4, 1, -3)
  scene.add(fill)
  return key
}

// Shadow map size and PCF radius per softness. Bigger map + wider radius is
// softer and costs more; the numbers are picked so 'soft' looks right on a
// product-sized model at the stage's usual on-screen size.
const SHADOW_QUALITY: Record<P3dConfig['shadowSoftness'], { mapSize: number; radius: number }> = {
  sharp: { mapSize: 2048, radius: 1 },
  soft: { mapSize: 1024, radius: 4 },
  softest: { mapSize: 512, radius: 8 },
}

/**
 * Put a shadow under a framed model: a ground plane that catches the key light's
 * shadow and nothing else, plus the renderer and light state that makes the light
 * cast one. Only the stage viewer calls this - a shadow on a 64px thumbnail is
 * cost with nothing to show for it, and the thumbnails spin their pivot, which
 * would drag a baked-in shadow round with them.
 *
 * The plane sits at the model's own base, found from its post-frame bounding box,
 * so it grounds the model rather than floating under or clipping through it. The
 * camera orbits (autoRotate moves the camera, not the model), so the model and
 * its shadow hold still while the view goes round - which is what a real object
 * on a surface does.
 *
 * Returns a teardown for the plane's geometry and material; the caller already
 * disposes the model and renderer, this is the one thing here it did not make.
 */
export async function addShadowCatcher(
  scene: Scene,
  renderer: WebGLRenderer,
  keyLight: DirectionalLight,
  model: Object3D,
  opts: { softness: P3dConfig['shadowSoftness']; opacity: number },
): Promise<() => void> {
  const { Box3, Mesh, PlaneGeometry, ShadowMaterial, Vector3, PCFSoftShadowMap } = await import('three')

  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap

  const quality = SHADOW_QUALITY[opts.softness]

  // Every mesh in the model casts, or the shadow is of an empty space. Probed
  // structurally rather than against the Mesh class: the loaders hand back plain
  // Object3D trees and isMesh is the flag three itself checks.
  model.traverse((child) => {
    const mesh = child as { isMesh?: boolean; castShadow: boolean }
    if (mesh.isMesh) mesh.castShadow = true
  })

  const box = new Box3().setFromObject(model)
  const size = box.getSize(new Vector3())
  const centre = box.getCenter(new Vector3())
  // A plane comfortably larger than the model's footprint, so the shadow never
  // falls off its edge, laid flat at the model's base.
  const extent = Math.max(size.x, size.z) * 4 || 4
  const ground = new Mesh(
    new PlaneGeometry(extent, extent),
    // ShadowMaterial is transparent everywhere the shadow is not, so on a
    // transparent stage the plane itself is invisible and only the shadow shows.
    new ShadowMaterial({ opacity: opts.opacity }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set(centre.x, box.min.y, centre.z)
  ground.receiveShadow = true
  scene.add(ground)

  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(quality.mapSize, quality.mapSize)
  keyLight.shadow.radius = quality.radius
  // The shadow camera is orthographic and must contain the model, or the shadow
  // is clipped to a box smaller than the thing casting it. Sized off the model
  // with headroom, near/far spanning the light's distance to the ground.
  const reach = Math.max(size.x, size.y, size.z) * 1.5 || 3
  const cam = keyLight.shadow.camera
  cam.left = -reach
  cam.right = reach
  cam.top = reach
  cam.bottom = -reach
  cam.near = 0.1
  cam.far = reach * 6
  cam.updateProjectionMatrix()

  return () => {
    scene.remove(ground)
    ground.geometry.dispose()
    ground.material.dispose()
  }
}

/**
 * Drop the environment built for `renderer`. Only for a caller that is disposing
 * the renderer itself - the texture outlives the WeakMap entry otherwise, since
 * a GPU allocation is not something the garbage collector can see.
 */
export function disposeEnvironment(renderer: WebGLRenderer): void {
  environments.get(renderer)?.dispose()
  environments.delete(renderer)
}
