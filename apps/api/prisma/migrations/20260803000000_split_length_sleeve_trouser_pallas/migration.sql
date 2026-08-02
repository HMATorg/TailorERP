-- D-068: a real tailor shop's front/back total length and left/right sleeve
-- are not interchangeable with the single m1_total_length/m3_sleeve_length
-- this replaces. Existing data is preserved by backfilling both sides of each
-- pair from the old single value before dropping it — not destroyed, since we
-- have no way to know which side a historical single value actually meant.

-- AlterTable: add the new columns
ALTER TABLE "measurements" ADD COLUMN     "m1_front_length" DECIMAL(6,2),
ADD COLUMN     "m1_back_length" DECIMAL(6,2),
ADD COLUMN     "m3_sleeve_left" DECIMAL(6,2),
ADD COLUMN     "m3_sleeve_right" DECIMAL(6,2),
ADD COLUMN     "trouser_pallas" JSONB;

-- Backfill: an existing single value applies to both sides until re-measured.
UPDATE "measurements"
SET "m1_front_length" = "m1_total_length",
    "m1_back_length" = "m1_total_length"
WHERE "m1_total_length" IS NOT NULL;

UPDATE "measurements"
SET "m3_sleeve_left" = "m3_sleeve_length",
    "m3_sleeve_right" = "m3_sleeve_length"
WHERE "m3_sleeve_length" IS NOT NULL;

-- Drop the now-superseded single columns.
ALTER TABLE "measurements" DROP COLUMN "m1_total_length",
DROP COLUMN "m3_sleeve_length";
