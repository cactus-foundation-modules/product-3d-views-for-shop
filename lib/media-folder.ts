import { getOrCreateFolderByPath, resolveFolderPath } from '@/lib/media/organise'
import { getProductMediaFolderId } from '@/modules/shop/lib/media/product-media'

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
 *
 * Shared by the two halves of the direct upload - the route that signs the object
 * key and the route that records the row once the bytes have landed. Both resolve
 * it from the parent product id rather than passing a folder id through the
 * browser: the key is signed with the folder path already baked in, so a client
 * that could name its own folder could file a model somewhere the signature never
 * agreed to.
 */
export async function resolve3dFolderId(parentProductId: string): Promise<string | null> {
  const productFolderId = await getProductMediaFolderId(parentProductId)
  if (productFolderId === null) return null
  const path = await resolveFolderPath(productFolderId)
  if (!path) return null
  return getOrCreateFolderByPath([...path.split('/'), '3d'])
}
