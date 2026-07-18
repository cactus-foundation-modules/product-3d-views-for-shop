-- Per-parent-product viewer setting overrides. One row per product that has any.
--
-- The sitewide p3d_settings singleton stays the default for the whole catalogue;
-- this table holds only the settings a product overrides (today: brightness).
-- Stored as a JSON blob for the same reason the singleton is - a column per
-- setting would mean a migration every time a setting becomes overridable.
--
-- product_id references the PARENT shp_products row: a variation is a child
-- product, and its viewer inherits the parent's override, the same way it
-- inherits the parent's fabric config. ON DELETE CASCADE takes the override
-- with the product.
--
-- New numbered file rather than an edit to an earlier one: editing an applied
-- migration in place only ever reaches fresh installs, so a schema change ships
-- as the next number and run-module-migrations.mjs applies it on every install's
-- next deploy. Idempotent DDL throughout, which keeps re-running harmless.
CREATE TABLE IF NOT EXISTS "p3d_product_settings" (
    "product_id" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "p3d_product_settings_pkey" PRIMARY KEY ("product_id"),
    CONSTRAINT "p3d_product_settings_product_id_fkey"
        FOREIGN KEY ("product_id") REFERENCES "shp_products"("id") ON DELETE CASCADE
);
