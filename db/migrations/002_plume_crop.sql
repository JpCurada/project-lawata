-- 002: evidence crop per plume (the 10 m OpenCV overlay JPEG in the evidence bucket).
-- Additive only and safe to re-run. NULL until the crop is rendered
-- (python -m lawata.entrypoints.backfill_crops).

ALTER TABLE plume_event ADD COLUMN IF NOT EXISTS crop_uri TEXT;
