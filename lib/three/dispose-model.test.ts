import { describe, it, expect, vi } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three'
import { disposeModel, disposeRenderer } from '@/modules/product-3d-views-for-shop/lib/three/load-model'

// What a mount of a model owns, and what it merely points at.
//
// loadModel hands every caller a clone whose GEOMETRY and TEXTURES are the cached
// master's, shared with every other clone alive on the page - only the materials are
// per-clone. disposeModel used to free all three, so a shopper changing an option
// deleted the GPU buffers the thumbnail strip and the next clone were still using.
// three re-uploads most of that on the next draw, but a texture it cannot re-upload
// binds its 1x1 empty texture instead, which is opaque black - a model that flashes
// black for a frame after an option change.
//
// These are cheap tests of an expensive mistake: the symptom only ever showed on a
// real GPU, minutes into a real session, on somebody else's machine.

/** A one-mesh model whose material carries a base colour map, as a glTF's would. */
function mountedModel(): { root: Group; geometry: BoxGeometry; material: MeshStandardMaterial; map: Texture } {
  const geometry = new BoxGeometry(1, 1, 1)
  const map = new Texture()
  const material = new MeshStandardMaterial({ map })
  const root = new Group()
  root.add(new Mesh(geometry, material))
  return { root, geometry, material, map }
}

describe('disposeModel', () => {
  it('frees the clone\'s own materials', () => {
    const { root, material } = mountedModel()
    const freed = vi.spyOn(material, 'dispose')
    disposeModel(root)
    expect(freed).toHaveBeenCalledTimes(1)
  })

  it('leaves the geometry alone - it belongs to the cached master', () => {
    const { root, geometry } = mountedModel()
    const freed = vi.spyOn(geometry, 'dispose')
    disposeModel(root)
    expect(freed).not.toHaveBeenCalled()
  })

  it('leaves the file\'s textures alone - every other clone still points at them', () => {
    const { root, map } = mountedModel()
    const freed = vi.spyOn(map, 'dispose')
    disposeModel(root)
    expect(freed).not.toHaveBeenCalled()
  })

  it('handles a mesh with several materials, and one with none', () => {
    const a = new MeshStandardMaterial()
    const b = new MeshStandardMaterial()
    const root = new Group()
    root.add(new Mesh(new BoxGeometry(1, 1, 1), [a, b]))
    root.add(new Group())
    const freedA = vi.spyOn(a, 'dispose')
    const freedB = vi.spyOn(b, 'dispose')
    expect(() => disposeModel(root)).not.toThrow()
    expect(freedA).toHaveBeenCalledTimes(1)
    expect(freedB).toHaveBeenCalledTimes(1)
  })
})

describe('disposeRenderer', () => {
  // three's own dispose() keeps the WebGL context. A page that retires a renderer
  // without asking for the context back banks one live context per teardown, and a
  // browser past its context budget force-loses the OLDEST live one - which on a
  // product page is the stage viewer the shopper is looking at.
  it('gives the WebGL context back before disposing', () => {
    const order: string[] = []
    const renderer = {
      forceContextLoss: () => { order.push('lose') },
      dispose: () => { order.push('dispose') },
    }
    disposeRenderer(renderer as unknown as Parameters<typeof disposeRenderer>[0])
    expect(order).toEqual(['lose', 'dispose'])
  })

  // A context the browser has already taken cannot be lost again, and the extension
  // may simply not be there. Neither is a reason to skip the dispose.
  it('still disposes when the context cannot be lost', () => {
    const disposed = vi.fn()
    const renderer = {
      forceContextLoss: () => { throw new Error('no WEBGL_lose_context') },
      dispose: disposed,
    }
    expect(() => disposeRenderer(renderer as unknown as Parameters<typeof disposeRenderer>[0])).not.toThrow()
    expect(disposed).toHaveBeenCalledTimes(1)
  })
})
