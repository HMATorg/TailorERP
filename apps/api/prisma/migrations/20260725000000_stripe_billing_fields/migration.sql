-- Stripe billing identifiers (D-018).
-- stripe_customer_id is unique: one Stripe Customer per tenant organisation.
ALTER TABLE "organizations" ADD COLUMN "stripe_customer_id" VARCHAR(255);

CREATE UNIQUE INDEX "organizations_stripe_customer_id_key"
  ON "organizations"("stripe_customer_id");

-- A plan is only purchasable once its Stripe Price IDs are populated.
ALTER TABLE "subscription_plans"
  ADD COLUMN "stripe_monthly_price_id" VARCHAR(255),
  ADD COLUMN "stripe_yearly_price_id" VARCHAR(255);
