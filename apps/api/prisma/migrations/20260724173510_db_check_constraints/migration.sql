-- Database-level stock integrity (D-007): the application validates first and
-- returns 422; these CHECKs are the final backstop against write races.
ALTER TABLE "inventory_batches"
  ADD CONSTRAINT "chk_batch_current_qty_nonnegative" CHECK ("current_quantity" >= 0);

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "chk_movement_new_balance_nonnegative" CHECK ("new_balance" >= 0),
  ADD CONSTRAINT "chk_movement_quantity_positive" CHECK ("quantity" > 0);
