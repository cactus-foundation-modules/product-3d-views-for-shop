import { MAX_UPLOAD_MB } from '@/lib/media/limits'
import {
  P3D_MAX_UPLOAD_BYTES,
  P3D_MAX_UPLOAD_MB,
  formatFromFilename,
} from '@/modules/product-3d-views-for-shop/lib/formats'
import type { P3dAdminModel } from '@/modules/product-3d-views-for-shop/lib/types'

// Uploading one model, from either surface that offers it: the 3D views tab and
// the Variations tab's 3D column.
//
// The model goes straight from the browser to the media Worker and never through
// the site's own server. That is not an optimisation - it is the only way this
// works. A form upload is capped at roughly 4.5 MB by the hosting platform, which
// rejects the request before any of our code runs, and returns a 413 whose body is
// not JSON. Reading that body for an error message is what used to leave the
// editor with nothing to say but a bare "Upload failed" on every model anyone would
// actually want to sell.

const mb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1)

/** Our own routes answer with { error }. Anything else has not come from us. */
async function reasonFrom(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    return typeof body?.error === 'string' ? body.error : fallback
  } catch {
    return fallback
  }
}

type Ticket =
  | { available: true; uploadUrl: string; contentType: string; key: string; token: string }
  | { available: true; clash: { existingName: string; suggestedName: string } }
  | { available: false }

/** What to do about a model whose name is already taken in the product's folder. */
export type ModelClashChoice = 'replace' | 'suffix' | 'cancel'

/** Asked when the name is taken. Returning 'cancel' abandons the upload quietly. */
export type ModelClashAsk = (info: { existingName: string; suggestedName: string }) => Promise<ModelClashChoice>

/** Thrown when the answer was 'cancel', so callers can tell it from a failure. */
export class ModelUploadCancelled extends Error {
  constructor() {
    super('Upload cancelled')
    this.name = 'ModelUploadCancelled'
  }
}

/**
 * Check the file the same way the server will, so a wrong type or an oversized
 * model says so at once rather than after the round trip. Returns a reason, or
 * null if it is fine to send.
 */
export function preflightModelError(file: File): string | null {
  if (!formatFromFilename(file.name)) {
    return `“${file.name}” is not a 3D model this can show. Use GLB, glTF, OBJ, FBX or 3DS.`
  }
  if (file.size > P3D_MAX_UPLOAD_BYTES) {
    return `“${file.name}” is ${mb(file.size)} MB. The most a model can be is ${P3D_MAX_UPLOAD_MB} MB.`
  }
  return null
}

export async function uploadModel(
  file: File,
  { productId, targetProductId, onClash }: { productId: string; targetProductId: string; onClash?: ModelClashAsk },
): Promise<P3dAdminModel> {
  const reason = preflightModelError(file)
  if (reason) throw new Error(reason)

  const base = `/api/m/product-3d-views-for-shop/admin/products/${productId}/models`

  const askFor = async (clashChoice?: ModelClashChoice): Promise<Ticket> => {
    const res = await fetch(`${base}/upload-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: file.name, targetProductId, ...(clashChoice ? { onClash: clashChoice } : {}) }),
    })
    if (!res.ok) throw new Error(await reasonFrom(res, 'That model could not be uploaded.'))
    return res.json()
  }

  let ticket = await askFor()

  // The name is taken. Nothing has been signed and nothing has been sent, so the
  // answer decides which key the second request asks for. A caller that offers no
  // way to ask keeps the old behaviour and files the model beside the other one.
  if (ticket.available && 'clash' in ticket) {
    const choice = onClash ? await onClash(ticket.clash) : 'suffix'
    if (choice === 'cancel') throw new ModelUploadCancelled()
    ticket = await askFor(choice)
    if (ticket.available && 'clash' in ticket) throw new Error('That model could not be uploaded.')
  }

  if (!ticket.available) return uploadThroughServer(file, base, targetProductId)

  const put = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: { authorization: `Bearer ${ticket.token}`, 'content-type': ticket.contentType },
    body: file,
  })

  if (!put.ok) {
    // A Worker deployed before it learned about 3D files turns every model away
    // with this exact status. It only picks up new code when someone redeploys it,
    // so the site owner is told what to do rather than left with "no".
    if (put.status === 415) {
      throw new Error('Your media service needs updating before it will accept 3D files. Go to Settings → Media and deploy the Worker again, then try once more.')
    }
    throw new Error(await reasonFrom(put, 'That model could not be sent to your media storage.'))
  }

  const recordRes = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: ticket.key, token: ticket.token, filename: file.name, sizeBytes: file.size, targetProductId }),
  })
  if (!recordRes.ok) throw new Error(await reasonFrom(recordRes, 'The model uploaded, but saving it failed.'))
  return recordRes.json()
}

/**
 * Providers the Worker cannot write to (Cloudinary, ImageKit, Vercel Blob,
 * Supabase) have no direct path, so the file has to come through the site's own
 * server and the platform's body cap applies. Said plainly and in advance: a model
 * over the cap has no route in on this install, and finding that out from a
 * swallowed request helps nobody.
 */
async function uploadThroughServer(file: File, base: string, targetProductId: string): Promise<P3dAdminModel> {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new Error(`Your media storage cannot take files straight from the browser, so a model has to pass through this site and can be at most ${MAX_UPLOAD_MB} MB. “${file.name}” is ${mb(file.size)} MB. Switching to Cloudflare R2, Backblaze B2 or S3 in Settings → Media lifts this to ${P3D_MAX_UPLOAD_MB} MB.`)
  }
  const body = new FormData()
  body.append('file', file)
  body.append('targetProductId', targetProductId)
  const res = await fetch(base, { method: 'POST', body })
  if (!res.ok) throw new Error(await reasonFrom(res, 'That model could not be uploaded.'))
  return res.json()
}
