// The formats this module accepts, and the only place that decides so. Shared by
// the upload route (server) and the file picker (browser), so what the admin is
// offered and what the server will take can never drift apart.
//
// Why these four and not six. The viewer renders in a WebGL canvas, which puts a
// hard floor under what "supported" can mean:
//   - DWG is AutoCAD's proprietary format. No JavaScript loader for it exists;
//     reading one needs a server-side conversion service (Autodesk's or ODA's,
//     both paid). Accepting a DWG would mean storing a file nothing on the page
//     could ever draw.
//   - USDZ renders only through Apple's AR Quick Look, which takes over the whole
//     screen on an iPhone and does nothing at all on desktop or Android. It
//     cannot drive an inline pan/tilt/zoom viewer, which is the feature.
// Both are therefore rejected at upload with a plain reason, rather than accepted
// and then silently absent from the gallery.
//
// GLTF is included alongside GLB because they are the same format - GLB is just
// its binary packaging - and GLTFLoader reads both. A .gltf that references
// external .bin/texture files by relative path will load only its own geometry
// here, since those siblings were never uploaded; GLB embeds everything and is
// the one to recommend, which the editor's help text does.
export const P3D_FORMATS = ['glb', 'gltf', 'obj', 'fbx', '3ds'] as const

export type P3dFormat = (typeof P3D_FORMATS)[number]

// 3D formats have no registered IANA media types worth trusting: browsers report
// .glb as application/octet-stream, .obj as anything from text/plain to nothing
// at all, and .fbx almost always as an empty string. So the extension decides,
// and the declared content type is not consulted - the reverse of how the image
// path works, where the bytes can be sniffed and the extension cannot be trusted.
//
// That is safe here because nothing on the server parses these files: they are
// stored as opaque bytes and handed to a loader in the shopper's browser, inside
// a canvas, with no more privilege than any other downloaded asset.
export function formatFromFilename(filename: string): P3dFormat | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return (P3D_FORMATS as readonly string[]).includes(ext) ? (ext as P3dFormat) : null
}

// What goes in the file picker's `accept`, so the admin's file dialogue offers
// the right files rather than everything on the disk.
export const P3D_ACCEPT = P3D_FORMATS.map((f) => `.${f}`).join(',')

// Stored against the blob. Deliberately generic: see the note above on why the
// real content type of a 3D file is not a thing worth asserting.
export const P3D_UPLOAD_MIME = 'application/octet-stream'

// A 3D model is a large file by web standards - a detailed FBX runs to tens of
// megabytes - but it is also downloaded by every shopper who opens the product,
// so this is as much a kindness to the shopper as a guard on the bucket.
export const P3D_MAX_UPLOAD_MB = 50
export const P3D_MAX_UPLOAD_BYTES = P3D_MAX_UPLOAD_MB * 1024 * 1024

export function formatLabel(format: P3dFormat): string {
  return format === 'gltf' ? 'glTF' : format.toUpperCase()
}
