import { MAX_DIRECT_UPLOAD_BYTES, MAX_DIRECT_UPLOAD_MB, modelTypeForExtension } from '@/lib/media/limits'

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

/**
 * The media type a model of this format is stored under.
 *
 * These used to all be `application/octet-stream`, on the reasoning that a 3D
 * file's real content type is not worth asserting. That reasoning was sound and
 * the conclusion was still wrong: core builds an object key's extension from the
 * type, so every model landed under a `.octet-stream` key, and a key whose
 * extension names no type is a key the media Worker will not accept - it reads
 * the type back out of the extension, that being the only claim about an upload a
 * client cannot forge. The type is not a description of the bytes here so much as
 * the thing that carries the extension.
 *
 * Core owns the mapping (MODEL_EXTENSION_TYPES in lib/media/limits.ts) because the
 * Worker mirrors it. A format core has never heard of throws rather than falling
 * back to a "close enough" type: the upload would be signed under a key nothing
 * could type, and it would fail at the Worker with something far less obvious than
 * this.
 */
export function mimeForFormat(format: P3dFormat): string {
  const mime = modelTypeForExtension(format)
  if (!mime) throw new Error(`No media type is registered for .${format} files`)
  return mime
}

// A 3D model is a large file by web standards - a detailed FBX runs to tens of
// megabytes - but it is also downloaded by every shopper who opens the product,
// so this is as much a kindness to the shopper as a guard on the bucket.
//
// Matched to core's MAX_DIRECT_UPLOAD_BYTES, which is the real ceiling: a model
// goes straight to the media Worker, and the Worker will not take more than that.
// Promising more here than the Worker accepts is how this number came to be a lie
// in the first place.
export const P3D_MAX_UPLOAD_BYTES = MAX_DIRECT_UPLOAD_BYTES
export const P3D_MAX_UPLOAD_MB = MAX_DIRECT_UPLOAD_MB

export function formatLabel(format: P3dFormat): string {
  return format === 'gltf' ? 'glTF' : format.toUpperCase()
}
