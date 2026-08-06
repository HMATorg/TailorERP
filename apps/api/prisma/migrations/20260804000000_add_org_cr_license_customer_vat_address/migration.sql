-- D-069: display-only fields for a competitor-style invoice — the seller's CR
-- and license numbers, and a B2B customer's own VAT number and address. None
-- of these feed ZATCA's XML/QR (only Organization.vatNumber does), so this is
-- a plain additive migration — no backfill needed.

ALTER TABLE "organizations" ADD COLUMN     "cr_number" VARCHAR(50),
ADD COLUMN     "license_number" VARCHAR(50);

ALTER TABLE "customers" ADD COLUMN     "vat_number" VARCHAR(20),
ADD COLUMN     "address" TEXT;
