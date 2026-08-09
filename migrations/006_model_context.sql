-- Model contexts: which add-on combination a model file shows.
--
-- '' (the default) is the base model - the product alone, exactly what every
-- existing row means. A tagged row ('screens', 'cable-tray+screens',
-- 'shelves:2') is the same product WITH those add-ons in shot, shown only when
-- the storefront says that context is active. Keys are sorted and joined with
-- '+' by the consumer; a ':N' suffix ties a file to an exact quantity.
--
-- Matching is exact-or-base by design: a combination without its own file
-- falls back to the base model, never to a nearest guess.
ALTER TABLE "p3d_models" ADD COLUMN IF NOT EXISTS "context" TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS "p3d_models_product_context_idx" ON "p3d_models" ("product_id", "context");
