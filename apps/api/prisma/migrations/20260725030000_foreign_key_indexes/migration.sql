-- Unindexed foreign keys force a sequential scan of the *referencing* table on every
-- delete of a referenced row, and hold locks while doing it (D-026).
--
-- Found while cleaning up load-test data: deleting customers hung, because each row
-- required a full scan of orders, appointments, and whatsapp_messages. The PRD (§5)
-- requires GDPR/PDPL erasure, so customer deletion is a real operation, not a test
-- artefact — it would have timed out in production.
--
-- Indexed here: every FK on a deletion path (customer/user/store/order erasure) plus
-- those used for direct lookups. Pure audit-trail columns are covered too since
-- deactivating a user must not scan the whole audit table.

-- Customer erasure path
CREATE INDEX "orders_customer_id_idx" ON "orders" ("customer_id");
CREATE INDEX "appointments_customer_id_idx" ON "appointments" ("customer_id");
CREATE INDEX "whatsapp_messages_customer_id_idx" ON "whatsapp_messages" ("customer_id");

-- Store deletion / per-store lookups
CREATE INDEX "user_store_roles_store_id_idx" ON "user_store_roles" ("store_id");
CREATE INDEX "customers_preferred_store_id_idx" ON "customers" ("preferred_store_id");
CREATE INDEX "customer_store_visits_store_id_idx" ON "customer_store_visits" ("store_id");
CREATE INDEX "measurements_store_id_idx" ON "measurements" ("store_id");

-- User deactivation / "who did this" attribution
CREATE INDEX "measurements_taken_by_idx" ON "measurements" ("taken_by");
CREATE INDEX "appointments_assigned_tailor_id_idx" ON "appointments" ("assigned_tailor_id");
CREATE INDEX "inventory_movements_created_by_idx" ON "inventory_movements" ("created_by");
CREATE INDEX "inventory_restock_alerts_resolved_by_idx" ON "inventory_restock_alerts" ("resolved_by");
CREATE INDEX "orders_created_by_idx" ON "orders" ("created_by");
CREATE INDEX "order_status_history_changed_by_idx" ON "order_status_history" ("changed_by");
CREATE INDEX "payments_received_by_idx" ON "payments" ("received_by");
CREATE INDEX "invitations_invited_by_idx" ON "invitations" ("invited_by");
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs" ("actor_user_id");

-- Organisation-level cascades (tenant offboarding)
CREATE INDEX "orders_organization_id_idx" ON "orders" ("organization_id");
CREATE INDEX "whatsapp_messages_organization_id_idx" ON "whatsapp_messages" ("organization_id");

-- Remaining referential lookups
CREATE INDEX "inventory_batches_supplier_id_idx" ON "inventory_batches" ("supplier_id");
CREATE INDEX "inventory_movements_order_id_idx" ON "inventory_movements" ("order_id");
CREATE INDEX "whatsapp_messages_order_id_idx" ON "whatsapp_messages" ("order_id");
CREATE INDEX "order_items_measurement_id_idx" ON "order_items" ("measurement_id");
CREATE INDEX "organization_subscriptions_plan_id_idx" ON "organization_subscriptions" ("plan_id");
