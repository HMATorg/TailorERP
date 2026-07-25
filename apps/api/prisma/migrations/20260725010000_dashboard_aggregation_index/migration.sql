-- The HQ dashboard aggregates orders by store over a date range (D-024).
-- The existing (store_id, customer_id, created_at) index leads with store_id and
-- cannot serve a range scan across many stores, so the planner fell back to a
-- sequential scan of the whole orders table on every dashboard load.
--
-- Partial index: cancelled orders are excluded from every revenue figure, so
-- keeping them out of the index makes it smaller and matches the query predicate.
CREATE INDEX "orders_store_created_active_idx"
  ON "orders" ("store_id", "created_at")
  INCLUDE ("total_amount")
  WHERE "status" <> 'cancelled';
