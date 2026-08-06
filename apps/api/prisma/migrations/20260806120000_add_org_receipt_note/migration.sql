-- D-072: opt-in per-tenant liability/policy note printed on the thermal
-- receipt (e.g. "not responsible for garments left unclaimed after 3
-- months"). Additive, nullable — no backfill needed.

ALTER TABLE "organizations" ADD COLUMN "receipt_note" VARCHAR(500);
