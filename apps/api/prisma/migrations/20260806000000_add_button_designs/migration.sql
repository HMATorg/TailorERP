-- D-071: a shop's own photographed button catalog, and which one an order
-- item uses. Fully additive — a new table plus one nullable FK column, no
-- backfill needed.

CREATE TABLE "button_designs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "serial_number" VARCHAR(20) NOT NULL,
    "image_url" TEXT NOT NULL,
    "label" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "button_designs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "button_designs_organization_id_serial_number_key" ON "button_designs"("organization_id", "serial_number");

CREATE INDEX "button_designs_organization_id_is_active_idx" ON "button_designs"("organization_id", "is_active");

ALTER TABLE "button_designs" ADD CONSTRAINT "button_designs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_items" ADD COLUMN "button_design_id" UUID;

CREATE INDEX "order_items_button_design_id_idx" ON "order_items"("button_design_id");

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_button_design_id_fkey" FOREIGN KEY ("button_design_id") REFERENCES "button_designs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
