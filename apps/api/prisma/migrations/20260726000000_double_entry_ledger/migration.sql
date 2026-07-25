-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('deposit', 'settlement', 'refund', 'adjustment');

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "name_ar" VARCHAR(255),
    "type" "AccountType" NOT NULL,
    "normal_balance" "NormalBalance" NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "store_id" UUID,
    "entry_number" INTEGER NOT NULL,
    "source" "JournalSource" NOT NULL,
    "reference_type" VARCHAR(50),
    "reference_id" UUID,
    "memo" TEXT,
    "total_debit" DECIMAL(14,2) NOT NULL,
    "total_credit" DECIMAL(14,2) NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_by" UUID,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "ledger_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_accounts_organization_id_type_idx" ON "ledger_accounts"("organization_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_organization_id_code_key" ON "ledger_accounts"("organization_id", "code");

-- CreateIndex
CREATE INDEX "journal_entries_organization_id_posted_at_idx" ON "journal_entries"("organization_id", "posted_at");

-- CreateIndex
CREATE INDEX "journal_entries_reference_type_reference_id_idx" ON "journal_entries"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "journal_entries_store_id_idx" ON "journal_entries"("store_id");

-- CreateIndex
CREATE INDEX "journal_entries_posted_by_idx" ON "journal_entries"("posted_by");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_organization_id_entry_number_key" ON "journal_entries"("organization_id", "entry_number");

-- CreateIndex
CREATE INDEX "ledger_lines_entry_id_idx" ON "ledger_lines"("entry_id");

-- CreateIndex
CREATE INDEX "ledger_lines_account_id_idx" ON "ledger_lines"("account_id");

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A journal entry that does not balance is not an entry (D-036). Enforced at the
-- database so no code path — migration, script, or future feature — can post one.
ALTER TABLE "journal_entries"
  ADD CONSTRAINT "chk_journal_balanced" CHECK ("total_debit" = "total_credit"),
  ADD CONSTRAINT "chk_journal_nonzero" CHECK ("total_debit" > 0);

-- A line carries a debit or a credit, never both and never neither.
ALTER TABLE "ledger_lines"
  ADD CONSTRAINT "chk_line_one_sided" CHECK (
    ("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0)
  );
