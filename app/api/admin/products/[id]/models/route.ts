import { NextRequest, NextResponse } from 'next/server'
import { getActiveMediaProvider, isMediaProviderConfigured } from '@/lib/config/env'
import { getOrCreateFolderByPath, resolveFolderPath } from '@/lib/media/organise'
import { saveMediaRecord, uploadMedia, validateNonImageUpload } from '@/lib/media/upload'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getProductMediaFolderId } from '@/modules/shop/lib/media/product-media'
import { createModel, getAdminModels, getTargets, isValidTarget } from '@/modules/product-3d-views-for-shop/lib/db/models'
import {
  P3D_MAX_UPLOAD_BYTES,
  P3D_MAX_UPLOAD_MB,
  P3D_UPLOAD_MIME,
  formatFromFilename,
} from '@/modules/product-3d-views-for-shop/lib/formats'

// The editor's list of a product's 3D models, and where a new one is uploaded.
// `id` is always the PARENT product; which of it or its variations a model is for
// travels as `targetProductId` in the body, checked against the parent's own tree
// below rather than trusted.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const { id } = await params
  const [models, targets] = await Promise.all([getAdminModels(id), getTargets(id)])
  return NextResponse.json({ models, targets })
}

/**
 * The library folder a product's 3D files belong in: Shop / <master category> /
 * <product> / 3d - the product's own image folder, with a `3d` subfolder so the
 * models sit beside the pictures they belong to rather than in a parallel tree
 * the site owner has to go looking for.
 *
 * A variation's model is filed under the PARENT's folder, not the hidden child
 * product's: shop already does exactly this for variant images (the
 * `folderProductId` option), and a child product's folder would be named after a
 * row the site owner is never shown.
 */
async function resolve3dFolderId(parentProductId: string): Promise<string | null> {
  const productFolderId = await getProductMediaFolderId(parentProductId)
  if (productFolderId === null) return null
  const path = await resolveFolderPath(productFolderId)
  if (!path) return null
  return getOrCreateFolderByPath([...path.split('/'), '3d'])
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const { id } = await params

  const provider = await getActiveMediaProvider()
  if (!provider || !isMediaProviderConfigured(provider)) {
    return NextResponse.json({ error: 'Media storage is not set up yet. Add a provider in Settings → Media first.' }, { status: 503 })
  }

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

  const validation = await validateNonImageUpload(P3D_UPLOAD_MIME, file.size, {
    allowedMimeTypes: [P3D_UPLOAD_MIME],
    maxSizeBytes: P3D_MAX_UPLOAD_BYTES,
  })
  if (!validation.valid) {
    return NextResponse.json({ error: `That model is too big (max ${P3D_MAX_UPLOAD_MB} MB).` }, { status: 400 })
  }

  try {
    const folderId = await resolve3dFolderId(id)
    const folderPath = folderId ? await resolveFolderPath(folderId) : ''
    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await uploadMedia(buffer, P3D_UPLOAD_MIME, provider, file.name, folderPath || undefined)

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
      uploadedById: gate.user.id,
      originalName: file.name || undefined,
      folderId,
    })

    const model = await createModel({
      productId: targetProductId,
      url: result.url,
      mediaProvider: provider,
      mediaKey: result.key,
      mediaId: record?.id ?? null,
      filename: file.name,
      format,
      size: result.sizeBytes,
    })
    return NextResponse.json(model, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    )
  }
}
