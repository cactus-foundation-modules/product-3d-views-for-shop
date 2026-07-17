-- Viewer settings for product-3d-views-for-shop.
--
-- A singleton row holding one JSON blob, the same shape and the same 'singleton'
-- key shop uses for shp_settings - there is no reason for the two to differ, and a
-- second convention is just something to remember wrong later.
--
-- One row because there is one viewer: these are the site owner's decisions about
-- how every model on the site is lit and driven, not per-product ones. A column per
-- setting would mean a migration every time we add a slider, and a product wanting
-- different lighting from the rest of the catalogue is a request nobody has made.
--
-- The CHECK is what makes it a singleton rather than a table that merely happens to
-- have one row in it: a second INSERT is refused by the database rather than
-- quietly creating a settings row nothing will ever read.
--
-- No row is seeded. Absent means "never saved", which lib/config.ts already has to
-- handle for a saved row that predates a newly added setting, so seeding defaults
-- would only add a second way of saying the same thing - and a stale one, frozen as
-- of this migration rather than tracking the schema's. updateP3dConfig upserts, so
-- a missing row heals itself on the first save.
CREATE TABLE IF NOT EXISTS "p3d_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "p3d_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "p3d_settings_singleton_check" CHECK ("id" = 'singleton')
);
