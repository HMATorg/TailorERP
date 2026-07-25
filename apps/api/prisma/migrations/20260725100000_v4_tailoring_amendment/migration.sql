-- v4 amendment: KSA tailoring domain (competitor blueprint).
-- Adds the M1-M8 measurement matrix, garment design variants, fabric roll trace
-- and reservations, ZATCA Fatoora Phase 2 invoice fields, and workshop tickets.
--
-- DATA-PRESERVING: the old free-form measurements.data JSON is mapped into the
-- new typed columns before the column is dropped. Anything unrecognised is kept
-- in "extra" so nothing entered by a shop is silently lost. Legacy values were
-- recorded in inches (see the old schema comment) and are converted to cm.

-- CreateEnum
CREATE TYPE "CollarStyle" AS ENUM ('qallabi_1_button', 'qallabi_2_button', 'rounded_sada', 'open_v_neck');

-- CreateEnum
CREATE TYPE "CuffStyle" AS ENUM ('formal_kabak', 'buttoned_sada');

-- CreateEnum
CREATE TYPE "PocketStyle" AS ENUM ('upper_left_patch', 'hidden_side', 'mobile_slot');

-- CreateEnum
CREATE TYPE "StitchingStyle" AS ENUM ('hidden_plain', 'visible_dual_sawai', 'embroidered_zari');

-- CreateEnum
CREATE TYPE "ProductionStation" AS ENUM ('queued', 'cutting', 'stitching', 'quality', 'ready');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('reserved', 'consumed', 'released');

-- CreateEnum
CREATE TYPE "ZatcaInvoiceType" AS ENUM ('simplified', 'standard');

-- CreateEnum
CREATE TYPE "ZatcaSubmissionStatus" AS ENUM ('pending', 'reported', 'cleared', 'failed');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('deposit', 'settlement', 'refund');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "lifetime_order_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "inventory_batches" ADD COLUMN     "barcode" VARCHAR(100),
ADD COLUMN     "brand" VARCHAR(100),
ADD COLUMN     "color_shade_code" VARCHAR(50),
ADD COLUMN     "fabric_type" VARCHAR(100),
ADD COLUMN     "min_usable_meters" DECIMAL(12,2) NOT NULL DEFAULT 3.50,
ADD COLUMN     "origin" VARCHAR(100),
ADD COLUMN     "reserved_quantity" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "clearance_status" VARCHAR(50),
ADD COLUMN     "icv" INTEGER,
ADD COLUMN     "invoice_hash" VARCHAR(128),
ADD COLUMN     "net_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "previous_hash" VARCHAR(128),
ADD COLUMN     "qr_code_base64" TEXT,
ADD COLUMN     "submission_status" "ZatcaSubmissionStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN     "submitted_at" TIMESTAMP(3),
ADD COLUMN     "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 15.00,
ADD COLUMN     "xml_url" TEXT,
ADD COLUMN     "zatca_invoice_type" "ZatcaInvoiceType" NOT NULL DEFAULT 'simplified',
ADD COLUMN     "zatca_response" JSONB,
ADD COLUMN     "zatca_uuid" UUID;

-- AlterTable: add the new measurement columns first (no drop yet)
ALTER TABLE "measurements" ADD COLUMN     "extra" JSONB,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "m1_total_length" DECIMAL(6,2),
ADD COLUMN     "m2_shoulder_width" DECIMAL(6,2),
ADD COLUMN     "m3_sleeve_length" DECIMAL(6,2),
ADD COLUMN     "m4_chest_circumference" DECIMAL(6,2),
ADD COLUMN     "m5_hip_width" DECIMAL(6,2),
ADD COLUMN     "m6_neck_diameter" DECIMAL(6,2),
ADD COLUMN     "m7_wrist_opening" DECIMAL(6,2),
ADD COLUMN     "m8_skirt_perimeter" DECIMAL(6,2),
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- Backfill from the legacy JSON. Keys are matched case-insensitively against the
-- names the old free-form editor used; 1 inch = 2.54 cm.
UPDATE "measurements" SET
  "m1_total_length"        = ROUND((COALESCE(("data"->>'length')::numeric, ("data"->>'totalLength')::numeric) * 2.54)::numeric, 2),
  "m2_shoulder_width"      = ROUND((("data"->>'shoulder')::numeric * 2.54)::numeric, 2),
  "m3_sleeve_length"       = ROUND((("data"->>'sleeve')::numeric * 2.54)::numeric, 2),
  "m4_chest_circumference" = ROUND((("data"->>'chest')::numeric * 2.54)::numeric, 2),
  "m5_hip_width"           = ROUND((COALESCE(("data"->>'waist')::numeric, ("data"->>'hip')::numeric) * 2.54)::numeric, 2),
  "m6_neck_diameter"       = ROUND((COALESCE(("data"->>'neck')::numeric, ("data"->>'collar')::numeric) * 2.54)::numeric, 2),
  "m7_wrist_opening"       = ROUND((("data"->>'wrist')::numeric * 2.54)::numeric, 2),
  "m8_skirt_perimeter"     = ROUND((COALESCE(("data"->>'skirt')::numeric, ("data"->>'hem')::numeric) * 2.54)::numeric, 2),
  -- keep the original payload so nothing is unrecoverable
  "extra" = jsonb_build_object('legacyData', "data", 'legacyUnit', 'inches')
WHERE "data" IS NOT NULL;

-- Only now is the legacy column redundant.
ALTER TABLE "measurements" DROP COLUMN "data";

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "collar_style" "CollarStyle",
ADD COLUMN     "cuff_style" "CuffStyle",
ADD COLUMN     "pocket_style" "PocketStyle",
ADD COLUMN     "sequence_no" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "stitching_style" "StitchingStyle",
ADD COLUMN     "yield_meters" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "vat_number" VARCHAR(20),
ADD COLUMN     "zatca_csid_encrypted" TEXT,
ADD COLUMN     "zatca_environment" VARCHAR(20),
ADD COLUMN     "zatca_private_key_encrypted" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "kind" "PaymentKind" NOT NULL DEFAULT 'settlement';

-- CreateTable
CREATE TABLE "fabric_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batch_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "meters" DECIMAL(12,2) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'reserved',
    "reserved_by" UUID,
    "consumed_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fabric_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "ticket_code" VARCHAR(50) NOT NULL,
    "station" "ProductionStation" NOT NULL DEFAULT 'queued',
    "assigned_to" UUID,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_ticket_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" UUID NOT NULL,
    "from_station" "ProductionStation",
    "to_station" "ProductionStation" NOT NULL,
    "changed_by" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_ticket_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fabric_reservations_batch_id_status_idx" ON "fabric_reservations"("batch_id", "status");

-- CreateIndex
CREATE INDEX "fabric_reservations_order_item_id_idx" ON "fabric_reservations"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_tickets_order_item_id_key" ON "production_tickets"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_tickets_ticket_code_key" ON "production_tickets"("ticket_code");

-- CreateIndex
CREATE INDEX "production_tickets_store_id_station_idx" ON "production_tickets"("store_id", "station");

-- CreateIndex
CREATE INDEX "production_tickets_order_id_idx" ON "production_tickets"("order_id");

-- CreateIndex
CREATE INDEX "production_tickets_assigned_to_idx" ON "production_tickets"("assigned_to");

-- CreateIndex
CREATE INDEX "production_ticket_history_ticket_id_created_at_idx" ON "production_ticket_history"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "production_ticket_history_changed_by_idx" ON "production_ticket_history"("changed_by");

-- CreateIndex
CREATE INDEX "inventory_batches_store_id_barcode_idx" ON "inventory_batches"("store_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_zatca_uuid_key" ON "invoices"("zatca_uuid");

-- CreateIndex
CREATE INDEX "invoices_organization_id_submission_status_idx" ON "invoices"("organization_id", "submission_status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_icv_key" ON "invoices"("organization_id", "icv");

-- CreateIndex
CREATE INDEX "measurements_customer_id_is_active_idx" ON "measurements"("customer_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "measurements_customer_id_garment_type_version_key" ON "measurements"("customer_id", "garment_type", "version");

-- AddForeignKey
ALTER TABLE "fabric_reservations" ADD CONSTRAINT "fabric_reservations_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "inventory_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_reservations" ADD CONSTRAINT "fabric_reservations_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_tickets" ADD CONSTRAINT "production_tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_tickets" ADD CONSTRAINT "production_tickets_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_tickets" ADD CONSTRAINT "production_tickets_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_tickets" ADD CONSTRAINT "production_tickets_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_ticket_history" ADD CONSTRAINT "production_ticket_history_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "production_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_ticket_history" ADD CONSTRAINT "production_ticket_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- Exactly one active measurement profile per customer+garment (v4 amendment §2:
-- "cutters work off a single valid frame template"). A partial unique index is
-- the only way to express "at most one row where is_active".
CREATE UNIQUE INDEX "measurements_one_active_per_garment"
  ON "measurements" ("customer_id", "garment_type")
  WHERE "is_active" = true;

-- Reserved metres can never exceed what is physically on the roll.
ALTER TABLE "inventory_batches"
  ADD CONSTRAINT "chk_batch_reserved_within_current"
  CHECK ("reserved_quantity" >= 0 AND "reserved_quantity" <= "current_quantity");
