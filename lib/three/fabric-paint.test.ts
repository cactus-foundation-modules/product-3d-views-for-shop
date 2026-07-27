import { describe, it, expect, vi } from 'vitest'
import { Color, Mesh, MeshStandardMaterial, Texture } from 'three'
import { applyFabricPaint, resetFabricPaint } from '@/modules/product-3d-views-for-shop/lib/three/load-model'

// The configurator's promise is that one swatch means one finish, whichever file a
// variation happens to be attached to. It does not hold on its own: the base colour
// MULTIPLIES the texture, and the two loaders hand us different base colours for the
// same surface. A glTF material arrives white (baseColorFactor defaults to 1,1,1);
// a model that shipped without materials is given UNDESCRIBED_COLOUR by
// normaliseMaterials, which is deliberately below white so an undescribed surface
// does not clip. Painted, that grey shaded the swatch to roughly 60% of its
// brightness - so Deskwell's boardroom table drew the same beech noticeably darker
// on its OBJ variation than on the GLB the product page shows.
//
// Nothing else in the suite draws a pixel, and neither tsc nor eslint has an opinion
// about a colour multiply, so these are the tests that hold it.

// TextureLoader wants a browser to decode an image in, and these tests run in node.
// Everything else in three is the real thing - the assertions are about Color and
// Material behaviour, which are exactly what a stub would get wrong.
vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>()
  class StubTextureLoader {
    async loadAsync(): Promise<InstanceType<typeof three.Texture>> {
      return new three.Texture()
    }
  }
  return { ...three, TextureLoader: StubTextureLoader }
})

function meshWith(material: MeshStandardMaterial): Mesh {
  return new Mesh(undefined, material)
}

const SLOT = { materialName: 'mat_table_top', textureUrl: 'https://example.test/beech.png', repeat: 1 }

describe('applyFabricPaint', () => {
  it('clears the base tint of a material it paints a texture onto', async () => {
    // What normaliseMaterials leaves on a model that shipped without materials.
    const material = new MeshStandardMaterial({ name: 'mat_table_top', color: 0xcccccc })
    const mesh = meshWith(material)

    await applyFabricPaint(mesh, SLOT)

    expect(material.color.getHex()).toBe(0xffffff)
  })

  it('paints the same finish on a tinted material as on a white one', async () => {
    const undescribed = new MeshStandardMaterial({ name: 'mat_table_top', color: 0xcccccc })
    const fromGltf = new MeshStandardMaterial({ name: 'mat_table_top', color: 0xffffff })

    await applyFabricPaint(meshWith(undescribed), SLOT)
    await applyFabricPaint(meshWith(fromGltf), SLOT)

    expect(undescribed.color.getHex()).toBe(fromGltf.color.getHex())
  })

  it('sets the map it was asked for', async () => {
    const material = new MeshStandardMaterial({ name: 'mat_table_top' })

    const texture = await applyFabricPaint(meshWith(material), SLOT)

    expect(texture).not.toBeNull()
    expect(material.map).toBe(texture)
  })

  it('still paints a flat colour, which is the one case the tint IS the finish', async () => {
    const material = new MeshStandardMaterial({ name: 'mat_table_leg_foot' })

    await applyFabricPaint(meshWith(material), {
      materialName: 'mat_table_leg_foot',
      textureUrl: '',
      colour: '#000000',
      repeat: 1,
    })

    expect(material.color.getHex()).toBe(0x000000)
    expect(material.map).toBeNull()
  })

  it('lifts a flat colour off a slot repainted with a texture', async () => {
    // The repaint path reuses the same material, so a slot moved from a fixed colour
    // to a swatch would otherwise draw the swatch through the old colour - black, in
    // the case above, which paints the part out entirely.
    const material = new MeshStandardMaterial({ name: 'mat_table_top' })
    const mesh = meshWith(material)

    await applyFabricPaint(mesh, { materialName: 'mat_table_top', textureUrl: '', colour: '#000000', repeat: 1 })
    await applyFabricPaint(mesh, SLOT)

    expect(material.color.getHex()).toBe(0xffffff)
  })

  it('leaves a material of another name alone', async () => {
    const other = new MeshStandardMaterial({ name: 'mat_table_leg', color: 0xcccccc })

    await applyFabricPaint(meshWith(other), SLOT)

    expect(other.color.getHex()).toBe(0xcccccc)
    expect(other.map).toBeNull()
    expect(new Color(0xcccccc).getHex()).toBe(other.color.getHex())
  })
})

// A variation that resolves to no paint for a part the previous one DID paint used to
// leave the old texture sitting on it: the repaint path walks the slots it is handed,
// and a slot the resolver dropped is simply never revisited. That showed a shopper a
// chair back in a fabric they had just changed away from - and, on the product that
// found it, one not sold in that combination at all. These hold the way back.
describe('resetFabricPaint', () => {
  it('gives a painted slot back the map and tint the file shipped with', async () => {
    const original = new Texture()
    const material = new MeshStandardMaterial({ name: 'mat_chair_back', color: 0xcccccc })
    material.map = original
    const mesh = meshWith(material)

    await applyFabricPaint(mesh, { ...SLOT, materialName: 'mat_chair_back' })
    expect(material.map).not.toBe(original)
    expect(material.color.getHex()).toBe(0xffffff)

    resetFabricPaint(mesh, 'mat_chair_back')

    expect(material.map).toBe(original)
    expect(material.color.getHex()).toBe(0xcccccc)
  })

  it('reverts a slot painted a flat colour, which carries no texture to swap back', async () => {
    // The case appliedRef alone cannot catch: a flat-colour paint returns no Texture,
    // so the viewer has nothing filed against the slot - but the material has still
    // been changed and still has to be handed back.
    const material = new MeshStandardMaterial({ name: 'mat_chair_back', color: 0xcccccc })
    const mesh = meshWith(material)

    await applyFabricPaint(mesh, { materialName: 'mat_chair_back', textureUrl: '', colour: '#000000', repeat: 1 })
    expect(material.color.getHex()).toBe(0x000000)

    resetFabricPaint(mesh, 'mat_chair_back')

    expect(material.color.getHex()).toBe(0xcccccc)
  })

  it('reverts to the FILE, not to whatever the last paint was', async () => {
    // Two colour changes then a revert. Recording the original on every paint rather
    // than only the first would hand back the second colour and call it neutral.
    const material = new MeshStandardMaterial({ name: 'mat_chair_back', color: 0xcccccc })
    const mesh = meshWith(material)

    await applyFabricPaint(mesh, { materialName: 'mat_chair_back', textureUrl: '', colour: '#ff0000', repeat: 1 })
    await applyFabricPaint(mesh, { materialName: 'mat_chair_back', textureUrl: '', colour: '#00ff00', repeat: 1 })

    resetFabricPaint(mesh, 'mat_chair_back')

    expect(material.color.getHex()).toBe(0xcccccc)
    expect(material.map).toBeNull()
  })

  it('leaves a material it never painted exactly as it is', () => {
    // Called speculatively by the viewer, so a name it has no record of - a part the
    // configurator has never touched - must come through untouched rather than blanked.
    const original = new Texture()
    const material = new MeshStandardMaterial({ name: 'mat_chair_frame', color: 0x333333 })
    material.map = original

    resetFabricPaint(meshWith(material), 'mat_chair_frame')

    expect(material.map).toBe(original)
    expect(material.color.getHex()).toBe(0x333333)
  })

  it('leaves a material of another name alone', async () => {
    const back = new MeshStandardMaterial({ name: 'mat_chair_back', color: 0xcccccc })
    const seat = new MeshStandardMaterial({ name: 'mat_chair_seat', color: 0xcccccc })
    const mesh = new Mesh(undefined, [back, seat])

    await applyFabricPaint(mesh, { ...SLOT, materialName: 'mat_chair_back' })
    await applyFabricPaint(mesh, { ...SLOT, materialName: 'mat_chair_seat' })

    resetFabricPaint(mesh, 'mat_chair_back')

    expect(back.map).toBeNull()
    expect(seat.map).not.toBeNull()
    expect(seat.color.getHex()).toBe(0xffffff)
  })
})
