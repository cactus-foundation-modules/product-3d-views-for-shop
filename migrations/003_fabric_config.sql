-- Per-parent-product fabric configurator config. One row per configured product.
--
-- product_id references the PARENT shp_products row. All other ids inside the
-- JSON (option ids, value ids, attribute ids, model ids) are resolved at read
-- time; nothing here is a hard FK to another module's rows, so the table is valid
-- on an install that later removes shop-variations or product-attributes-for-shop.
--
-- New numbered file rather than an edit to 001/002: editing an applied migration
-- in place only ever reaches fresh installs, so a schema change ships as the next
-- number and run-module-migrations.mjs applies it on every install's next deploy.
-- Idempotent DDL throughout, which keeps re-running harmless.
CREATE TABLE IF NOT EXISTS "p3d_fabric_configs" (
    "product_id" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "p3d_fabric_configs_pkey" PRIMARY KEY ("product_id"),
    CONSTRAINT "p3d_fabric_configs_product_id_fkey"
        FOREIGN KEY ("product_id") REFERENCES "shp_products"("id") ON DELETE CASCADE
);
