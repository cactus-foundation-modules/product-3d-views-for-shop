import { NextRequest, NextResponse } from 'next/server'
import { getActiveMediaProvider, isMediaProviderConfigured } from '@/lib/config/env'
import { isS3Provider, workerUrl } from '@/lib/media/upload'
import { resolveFolderPath } from '@/lib/media/organise'
import { signUploadToken, UPLOAD_TOKEN_TTL_MS } from '@/lib/media/upload-token'
import { requireShopUser } from '@/modules/shop/lib/access'
import { isValidTarget } from '@/modules/product-3d-views-for-shop/lib/db/models'
import { resolve3dFolderId } from '@/modules/product-3d-views-for-shop/lib/media-folder'
import { buildModelKey } from '@/modules/product-3d-views-for-shop/lib/model-key'
import { formatFromFilename, mimeForFormat } from '@/modules/product-3d-views-for-shop/lib/formats'

// Hand the browser a signed target so it can PUT a model straight to the media
// Worker, and never send the bytes through this function at all.
//
// This exists because the old route could not work. It took the file as a form
// upload, and the hosting platform rejects any request body over roughly 4.5 MB
// with a 413 before the handler runs - so every model worth uploading died on the
// doorstep, and the 413 is not JSON, which is why the editor could only ever say
// "Upload failed". Photographs have gone this way round for a while
// (app/api/admin/media/upload-url); this is the same trick, with the folder and
// the ownership check that only this module can do.
//
// { available: false } means the direct path cannot be used for this install, and
// the caller should fall back to the size-guarded form upload. Same contract as
// core's route, for the same reason: not every provider can take a browser's PUT.

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const { id } = await params

  const provider = await getActiveMediaProvider()
  if (!provider || !isMediaProviderConfigured(provider)) {
    return NextResponse.json({ error: 'Media storage is not set up yet. Add a provider in Settings → Media first.' }, { status: 503 })
  }

  const body = await request.json().catch(() => null)
  const filename = typeof body?.filename === 'string' ? body.filename : ''
  const rawTarget = body?.targetProductId
  const targetProductId = typeof rawTarget === 'string' && rawTarget ? rawTarget : id

  // The parent's own tree is the only place a model may be attached. Checked here
  // as well as at record time: no reason to sign a key for an upload that will be
  // refused once the bytes have already crossed the wire.
  if (!(await isValidTarget(id, targetProductId))) {
    return NextResponse.json({ error: 'That variation does not belong to this product.' }, { status: 400 })
  }

  // The extension decides, not the browser's content type - see lib/formats.ts.
  const format = formatFromFilename(filename)
  if (!format) {
    return NextResponse.json(
      { error: 'That file type is not supported. Use GLB, glTF, OBJ, FBX or 3DS.' },
      { status: 400 },
    )
  }

  // Only the S3-compatible family takes a direct write (the Worker signs those),
  // and only when there is a Worker to write to. Anything else falls back.
  const base = workerUrl()
  if (!base || !isS3Provider(provider)) return NextResponse.json({ available: false })

  const folderId = await resolve3dFolderId(id)
  const folderPath = folderId ? await resolveFolderPath(folderId) : ''
  // Named after the parent product, the way the shop names its product images -
  // see lib/model-key.ts. Chosen here rather than tidied up afterwards because the
  // key is what the upload token signs.
  const { key } = await buildModelKey({
    provider,
    mimeType: mimeForFormat(format),
    filename,
    folderPath: folderPath || undefined,
    parentProductId: id,
  })
  const { token } = signUploadToken(key, UPLOAD_TOKEN_TTL_MS)

  return NextResponse.json({
    available: true,
    uploadUrl: `${base}/${key}`,
    contentType: mimeForFormat(format),
    key,
    token,
  })
}
