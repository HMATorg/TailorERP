# Engineering Decisions Log

**Product:** Tailonix – Complete Enterprise Platform
**Maintained by:** Lead Full-Stack Engineer
**Started:** July 24, 2026

This document records decisions made during implementation where the PRD/TRD/Architecture
docs were ambiguous, contradictory, or silent. Each entry states the conflict, the decision,
and the rationale. Specs live in `docs/` alongside this file.

---

## D-001: Staff JWT expiry — PRD vs TRD conflict

- **Conflict:** PRD §5 (Security NFR) says "JWT with short expiry (15 min)". TRD §4.1 and
  Architecture §7.1 say staff access tokens are **1 hour** with 7-day refresh; **customer**
  tokens are 15 min.
- **Decision:** Follow TRD/Architecture: staff access **1h / refresh 7d**, customer access
  **15 min** with rotating refresh. All expiries are env-configurable (`JWT_STAFF_ACCESS_TTL`
  etc.), so tightening to 15 min is a config change, not a code change.
- **Rationale:** The TRD is the engineering hand-off document and is internally consistent;
  the PRD line reads as a summary of the customer-token policy.

## D-002: `batch_code` uniqueness — schema bug in TRD

- **Conflict:** TRD §3.4 declares `batch_code VARCHAR(100) UNIQUE` (globally unique).
  But TRD §5.2 (inter-store transfer) requires the destination store to hold a batch with the
  **same** `batch_code` as the source. Both cannot be true.
- **Decision:** Uniqueness is **per store**: `UNIQUE (store_id, batch_code)`.
- **Rationale:** Transfers preserve the batch identity across stores; global uniqueness would
  make §5.2 impossible and would also cause collisions between unrelated tenants.

## D-003: Base tables the TRD assumes but never defines

- **Gap:** TRD §3.3 says `ALTER TABLE customers ADD COLUMN …` and §3.7 says "an existing
  `audit_logs` table extended" — but this is a greenfield build; there is no existing system.
  `orders`, `order_items`, `measurements`, `payments`, `invoices` are referenced throughout
  (FKs, endpoints, wireframes) but never defined.
- **Decision:** We author the full base schema ourselves: `customers`, `orders`, `order_items`,
  `order_item_fabrics` (links consumed batches to items), `order_status_history` (powers the
  PWA timeline timestamps), `measurements`, `payments`, `invoices`, `audit_logs`,
  `refresh_tokens`, `notifications`, `invitations`. Columns the TRD adds via `ALTER TABLE`
  are folded into the base definitions.
- **Rationale:** The v3.0 docs are written as a delta over an assumed v1/v2 that doesn't exist
  here. The wireframes (order timeline with per-step timestamps, measurement history,
  payment processing) dictate what the base tables must contain.

## D-004: HQ Admin scoping — org-level role vs per-store rows

- **Conflict:** TRD models all roles in `user_store_roles` (one row per user per store), but an
  HQ Admin must automatically see **new** stores (PRD HQ-2) — per-store rows would require
  backfilling a row every time a store is created.
- **Decision:** `users.organization_id` + `users.org_role` (`hq_admin` or NULL) grants
  org-wide access. `user_store_roles` holds store-scoped roles (`regional_manager`,
  `store_manager`, `tailor`, `cashier`). Regional managers get one row per assigned store.
- **Rationale:** Matches the real hierarchy in PRD §4.6, avoids backfill bugs, keeps the
  store-role table clean for the common case.

## D-005: PWA framework — Vue vs React left open by TRD

- **Open point:** TRD §2 says "Vue 3 + Vite (or React)"; Architecture §12 says "pick based on
  team skills".
- **Decision:** **React 18 everywhere** (admin SPA, PWA, platform admin SPA).
- **Rationale:** One ecosystem = shared API client, shared types package, shared design
  tokens, one set of lint/test tooling, and no context-switching. Nothing in the PWA
  requirements needs Vue specifically.

## D-006: ORM — TypeORM vs Prisma left open by TRD

- **Decision:** **Prisma** for schema, migrations, and type-safe queries. FIFO batch
  consumption and transfers use `$queryRaw` with `SELECT … FOR UPDATE` inside
  `prisma.$transaction` for row-level locking (TRD §5.1 requirement).
- **Rationale:** Prisma's migration story and generated types are stronger; the few
  pessimistic-locking paths are explicit raw SQL, which is *better* for auditing the exact
  locking behavior than ORM-generated SQL.

## D-007: Negative stock prevention "at database level"

- **Decision:** `CHECK (current_quantity >= 0)` on `inventory_batches` and
  `CHECK (new_balance >= 0)` on `inventory_movements`, added as raw SQL in the initial
  migration (Prisma doesn't model CHECK constraints natively). Application logic still
  validates first and returns 422 with available quantity (TRD §5.1.3); the CHECK is the
  last line of defense against race conditions.

## D-008: Store timezone for the 8 AM reorder cron

- **Gap:** TRD §5.4 says the cron runs at 8 AM *store* local time, but `timezone` lives on
  `organizations`, not `stores`.
- **Decision:** Add nullable `stores.timezone`; falls back to the organization's timezone.
  The cron scans hourly and fires for stores whose effective local time is 08:00.
- **Rationale:** Gulf chains can span timezones (KSA/UAE/Oman differ); a nullable override
  costs nothing and avoids a migration later.

## D-009: OTP length — 4 digits per wireframes

- **Note:** Wireframes specify a 4-digit OTP. Kept at 4 (configurable `OTP_LENGTH`), but with
  the mandatory compensating controls: 5-minute expiry, max **5 verification attempts** per
  code (the TRD rate-limits *requests* but is silent on *attempts* — added), request limit
  3 per 15 min per phone, codes stored hashed in Redis.
- **Recommendation on file:** move to 6 digits before GA; it's a config change.

## D-010: Order number & status model

- **Decision:** `order_number` is sequential per store with a store prefix (e.g. `DXB-000123`),
  unique per store. Status enum: `pending → cutting → sewing → fitting → ready → delivered`
  (+ `cancelled`). Wireframe stepper shows the first 5; `delivered` is the terminal state
  after pickup (PRD C-3 lists all 6). Every transition writes `order_status_history`, which
  powers the PWA timeline timestamps.

## D-011: Dev-first infrastructure

- **Decision:** Local/dev runs on Docker Compose (Postgres 15, Redis 7, MinIO as the
  S3-compatible store). Kubernetes/RDS/ElastiCache/CloudFront topology from Architecture
  §8 is a deployment concern deferred until we have a deployable product; nothing in the
  code assumes Compose (12-factor config throughout).

## D-012: Monorepo layout

```
apps/api             NestJS modular monolith (tenant + customer + platform APIs, workers)
apps/admin           React admin SPA (Ant Design v5, RTL)
apps/pwa             React customer PWA (Vite + vite-plugin-pwa/Workbox)
apps/platform-admin  React platform admin SPA
packages/shared      Shared TS types, role/permission constants, order status enums
```

npm workspaces (no pnpm dependency on dev machines). Node 24, TypeScript 5 strict.

## D-013: Customer identity

- **Decision:** Customers are unique per `(organization_id, phone)` — the phone number is
  the login identity for the PWA (OTP). The same physical person at two different tenant
  chains is two customer rows; profiles are shared **within** an org across its stores
  (PRD hybrid-tenancy requirement), never across orgs.

## D-014: Validation library

- **Decision:** `class-validator` + `class-transformer` DTOs (canonical NestJS style) rather
  than Zod. TRD offers either; NestJS pipes integrate with class-validator out of the box.

## D-015: Notification channel priority and fallback

- **Decision:** On `order.status.changed` the worker tries **WhatsApp first** when
  the customer has consented; if the send throws (or there is no consent), it falls
  through to **web push** to the customer's registered devices. SMS remains the
  final planned hop but is unimplemented pending a Gulf gateway choice.
- **Rationale:** PRD §4.4 requires the fallback chain, and consent is a hard gate on
  the WhatsApp leg. Push needs no consent record beyond the browser permission the
  customer already granted, so it is the correct second hop.
- **Note:** Push copy is *not* a WhatsApp template — templates need Meta pre-approval
  and are variable-substituted, whereas push text is free-form. They are maintained
  separately (`PUSH_COPY` in `notification.worker.ts`), localised en/ar.

## D-016: `validateEnv` must return the whole config

- **Bug found in implementation:** NestJS `ConfigModule` **replaces the entire
  configuration object** with whatever the `validate` function returns. Returning
  only the validated class instance silently dropped every undeclared variable —
  `TOKEN_ENCRYPTION_KEY`, `OTP_*`, `WHATSAPP_*`, `VAPID_*`, and all JWT TTLs — which
  then fell back to code defaults with no error. In production this would have broken
  WhatsApp access-token decryption.
- **Decision:** `validateEnv` returns `{ ...config, ...instanceToPlain(validated) }`,
  and a regression test asserts undeclared vars survive.
- **Rule going forward:** adding a required env var means adding it to `EnvVariables`;
  adding an optional one needs no change, but never narrow the return type again.

## D-017: Service worker owns push (Workbox `injectManifest`)

- **Decision:** The PWA switched from `generateSW` to **`injectManifest`** with a
  hand-written `src/sw.ts`.
- **Rationale:** `generateSW` cannot host custom `push` / `notificationclick`
  listeners. The hand-written worker keeps the same caching strategy (precache +
  network-first for `/api/`) and adds push handling that focuses an already-open tab
  before opening a new window.

## D-018: Stripe is the source of truth for subscription state

- **Decision:** `organization_subscriptions` is a **projection** of Stripe, not a
  parallel ledger. Webhooks (`customer.subscription.*`, `invoice.paid`,
  `invoice.payment_failed`) upsert our row; the platform admin's manual "change plan"
  action remains for enterprise deals billed outside Stripe.
- **Mapping:** Stripe status → ours: `trialing`→`trialing`, `active`→`active`,
  `past_due`/`unpaid`→`past_due`, `canceled`/`incomplete_expired`→`cancelled`,
  everything else→`suspended`. Every sync invalidates the Redis feature cache so
  entitlements follow payment immediately rather than after the 5-minute TTL.
- **Tenant linkage:** `organizationId` is written into subscription metadata at
  checkout. A webhook without it is logged and ignored — we never guess which tenant
  a payment belongs to.

## D-019: Stripe SDK v22 field relocations

- **Gotcha hit during implementation:** the installed SDK pins API `2026-06-24.dahlia`,
  which moved two fields the older integration guides still reference:
  - `invoice.subscription` → **`invoice.parent.subscription_details.subscription`**
  - `subscription.current_period_start/end` → **on the subscription *item***
    (`subscription.items.data[0].current_period_*`)
- **Decision:** Do not pin `apiVersion` in the constructor. The SDK's default matches
  its own typings; pinning an older string compiles only with `as any` casts and would
  silently drift from the types.
- A subscription arriving without a resolvable billing period is skipped and logged
  rather than written with a fabricated date.

## D-020: Billing degrades, it does not crash

- Without `STRIPE_SECRET_KEY` the billing endpoints return **503** and the rest of the
  platform runs untouched. This keeps local dev, CI, and self-hosted deployments that
  do not use Stripe fully functional. Webhooks without a valid signature are rejected
  **400 before any parsing** — the signature is the only authentication that endpoint has.

## D-021: Invoice PDFs are Latin-only for now — **superseded by D-040**

> **Superseded.** The constraint below was half right and half wrong, and the wrong
> half is why this sat unfixed. PDFKit's *built-in* fonts genuinely cannot render
> Arabic. But the claim that correct output additionally needs a separate
> bidi/shaping pass is false: PDFKit lays out embedded OpenType fonts through
> fontkit, which shapes Arabic and reorders RTL runs on its own. The only thing
> missing was the font file. See D-040.

- **Constraint:** PDFKit's built-in fonts are WinAnsi-encoded and cannot *shape*
  Arabic — glyphs would render disconnected and left-to-right. Correct Arabic output
  needs an embedded OpenType font plus a bidi/shaping pass (e.g. `harfbuzzjs`).
- **Decision:** Ship the Latin/numeric invoice layout for all languages now. Names
  entered in Arabic will render as boxes; the amounts, dates, and reference numbers —
  the parts that matter legally — are correct in every locale.
- **To do properly later:** embed Noto Naskh Arabic (or Tajawal) via `doc.font()`,
  add shaping, and mirror the layout. Tracked as a follow-up, not a silent gap.

## D-022: Invoices are generated, not stored-and-served

- **Decision:** The PDF is rendered fresh on each download (`GET /invoices/:id/download`)
  rather than served from S3. A copy is *also* pushed to S3 at creation for the
  WhatsApp send and for a shareable presigned link.
- **Rationale:** Regeneration keeps the document consistent with the order if line
  items are corrected, and means the download path works even when object storage is
  unavailable — which is the common case in local dev and self-hosted installs.
- The `invoices` row (number, total, timestamps) is the durable record; the file is a
  render of it.

## D-023: Invoicing triggers on delivery

- `order.status.changed → delivered` enqueues `invoice.requested` on the same queue as
  notifications. The worker creates the invoice (idempotently — an order already
  invoiced returns the existing row) and, if the customer consented, sends the PDF as a
  WhatsApp **document**: upload bytes to Meta's `/media` endpoint, then reference the
  returned media ID in the message (two calls, per TRD §5.5).
- Staff can also invoice on demand from the order screen before delivery.

## D-024: Partial covering index for the dashboard aggregation

- **Problem found by profiling** (see [PERFORMANCE.md](PERFORMANCE.md)): the HQ dashboard
  did a **sequential scan of `orders`** on every load. The TRD's suggested index
  `(store_id, customer_id, created_at)` leads with `store_id` and cannot serve a
  date-range filter spanning all stores.
- **Decision:** `orders (store_id, created_at) INCLUDE (total_amount) WHERE status <> 'cancelled'`.
  Partial because cancelled orders never count toward revenue; covering so the aggregate
  is satisfied from the index.
- **Rejected:** materialized views (TRD §9 suggests them as a fallback). Unnecessary —
  p95 is 29 ms against a 2 s budget — and they add refresh lag plus a cron dependency to
  a number the business reads as live.
- **Maintenance hazard:** Prisma cannot express partial or covering indexes, so this one
  lives only in raw migration SQL with a pointer comment in `schema.prisma`. A migration
  that rebuilds `orders` must re-create it.

## D-025: Trigram indexes for substring search

- **Problem:** customer and order search use `ILIKE '%term%'`, which no B-tree can serve.
  At 202k customers a search cost 94.5 ms of pure sequential scan — per keystroke, per
  user. The PRD targets 1M+ customers.
- **Decision:** `pg_trgm` + GIN on `customers.full_name`, `customers.phone`, and
  `orders.order_number`. Measured 94.5 ms → 19.9 ms, and the gap widens with row count.
- **Declared in `schema.prisma`** using the `postgresqlExtensions` preview feature with
  explicit `map:` names, so `prisma migrate dev` does not offer to drop them. Verified
  clean with `prisma migrate diff`.
- **Not chosen:** a search service (Elasticsearch/Meilisearch). Postgres handles this
  workload comfortably; adding a second datastore would mean sync lag and another thing
  to operate for no measured benefit.

## D-026: Index every foreign key

- **Problem:** Postgres does not index foreign keys automatically. Deleting a referenced
  row scans each *referencing* table to enforce the constraint. An audit found **23
  unindexed FKs**; deleting 200k customers hung for over ten minutes because each row
  triggered sequential scans of `orders`, `appointments`, and `whatsapp_messages`.
  After indexing: **4.85 s**.
- **Why it matters beyond cleanup:** PRD §5 requires GDPR/PDPL erasure. Customer
  deletion is a product feature, and it was effectively broken.
- **Decision:** index all 23, not just the customer path. Deactivating a user, closing a
  store, and offboarding a tenant have the same shape, and the cost of an index on a
  UUID column is small compared to a table scan under lock.
- **Standing rule:** every new `@relation` gets an index on its FK column unless it is
  already the leading column of a composite index. `@@index([storeId, customerId, …])`
  does **not** cover lookups by `customerId` — leading column only.

## D-027: Measurements become a versioned matrix, enforced by the database

- **Change (v4 §2):** free-form JSON → typed M1–M8 columns in **centimetres**, with
  `version` and `isActive`.
- **Enforcement:** a *partial unique index* `(customer_id, garment_type) WHERE is_active`
  makes "exactly one active frame per garment" impossible to violate, rather than a rule
  the application is trusted to remember. The blueprint is explicit that cutters must work
  from a single valid template; that is a data-integrity requirement, not a UI concern.
- **Migration is data-preserving:** legacy JSON is mapped into the typed columns
  (inches → cm at 2.54) and the original payload is retained in `extra.legacyData`.
  Dropping the column outright would have destroyed real shop data.

## D-028: VAT is derived by subtraction, not by re-multiplication

- KSA retail prices are quoted **VAT-inclusive**, and our order totals are what the
  customer was quoted. So `splitInclusive` computes net = gross / 1.15, then
  **vat = gross − net**.
- **Why not compute VAT = net × 0.15?** Because rounding net first and then multiplying
  can produce net + vat ≠ gross by one halala. The tax authority reconciles those three
  numbers; they must agree exactly. A test asserts the identity across awkward amounts.

## D-029: ZATCA Phase 2 — what is implemented and what needs onboarding

**Implemented and tested:** 15% VAT split, invoice UUID, ICV (monotonic, allocated under
`FOR UPDATE` so concurrent checkouts cannot collide), SHA-256 hash chain from the ZATCA
genesis PIH, Base64 TLV QR (tags 1–6), UBL 2.1 XML, XML archived to object storage.

**Requires the client's ZATCA credentials, not more code:** the cryptographic stamp
(QR tags 7–9) needs a CSR submitted to ZATCA and a CSID issued for a *registered device*;
Fatoora clearance/reporting then submits against that CSID. `submit()` returns
`zatca_not_onboarded` rather than pretending success — an invoice must never be recorded
as filed when it was not.

## D-030: Compliance verification needs hash re-computation, not just chain linkage

- **Found by testing, not by review.** Chain linkage alone (`previousHash[i] ===
  invoiceHash[i-1]`) reports a *single* tampered invoice as intact — it has no successor
  to contradict it, and an attacker who edits amounts can rewrite the stored hash too.
- **Fix:** `verifyChain` now also re-reads the archived XML, re-hashes it, and compares.
  Three independent checks — linkage, re-hash, ICV continuity — because each catches a
  different tampering mode.
- Invoices whose XML cannot be read are reported as `unverifiable` rather than counted as
  passing. Absence of evidence is not evidence of integrity.

## D-031: Reserve at checkout, deduct at cutting

- The blueprint distinguishes an **Inventory Hold** (Phase 2 §3) from the actual cut
  (Phase 4 §2). We had been deducting immediately at order creation.
- **Decision:** checkout increments `reserved_quantity`; leaving the **cutting** station
  decrements `current_quantity` and releases the hold, writing the `order_out` movement
  at that moment. Cancellation releases the hold with no movement at all.
- **Why it matters:** deducting at checkout makes the roll balance lie — the fabric is
  still physically on the shelf until it is cut. Reserving keeps the ledger truthful
  while still stopping a walk-in sale from consuming promised metres.
- A CHECK constraint keeps `reserved_quantity` between 0 and `current_quantity`, so the
  two counters cannot drift into an impossible state.

## D-032: Yield is computed from the customer's own active measurements

- `Yield = (M1 × 2) + M3 + 0.20 m`, rounded **up** — a short cut ruins the garment,
  whereas a small offcut costs pennies.
- Measurements are captured in centimetres and the formula is stated in metres; the
  conversion lives in `YieldService` alone rather than at each call site.
- Availability is checked against `current − reserved`, then against the roll's own
  `min_usable_meters` (default 3.50 m). A roll that *has* the metres but would be
  stranded below its minimum is correctly refused.

## D-033: POS checkout is one call, not a wizard of independent endpoints

- `POST /pos/orders` performs measurement resolution → yield → stock validation →
  reservation → order + design variants → deposit → tickets → ZATCA invoice.
- **Rationale:** the intermediate states are not independently valid. A reservation
  without an order leaks stock; an order without tickets never reaches the workshop.
  Everything that must be atomic runs in one transaction, so a stock failure on garment
  three cannot leave garments one and two reserved.
- Deliberately **outside** the transaction: ticket creation and invoice issuance. An
  invoice-numbering hiccup must not roll back a payment the customer already made; those
  steps are idempotent and retryable instead.

## D-034: The POS is a separate app, not a section of the admin SPA

- **Decision:** new `apps/pos` (port 5176) carrying both the counter flow and the
  workshop board; the admin SPA stays a management tool.
- **Rationale:** the blueprint puts front-of-house on its own tier, and the two
  contexts genuinely differ — counter and workshop are touch/barcode devices with
  48px controls, a permanently-focused scan field, and no sidebar navigation.
  Folding them into the desk app would have compromised both.
- Counter and workshop share one shell because a small shop runs both on the same
  tablet; a segmented control switches between them.
- On login the POS defaults to a **real store**, never the HQ "all stores" view —
  that view cannot take an order, and silently landing there would be a dead end.

## D-035: Returning a pre-update row printed the wrong balance

- **Bug found by driving the UI, not by tests.** `checkout()` returned the order
  object captured from `tx.order.create()`, then separately updated `paidAmount` for
  the deposit. The response therefore reported `paidAmount: 0` while the database
  correctly held 200 — the printed receipt told a customer who had just paid SAR 200
  that the full SAR 400 was still due.
- **Fix:** capture the row returned by the update and return that.
- **Lesson worth keeping:** every unit test passed, and the e2e suite asserted the
  database. Only rendering the receipt exposed it. Assertions now cover the *response*
  `paidAmount`/`balanceDue`, not just the persisted values.

## D-036: The blueprint states the deposit posting backwards

- **The source document says:** *"logs the incoming cash as a **credit** to Cash on Hand
  and a **debit** to Unearned Revenue Liabilities."*
- **That is inverted.** Cash is an asset and increases with a **debit**; Unearned Revenue
  is a liability and increases with a **credit**. Implemented literally, taking a deposit
  would *reduce* recorded cash and *reduce* the liability — the opposite of what happened,
  and a ledger no auditor would accept.
- **Implemented correctly:**
  - Deposit: `Dr Cash/Card` · `Cr Unearned Revenue` · `Cr VAT Payable`
  - Handover: `Dr Cash` + `Dr Unearned Revenue` · `Cr Sales Revenue` · `Cr VAT Payable`
- Deposits are a **liability**, not revenue — the shop owes a thobe, and nothing is
  earned until collection. This is the substance of the blueprint's intent even though
  its debits and credits are swapped.
- Enforced structurally: `CHECK (total_debit = total_credit)` on entries and
  `CHECK` one-sidedness on lines, so no code path can post an unbalanced entry.

## D-037: VAT on split payments is a remainder, not a per-payment split

- **Problem caught by a test I wrote to document behaviour.** Splitting a SAR 400 order
  into two SAR 200 payments and computing VAT independently each time yields
  26.09 + 26.09 = **52.18**, while the invoice says **52.17**.
- One halala per split order sounds trivial until it is thousands of orders: VAT Payable
  would be systematically overstated and would never reconcile against the ZATCA filing.
- **Decision:** the settling entry derives VAT as `orderVat − vatAlreadyPosted` rather
  than splitting the balance independently. Any rounding drift is absorbed into Sales
  Revenue so the entry still balances while **VAT stays exactly reconcilable to the
  invoice** — the number the tax authority checks.
- Verified live: deposit 26.09 + settlement 26.08 = 52.17, trial balance balanced,
  Unearned Revenue discharged to zero.

## D-038: Document numbers need an atomic counter, not `count(*) + 1`

- **Found by concurrency testing.** Firing 12 simultaneous checkouts at one store
  produced **1 success and 11 HTTP 500s**: every transaction read the same
  `count(*)`, built the same `ORD-…` number, and all but one hit the unique
  constraint. Two tills in one shop would have done this daily.
- The constraint did its job — no duplicate numbers reached the database — but the
  clerk saw an opaque 500 instead of an order.
- **Decision:** a `document_counters` row incremented by
  `INSERT … ON CONFLICT DO UPDATE SET value = value + 1 RETURNING value`. One atomic
  statement; the row lock serialises callers so each gets a distinct number.
  Applied to order numbers (per store) and invoice numbers (per org, scoped by year).
- The migration backfills counters from existing rows so numbering continues rather
  than restarting at 1.
- After: 12 concurrent → 6 accepted, 6 cleanly rejected 422, **zero errors**.

## D-039: `FOR UPDATE` on the latest row does not serialise inserts

- **Second bug from the same test, and a compliance failure.** Under 32-way load,
  only **7 of 14** orders received a ZATCA tax invoice; the rest failed on
  `unique (organization_id, icv)` and were swallowed by a catch.
- `SELECT … ORDER BY icv DESC LIMIT 1 FOR UPDATE` locks the newest *existing* row.
  It does nothing to stop two transactions reading that same row and computing the
  same next ICV. Row locks guard rows, not the gap after them.
- **Decision:** `pg_advisory_xact_lock` keyed on the organisation around ZATCA
  issuance. A hash chain is inherently serial — invoice N embeds N−1's hash — so
  issuance *must* serialise per tenant. An advisory lock does that without blocking
  other tenants, and releases with the transaction.
- **Also fixed:** a failed issuance now returns `invoiceError` on the checkout
  response instead of only reaching the log. Handing over goods without a tax
  invoice is a legal problem; the counter has to know.
- After: 32 concurrent → 14 accepted, **14/14 with a tax invoice**, chain intact,
  no ICV gaps.
- Harness kept at `apps/api/test/concurrency-harness.js`; run it against a live API
  after any change to reservation, numbering, or issuance.

## D-040: Arabic invoices need a font, not a shaping engine

- **Supersedes D-021**, whose stated blocker — that a separate bidi/shaping pass was
  required — was wrong and cost the product a compliance gap it did not need to have.
- **Measured, not assumed.** PDFKit lays out embedded OpenType fonts through fontkit.
  Given a real face, fontkit applies the Arabic shaper and returns the run already
  reordered (`run.direction === 'rtl'`): 12 source characters of `خياطة الأنوار`
  become 12 glyphs whose ids differ from a per-character cmap lookup, and PDFKit
  emits all of them contiguously in one `TJ` array. No `harfbuzzjs`, no manual
  reversal — reversing the source string yourself actively breaks it.
- **Decision:** embed **Tajawal** (SIL OFL) at `apps/api/src/assets/fonts`, registered
  in `invoice-fonts.ts`. Chosen over Noto Naskh Arabic because it is the face the
  admin SPA and PWA already use, its word space is 0.240 em against Noto Naskh's
  0.108 em (words look separated at invoice body sizes), and it is a third the size.
- **`src/assets`, not `assets`,** so `nest build` copies the files into `dist` via the
  `assets` entry in nest-cli.json. `<src|dist>/invoices/..` then resolves to
  `<src|dist>/assets/fonts` unchanged between dev and the built output.
- **Missing fonts throw at boot** (`OnModuleInit`). A silent fallback to a Latin face
  is exactly how this stayed hidden: the PDF still renders, it just turns every
  Arabic name into boxes. An invoice that cannot show Arabic is not a valid KSA tax
  invoice, so failing the deploy beats shipping quiet non-compliance.
- **Verifying this needs measurement, not eyes.** Arabic letterforms abut, so a
  dropped word space looks plausible. Reading rendered pages by eye produced two
  wrong conclusions in a row, and pdf.js text extraction produced a third — it
  reconstructs RTL runs in visual order and splits the lam-alef ligature back into
  two code points, so it reports spaces that are present as missing. What settled it:
  `widthOfString('خياطة الأنوار') − widthOfString('خياطةالأنوار')` = 9.60 pt at 40 pt,
  exactly 0.240 em, and the sum of the emitted CIDs against the subset's `/W` table
  agrees with it. `invoice-fonts.spec.ts` pins all of that.

## D-041: Creating an invoice issues it; the PDF is rendered after

- **Bug this fixes:** `createForOrder` rendered and stored the PDF *before* anything
  called `ZatcaService.issue`, so every printed invoice went out with `netAmount` and
  `vatAmount` still at their `0` defaults and no QR — no VAT block at all on a KSA tax
  invoice. The WhatsApp path never issued to ZATCA in the first place.
- **Decision:** `InvoicesService.createForOrder` creates the row, calls `zatca.issue`,
  and only then renders. `InvoicesModule` imports `ZatcaModule` (no cycle — ZatcaModule
  imports nothing). POS no longer issues separately; issuance is idempotent, so the
  ordering holds no matter which path creates the invoice.
- **Rationale:** in KSA these are one operation. A document without a VAT split and a
  QR is not a tax invoice, so letting callers do the two steps in their own order made
  correctness a function of which endpoint you happened to come through.
- **Rows predating issuance** still render: `buildPdfData` recomputes the split with
  `splitInclusive` when the stored tax block is zero, rather than printing "VAT 0.00"
  on a document whose total plainly includes VAT. An unissued invoice prints
  "QR not yet issued" instead of silently omitting the QR.

## D-042: The invoice footer anchors to the page box, not a constant

- **Bug this fixes:** the QR block sat at a hand-tuned `y`. Once the totals grew — a
  discount row and a balance-due row are enough, i.e. an ordinary counter sale with a
  deposit — the QR caption crossed the bottom margin and PDFKit spilled it onto a
  second, otherwise blank page. Every such invoice printed as two sheets.
- **Decision:** derive the footer band from the page: A4 is 841.89pt, the margin is 50,
  so content ends at 791.89 and the footer occupies the last 124pt of that. Each block
  guards its own boundary — line items stop before the band, the totals block starts a
  page when its worst case (7 rows) would not fit, and the footer starts one only when
  the totals genuinely reach into it.
- **Every footer `text()` passes `lineBreak: false`.** Without it PDFKit may paginate on
  its own account and reintroduce the blank page from a different direction.
- **Regression test** uses the realistic worst case rather than the minimal one: two
  garments, a discount and a part payment, which is the combination that produces every
  totals row at once. `scripts/sample-invoice.ts` renders the same case for eyeballing.

## D-043: POS and the workshop get their own permissions

- **Problem:** the counter and the workshop floor were authorised with back-office
  permissions — `create_orders` for checkout, `process_payments` for settlement,
  `manage_orders` and `update_order_status` for moving tickets. That conflates three
  different rooms: you could not hand someone the till without also handing them order
  administration, nor let the workshop tablet move tickets without granting the counter.
- **Decision:** add `use_pos`, `pos_checkout`, `pos_settle`, `view_workshop`,
  `manage_workshop`, plus `view_measurement_history` split out from `view_measurements`.
  Defaults: cashier gets the till and no workshop; tailor gets the workshop and
  measurement history but no till; store manager gets both; regional manager gets
  read-only oversight.
- **Measurement history is separately permissioned** from the active set, because a
  tailor re-cutting an old order needs superseded numbers while a cashier quoting a new
  one does not.
- **Effective permissions now travel with the login response**, computed server-side per
  store (role defaults + the per-user JSONB grants/revokes, which a client cannot derive
  from a role name alone). This is for hiding UI the user cannot use; `PermissionsGuard`
  still enforces independently and remains the only thing that decides.
- **The count assertion in `permissions.spec.ts` now counts `PERMISSIONS`** rather than
  the literal 17. It exists to catch a role losing coverage, not to freeze the enum size.

## D-044: One read model for measurements, and it is read-only

- **Problem:** the M1–M8 matrix is displayed on four surfaces — the customer's PWA, the
  counter, the admin SPA, and the workshop tablet — and each was free to hand-roll its
  own `select`. The customer PWA had one; staff had no read endpoint at all, only a
  create route. Three hand-maintained field lists are three chances for one surface to
  show a different figure than the person holding the scissors.
- **Decision:** `MeasurementsService` owns a single `MEASUREMENT_SELECT` and the grouped
  history shape, and every surface reads through it. Writes stay in `CustomersService`,
  which owns versioning and supersession, so no display path can edit what a garment was
  cut against.
- **Customers get read-only access to every version**, not just the active one. There is
  no corresponding write route, and the query is scoped by the customer id on the token.
  History is shown rather than hidden because "why does this one fit differently" is
  answered by it.
- **The workshop reads the snapshot the garment was cut against** — the order item's
  `measurementId` — not whatever is active now. Re-measuring a customer mid-production
  must not silently change what is on the cutting table. When a newer version exists the
  response flags `supersededByNewerVersion` instead of swapping to it.
- `MeasurementsModule` is a shared provider module imported by the feature modules that
  consume it, not by `AppModule`. The memory-graph drift check was widened accordingly:
  a module is wired if *anything* imports it, not only if `AppModule` names it.

## D-045: The counter can browse and search customers, not just look one up exactly

- **Problem:** `/pos/lookup` only accepted an exact phone number via `findUnique` on the
  `(organizationId, phone)` compound key. A cashier who mistyped a digit, or a customer
  who couldn't recall their registered number, produced a dead end with no path forward
  except retyping — costly during rush hour when speed matters most.
- **Decision:** added `GET /pos/customers` (directory: recent customers with no query,
  name/phone substring match with one) and `GET /pos/customers/:id` (opens the full
  profile for a customer picked from that list), both gated by the same
  `use_pos` + `view_customers` pair as the existing lookup. `GET /pos/lookup` is
  untouched — it still e2e-tests the exact-phone path and remains valid for barcode/
  loyalty-card scanners that emit a full number.
- **`fullProfile()` is now the one place** that shapes a customer + active measurements +
  recent orders + tier for the counter. `lookupByPhone`, `lookupById`, and the directory
  all go through it (the directory returns a lighter row shape — id/name/phone/tier only
  — since a picker list doesn't need five orders and a measurement matrix per row).
  Before this, `lookupByPhone` was the only place that shape existed; duplicating it for
  the new paths would have reintroduced the exact failure mode D-044 fixed for
  measurements — three call sites free to quietly diverge.
- **No query still returns something**: the eight most recently-updated customers, so the
  counter is never a blank box waiting for input. Recency is a proxy for "who's likely
  walking back in," not a claim about loyalty or spend.

## D-046: The counter registers walk-ins itself, no admin round-trip

- **Problem:** creating a customer (`manage_customers`) and taking their first measurement
  (`manage_measurements`) were both store-manager-and-above permissions, per D-043's original
  split. In practice this meant a walk-in customer with no existing record — the ordinary case
  for a tailor shop, not the exception — had to wait while the cashier found a manager or,
  worse, went into the separate admin app to create the record before the counter could do
  anything at all. That is exactly the "multilevel intervention" a point of sale exists to
  avoid.
- **Decision:** `cashier` gains `manage_customers` and `manage_measurements`. No new backend
  endpoints were needed: `POST /customers` and `POST /customers/:id/measurements` already did
  the right thing — org-scoped uniqueness check, `preferredStoreId` set from `X-Store-Id`,
  a `CustomerStoreVisit` row, and a full `customer.created` audit entry with actor/store/IP.
  They were simply unreachable from the counter's own role.
- **`manage_orders`, `manage_workshop`, and the rest of D-043's split are untouched.** This is
  specifically about the two permissions that gate "can this walk-in be served at all," not a
  general loosening of the cashier role — a cashier still cannot edit an existing order's
  structure or touch the workshop board.
- **Admin's oversight role does not change.** `GET /customers/:id` already returns the full
  record — measurements (every version), visit history, order/appointment counts — server-side;
  the admin app simply never had a UI to show it (see the accompanying fix). Nothing about
  giving the counter write access removes anything from what HQ can see.

## D-047: Print Center — thermal, garment-tag barcodes, and the A4 invoice are three documents, not one

- **Problem:** the counter had exactly one print action (`window.print()` on the on-screen
  confirmation), and no way to produce a proper thermal receipt, a scannable garment tag, or
  the already-built ZATCA A4 PDF from the same order.
- **Decision:** three documents, one order:
  - **Thermal receipt** — a compact 80mm layout (Courier, dashed rules, itemised lines,
    VAT breakdown, ZATCA QR) shown via a `print-only` section that `print.css` reveals only
    while `<body class="printing-thermal">`, toggled by JS right before `window.print()`.
  - **Garment tags** — one Code128-barcoded label per production ticket, sized for a common
    label roll (`62mm × 100mm`), printed the same way under `printing-tags`.
  - **A4 tax invoice** — not re-implemented. Fetched as a blob from the already-existing
    `GET /invoices/:id/download` (D-040–D-042) and opened in a new tab, so the browser's own
    PDF viewer supplies the print button for the document that already carries the seller's
    VAT number, the full net/VAT/gross breakdown, and the tamper-evident hash chain.
- **No raw ESC/POS.** There is no web API for a page to talk to a thermal printer directly
  without native access; every browser-based POS reaches one the same way — CSS controlling
  what a page looks like, the OS print dialog, and the printer's own driver doing the
  conversion. `@page` size here is a hint the driver is free to override with whatever stock
  is actually loaded.
- **Why Code128 for the tag, not the QR already used for ZATCA:** the workshop's own
  barcode-scan flow (`GET /workshop/tickets/by-code/:code`) only cares about the decoded text,
  not the symbology — but the cheap 1D-only scanners common on a shop floor cannot read a QR
  at the print size a fabric tag allows. `jsbarcode` renders Code128 client-side; no server
  round trip.
- **Garment tags need per-item data the checkout response never carried** — `tickets` used to
  return only `{id, ticketCode, station}`. Enriched with `garmentType` by zipping with the
  already-in-scope `prepared` array by index (`createTicketsForOrder` creates one ticket per
  `order.items` row in `sequenceNo` order, which is the same order `prepared` was built in —
  see `pos.service.ts`), rather than a second query.
- **The login response now also carries `organization.vatNumber`/`taxId`**, so the thermal
  receipt can show the seller's VAT registration without a second request — the same field
  `InvoicePdfService` already prints on the A4 invoice. Additive only; nothing existing was
  removed or renamed from the response shape.
- **The A4 button opens its target tab *before* the fetch, not after.** The first version
  fetched the PDF blob and only then called `window.open(blobUrl, '_blank')`; several browsers'
  popup blockers treat the user-activation window from the click as expired by the time an
  `await` resolves, so the call can silently no-op even though the request itself succeeds.
  `window.open('', '_blank')` now runs synchronously inside the click handler — a blank tab is
  a trusted-gesture action no blocker rejects — and the tab's `location` is set once the blob
  is ready; a null return (pop-ups disabled outright) falls back to same-tab navigation instead
  of leaving the cashier with no way to reach the PDF at all.

## D-048: `cashier` needs `view_inventory` because checkout structurally requires it

- **Bug found while live-testing D-046 as an actual cashier account** (not hq_admin, who
  already held every permission and so never exercised this path): the fabric-roll picker on
  Counter — `GET /inventory/sellable`, gated by `view_inventory` — 403'd. A cashier could never
  complete *any* checkout through the counter UI, new customer or existing, because selecting a
  roll to reserve is not optional; it is step 3 of the one order-creation flow the role exists
  to run. This predates today's work — it was a gap in D-043's original cashier scope, just
  never exercised because every prior session tested as hq_admin or store_manager.
- **Decision:** add `view_inventory` to `cashier`'s defaults. This is not "let cashiers manage
  stock" — `manage_inventory`, `select_batches`, `transfer_inventory` stay out of reach; this is
  specifically the read permission the counter's own screen depends on to render at all.
- **Caught by using a real seeded cashier account for the first time**, not by reasoning about
  the permission table in the abstract — the lesson generalises: a new role's defaults are not
  actually verified until something runs the entire workflow as that role, end to end.

## D-049: The Print Center's first shipped version was never actually print-tested

- **What the user found:** the A4 tax invoice button did nothing, and the two prints that did
  work — the thermal receipt and the garment tag — both showed the app's own navigation bar
  (Counter/Workshop toggle, store selector) bleeding across the top of the page, floating small
  inside what was clearly a full default-size sheet rather than a receipt or a label, with a
  second, entirely blank page tacked on after.
- **Why the D-047 verification pass missed all three:** it inspected rendered DOM content and
  CSS *selector* text, and confirmed a real click's popup opened once — none of that exercises
  Chromium's actual print-to-PDF pipeline, so a page that would visibly break under `Ctrl+P`
  looked correct from the outside.
- **Three separate, concrete bugs, each independently confirmed by capturing real print output
  with `page.pdf()` before and after** (see `apps/pos/scripts/verify-print-center.mjs`):
  1. **The app shell was never scoped out of print.** `Layout.Header` lives in `App.tsx`'s
     `Shell`, structurally outside anything `Receipt.tsx` controls — no `.screen-only`/
     `.print-only` class ever touched it, so it printed on every job regardless of mode.
     Fixed with a `no-print` class on the header, honoured by the same `@media print` block.
  2. **`@page { size: 80mm auto }` is invalid CSS.** The `size` property accepts one or two
     `<length>` values, `auto` alone, or a page-size keyword — not a length paired with `auto`.
     A UA that rejects one token in the shorthand drops the whole declaration, which is exactly
     what happened: content sized for an 80mm receipt was laid out onto the browser's default
     paper size instead. Fixed to an explicit `80mm 297mm` (A4's height as a generous ceiling —
     no real receipt should hit it, and a continuous-roll printer's own driver cuts to content
     length regardless of this hint).
  3. **`Layout` was styled `minHeight: '100vh'`, and Chrome recomputes `vh` per printed page.**
     An ancestor pinned to "at least one viewport tall" forces the print job to be at least one
     full page tall no matter how short the actual content is; anything appended after that —
     even a few pixels of margin — spills onto a genuinely blank second page. Fixed with a print
     rule collapsing `html, body, #root, .ant-layout` to `min-height: 0` — needs `!important`
     because the 100vh is an inline style, which ordinary specificity cannot beat.
- **The A4 button's actual fix: stopped using `window.open()` for the navigation, not just for
  timing.** D-047 already fixed calling it after an `await` (losing the click's user-activation
  window). That turned out to still be a `window.open()` popup, which some browsers' popup
  blockers reject regardless of gesture freshness — plausibly what the user hit. Switched to a
  synthetic click on a temporary `<a target="_blank" rel="noopener noreferrer">`, which is a
  plain navigation, not a popup, and is the standard technique for exactly this reason.
- **Verification method itself changed.** The MCP browser tool's synthetic clicks do not count
  as a trusted user gesture in this harness at all — proven earlier by a bare
  `<button onclick>{window.open()}</button>` returning `null` on a real dispatched click — so it
  cannot validate anything gesture-gated, and inspecting rendered DOM/CSS text cannot validate
  actual paginated print output. `apps/pos/scripts/verify-print-center.mjs` drives the real
  counter flow with Playwright against a real, non-headless Chrome and calls `page.pdf()` —
  the same pipeline a physical "Save as PDF" uses — kept in the repo specifically so the next
  change to `print.css`/`print.ts`/`Receipt.tsx` can be checked against real output instead of
  a screenshot of the on-screen confirmation view, which is what looked fine both times before.

## D-050: The A4 button downloads a file, it does not try to open a tab

- **Two prior attempts at "open the invoice in a new tab" both failed for a real user in a
  real browser** — first `window.open()` called after an `await` (D-047, lost the click's
  user-activation window), then a synthetic click on `<a target="_blank">` (D-049, still a
  popup by another name, rejected by some blockers regardless of gesture freshness). Two
  failures of the same *family* of mechanism, reported firsthand rather than inferred, is a
  reason to stop tuning that family rather than try a third variant of it.
- **Decision:** stop trying to open a tab. `<a download>` forces a file download; it is not a
  popup and is not subject to popup-blocker heuristics in any mainstream browser — it is the
  same mechanism virtually every "export as PDF" feature on the web relies on for exactly this
  reason. The cashier gets a saved `INV-2026-NNNNNN.pdf`, which is arguably closer to a real
  handover anyway (a file to keep or forward) than a fragile preview tab.
- **The button is now `disabled` (with a tooltip) when `!invoice`,** rather than only warning
  on click. A silently-swallowed click and a genuinely broken button were indistinguishable
  before this — both looked like nothing happened — which is exactly the ambiguity a real user
  report ran into. Disabling makes the "no invoice yet" case visibly different from "click me."
- **The verification tooling changed with it.** `apps/pos/scripts/verify-print-center.mjs`
  previously listened for a `popup` event, which a correctly-working forced download will
  *never* fire — that test would have reported false failure on the very code meant to fix
  this. Switched to Playwright's `page.waitForEvent('download')`, which listens for the
  browser's actual download-manager event and hands back the saved file directly. Confirmed
  against real output, not an inference: the downloaded `INV-2026-NNNNNN.pdf` is a valid,
  complete bilingual tax invoice with the correct VAT split and a scannable ZATCA QR.
- **Process note, not just a code note:** the first fix (D-047) was reported working from one
  successful Playwright click; that was true and remained true, but was not sufficient
  evidence that *the mechanism* was safe across real browsers and real popup-blocker
  configurations — only that it worked once in one environment. The second fix (D-049) added a
  second real-environment success and was still wrong for the same underlying reason. What
  actually closed it was changing the mechanism to one with no popup-blocker exposure at all,
  not accumulating more single successful observations of one that had some.
