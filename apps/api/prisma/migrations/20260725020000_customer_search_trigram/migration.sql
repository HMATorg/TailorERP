-- Customer search uses ILIKE '%term%' (name) and LIKE '%term%' (phone), which no
-- B-tree index can serve — the planner falls back to a full scan of customers on
-- every keystroke. Harmless at demo size, but the PRD targets 1M+ customers.
--
-- pg_trgm + GIN makes substring matching index-backed (D-025).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "customers_full_name_trgm_idx"
  ON "customers" USING gin ("full_name" gin_trgm_ops);

CREATE INDEX "customers_phone_trgm_idx"
  ON "customers" USING gin ("phone" gin_trgm_ops);

-- Order search filters on order_number the same way.
CREATE INDEX "orders_order_number_trgm_idx"
  ON "orders" USING gin ("order_number" gin_trgm_ops);
