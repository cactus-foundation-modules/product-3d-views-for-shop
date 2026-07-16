import { Product3dEditor } from '@/modules/product-3d-views-for-shop/components/admin/Product3dEditor'

// The "3D views" tab on the shop product editor, contributed through the
// shop.product-editor-sections point. The client editor below loads this
// product's models and its variations for itself, so there is nothing to resolve
// here - the wrapper exists because the point hands shop a component and takes a
// productId, and this is that shape.
export function Product3dSection({ productId }: { productId: string }) {
  return <Product3dEditor productId={productId} />
}
