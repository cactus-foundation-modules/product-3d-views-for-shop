import type { P3dFormat } from '@/modules/product-3d-views-for-shop/lib/formats'

// A stored 3D model row.
export type P3dModel = {
  id: string
  productId: string
  url: string
  mediaProvider: string | null
  mediaKey: string | null
  mediaId: string | null
  filename: string
  format: P3dFormat
  size: number
  position: number
}

// One model as the storefront sees it. Trimmed to what the gallery needs, because
// this crosses to the browser on every product page that has a model: the storage
// key and provider are the admin's business and stay server-side.
export type P3dItem = {
  // Stable across renders and unique within the payload - shop's gallery tracks
  // which contributed item is on the stage by this alone.
  key: string
  // The product this model hangs off: the parent, or one of its variant children.
  productId: string
  url: string
  format: P3dFormat
  label: string
}

// What `load` hands the browser, via shop's `shop.gallery-media` point. Must stay
// JSON-serialisable: it crosses the RSC boundary as a plain prop.
export type P3dPayload = {
  // The product whose page this is. Anything in `items` with a different
  // productId therefore belongs to one of its variations.
  parentProductId: string
  items: P3dItem[]
}

// One row of the editor's list: a model, plus which product it belongs to.
export type P3dAdminModel = P3dModel & {
  // Null for the parent product's own models; the variation's display name
  // ("Large / Red") for a variant child's, so the admin can see at a glance
  // which of them a model is for.
  variationLabel: string | null
}

// A product or variation a model can be attached to, as offered in the editor.
export type P3dTarget = {
  productId: string
  // Null for the parent product itself.
  variationLabel: string | null
}
