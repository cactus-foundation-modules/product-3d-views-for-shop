import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getActiveMediaProvider, isMediaProviderConfigured } from '@/lib/config/env'
import { resolveFolderPath } from '@/lib/media/organise'
import { adoptReplacementBlob, autoOptimiseNewUpload, saveMediaRecord, uploadMedia, validateNonImageUpload } from '@/lib/media/upload'
import { verifyUploadToken } from '@/lib/media/upload-token'
import { signAssetUrl } from '@/lib/media/asset-token'
import { requireShopUser } from '@/modules/shop/lib/access'
import { createModel, getAdminModels, getProductOptions, getTargets, isValidTarget } from '@/modules/product-3d-views-for-shop/lib/db/models'
import { resolve3dFolderId } from '@/modules/product-3d-views-for-shop/lib/media-folder'
import { buildModelKey } from '@/modules/product-3d-views-for-shop/lib/model-key'
import {
  P3D_MAX_UPLOAD_BYTES,
  P3D_MAX_UPLOAD_MB,
  formatFromFilename,
  mimeForFormat,
} from '@/modules/product-3d-views-for-shop/lib/formats'

// The editor's list of a product's 3D models, and where a new one is recorded.
// `id` is always the PARENT product; which of it or its variations a model is for
// travels as `targetProductId` in the body, checked against the parent's own tree
// below rather than trusted.
//
// POST takes two shapes:
//   - JSON, the second half of a direct upload. The bytes are already in storage
//     (see ./upload-url); this only writes the rows. The normal path.
//   - multipart, the fallback for installs whose provider cannot take a browser's
//     PUT. The bytes come through this function, which means the platform's ~4.5 MB
//     body cap applies and most real models will not fit. The client says so
//     before it tries, rather than letting the platform swallow the request.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const { id } = await params
  // Options ride along with the targets: the editor's preview picker needs both
  // halves - what a shopper can choose, and which variation each choice lands on
  // - and a second round-trip for the smaller half would only be slower.
  const [models, targets, options] = await Promise.all([getAdminModels(id), getTargets(id), getProductOptions(id)])
  return NextResponse.json({ models, targets, options })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const { id } = await params

  const provider = await getActiveMediaProvider()
  if (!provider || !isMediaProviderConfigured(provider)) {
    return NextResponse.json({ error: 'Media storage is not set up yet. Add a provider in Settings → Media first.' }, { status: 503 })
  }

  if (request.headers.get('content-type')?.includes('application/json')) {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 })
    }
    // Two JSON shapes share this route. A `mediaId` means "attach a file already
    // in the library" - the pick-existing path, no bytes moving. Anything else is
    // the second half of a fresh upload, whose bytes are already in storage.
    return typeof (body as Record<string, unknown>).mediaId === 'string'
      ? attachExisting(body as Record<string, unknown>, id)
      : recordDirect(body as Record<string, unknown>, id, provider, gate.user.id)
  }
  return uploadThroughServer(request, id, provider, gate.user.id)
}

type Provider = NonNullable<Awaited<ReturnType<typeof getActiveMediaProvider>>>

/**
 * Record a model whose bytes the browser already PUT to the Worker.
 *
 * Nothing identifying the object is taken at face value. The caller hands back the
 * token this module signed for this exact key, and the format is read from the
 * key's own extension rather than from the filename beside it - the key is what
 * the signature covers, so it is the only claim here that cannot be edited in
 * flight. Same reasoning as core's /api/admin/media/record.
 */
async function recordDirect(body: Record<string, unknown>, id: string, provider: Provider, userId: string) {
  const key = typeof body?.key === 'string' ? body.key : ''
  const token = typeof body?.token === 'string' ? body.token : ''
  const filename = typeof body?.filename === 'string' ? body.filename : ''
  const sizeBytes = typeof body?.sizeBytes === 'number' ? body.sizeBytes : NaN
  const rawTarget = body?.targetProductId
  const targetProductId = typeof rawTarget === 'string' && rawTarget ? rawTarget : id

  if (!(await isValidTarget(id, targetProductId))) {
    return NextResponse.json({ error: 'That variation does not belong to this product.' }, { status: 400 })
  }

  // The key must sit under this provider's own namespace - the shape buildKey()
  // produced for /upload-url. B2 keeps the legacy prefix-less form.
  const expectedPrefix = provider === 'B2' ? 'media/' : `media/${provider}/`
  if (!key.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: 'Invalid object key' }, { status: 400 })
  }

  // Proof this key is one we handed out this session, still within its short life
  // - the same signature the Worker checked before it accepted the bytes.
  if (!token || !verifyUploadToken(key, token)) {
    return NextResponse.json({ error: 'That upload took too long. Try again.' }, { status: 403 })
  }

  const format = formatFromFilename(key)
  if (!format) {
    return NextResponse.json({ error: 'That file type is not supported.' }, { status: 400 })
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > P3D_MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `That model is too big (max ${P3D_MAX_UPLOAD_MB} MB).` }, { status: 400 })
  }

  try {
    // The folder is resolved here rather than carried back from the browser: the
    // path is already baked into the signed key, so re-deriving it is what keeps
    // the library row and the object in the same place.
    const folderId = await resolve3dFolderId(id)
    // A key that already has a library row means the uploader chose "replace" when
    // told the name was taken. The bytes have landed on that object, so the row
    // moves onto them - it keeps its id and url, and everything already pointing
    // at it picks up the new model rather than being stranded on the old one.
    const existing = await prisma.media.findUnique({ where: { key } })
    const record = existing
      ? await adoptReplacementBlob(existing, key, mimeForFormat(format), sizeBytes, existing.originalName)
      : await saveMediaRecord({
          key,
          url: '', // saveMediaRecord rebuilds the Worker url for proxied providers
          provider,
          mimeType: mimeForFormat(format),
          sizeBytes,
          uploadedById: userId,
          originalName: filename || undefined,
          folderId,
        })

    // Compressed as it lands, so the first shopper to open this product gets the
    // smaller file rather than whichever shopper happens to arrive after someone
    // remembered to optimise it. Done BEFORE createModel so the size recorded
    // here is the size the file actually is - core rewrites the library row's
    // own size itself, but it cannot know about this table.
    //
    // The url and key are deliberately unaffected: an optimised GLB is written
    // back over its own storage key precisely so that rows like this one, which
    // core's reference rewriting never reaches, do not need to learn anything.
    const storedSize = await autoOptimiseNewUpload(record.id, mimeForFormat(format), sizeBytes, userId)

    const model = await createModel({
      productId: targetProductId,
      url: record.url,
      mediaProvider: provider,
      mediaKey: key,
      mediaId: record.id,
      // These bytes arrived because of this row, so removing the row may take
      // them away again - unless they took over a library item that was already
      // there, which is the site owner's file and not ours to delete.
      ownsMedia: !existing,
      filename: filename || key.split('/').pop() || `model.${format}`,
      format,
      size: storedSize,
    })
    // Signed on the way back, like every other model url the editor is handed:
    // it may be dropped straight into a preview viewer, which fetches it from the
    // Worker and would be refused without a token.
    return NextResponse.json({ ...model, url: signAssetUrl(model.url) }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: `Could not save that model: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    )
  }
}

/**
 * Attach a 3D file already in the media library, chosen through the picker rather
 * than uploaded. No bytes move: the object is where it has always been, so this
 * only writes our own row pointing at it - the same shape a fresh upload leaves
 * behind, minus the transfer.
 *
 * The media row is the sole source of truth for the object. The browser hands back
 * only its id; the key, url, provider and size are read from the row here, never
 * taken from the request, so a client cannot name one file and attach another.
 *
 * A picked file that is not a 3D model is turned away: the library's "other" tab
 * holds PDFs and the like alongside models, and the picker filters by extension,
 * but the extension is checked again here rather than trusted from the browser.
 */
async function attachExisting(body: Record<string, unknown>, id: string) {
  const mediaId = typeof body?.mediaId === 'string' ? body.mediaId : ''
  const rawTarget = body?.targetProductId
  const targetProductId = typeof rawTarget === 'string' && rawTarget ? rawTarget : id

  if (!mediaId) {
    return NextResponse.json({ error: 'No file was chosen.' }, { status: 400 })
  }
  if (!(await isValidTarget(id, targetProductId))) {
    return NextResponse.json({ error: 'That variation does not belong to this product.' }, { status: 400 })
  }

  const media = await prisma.media.findUnique({
    where: { id: mediaId },
    select: { id: true, key: true, url: true, provider: true, originalName: true, sizeBytes: true },
  })
  if (!media) {
    return NextResponse.json({ error: 'That file is no longer in your media library.' }, { status: 404 })
  }

  // The uploaded filename decides the format where it survives; the storage key,
  // whose extension core bakes from the media type, is the fallback for rows that
  // never kept one. See lib/formats.ts for why the extension and not the MIME.
  const format = formatFromFilename(media.originalName ?? media.key)
  if (!format) {
    return NextResponse.json(
      { error: 'That file is not a 3D model. Use GLB, glTF, OBJ, FBX or 3DS.' },
      { status: 400 },
    )
  }

  try {
    const model = await createModel({
      productId: targetProductId,
      url: media.url,
      mediaProvider: media.provider,
      mediaKey: media.key,
      mediaId: media.id,
      // The file was in the library before this row was, and stays there after
      // it goes. Nothing about attaching a model is permission to delete the
      // site owner's own file.
      ownsMedia: false,
      filename: media.originalName || media.key.split('/').pop() || `model.${format}`,
      format,
      size: media.sizeBytes,
    })
    // Signed on the way back, like every other model url the editor is handed:
    // it may be dropped straight into a preview viewer, which fetches it from the
    // Worker and would be refused without a token.
    return NextResponse.json({ ...model, url: signAssetUrl(model.url) }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: `Could not add that model: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    )
  }
}

/**
 * The fallback: the file arrives as a form upload and this function forwards it to
 * storage. Only reachable where the direct path is unavailable, and only useful
 * for a model small enough to clear the platform's body cap.
 */
async function uploadThroughServer(request: NextRequest, id: string, provider: Provider, userId: string) {
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const rawTarget = form?.get('targetProductId')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  // No target named means the product itself, which is the common case and saves
  // the editor sending a field to say "the obvious one".
  const targetProductId = typeof rawTarget === 'string' && rawTarget ? rawTarget : id
  // The parent's own tree is the only place a model may be attached. Without this
  // an admin with rights to one product could post another product's id and hang
  // a model off it.
  if (!(await isValidTarget(id, targetProductId))) {
    return NextResponse.json({ error: 'That variation does not belong to this product.' }, { status: 400 })
  }

  // The extension decides, not the browser's content type: see lib/formats.ts for
  // why a 3D file's declared MIME is worth nothing. This is also where DWG and
  // USDZ are turned away - both are storable and neither can be rendered, so
  // accepting them would mean a file that never appears on the page.
  const format = formatFromFilename(file.name)
  if (!format) {
    return NextResponse.json(
      { error: 'That file type is not supported. Use GLB, glTF, OBJ, FBX or 3DS.' },
      { status: 400 },
    )
  }

  const mimeType = mimeForFormat(format)
  const validation = await validateNonImageUpload(mimeType, file.size, {
    allowedMimeTypes: [mimeType],
    maxSizeBytes: P3D_MAX_UPLOAD_BYTES,
  })
  if (!validation.valid) {
    return NextResponse.json({ error: `That model is too big (max ${P3D_MAX_UPLOAD_MB} MB).` }, { status: 400 })
  }

  try {
    const folderId = await resolve3dFolderId(id)
    const folderPath = folderId ? await resolveFolderPath(folderId) : ''
    const buffer = Buffer.from(await file.arrayBuffer())
    // Same naming as the direct path - the model is filed under the product's own
    // name rather than a nanoid. See lib/model-key.ts.
    const { nameForKey, exactName } = await buildModelKey({
      provider,
      mimeType,
      filename: file.name,
      folderPath: folderPath || undefined,
      parentProductId: id,
    })
    const result = await uploadMedia(buffer, mimeType, provider, nameForKey, folderPath || undefined, exactName)

    // Recorded in the core library as well as in our own table, so the model turns
    // up in Media under the product's 3d folder rather than being a file only this
    // module can see. Our row is still the source of truth for the gallery - the
    // library row is there for the site owner, and a model whose library row is
    // later deleted goes on rendering.
    const record = await saveMediaRecord({
      key: result.key,
      url: result.url,
      provider,
      mimeType: result.mimeType,
      sizeBytes: result.sizeBytes,
      uploadedById: userId,
      originalName: file.name || undefined,
      folderId,
    })

    // Same treatment as the direct-to-Worker path above: compressed on arrival,
    // and only optimisable when there is a library row to optimise, since core
    // works from the Media id.
    const storedSize = record
      ? await autoOptimiseNewUpload(record.id, result.mimeType, result.sizeBytes, userId)
      : result.sizeBytes

    const model = await createModel({
      productId: targetProductId,
      url: result.url,
      mediaProvider: provider,
      mediaKey: result.key,
      mediaId: record?.id ?? null,
      // An upload, the long way round: still ours to tidy away later.
      ownsMedia: true,
      filename: file.name,
      format,
      size: storedSize,
    })
    // Signed on the way back, like every other model url the editor is handed:
    // it may be dropped straight into a preview viewer, which fetches it from the
    // Worker and would be refused without a token.
    return NextResponse.json({ ...model, url: signAssetUrl(model.url) }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    )
  }
}
