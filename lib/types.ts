import type { P3dFormat } from '@/modules/product-3d-views-for-shop/lib/formats'
import type { P3dConfig } from '@/modules/product-3d-views-for-shop/lib/config'
import type { FabricConfig } from '@/modules/product-3d-views-for-shop/lib/db/fabric-config'

// Re-exported so consumers can reach the config shape from the one types module
// without knowing it is defined alongside its database access. The import above is
// type-only and erased at build, so this drags no server code (prisma, zod) into a
// client bundle - the same bargain P3dConfig strikes from lib/config.ts.
export type { FabricConfig }

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
  // The site owner's viewer settings, resolved once server-side and carried here
  // rather than fetched by the browser: it is already on the wire, the shopper is
  // waiting on this payload anyway, and a second client round-trip would only add
  // a flash of default-lit model before the real settings arrived. Plain data,
  // so it crosses the RSC boundary intact.
  settings: P3dConfig
  // The fabric configurator's config for this product, or null when the product is
  // not configured for it (the overwhelming majority). Present only when a saved
  // p3d_fabric_configs row defines fabric parts - see lib/gallery-provider.ts. When
  // set, the variation's own model is re-textured live from the shopper's choices
  // once a full combination is chosen; the thumbnails stay one per model file.
  fabric: FabricConfig | null
}

// A fabric configurator resolution for one variant child: which model to draw and
// which named material slots to paint, at what tile density. Composed server-side
// from the child's selected options + sizes and the saved config (see
// lib/fabric/resolve.ts), and fetched by the stage on demand keyed by child id.
export type FabricBundle = {
  // The p3d_models row the resolved model came from - carried so the client can
  // key its cache and so a changed model id is visible without comparing urls.
  modelId: string
  modelUrl: string
  format: P3dFormat
  slots: Array<{
    // The exact glTF material name to paint on the model.
    materialName: string
    // Public url of the fabric texture (the option value's swatch).
    textureUrl: string
    // Tile repeat, so the weave renders at true real-world scale. Derived server-side
    // from the model's real height, its measured geometry and the swatch size - see
    // tileRepeat in lib/fabric/resolve.ts.
    repeat: number
  }>
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
