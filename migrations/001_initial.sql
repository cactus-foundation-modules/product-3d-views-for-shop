-- product-3d-views-for-shop schema. Every table is prefixed p3d_ and all DDL is
-- idempotent (IF NOT EXISTS) so this file is both the fresh-install schema and
-- safe to re-run. Later schema changes ship as new numbered files (002_*.sql,
-- ...) rather than edits here: editing this one in place only ever reaches fresh
-- installs, never the sites already running.

-- One 3D model attached to a product.
--
-- product_id points at an ordinary shp_products row, and that is the whole trick
-- of this module: a shop-variations "variation" IS a hidden child shp_products
-- row (svr_variants.child_product_id), so a model attached to a variation is
-- just a model attached to that child's id. Nothing here needs to know what an
-- option or a variant is, and the module therefore depends on shop alone - a
-- shop without shop-variations installed simply has no child products to find.
--
-- Cross-module foreign keys to shp_products are safe because shop installs first
-- (requiresModules), so the referenced table always exists. ON DELETE CASCADE
-- means deleting a product - or a variant child, which shop-variations deletes
-- when a matrix is regenerated - takes its models with it.
CREATE TABLE IF NOT EXISTS "p3d_models" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "product_id" TEXT NOT NULL,
    -- Public url of the stored file, used as the viewer's source.
    "url" TEXT NOT NULL,
    -- Provider + storage key, kept so deleting a model can delete the blob too
    -- rather than leaving it to rot in the bucket.
    "media_provider" TEXT,
    "media_key" TEXT,
    -- The core Media row this file was recorded as, so the library shows it in
    -- the product's 3d folder alongside the images. Nullable: a model whose
    -- library row has since been deleted is still perfectly renderable.
    "media_id" TEXT,
    -- Whether this module put the file in the library and may therefore delete
    -- it again. False for a file picked from the library, which was already the
    -- owner's before we pointed at it. See 005_owns_media.sql.
    "owns_media" BOOLEAN NOT NULL DEFAULT false,
    "filename" TEXT NOT NULL,
    -- Lower-case extension, and the only thing that decides which loader runs.
    -- Constrained to the four formats a browser can actually render: DWG is
    -- proprietary CAD with no JS loader at all, and USDZ only opens in Apple's
    -- AR Quick Look, so neither can drive a pan/tilt/zoom viewer and neither is
    -- accepted rather than being accepted and then quietly doing nothing.
    "format" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "p3d_models_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "p3d_models_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "shp_products"("id") ON DELETE CASCADE,
    CONSTRAINT "p3d_models_format_check" CHECK ("format" IN ('glb', 'gltf', 'obj', 'fbx', '3ds'))
);

CREATE INDEX IF NOT EXISTS "p3d_models_product_id_idx" ON "p3d_models" ("product_id");
