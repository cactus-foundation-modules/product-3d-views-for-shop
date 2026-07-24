import { describe, it, expect } from 'vitest'
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene, Vector3 } from 'three'
import { frameModel } from '@/modules/product-3d-views-for-shop/lib/three/load-model'

// One camera position has to suit every file an admin uploads, so frameModel
// normalises each model to the same size before it reaches the stage. The whole
// feature rests on it: get the factor wrong and the model is not broken, it is
// simply the wrong size on screen, with nothing thrown and nothing logged.

/** A model `size` units across, hung under a root carrying `rootScale`. */
function modelOfSize(size: number, rootScale = 1): Group {
  const root = new Group()
  root.add(new Mesh(new BoxGeometry(size, size, size), new MeshStandardMaterial()))
  root.scale.setScalar(rootScale)
  return root
}

function worldSize(object: Group): Vector3 {
  return new Box3().setFromObject(object).getSize(new Vector3())
}

describe('frameModel', () => {
  it('scales a model with no root transform to the target size', async () => {
    const model = modelOfSize(0.5)
    const pivot = await frameModel(new Scene(), model, 2)
    const size = worldSize(pivot as Group)
    expect(size.x).toBeCloseTo(2, 5)
    expect(size.y).toBeCloseTo(2, 5)
    expect(size.z).toBeCloseTo(2, 5)
  })

  // The regression this file exists for. FBXLoader puts the file's unit
  // conversion on the root it hands back - a centimetre file arrives scaled 100 -
  // and the bounding box is measured in world space, so it already includes that.
  // Assigning the fit factor instead of multiplying it in threw the 100 away and
  // drew a desk at 1/100th of its intended size: one grey pixel, no error.
  it('keeps the size right when the loader already scaled the root (FBX)', async () => {
    const model = modelOfSize(1.6, 100) // 160 world units, the way a cm-unit FBX arrives
    const pivot = await frameModel(new Scene(), model, 2)
    const size = worldSize(pivot as Group)
    expect(size.x).toBeCloseTo(2, 5)
    expect(size.y).toBeCloseTo(2, 5)
    expect(size.z).toBeCloseTo(2, 5)
  })

  it('preserves a non-uniform root scale rather than flattening it to a cube', async () => {
    const model = modelOfSize(1)
    model.scale.set(4, 2, 2) // 4 x 2 x 2 in world space
    const pivot = await frameModel(new Scene(), model, 2)
    const size = worldSize(pivot as Group)
    expect(size.x).toBeCloseTo(2, 5)
    expect(size.y).toBeCloseTo(1, 5)
    expect(size.z).toBeCloseTo(1, 5)
  })

  it('centres the model on the pivot, wherever the exporter left its origin', async () => {
    const model = modelOfSize(1)
    model.children[0]!.position.set(150, -20, 7) // origin miles from the geometry
    const pivot = await frameModel(new Scene(), model, 2)
    const centre = new Box3().setFromObject(pivot).getCenter(new Vector3())
    expect(centre.length()).toBeCloseTo(0, 5)
  })

  it('leaves a model with no measurable size alone rather than scaling it to NaN', async () => {
    const model = new Group()
    const pivot = await frameModel(new Scene(), model, 2)
    expect(model.scale.x).toBe(1)
    expect(pivot.children).toContain(model)
  })
})
