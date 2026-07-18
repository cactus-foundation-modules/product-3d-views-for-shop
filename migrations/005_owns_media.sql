-- Whether the module put this file in the media library itself, and may
-- therefore take it out again.
--
-- Removing a model deletes the stored file, so the owner is not billed for tens
-- of megabytes nothing points at. That was written when every model arrived by
-- upload through this module, and the picker has since made the other case
-- ordinary: choosing a 3D file already in the library attaches it without moving
-- a byte, so the file was never ours - and deleting the model deleted the site
-- owner's library file out from under them.
--
-- One flag settles it. An upload records true and keeps the tidy-up; a file
-- picked from the library records false and is left exactly where it was found.
-- DEFAULT false so a path that forgets to say leaks bytes rather than destroying
-- a file: an orphaned blob is a bill, a deleted one is gone.
--
-- New numbered file rather than an edit to 001: editing an applied migration in
-- place only ever reaches fresh installs, so a schema change ships as the next
-- number and run-module-migrations.mjs applies it on every install's next
-- deploy. Idempotent DDL throughout, which keeps re-running harmless.
ALTER TABLE "p3d_models"
    ADD COLUMN IF NOT EXISTS "owns_media" BOOLEAN NOT NULL DEFAULT false;

-- Backfill for rows that predate the flag. Every file this module has ever
-- uploaded was filed in the product's own "3d" subfolder (resolve3dFolderId
-- builds that path and nothing else writes there), so a storage key under one is
-- a file we uploaded and may still tidy away. Rows without a key at all - a url
-- typed into a Google Sheet cell - never owned a blob and stay false, which is
-- what they already behaved like.
--
-- Guarded on the column having just been added, so a re-run cannot re-assert
-- ownership over a row an admin has since had set the other way.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "p3d_models" WHERE "owns_media" IS TRUE
    ) THEN
        UPDATE "p3d_models"
        SET "owns_media" = true
        WHERE "media_key" IS NOT NULL
          AND "media_key" LIKE '%/3d/%';
    END IF;
END $$;
