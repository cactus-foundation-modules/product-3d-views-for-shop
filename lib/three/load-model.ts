'use client'

import type { Object3D, Scene } from 'three'
import type { P3dFormat } from '@/modules/product-3d-views-for-shop/lib/formats'

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

/**
 * Centre a model on the origin and scale it to a predictable size, then drop it
 * into the scene. Models arrive in wildly different units - a chair authored in
 * millimetres and one authored in metres differ by a thousand - so framing by the
 * model's own bounding box is the only way one camera position suits them all.
 * Without this, half of what an admin uploads renders as either a speck or an
 * invisible wall of polygons filling the near plane.
 */
export async function frameModel(scene: Scene, model: Object3D, fitTo = 2): Promise<void> {
  const { Box3, Vector3 } = await import('three')
  const box = new Box3().setFromObject(model)
  const size = box.getSize(new Vector3())
  const centre = box.getCenter(new Vector3())

  const largest = Math.max(size.x, size.y, size.z)
  // A degenerate box (an empty or unparseable model) would divide by zero and
  // scale the thing to infinity, so leave it alone and let it render as whatever
  // it is rather than as NaN.
  if (largest > 0 && Number.isFinite(largest)) {
    const scale = fitTo / largest
    model.scale.setScalar(scale)
    // Re-measured after scaling rather than multiplying the old centre through:
    // the two agree for a plain scale and stop agreeing the moment a loader
    // hands back a model with a transform already on its root, which FBX
    // routinely does.
    const scaled = new Box3().setFromObject(model)
    model.position.sub(scaled.getCenter(new Vector3()))
  } else {
    model.position.sub(centre)
  }
  scene.add(model)
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

/** A neutral three-point-ish lighting rig, so an unlit model is not a silhouette. */
export async function addLights(scene: Scene): Promise<void> {
  const { AmbientLight, DirectionalLight } = await import('three')
  scene.add(new AmbientLight(0xffffff, 2))
  const key = new DirectionalLight(0xffffff, 2.5)
  key.position.set(3, 5, 4)
  scene.add(key)
  const fill = new DirectionalLight(0xffffff, 1)
  fill.position.set(-4, 1, -3)
  scene.add(fill)
}
