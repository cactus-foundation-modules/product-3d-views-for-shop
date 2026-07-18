import { NextRequest, NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { findProductMediaFolderId } from '@/modules/shop/lib/media/product-media'

/**
 * Where the pick-a-model dialogue should OPEN: the product's 3D folder,
 * Shop / <master category> / <product> / 3d - the same folder uploads are filed
 * into (lib/media-folder.ts) but resolved with a look rather than a create, so
 * merely opening the dialogue never litters the library with empty folders.
 * Falls back to the deepest folder of that path that actually exists (the
 * product's, its category's, Shop's) and finally null for the library root.
 *
 * `id` is the PARENT product, matching this module's other admin routes - a
 * variation's models live under its parent's folder.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  const { id } = await params
  const folderId = await findProductMediaFolderId(id, { segments: ['3d'] })
  return NextResponse.json({ folderId })
}
