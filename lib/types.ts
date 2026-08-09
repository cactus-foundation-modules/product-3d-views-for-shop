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
  // True when this module uploaded the file, and may therefore delete it when
  // the model goes. False for a file chosen from the media library, which was
  // the site owner's before we pointed at it and stays theirs afterwards.
  ownsMedia: boolean
  filename: string
  format: P3dFormat
  size: number
  position: number
  // Which add-on combination this file shows: '' (the base model - the product
  // alone) for the overwhelming majority, else sorted keys joined with '+'
  // ('screens', 'cable-tray+screens'), optionally quantity-tagged ('shelves:2').
  // Matching is exact-or-base: an active combination with no tagged file simply
  // shows the base model. See migrations/006_model_context.sql.
  context: string
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
  // The add-on combination this file shows ('' = the base model). The strip
  // offers base items only; the stage swaps to a tagged item when the page says
  // that combination is active. Optional so a cached payload serialised before
  // this shipped reads as all-base rather than throwing.
  context?: string
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

// One model ready for the card viewer: the file, and the fabric paints (or null for
// a plain, unpainted model). The `fabric` shape matches Viewer3d's `fabric` prop.
export type P3dCardModel = {
  item: P3dItem
  fabric: { slots: FabricBundle['slots']; realCm: number | null; scaleAxis: 'height' | 'width' } | null
}

// What the card-media provider hands its overlay, via shop's `shop.card-media` point,
// to show a model on a product CARD in a grid. The overlay picks WHICH model by the
// variation the shopper is looking at (the carousel's active image), so a payload
// carries more than one: JSON-serialisable, crosses the RSC boundary as a plain prop.
export type P3dCardPayload = {
  settings: P3dConfig
  parentProductId: string
  // True when the product has a fabric configurator config. The overlay then fetches
  // the current variation's painted bundle live from `/fabric/[child]` (model + its
  // material), rather than the provider resolving every variation up front.
  hasFabric: boolean
  // Per-variation OWN models for NON-fabric products (child product id -> model),
  // where a variation carries its own model file. Empty for fabric products, whose
  // per-variation model+material is fetched live instead.
  byVariation: Record<string, P3dCardModel>
  // Shown when no variation is in view (the product's own photo), or when the current
  // variation has no model of its own to show: the product's own model, else the first
  // variation that has one. Always present - a payload with no model is never emitted.
  fallback: P3dCardModel
  // For a FABRIC product, the variation whose material paints the opening view when no
  // colour is in view yet (the shopper opened 3D on the product's own photo): the first
  // enabled variation. The overlay fetches its painted bundle live so the card's 3D
  // shows a real material rather than the bare, unpainted file. Undefined for a
  // non-fabric product (its fallback is just a model file, nothing to paint) and for a
  // fabric product with no variation to default to.
  defaultChildId?: string
  // For a FABRIC product, every enabled variation's child id in matrix order - the set
  // the open viewer's own prev/next arrows step through, fetching each one's painted
  // bundle live. Undefined for a non-fabric product, whose navigable models are already
  // listed in `byVariation` (in the same order).
  variationChildIds?: string[]
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
  // The product's real overall size along `scaleAxis`, in centimetres, for this
  // variation - the same measurement the configurator uses to tile fabric at true
  // scale (see realCm in lib/fabric/resolve.ts). Null when the size source did not
  // resolve. The stage viewer reuses it to place the model at life size in AR, so a
  // boardroom table arrives table-sized rather than at the owner's global guess.
  realCm: number | null
  // Which axis realCm measures - 'height' (Y) or 'width' (X). Needed to turn one
  // dimension into an AR scale factor against the model's measured extent.
  scaleAxis: 'height' | 'width'
  slots: Array<{
    // The exact glTF material name to paint on the model.
    materialName: string
    // Public url of the fabric texture (the option value's swatch). Empty for a part
    // painted a flat colour, where `colour` carries the whole answer instead.
    textureUrl: string
    // A flat `#rrggbb` for a part the admin has set to a fixed colour rather than
    // pointing at an option, else null. Painting it replaces the material's baseColour
    // texture outright, so the part reads as that colour and nothing else.
    colour: string | null
    // Tile repeat, so the weave renders at true real-world scale. Derived server-side
    // from the model's real height, its measured geometry and the swatch size - see
    // tileRepeat in lib/fabric/resolve.ts.
    repeat: number
    // Degrees clockwise to turn the texture about the middle of its tile, so a
    // directional surface (grain, weave, brush) can be laid the right way round
    // without re-exporting the model. 0 leaves the model's own UVs alone.
    rotationDeg: number
    // How shiny to make the part, 0-1, read from the words on the swatch itself -
    // see detectGloss in lib/fabric/finish.ts. 0 leaves the material's own finish
    // untouched, which is what every part did before this and what all but a leather
    // swatch still does. It is the one property a paint changes beyond the base
    // colour, and it is what lets one model serve a range with a leather option in
    // it rather than needing a second file for the leather.
    gloss: number
    // Set when `repeat` above could NOT be worked out from the saved config, and the
    // viewer should measure the model instead of trusting it. Null - the normal case -
    // means the config had everything and `repeat` is final.
    //
    // Only ever set when the shop's own two facts (the product's real size, the
    // swatch's real size) are present and it is the MEASUREMENTS that are missing,
    // since those are the only ones the viewer can supply for itself. A model attached
    // after the last Detect+Save has none, which used to leave that one variation's
    // weave at repeat 1 with nothing said about it - see measureFabricRepeat.
    autoScale: { realCm: number; scaleAxis: 'height' | 'width'; swatchCm: number } | null
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
  // The option values that make this variation up ("Large", "Red"), as
  // svr_option_values ids. Empty for the parent, and for a variant that has no
  // option values of its own. The editor's preview picker matches a dropdown
  // selection against these to find which variation to show.
  valueIds: string[]
}

// One of the product's variation options, with its values, for the editor's
// preview picker. The same shape shop-variations shows on the Variations tab,
// trimmed to what a dropdown needs.
export type P3dOption = {
  id: string
  name: string
  values: { id: string; label: string }[]
}
