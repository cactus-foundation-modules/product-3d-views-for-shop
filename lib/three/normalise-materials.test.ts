import { describe, it, expect } from 'vitest'
import {
  Color,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Texture,
} from 'three'
import { normaliseMaterials } from '@/modules/product-3d-views-for-shop/lib/three/load-model'

// Every model that reaches the viewer is lit by one rig (addLights) and one set of
// site-owner sliders. That only means anything if every material responds to them
// the same way, which is what normaliseMaterials is for: glTF arrives PBR, and
// OBJ, FBX and 3DS arrive as pre-PBR Phong, which takes roughly three times the
// light for the same colour and reads as a much brighter scene beside a GLB.
//
// None of that shows up in a type check or a lint, and nothing else in the suite
// draws a pixel, so these are the tests that hold it.

function meshWith(material: MeshPhongMaterial | MeshStandardMaterial | MeshBasicMaterial): Mesh {
  return new Mesh(undefined, material)
}

// The material a mesh ended up with, narrowed for assertions.
function materialOf(mesh: Mesh): MeshStandardMaterial {
  return mesh.material as MeshStandardMaterial
}

describe('normaliseMaterials', () => {
  it('converts a Phong material to Standard', async () => {
    const mesh = meshWith(new MeshPhongMaterial())
    await normaliseMaterials(mesh, 'fbx')
    expect(materialOf(mesh).isMeshStandardMaterial).toBe(true)
  })

  it('keeps the material name, which the fabric configurator matches on', async () => {
    const mesh = meshWith(new MeshPhongMaterial({ name: 'Seat_Fabric' }))
    await normaliseMaterials(mesh, 'obj')
    expect(materialOf(mesh).name).toBe('Seat_Fabric')
  })

  it('leaves a material that already speaks PBR untouched', async () => {
    const standard = new MeshStandardMaterial({ roughness: 0.2, metalness: 1 })
    const mesh = meshWith(standard)
    await normaliseMaterials(mesh, 'glb')
    expect(mesh.material).toBe(standard)
  })

  it('leaves a Physical material untouched', async () => {
    const physical = new MeshPhysicalMaterial({ clearcoat: 1 })
    const mesh = new Mesh(undefined, physical)
    await normaliseMaterials(mesh, 'glb')
    expect(mesh.material).toBe(physical)
  })

  it('leaves a Basic material alone, since that is glTF saying "do not light this"', async () => {
    const basic = new MeshBasicMaterial()
    const mesh = meshWith(basic)
    await normaliseMaterials(mesh, 'glb')
    expect(mesh.material).toBe(basic)
  })

  it('leaves the Line materials OBJLoader hands back for non-mesh geometry alone', async () => {
    const line = new LineBasicMaterial()
    const mesh = new Mesh(undefined, line)
    await normaliseMaterials(mesh, 'obj')
    expect(mesh.material).toBe(line)
  })

  it('gives an OBJ a neutral grey rather than the loader default of pure white', async () => {
    // Pure white is the one albedo that cannot help but clip under the rig, which
    // is what put an OBJ permanently at the top of the exposure range.
    const mesh = meshWith(new MeshPhongMaterial())
    expect(materialOf(mesh).color.getHex()).toBe(0xffffff)
    await normaliseMaterials(mesh, 'obj')
    const material = materialOf(mesh)
    expect(material.color.getHex()).toBeLessThan(0xffffff)
    expect(material.roughness).toBeGreaterThan(0.5)
  })

  it("keeps an FBX's own authored colour, which is intent rather than a loader default", async () => {
    const mesh = meshWith(new MeshPhongMaterial({ color: 0x336699 }))
    await normaliseMaterials(mesh, 'fbx')
    expect(materialOf(mesh).color.getHex()).toBe(0x336699)
  })

  it('turns shininess into a roughness, glossier source meaning smoother result', async () => {
    const glossy = meshWith(new MeshPhongMaterial({ shininess: 200 }))
    const matte = meshWith(new MeshPhongMaterial({ shininess: 1 }))
    await normaliseMaterials(glossy, 'fbx')
    await normaliseMaterials(matte, 'fbx')
    expect(materialOf(glossy).roughness).toBeLessThan(materialOf(matte).roughness)
    expect(materialOf(glossy).roughness).toBeGreaterThan(0)
  })

  it('never claims a converted material is metal', async () => {
    // Metalness 1 removes the diffuse term entirely, so a wrong guess renders the
    // part black - the same failure the missing environment caused. Nothing in a
    // Phong material states "this is metal", so nothing here may claim it does.
    const mesh = meshWith(new MeshPhongMaterial({ specular: new Color(0xffffff), shininess: 300 }))
    await normaliseMaterials(mesh, 'fbx')
    expect(materialOf(mesh).metalness).toBe(0)
  })

  it('carries the texture maps across', async () => {
    const map = new Texture()
    const normalMap = new Texture()
    const mesh = meshWith(new MeshPhongMaterial({ map, normalMap }))
    await normaliseMaterials(mesh, 'fbx')
    expect(materialOf(mesh).map).toBe(map)
    expect(materialOf(mesh).normalMap).toBe(normalMap)
  })

  it('carries flatShading and vertexColors, which OBJLoader sets from the file itself', async () => {
    const mesh = meshWith(new MeshPhongMaterial({ flatShading: true, vertexColors: true }))
    await normaliseMaterials(mesh, 'obj')
    expect(materialOf(mesh).flatShading).toBe(true)
    expect(materialOf(mesh).vertexColors).toBe(true)
  })

  it('carries transparency, so a converted glass part does not turn solid', async () => {
    const mesh = meshWith(new MeshPhongMaterial({ transparent: true, opacity: 0.4, side: 2 }))
    await normaliseMaterials(mesh, 'fbx')
    const material = materialOf(mesh)
    expect(material.transparent).toBe(true)
    expect(material.opacity).toBe(0.4)
    expect(material.side).toBe(2)
  })

  it('converts one shared source material once, so meshes keep sharing it', async () => {
    // OBJLoader shares a single default material across a whole file. Converting
    // per mesh would multiply it into one material per mesh and lose the sharing
    // the clone step in loadModel relies on to stay cheap.
    const shared = new MeshPhongMaterial({ name: 'Body' })
    const a = meshWith(shared)
    const b = meshWith(shared)
    const group = new Group()
    group.add(a, b)
    await normaliseMaterials(group, 'obj')
    expect(materialOf(a)).toBe(materialOf(b))
  })

  it('converts every material of a multi-material mesh', async () => {
    const mesh = new Mesh(undefined, [
      new MeshPhongMaterial({ name: 'Frame' }),
      new MeshPhongMaterial({ name: 'Seat' }),
    ])
    await normaliseMaterials(mesh, 'obj')
    const materials = mesh.material as unknown as MeshStandardMaterial[]
    expect(materials.map((m) => m.isMeshStandardMaterial)).toEqual([true, true])
    expect(materials.map((m) => m.name)).toEqual(['Frame', 'Seat'])
  })

  it('walks the whole tree, not just the root', async () => {
    const child = meshWith(new MeshPhongMaterial({ name: 'Arm' }))
    const parent = new Group()
    const branch = new Group()
    branch.add(child)
    parent.add(branch)
    await normaliseMaterials(parent, 'obj')
    expect(materialOf(child).isMeshStandardMaterial).toBe(true)
  })
})
