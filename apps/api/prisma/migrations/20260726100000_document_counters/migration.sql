-- CreateTable
CREATE TABLE "document_counters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "store_id" UUID,
    "kind" VARCHAR(30) NOT NULL,
    "scope" VARCHAR(30) NOT NULL DEFAULT '',
    "value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_counters_organization_id_store_id_kind_scope_key" ON "document_counters"("organization_id", "store_id", "kind", "scope");


-- Seed from existing data so numbering continues rather than restarting at 1.
INSERT INTO document_counters (organization_id, store_id, kind, scope, value, updated_at)
SELECT o.organization_id, o.store_id, 'order', '',
       COALESCE(MAX(NULLIF(regexp_replace(o.order_number, '\D', '', 'g'), ''))::int, 0), NOW()
FROM orders o
GROUP BY o.organization_id, o.store_id
ON CONFLICT DO NOTHING;

INSERT INTO document_counters (organization_id, store_id, kind, scope, value, updated_at)
SELECT i.organization_id, '00000000-0000-0000-0000-000000000000'::uuid, 'invoice',
       split_part(i.invoice_number, '-', 2),
       COALESCE(MAX(split_part(i.invoice_number, '-', 3)::int), 0), NOW()
FROM invoices i
GROUP BY i.organization_id, split_part(i.invoice_number, '-', 2)
ON CONFLICT DO NOTHING;
