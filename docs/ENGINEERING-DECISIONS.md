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

## D-051: Counter can find, reprint, and settle a past order — and a full settlement closes it

- **The gap:** once a customer left the counter, their order was unreachable. `Receipt.tsx` only
  ever read from React Router's in-memory navigation `state`, which a page refresh or a second
  visit doesn't have — the page's own dead-end message said "reopen this order from the order
  list to reprint," but no such list existed anywhere in the POS app. A customer coming back to
  pay a balance or re-collect a lost thermal receipt had nowhere to be served from, even though
  `GET /orders` and `GET /orders/:id` were already fully permissioned for `cashier` via
  `view_orders` — this was a missing page, not a missing capability.
- **Decision: reuse the existing generic Orders API rather than build POS-specific duplicates.**
  New `Orders.tsx` (search by order #/customer name/phone, status filter) and `OrderDetail.tsx`
  (status timeline, items, payments, settlement, reprint) call `GET /orders` and `GET /orders/:id`
  directly. `orders.service.ts getById()` was missing the `invoice` and `tickets` relations
  needed to power a reprint — added them (tickets flattened to carry `garmentType` off the
  nested `orderItem`, matching the shape `pos.service.ts checkout()` already returns) so one
  call gives a reopened order everything Print Center needs, the same as a fresh checkout.
- **The print output itself is shared, not re-implemented.** The thermal-receipt/garment-tag
  markup and the Print Center button row (including the D-050 forced-download A4 button) were
  extracted from `Receipt.tsx` into `components/PrintCenter.tsx`, taking a normalized data shape
  instead of a page-specific one. `Receipt.tsx` (fresh checkout, reading `location.state`) and
  `OrderDetail.tsx` (reopened from history, reading the API response) each build that shape from
  their own source and hand it to the same component. The alternative — a second reprint view
  with its own copy of the print markup — would have reintroduced exactly the class of bug D-049
  took three rounds to fix, just in a second place that could silently drift from the first.
- **Settling the balance also closes the order, but only when production actually finished.**
  The user confirmed the cashier who collects the final payment should be able to mark the order
  delivered themselves, without a separate manager trip through Workshop. `pos.service.ts
  settle()` already computed `closesOrder` (balance reaches zero); it now also checks
  `canTransition(order.status, 'delivered')` from `@tailonix/shared` — true only when the order
  is at `ready`, since that's the only state the order-lifecycle state machine allows to advance
  to `delivered`. If both hold, the same transaction sets `status: 'delivered'`, `deliveredAt`,
  and an `orderStatusHistory` row, and `OrderEventsPublisher.publishStatusChanged` fires the same
  WhatsApp delivery notification a manager's manual status change would.
- **Payment is never blocked on a workflow technicality.** If a customer pays off the full
  balance before Workshop has marked the order `ready` — an operational error, but not the
  cashier's to solve at the till — `settle()` still records the payment and releases the deposit
  liability exactly as before; it just doesn't auto-transition. The response carries
  `markedDelivered: false` and the order's actual `status`, and `OrderDetail.tsx` renders a
  warning banner ("balance is fully paid but the workshop has not marked this order ready") so
  the handover happens deliberately rather than being silently skipped or silently forced. No new
  RBAC permission was added — this reuses the `pos_settle` permission cashier already has, kept
  deliberately narrow to "close out what you just got paid for," not general order-status control.
- **Verification:** `apps/api/test/pos.e2e-spec.ts` covers both branches — settling an order
  still at `pending` records the payment without touching status; settling one seeded at `ready`
  transitions it to `delivered`, sets `deliveredAt`, and writes the status-history row — plus a
  reprint check that `GET /orders/:id` on a checked-out order returns the same invoice and ticket
  data the checkout response did.

## D-052: Measurement, yield, and fabric-roll selection were silently hardcoded to Thobe

- **The bug:** `Counter.tsx` let a cashier pick Bisht/Shirt/Trousers from a per-garment Type
  dropdown, but every consumer of that choice ignored it — `activeThobeProfile` always looked up
  the `Thobe` measurement row, `saveMeasurements()` always wrote `garmentType: 'Thobe'`, and the
  yield-preview call always requested `garmentType: 'Thobe'`. Selecting anything else had zero
  effect: the garment was measured, yield-calculated, and cut against whatever Thobe profile
  happened to be on file, with no error or warning. This was purely a front-end binding bug —
  `Measurement`, `previewYield`, and the checkout DTO were already keyed by `garmentType`
  server-side; nothing in the API needed to change.
- **Decision: the Measurements panel edits whichever garment tab is active, and yield/fabric
  lookups run per distinct garment type in the cart, not once globally.** `activeGarmentType`
  now derives from `garments[activeTab].garmentType`; a `useEffect` keyed on
  `[activeGarmentType, lookup]` repopulates the measurement form from that type's saved profile
  (or empty, if none exists yet) every time the active tab or its type changes. `yieldByType`/
  `rollsByType` replace the single global `yieldPer`/`rolls`, computed by grouping the cart's
  garments by type and calling the yield/sellable-roll endpoints once per distinct type — a
  Thobe and a Shirt in the same order can now need, and get offered, different fabric.
- **A tab whose type has no saved profile no longer hides the entire Garments card.** The old
  gate (`!activeThobeProfile → <Empty>`) assumed one profile covered everything. It's now
  per-tab: an `Alert` inside that tab's body says a profile is missing and the fabric-roll select
  is disabled, while other tabs whose types do have a profile stay fully usable. The Measurements
  card's title and "active vN" tag also now say which type they're showing, since it's no longer
  always Thobe.
- **`MeasurementDiagram`'s SVG is still visually a thobe silhouette.** The M1–M8 point set it
  labels (total length, shoulder width, sleeve length, chest, hip, neck, wrist, hem) is the one
  shared numeric schema every garment type's `Measurement` row uses — the bug was in which row
  got read and written, not in the fields themselves — so redrawing per-type artwork was out of
  scope for this fix.

## D-053: Checkout now sends the discount, due date, notes, and deposit-method fields the DTO already accepted

- `PosCheckoutDto` has always declared `discountAmount`, `dueDate`, `notes`, and a
  `depositMethod` enum, and `pos.service.ts checkout()` already applied all four — `Counter.tsx`
  simply never collected or sent them, and hardcoded `depositMethod: 'card'` regardless of what
  the cashier actually took. Added the corresponding fields (discount input, due-date picker,
  notes textarea, deposit-method select) to the checkout panel and wired them into the POST body.
  All four stay optional and are excluded from `readyToCheckout`'s gating, matching the DTO.
- The on-screen running total now subtracts the discount before display (`total = grossTotal -
  discount`), and the deposit input's max/50%-quick-fill are based on that discounted total —
  otherwise a cashier could enter a deposit larger than what the order will actually total after
  the discount is applied server-side.

## D-054: Trousers gets its own measurement matrix, diagram and yield formula — not Thobe's, relabeled

- **What the user flagged:** D-052 fixed *which* profile a garment tab reads/writes, but every
  garment type still shared the exact same eight fields and the same thobe-shaped diagram. The
  user pointed out that "there should be [a] complete [set of] measurements for all the Types" —
  correctly, since the M1-M8 columns are not generic slots: `m8SkirtPerimeter`/الذيل is literally
  a thobe's hem, and the fabric-yield formula (`2×TotalLength + SleeveLength + 0.20m hem`) is
  Thobe's own cutting geometry from the blueprint. Trousers in particular has no sleeve, no neck,
  and is cut as two leg panels, not one doubled body panel — none of the eight points or the
  formula's shape apply to it at all.
- **Two decisions were the user's, not mine, because getting them wrong means wrong fabric-stock
  deductions, not just a mislabeled field:**
  1. **Trousers gets dedicated schema columns** (`t1Waist`…`t7AnkleOpening`, migration
     `20260727102924_add_trouser_measurement_points`) rather than relabeling the M-columns —
     chosen over reuse because forcing e.g. inseam into a column named `m8SkirtPerimeter` would
     leave the schema self-contradictory for anyone reading it directly (a DBA, a future
     migration, a report). Thobe/Bisht/Shirt keep sharing M1-M8: all three are genuinely
     "long garment, body + sleeve + neck + hem" shapes where the same eight measurement
     *concepts* apply, just with different typical values.
  2. **Bisht/Shirt/Trousers yield formulas are explicit, flagged approximations**, not real
     shop figures — none were available. `yield.service.ts` generalises the Thobe formula into
     `calculateRobe({lengthMultiplier, hemAllowanceM})`, defaulting to Thobe's exact numbers so
     `calculate()` (and every existing test asserting its output) is byte-identical to before.
     Bisht reuses the ×2 multiplier with a larger hem allowance (0.35m — fuller/looser cut than a
     Thobe); Shirt drops to ×1 (a shorter body panel, not doubled floor-length fabric) with a
     smaller allowance (0.15m). Trousers gets its own `calculateTrousers()` entirely
     (`2×Outseam + 0.25m`, no sleeve term at all) since the robe formula's shape doesn't apply —
     and since this system has no fabric-width model, thigh/hip fullness is folded into one flat
     allowance rather than faked with a spuriously precise conversion. Every constant carries a
     one-line comment saying it is a placeholder pending real figures; nothing here should be
     read as validated shop data.
- **The "one read model" discipline (D-044) extends cleanly to a second garment family.**
  `packages/shared/src/measurements.ts` gained `TROUSER_POINT_KEYS` and a `garmentFamily()`
  helper; every consumer (the API's `MEASUREMENT_SELECT`/`pointsForGarmentType()`, the workshop's
  `forTicket()`, Counter's measurement panel and diagram, Admin's `CustomerDetailDrawer`) reads
  through it rather than re-deriving which points apply. One consequence worth calling out: the
  customer PWA's `Measurements.tsx` needed **zero code changes**. It already fetches the point
  list from `GET /customer/measurements/points` and renders only whichever keys a given snapshot
  actually carries (`filled()`), so widening that endpoint to return both families' points was
  sufficient — a Trousers snapshot shows its T-points and a robe snapshot shows its M-points, with
  the existing sparse-rendering logic doing the type-dispatch implicitly. That this fell out for
  free is a direct payoff of the read-model discipline the codebase already had, not new work.
- **`MeasurementDiagram.tsx` gets a real trousers silhouette** (waistband splitting into two
  legs, hotspots for waist/hip/inseam/thigh/knee/ankle), not the thobe outline with different
  labels — the user's original complaint was exactly that a visibly wrong diagram undermines
  "professional certified tailor shop" credibility as much as a wrong field does.
- **Verification:** `yield.service.spec.ts` covers `calculateRobe`'s Thobe-default-equivalence
  and its Shirt-multiplier case, and `calculateTrousers`'s formula and required-field guard.
  `pos.e2e-spec.ts` adds a full Trousers checkout (own measurement profile, `POST /pos/orders`,
  ticket carries `garmentType: 'Trousers'`, reserved fabric matches `2×1.05 + 0.25 = 2.35m`
  exactly) alongside the existing Thobe coverage. Live-verified in the browser: took Trousers
  measurements in Counter against the new diagram, confirmed the per-tab "no profile yet" gate
  and required-field messaging said T4 rather than M1/M3, completed a Trousers checkout end to
  end, and confirmed Admin's `CustomerDetailDrawer` renders the T-column table for that
  customer's Trousers history instead of eight blank M-columns.

## D-055: Five more Thobe measurement points, a cut-style/cufflink spec, and an urgent flag — read off a real tailor shop's own paper order form

- **Source:** the user supplied a photo of an actual tailor shop's physical order slip (Arabic,
  with a "J"/`0101` reference and "Brofan"/"Thob No." fields), annotated with English labels for
  each field. It is the closest thing this project has to ground truth for what a professional
  shop actually captures, and it captures more than the blueprint's M1-M8 did.
- **What was added, and what was deliberately not guessed at:**
  - Five new robe-family points, `m9Waist` through `m13HalfChest` (Waist, Round Shoulder, Mid of
    Hand, Plate Length, Half Chest) — migration `20260729075052_add_tailor_shop_reference_fields`.
    These are pure capture fields: the yield formula only ever needed M1/M3, so adding points
    that aren't fed into any calculation carries no correctness risk, only more precise intake.
    `m5HipWidth` is relabeled "Hip" (from "Waist / Hip") now that `m9Waist` is the dedicated
    waist point; the DB column itself is untouched, so historical rows keep whatever a cashier
    actually meant by the old combined field — there's no way to retroactively know which.
  - `CutStyle` enum (`saudi | kuwaiti | qatari | other`) and a free-text `cufflinkSize` (e.g.
    `"9x3"`) on `OrderItem` — a garment-construction spec, not a body measurement, so it lives
    with `collarStyle`/`cuffStyle` rather than in the `Measurement` matrix.
  - `isUrgent` on `Order` ("مستعجل" on the form) — surfaced as a checkbox at checkout, a red
    button/tag on Receipt, and an `URGENT` tag in both POS's and Admin's Orders list/detail, so a
    rush order is visible at every point someone might act on it, not just where it was flagged.
  - **Deliberately not touched: `CollarStyle`/`CuffStyle`/`PocketStyle`/`StitchingStyle`.** The
    form shows roughly 13 collar/placket icons and 8 pocket icons against our 4/2/3/3 — a real
    gap — but the icons' Arabic labels were too small to read reliably from the photo. Inventing
    plausible-sounding English names for garment-construction styles I can't actually confirm is
    exactly the failure mode this reference material was meant to prevent: confidently wrong data
    entry options are worse than an acknowledged gap. Left open pending a clearer source (a closer
    crop of that row, or a dictated list) rather than guessed.
- **Verification:** `measurements.service.spec.ts` and `yield.service.spec.ts` pass unchanged
  (new points are additive to `MEASUREMENT_SELECT`/the labeled point arrays, not a formula
  input). Live-verified in the browser: M9-M13 hotspots render and are enterable on the Thobe
  diagram, a cut-style + cufflink size set on a garment round-trips through checkout, the urgent
  checkbox produces the `URGENT` tag on Receipt, Orders (POS and Admin), and Order detail, and
  Admin's `CustomerDetailDrawer` measurement history table shows all thirteen M-columns.

## D-056: The measurement diagram moved every hotspot off the garment into labelled columns

- **What the user found:** with all 13 robe points now live, several hotspots — M2, M4, M9,
  M10, M12, M13 — sat within a ~100×100px cluster near the chest, close enough that the circles
  nearly touched. Visually indistinguishable points defeat the diagram's whole purpose: a
  cashier can't tell "click here for Waist" from "click here for Half Chest" when the two dots
  are 10px apart. The user asked for every point to have its own clear graphic, not just enough
  space to not overlap.
- **Decision:** stopped placing hotspots on the garment outline at all. Each of the 13 (7)
  points now sits in a fixed left- or right-margin column, evenly spaced top to bottom by
  construction (`HotspotLayout` gives each an explicit `x`/`y` for the clickable label and a
  separate `targetX`/`targetY` for where it's actually measured on the body), connected by a
  thin dashed leader line — the same convention a tailor's flat-sketch spec sheet uses to
  annotate a garment without crowding the drawing itself. Collision by construction is
  impossible: the columns are just a list, not a shared coordinate space.
- **"Semantic," not just "spaced out":** five robe points (shoulder width, chest, waist, hip,
  hem) and five trouser points (waist, hip, thigh, knee, ankle) are genuine circumference/width
  measurements, so each gets an actual amber dimension-line arrow drawn across the body at that
  height, with tick-mark ends — the graphic now shows *what kind* of measurement it is, not just
  *where*. Total length (robe) and outseam/inseam (trousers) get the same treatment as vertical
  dimension lines along the body instead of a bare dot. The garment fill also picked up a subtle
  gradient for a less flat, more finished look, matching the "more attractive" ask directly.
  Canvas grew from 200×350 to 320×400 to give the margin columns room without shrinking the
  garment itself.
- **Unchanged:** the click-to-focus/highlight behaviour and the cm/in toggle (both D-051-era
  additions) needed no changes — they operate on the label position, which still exists, just
  relocated. Verified live for both the robe (all 13 points, including a value already on file
  from earlier testing) and trousers (all 7) diagrams: clicking a hotspot still scrolls to and
  focuses its field correctly with the new layout.

## D-057: ZATCA Phase 2 — real XAdES signing, CSR generation, and the Reporting/Clearance client

- **Source:** the user supplied the full "E-invoicing Detailed Technical Guidelines Version 2"
  (ZATCA/FATOORA, Nov 2022) and asked for implementation against it. D-029 had already scoped the
  gap between "cryptographic stamp" (needs a real CSID — client action, not code) and everything
  upstream of it (buildable and independently testable with self-signed fixtures). Given
  `AskUserQuestion`, the user chose to build everything in the latter category now, all gated
  behind config exactly like the existing `zatca_not_onboarded` stub, so nothing calls the real
  ZATCA API until real credentials exist.
- **`canonicalize()` now runs real C14N** (`xml-crypto`'s `C14nCanonicalization`, replacing a
  placeholder) via `@xmldom/xmldom`. The guideline specifies C14N **1.1**; `xml-crypto` implements
  **1.0**. The two are byte-identical for any XML that never uses `xml:base`/`xml:id`/`xml:lang` —
  true of every invoice this system generates — so the divergence is a documented non-issue, not
  an unverified assumption.
- **Full 6-step XAdES-BES pipeline** (`zatca-sign.ts`, per guideline §5): sign the canonicalized
  invoice with ECDSA-SHA256 → build `SignedProperties` (cert digest, signing time, issuer, serial)
  → hash *that* canonicalized → assemble `UBLExtensions` with two `ds:Reference` entries (invoice
  digest, SignedProperties digest) → splice as the first child of `<Invoice>` (UBL 2.1 ordering
  requires it before `ProfileID`) → splice a QR `AdditionalDocumentReference`.
  `zatca-cert.ts` extracts the facts the pipeline needs from a PEM certificate (issuer DN reversed
  to RFC4514 order, serial converted hex→decimal since XAdES wants decimal, and the CA's own
  signature over the CSID pulled via `asn1js` from `Certificate ::= SEQUENCE`'s third element,
  since no Node API exposes it — needed for QR tag 9 on simplified invoices only).
- **Guideline §5 Step 2 is ambiguous** ("sign the generated invoice hash... not encode" reads as
  either "ECDSA-sign the canonical XML" or "double-hash a pre-computed digest"). Implemented the
  standard XML-DSig interpretation — sign the canonical content directly — and documented the
  alternative in `zatca-sign.ts`'s module comment rather than silently picking one.
- **Node's WebCrypto rejects secp256k1** (`Unrecognized namedCurve`), which is the curve ZATCA's
  own guideline uses in its Appendix example. This ruled out `pkijs`'s built-in `.sign()`
  (WebCrypto-bound) for both the XAdES signature and the CSR. Fixed by hybridizing: `pkijs`/
  `asn1js` build the ASN.1 structure (TBS bytes via its normally-`protected` `encodeTBS()`, called
  through a type-cast — a compile-time-only restriction, not a runtime one), and Node's classic
  `crypto.sign`/`crypto.verify` do the actual cryptographic operation, which does support the
  curve via OpenSSL bindings. Verified independently of the app's own tests: a generated CSR
  round-tripped through real `openssl req -verify -noout` → "Certificate request self-signature
  verify OK".
- **`zatca-csr.ts`'s exact OID/attribute placement is explicitly unverified** — the guideline
  defers the CSR template to "the EGS vendor's manual," which this document doesn't include.
  Implemented from memory of common ZATCA reference implementations; the *shape* (valid PKCS#10,
  correct curve, all eight required fields present) is proven by the OpenSSL round-trip above, but
  the OID assignments should be checked against ZATCA's actual SDK/`.cnf` before use against a
  real Compliance API. Same "don't guess at unverifiable compliance data" discipline as D-055's
  collar/pocket gap, applied here to something that blocks real invoice submission rather than
  just intake precision.
- **`zatca-api-client.ts`** wraps the Reporting (`/invoices/reporting/single`) and Clearance
  (`/invoices/clearance/single`) calls behind `ZATCA_API_BASE`; unset, every call returns
  `not_configured` rather than throwing, matching the existing `submit()` contract. Response
  parsing follows ZATCA's real Core API JSON shape (`validationResults.status` of PASS/WARNING/
  ERROR) from general knowledge, not from a schema printed in this guideline — flagged for the
  same reason the CSR OIDs are: confirm against a live response before trusting it exactly.
- **A real bug this surfaced and fixed before it shipped:** archiving the *signed* XML (instead of
  the plain canonical form, needed once signing exists) broke `verifyChain()`'s re-hash check,
  since the signed form carries extra content the original `invoiceHash` was never computed over —
  every signed invoice would have silently reported as tampered. Fixed with `stripSignatureElements()`
  (the inverse splice) plus re-canonicalizing before re-hashing. Caught by writing a genuine
  round-trip test (sign → strip → canonicalize → hash → compare), not by trusting the pieces in
  isolation; the first version of that test itself was wrong (asserted against the canonical form
  when `stripSignatureElements()` actually restores the raw pre-canonicalization XML) and the
  failure is what revealed the real bug's shape.
- **Verification:** `zatca-sign.spec.ts` (9 tests) proves the signature verifies against the real
  certificate's public key via `crypto.verify`, that tampering a single character breaks
  verification, correct UBLExtensions ordering/content, the full 9-tag QR for simplified vs 8-tag
  (no CA signature) for standard invoices, and the archival round-trip above. `zatca-csr.spec.ts`
  (4 tests) proves a fresh key pair per call and independent OpenSSL verification. All existing
  `src/zatca/` tests (38 total before this addition) still pass.
- **`submit()` now actually calls Fatoora** instead of always returning the `zatca_not_onboarded`
  stub: simplified invoices go through Reporting, standard through Clearance (guideline §3.1.2 —
  the two invoice families use different endpoints, not a shared one branched on a flag). This
  needed a field the schema didn't have: ZATCA's Basic Auth for these APIs is
  `base64(certificate:secret)`, where the *secret* is a value returned once at CSID issuance and
  distinct from both the certificate and the private key already stored. Added
  `Organization.zatcaApiSecretEncrypted` (migration `20260729183118_add_zatca_api_secret`,
  encrypted the same way as the other two) rather than reusing an existing field for something it
  doesn't represent. The Basic-Auth *username* itself is derived from the stored certificate via
  `readCertFacts().certificateDerBase64` on each call instead of being stored separately — it's
  already fully recoverable from data that exists, so a second copy would just be one more thing
  that could drift from the certificate it's supposed to match.
- **The result is persisted, not just returned:** `Invoice.submissionStatus` moves to `reported`/
  `cleared`/`failed` (the enum already had these; nothing used them yet) and `clearanceStatus`/
  `zatcaResponse` capture ZATCA's own outcome and full response body for audit, mirroring exactly
  the fields the compliance report and any future admin UI will need to read.
- **Verified with a mocked `ZatcaApiClient` and `fetch`**, per the same instantiate-with-mocks
  pattern already used by `invoices.service.spec.ts` (no Nest `TestingModule` elsewhere in this
  module, so none was introduced here). `zatca-submit.spec.ts` covers all four early-exit reasons
  (`zatca_not_onboarded` — missing config or missing org secret, `not_issued`, `archive_unavailable`),
  confirms Reporting vs Clearance routing by invoice type, and confirms both the success and the
  rejected-outcome paths persist the fields above correctly — using the *real* `encryptSecret`/
  `decryptSecret` round-trip against the test certificate fixture rather than mocking the crypto
  itself, so the Basic-Auth credentials asserted in the test are the actual bytes `submit()` would
  send, not a stand-in for them.

## D-058: ZATCA onboarding orchestration — three explicit steps, a permission that didn't exist, and one deliberate non-feature

- **Continues D-057's scope** ("everything buildable now" against the pasted guideline):
  `ZatcaOnboardingService` drives the Compliance CSID → compliance checks → Production CSID
  sequence from guideline §3.3, gated the same way as everything ZATCA-shaped in this codebase —
  inert without `ZATCA_API_BASE`, and requiring a human-obtained OTP from the real FATOORA portal
  or Developer Portal at the first step, since generating that OTP is not something this system
  (or Claude, per the standing safety rules around account/portal access) can do on the tenant's
  behalf.
- **Three separately-persisted steps, not one call.** A real onboarding session is naturally
  interrupted — the OTP comes from a portal in another tab, compliance checks may need a retry,
  and a store owner walking through a UI wizard (task after this one) needs each step to survive a
  page reload. `Organization.zatcaEnvironment` (previously an unused column) now tracks the CSID's
  own stage — `null` → `'compliance'` → `'production'` — and a new `zatcaComplianceRequestId`
  column carries ZATCA's own request id from the compliance step into the production-CSID request
  that needs it.
- **`submit()` (D-057) now checks the stage, not just presence.** Before this, any CSID+secret pair
  was enough to attempt real Reporting/Clearance. A compliance-stage CSID is a bootstrap credential
  — valid only against the compliance-check endpoint — so `ZatcaService.submit()` gained
  `org.zatcaEnvironment !== 'production'` as an explicit third gate. Missing this would have let an
  org mid-onboarding accidentally attempt (and fail, or worse, half-succeed against) a real
  Reporting/Clearance call with credentials ZATCA never intended for that purpose.
- **The Production CSID reuses the Compliance CSID's key pair.** ZATCA issues a new certificate for
  the CSR already on file rather than requiring a second CSR, so `requestProductionCsid` only
  replaces the stored certificate and secret — the private key from step 1 carries through
  unchanged. Getting this wrong (regenerating a key pair) would produce a production certificate
  that doesn't match the tenant's own signing key.
- **Compliance checks are deliberately partial, and say so in their own response.** ZATCA's real
  compliance suite expects six sample documents — standard and simplified, each as an invoice,
  credit note, and debit note. This codebase has never modeled credit or debit notes; inventing
  fake ones just to submit six documents would either be rejected outright by ZATCA or, worse,
  silently misrepresent what was actually checked. `runComplianceChecks()` submits the two document
  types this system genuinely produces (one standard, one simplified tax invoice, built from
  synthetic sample data — not a real tenant order, matching what a compliance check is for) and its
  response literally says "does not yet model credit/debit notes" rather than claiming a six-check
  pass that didn't happen. Extending this to the full six is real future work, not a rounding error.
- **Revocation is local-only, on purpose.** Every other step in this file has *some* guideline
  section describing its request/response shape, reconstructed from general ZATCA-API knowledge
  with the same "unverified against a live response" caveat as the CSR OIDs (D-057). Revocation
  does not — nothing in the material available to this session describes it step by step — and
  guessing at a destructive remote call's contract is a categorically worse mistake than guessing at
  a request one: a wrong local wipe is recoverable by re-onboarding, a wrong remote revocation call
  is not verifiable as having done what was intended at all. `revokeLocally()` wipes the stored
  CSID/key/secret and resets the stage to `not_started` — immediately stopping this system from
  being able to sign or submit anything with a possibly-compromised credential — and says plainly
  that revoking it on ZATCA's own side is a separate, human action on the real portal.
- **New `manage_organization` permission, `hq_admin` only.** No existing permission in
  `packages/shared/src/permissions.ts` correctly describes "change this tenant's ZATCA compliance
  credentials" — the closest, `manage_stores`, is about store records, not tax/compliance identity.
  Added as a new entry in `PERMISSIONS`; since `hq_admin`'s default list is the array itself (not an
  enumerated subset, per D-043), the new permission reaches `hq_admin` automatically and no other
  role's default list needed to change. `permissions.spec.ts`'s count assertion (already keyed off
  `PERMISSIONS.length`, not a literal, since D-043) required no edit.
- **Verification:** `zatca-onboarding.spec.ts` (8 tests) mocks `ZatcaApiClient.complianceRequest`
  and uses the real `encryptSecret`/`decryptSecret` round-trip against the test certificate fixture
  (same discipline as `zatca-submit.spec.ts`) to prove the actual bytes stored and later decrypted
  match what a real onboarding call would carry — covering the compliance-CSID request, the
  refuse-before-compliance-CSID and refuse-before-request-id guards, the two-document compliance
  check, the production-CSID exchange (including the compliance-request-id round trip and key-pair
  reuse), and full local revocation. `zatca-submit.spec.ts` gained a case for the compliance-stage
  rejection specifically. `npx tsc --noEmit` clean across `apps/api`; full `src/zatca` + `src/auth`
  suites (80 tests) pass together.
- **Admin SPA gets a minimal onboarding page** (`apps/admin/src/pages/Settings.tsx`, route
  `/settings`, nav item gated by the same `isHq` boolean `Team`/`Stores` already use — consistent
  with `manage_organization` defaulting to `hq_admin` only). A `Steps` header tracks the three
  stages; the body swaps between the CSR+OTP form, the compliance-check/production-CSID actions, and
  the production-stage status + renew/revoke panel, driven by `GET /zatca/onboarding/status`. No new
  frontend infrastructure — reuses the existing `api`/`errMsg` axios wrapper and `message.success`/
  `message.error` pattern from `Team.tsx`, since this app has no data-fetching library beyond that.
- **Live verification in the browser found a real bug, not just a cosmetic one.** Submitting the
  Compliance CSID form against a dev environment with `ZATCA_API_BASE` unset — the expected,
  routine case before real onboarding — returned a bare Internal Server Error: `complianceRequest()`
  used `config.getOrThrow`, so the missing-config condition threw an uncaught `Error` that NestJS's
  default filter turned into an opaque 500 instead of a message the UI's existing `errMsg()` could
  show. Fixed by checking configuration explicitly and throwing `BadRequestException` with a clear
  message — the same "degrades, does not crash" contract D-020 already established for billing,
  extended here to onboarding. Caught by actually filling in and submitting the live form (network
  tab showed the 500 directly), not by reading the code — exactly the class of gap code review
  alone tends to miss, consistent with this project's standing verification discipline. Regression
  covered in `zatca-api-client.spec.ts` (4 new tests: clean rejection when unconfigured, correct OTP
  vs Basic-Auth header selection, and error-body propagation on a ZATCA-side rejection).

## D-059: A real ZATCA primary source arrived — corrects the CSR structure, the wire shapes, and renewal

- **Source:** the user supplied ZATCA's own "E-invoicing: User Manual — Developer Portal Manual
  Version 3" (130 pages) after D-057/D-058 were built from the earlier Detailed Technical
  Guideline plus general knowledge, both of which explicitly deferred the exact CSR/API wire
  format to "the EGS vendor's manual" or a Swagger file neither document printed. This is that
  manual. Every correction below replaces a documented guess with something the new source states
  or shows directly (§5.3.1's literal OpenSSL `.cnf`, §4.2.4's literal FAQ request/response JSON),
  not a second guess.
- **The CSR structure was wrong, not just under-specified — this was the highest-severity finding.**
  `zatca-csr.ts` put all nine business fields flat into the Subject DN. §5.3.1 prints ZATCA's own
  `.cnf` and it splits them: **only** `C`/`OU`/`O`/`CN` belong in the Subject DN; EGS Serial Number,
  Organization Identifier, Invoice Type, Location, and Industry belong in a `subjectAltName`
  extension as a single `directoryName` GeneralName (`SN`/`UID`/`title`/`registeredAddress`/
  `businessCategory` respectively — same OIDs already chosen, wrong location). Two extensions were
  missing outright: `basicConstraints` (`CA:FALSE`) and `keyUsage`
  (`digitalSignature, nonRepudiation, keyEncipherment`). A **fourth, previously-unknown extension**
  — `certificateTemplateName` (Microsoft's CA-template-name OID, `1.3.6.1.4.1.311.20.2`, fixed
  value `"ZATCA-Code-Signing"`) — turned out to be required and had no prior placeholder at all.
  All four are now carried the standard way, as one PKCS#9 `extensionRequest` attribute
  (`1.2.840.113549.1.9.14`) on the CSR, built with `pkijs.Extension`/`Extensions`/`GeneralName`/
  `GeneralNames`/`RelativeDistinguishedNames`/`Attribute` rather than hand-rolled ASN.1. A CSR built
  the old way would very likely have been rejected outright by ZATCA's real CA — this shipped
  behind D-057/D-058's config gate, so nothing had called it against a real endpoint yet, but it
  would have failed the very first live onboarding attempt.
- **The Reporting/Clearance wire shapes were also wrong.** §4.2.4's FAQ prints the literal request
  and response JSON: request body is exactly `{ invoiceHash, invoice }` — `zatca-api-client.ts` was
  additionally sending a `uuid` field that has no place in that body. Response body is a **flat**
  `{ invoiceHash, status, warnings, errors }`, not the nested `validationResults.{status,
  warningMessages, errorMessages}` shape this client invented from memory — `warnings`/`errors` are
  `null` on a clean pass, not `[]`. HTTP semantics are also now handled per the same FAQ: 202 means
  "accepted with warnings" (not an error), 303 means the wrong endpoint was used for the document's
  type. `fetch` follows 303 by default and would silently turn the POST into a GET against
  `Location`, corrupting the result without any visible failure — `redirect: 'manual'` plus checking
  `res.status === 303 || res.type === 'opaqueredirect'` stops that, surfaced as a new
  `'wrong_endpoint'` outcome rather than folded into `'rejected'`.
- **Renewal was structurally wrong, not just detail-wrong.** D-058 implemented renewal as
  `requestComplianceCsid()` followed by `requestProductionCsid()` — a full re-run of onboarding's
  two-step exchange. §2.3.10.4's walkthrough shows renewal is **one call**: authenticate with an
  existing CSID via Basic Auth, submit a fresh OTP *and* a fresh CSR together, and receive a new
  Production CSID directly — no separate compliance-check gate. The manual is internally
  inconsistent about *which* CSID authenticates that call (§2.3.11's summary table says Compliance
  CSID, matching how the sandbox lets the Renewal API be tested in isolation; the walkthrough's own
  auth step says "obtained from API #3," i.e. also Compliance). This implementation authenticates
  with the org's **current Production CSID** instead — the standard PKI renewal pattern (prove
  possession of your current live credential to get the next one), and the only reading consistent
  with a live renewal actually depending on prior successful onboarding rather than on a sandbox
  test-convenience substitution. Flagged as a judgment call in `zatca-onboarding.service.ts`'s
  module comment, not asserted as certain. A fresh CSR means a fresh key pair, so renewal now also
  replaces the stored private key — the original implementation never touched it, which would have
  left a renewed certificate paired with a stale key.
- **`ZatcaApiClient.complianceRequest()`'s auth parameter became an options object**
  (`{ otp?, csid?, secret? }`) instead of two positional arguments, because renewal is the first
  call that needs Basic Auth *and* an OTP header simultaneously — the old `(otpOrCsid, secret?)`
  shape could only express one or the other.
- **What remains an acknowledged gap, not a new guess:** the literal path segments (`/compliance`,
  `/production/csids`, `/production/csids/renewal`) and the exact key `compliance_request_id` are
  still this module's own reconstruction — the manual describes these calls at the level of
  Developer Portal *screenshots* (images, not extractable text), not printed field names. Confirm
  against the real Swagger files before a live onboarding attempt, same standing caveat as D-057.
- **Verification:** all corrections are covered by updated/new tests — `zatca-csr.spec.ts`'s
  existing OpenSSL round-trip and full-text field checks pass unchanged against the restructured
  CSR (confirming `openssl req -text` renders the `subjectAltName` GeneralName's RDN values, so the
  fields are genuinely present, not just structurally different); `zatca-api-client.spec.ts` gained
  cases for the flat response shape, HTTP 202/303 handling, and all three `complianceRequest` auth
  combinations; `zatca-onboarding.spec.ts` gained a full `renewProductionCsid` test proving it makes
  exactly one API call (not two), authenticates with Basic Auth from the *current* production
  credential, and rotates the stored private key. `npx tsc --noEmit` clean; full `src/zatca` suite
  (76 tests) passes.

## D-060: Platform Admin finalized — three real bugs, three missing features, and the module's first tests

- **Trigger:** an audit across the whole Platform Admin surface (`apps/api/src/platform/`,
  `apps/api/src/billing/`, `apps/api/src/auth/guards/platform-admin.guard.ts`, and
  `apps/platform-admin/`) requested to bring it from "built" to actually complete. The module had
  shipped (D-011-era) with tenant CRUD, plans, subscriptions, and impersonation, but three things
  were silently broken and three PRD-listed capabilities were simply absent.
- **Bug 1 — platform-admin token refresh was unreachable.** `AuthService.rotateRefreshToken` was
  shared by both flows but had `expectedType: 'staff'` hardcoded, so a platform admin's refresh
  token was always rejected as the wrong principal type — every platform session silently died at
  the access-token TTL with no way to renew it, and nothing in the test suite exercised that path
  because `platform-admin.e2e-spec.ts` only ever exercised login, not refresh. Fixed with a
  dedicated `AuthService.platformRefresh()` (mirrors the existing `customerRefresh`) and a new
  `POST /auth/platform/refresh` route; `apps/platform-admin/src/api.ts` was rewritten to persist
  `refreshToken` and retry once on 401 via the same pattern `apps/admin` already used.
- **Bug 2 — feature gating was data with no enforcement.** `SubscriptionPlan.features` (a string
  array: `transfers`, `reorder_alerts`, `whatsapp`, `pwa`, `regional_managers`, `multi_store`) was
  written by `upsertPlan` and returned by every read, but no code path ever checked it — a tenant on
  the Basic plan could use every Enterprise feature. Added `FeatureGateService.getFeatures(orgId)`
  (Redis-cached 5 min, `[]` unless subscription status is `active`/`trialing`) and
  `assertFeature(orgId, feature)` (throws `HttpException(402)`), wired into five call sites:
  `inventory.service.ts#transfer`, `inventory/alerts.service.ts#listAlerts`
  (`reorder_alerts`), `notifications/notification.worker.ts` (`whatsapp` — a graceful fallback to
  push inside a BullMQ worker, not a thrown 402, since there's no HTTP response to throw into),
  `team/team.service.ts#assertRegionalManagerAllowed` (`regional_managers`, checked in both
  `invite()` and `updateRoles()`), and `auth/otp.service.ts#verifyOtp` (`pwa`, checked *after*
  successful code verification specifically so the gate can't be used to enumerate whether a phone
  number exists — `requestOtp` never reveals that regardless of plan). **`multi_store` is
  deliberately left unenforced**: the seed data is self-contradictory (`pro` has `maxStores: 5` but
  its `features` array omits `multi_store`), so gating it would 402 real seeded tenants for a plan
  limit that's already independently enforced by the `maxStores` check in `stores.service.ts`.
  Flagged in `feature-gate.service.ts`'s module comment as a known gap pending a seed-data fix, not
  silently worked around.
- **Bug 3 — the impersonation link couldn't actually sign an operator in.** `PlatformService.
  impersonate()` returned a bare staff-typed JWT; the platform-admin frontend had nowhere to put it
  because `apps/admin`'s zustand session store needs a full `{user, stores}` shape, not a token
  string, and nothing minted that shape outside of a real interactive login. Added
  `AuthService.staffSession(userId)` / `buildStaffSession()` (extracted from `staffLogin`, reused by
  both) and `GET /auth/session`, which resolves any valid staff-typed access token — impersonation
  or ordinary — into the same session shape a real login produces. `apps/admin` gained an
  `/impersonate?token=` route (`Impersonate.tsx`) that calls it and an `isImpersonating` banner in
  `AppLayout.tsx` with an explicit "End impersonation" action. The platform-admin UI hands off via a
  real, already-resolved `<Button href=... target="_blank">` the operator clicks themselves, per the
  standing D-047/D-049/D-050 rule against calling `window.open()` after an `await` or synthetically
  clicking an anchor — both reliably trigger popup blockers.
- **Three PRD capabilities that plans/impersonation implied but nothing implemented, now built:**
  platform admin account management (`PlatformAdmin` CRUD — `createPlatformAdmin`/
  `updatePlatformAdmin`/`listPlatformAdmins`, all `super_admin`-only, with a load-bearing guard in
  `updatePlatformAdmin`: a `super_admin` cannot deactivate their *own* row, checked by
  `userId === actorId`, not by admin level, so the very last active super_admin can't accidentally
  lock themselves out); a platform-wide metrics dashboard (`getMetrics()` — org/subscription counts
  by status via `groupBy`/`_count._all`, store/user totals, an MRR estimate summed from active +
  trialing subscriptions' `plan.monthlyPrice`, five most recent signups); and Stripe invoice history
  surfaced per tenant (`StripeService.listInvoices`, `GET /admin/billing/organizations/:id/invoices`,
  gated to `super_admin`/`billing` — PA-6).
- **`FeatureGateService` moved to its own zero-import `FeatureGateModule`** rather than staying a
  `PlatformModule` provider, because `AuthModule` needs it too (for `OtpService`'s `pwa` check) and
  `AuthModule → PlatformModule → AuthModule` would have been a circular import. Every consumer
  (`auth`, `platform`, `billing`, `inventory`, `notifications`, `team`) now imports
  `FeatureGateModule` directly instead of routing through `PlatformModule`.
- **Verification:** backend gained unit tests for every previously-untested piece —
  `feature-gate.service.spec.ts` (8), `auth/guards/platform-admin.guard.spec.ts` (9, including that
  it re-queries the database on every single call rather than trusting the JWT, which is what makes
  a revoked admin's existing token stop working immediately), `audit/audit.service.spec.ts` (4),
  `platform/platform.service.spec.ts` (19, covering all mutation/query methods including the
  self-deactivation guard and the plan-code-vs-plan-id resolution in `changeSubscription`),
  `platform.controller.spec.ts` (15) and `billing/billing.controller.spec.ts` (7, including that the
  unauthenticated Stripe webhook route 400s before ever touching Stripe when the signature or raw
  body is missing) — full `apps/api` suite is 254 tests across 23 files, all green.
  `test/platform-admin.e2e-spec.ts` grew from 4 to 17 cases against a live database: the D-060
  feature-gate 402s (transfers/regional_managers/pwa) under a downgraded plan, plan CRUD via
  upsert-by-code, a subscription upgrade that lifts a 402 on the very next request (proving the
  Redis cache invalidation actually fires), per-route `RequireAdminLevel` allow-list enforcement
  across `billing` and `support` tokens (not just the guard's unit-level allow-list logic), and —
  the case this module most needed — revoking a platform admin mid-session and confirming their
  still-valid, unexpired JWT is rejected on its *very next* request, not merely at next login.
  `apps/platform-admin` had zero test files or framework; added Vitest + `@testing-library/react`
  (matching the app's existing Vite tooling, not introduced project-wide) with two suites:
  `api.test.ts` exercises the real interceptor chain against a scripted axios adapter — 401 retry
  with a fresh token, refresh-failure logout, no-refresh-token short-circuit, the `_retry` flag
  preventing a second attempt, and two concurrent 401s deduplicating into one refresh call — and
  `pages/PlatformAdmins.test.tsx` locks in that the signed-in admin's own row never renders a
  Revoke control, mirroring the backend guard at the UI layer. Test files are excluded from the
  app's production `tsconfig.json` (a separate `tsconfig.vitest.json` type-checks them) so `tsc -b`
  isn't broken by `@testing-library/jest-dom`'s ambient matcher types. Every change was also
  live-verified in a real browser against the dev database: login, tenant provisioning, plan
  changes, suspend/reactivate, impersonate → land in `apps/admin` already signed in, create/revoke a
  platform admin, and the dashboard's numbers checked against direct Postgres queries.

## D-061: First real deploy attempt exposed five gaps a dev-only setup never surfaces

- **Trigger:** connecting the repo to Railway and deploying revealed the whole stack had only ever
  been proven in a mode where `npm install` at the repo root happens once and stays put, every
  frontend is proxied through Vite's own dev server, and Postgres/Redis are always at
  `localhost` with no auth. None of that holds on a platform that does a clean install per
  deploy and serves each app from its own domain.
- **The API's Prisma client was never generated on a fresh install.** `apps/api/package.json` had
  no `postinstall` and `build` was plain `nest build` — the very first Railway build failed with
  `Namespace "Prisma" has no exported member 'InputJsonValue'` and similar, because `nest build`
  ran against whatever stub `.prisma/client` output was already on disk from a local `npm install`
  months ago, not a client generated from this schema. Locally this was invisible: a fresh
  `prisma generate` had been run by hand often enough that the generated client just sat in
  `node_modules` indefinitely. Fixed with `postinstall: prisma generate` and
  `build: prisma generate && nest build`; `start` now also runs `prisma migrate deploy` first, since
  a freshly provisioned production database has no schema applied to it at all.
- **No Redis/BullMQ connection anywhere accepted a password.** `redis.module.ts`,
  `notifications.module.ts`, `notification.worker.ts`, and `reorder-cron.service.ts` all built a
  bare `{host, port}` connection object. The local Docker Compose Redis has no auth, so this never
  mattered until Railway's managed Redis — which always requires one — was in the picture. Added
  `password: config.get('REDIS_PASSWORD') || undefined` to all four.
- **Every one of the four Vite SPAs was being started with `vite dev` in production.** Railway's
  GitHub connector auto-created one service per workspace and guessed a start command from
  whatever scripts existed; none of the four had a `"start"` script, so it fell back to `dev`.
  A dev server is not meant to serve real traffic and, more immediately, none of the services had
  a public domain yet either, so this had gone unnoticed. Added a `"start": "serve -s dist -p
  ${PORT:-<port>}"` script (the `-s` flag rewrites unmatched routes to `index.html`, required for
  client-side routing — verified directly: a request to a nonexistent deep route like
  `/orders/some-fake-id` returns the app shell with 200, not a 404) to each of `admin`, `pos`,
  `pwa`, and `platform-admin`. `serve`'s `-l` flag takes a listen *URI*, not a bare port number,
  and silently no-ops on one — confirmed by testing both and finding `-l` bound to serve's own
  default port regardless of the value passed; `-p` is the correct flag for a plain port.
- **Every frontend called the API through a hardcoded relative `/api/v1` path**, in the shared
  `api` client instance and, separately, in nine raw `axios.post`/`axios.get` calls used for
  login/refresh/logout specifically to bypass the response interceptor and avoid recursing back
  into itself on a 401. A relative path only resolves correctly when something proxies `/api` to
  the API server — true for every local dev server (`vite.config.ts`'s own proxy) and therefore
  never once exercised any other way. In production each SPA is served from its own domain with no
  proxy in front of it, so a relative path resolves against the *frontend's* own origin instead of
  the API's. Added `VITE_API_URL` (build-time, baked into the bundle by Vite — not readable at
  runtime) with a fallback to the empty string, so the relative-path behavior is unchanged for
  local dev and every absolute call becomes `${VITE_API_URL}/api/v1/...` in production. The nine
  raw-axios call sites needed the same prefix threaded through by hand, since they deliberately
  don't go through the configured `api` instance.
- **Railway's Hobby plan caps a project at 5 services and 3 volumes.** The connector had already
  used all 5 on the four SPAs plus the API before any database existed. Postgres and Redis both
  need one service (with a volume) each — provisioning both was not possible without either
  upgrading the plan, dropping an app, or moving a database off Railway entirely. This is a cost/
  scope decision, not an engineering one — surfaced to the user rather than guessed at. Resolved by
  removing `apps/pwa`'s Railway service (the codebase itself is untouched; the customer PWA can be
  redeployed once there's room) and provisioning Postgres. **Redis has not been provisioned yet**
  for the same reason — the project is back at 5/5 services.
- **The first live deploy without Redis 502'd outright — not a graceful degradation.** The
  assumption above (`RedisModule`'s client and every `BullMQ` `Queue`/`Worker` construct
  asynchronously, so nothing should block boot) was correct for three of the four Redis-touching
  services but wrong for the fourth: `ReorderCronService.onModuleInit()` did `await
  this.queue.upsertJobScheduler(...)`. Nest awaits every module's `onModuleInit` before
  `NestFactory.create()` resolves, and `app.listen()` is the line immediately after that in
  `main.ts` — so an `onModuleInit` that never resolves means the HTTP port never opens, not just
  that cron doesn't run. With `enableOfflineQueue` on (ioredis's default) and no reachable Redis,
  that call sits in the offline queue forever: the process stays alive (hence the endless
  `ECONNREFUSED` retry logs in Railway's deploy logs) but never binds a port, which is exactly
  what a 502 "Application failed to respond" looks like from the edge proxy — indistinguishable
  from a genuine crash without reading past the Redis noise to notice `app.listen()`'s log line
  never appears. Caught by actually curling the deployed health endpoint after the "SUCCESS"
  deployment status, not by trusting the status — Railway marks a deployment successful once the
  container starts without exiting, which says nothing about whether the app inside it ever opened
  its port. Fixed by not awaiting the scheduler registration
  (`this.queue.upsertJobScheduler(...).catch(...)` instead) — it still registers once Redis exists
  and reconnects, it just no longer gates the rest of the process on that happening first. WhatsApp
  delivery, the reorder-alert cron itself, and the OTP flow's rate-limit/code storage remain
  degraded or non-functional until Redis exists; the API as a whole reaching its listeners is no
  longer contingent on it.
- **Secrets were generated, not requested.** `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (64-byte
  base64url), `TOKEN_ENCRYPTION_KEY` (32-byte hex, matching the shape `zatca-submit.spec.ts` and
  `zatca-onboarding.spec.ts` already assume), and a VAPID key pair are all self-contained
  cryptographic material with no external party to ask — generated locally with Node's `crypto`
  and the already-installed `web-push` CLI helper and set directly on the API service. Nothing
  requiring a real third-party credential (Stripe, WhatsApp Cloud API, ZATCA, an SMS gateway) was
  invented or guessed; those remain unset, and the features that need them degrade the way D-020
  and D-029 already designed them to — a 503 on billing routes, `zatca_not_onboarded` on submit —
  rather than crashing.

## D-062: Finalizing admin found the same shape of gap as platform-admin — backend built, no UI

- **Trigger:** "now it's time to work on admin" — the same systematic audit that finalized
  platform-admin (D-060), applied to `apps/admin`. Cross-referencing its page list against every
  backend module in `AppModule` found three fully-built, correctly-permissioned backend surfaces
  with no admin UI at all, plus one route family gated to the wrong audience entirely.
- **Billing was not "missing a page," it was gated to the wrong people.** `BillingController`'s
  checkout/portal/invoices routes — the actual Stripe self-serve flows — sat behind
  `PlatformAdminGuard`, so a tenant's own hq_admin could not see their plan, self-upgrade, open the
  Stripe customer portal, or view their invoice history; every billing action required going
  through Tailonix's own platform-admin team on the tenant's behalf. This is a business-model
  question, not an engineering one, so it was put to the user directly rather than guessed at
  (self-serve vs. staying sales-assisted) before touching anything — resolved in favor of
  self-serve. **Existing platform-admin routes/guards are untouched**; a new `TenantBillingController`
  (`@Controller('billing')`, no `:id` param — always `principal.orgId!`) reuses the same
  `StripeService` methods. `createCheckoutSession`/`createPortalSession` gained optional
  `successUrl`/`cancelUrl`/`returnUrl`/`actorType` parameters, defaulting to the exact URLs and
  `actorType: 'platform_admin'` they already used, so the platform-admin path is provably
  unchanged; the tenant path passes its own admin-app URLs and `actorType: 'staff'`.
- **The double-entry ledger (D-036/D-037) had zero UI since the day it was built.**
  `LedgerController`'s trial-balance and per-account statement endpoints were already gated by the
  ordinary `view_dashboard` permission — tenant-accessible from day one — but nothing in
  `apps/admin` ever called them. New `Ledger.tsx` reads both, plus calls the idempotent
  `POST /ledger/accounts/bootstrap` automatically on first visit if the chart of accounts doesn't
  exist yet for that tenant, so there's no separate manual setup step.
- **Invoices had an endpoint but no browsable history.** `GET /invoices` already existed
  (`view_orders`-gated) and was reachable exactly once — `OrderDetail`'s single-order reprint
  button. New `InvoicesList.tsx` is the first place a tenant can see every invoice at once.
- **WhatsApp — D-015's "primary" notification channel — had no way to ever be configured.**
  `Store.whatsappPhoneNumberId`/`whatsappAccessTokenEncrypted` existed in the schema and were read
  by `notification.worker.ts`/`whatsapp.service.ts`, but neither `stores.dto.ts` nor any frontend
  ever exposed a write path — the only way to set them was a raw database write. Added both fields
  to `UpdateStoreDto`, gated by the existing `manage_stores` permission (an extension of ordinary
  store editing, not a new org-wide setting like the other three). The token is encrypted with the
  same `encryptSecret`/`TOKEN_ENCRYPTION_KEY` pattern already used for ZATCA credentials before it
  touches the database, and **no read path returns it in any form** — `sanitizeStore()` strips
  `whatsappAccessTokenEncrypted` from every `StoresService` response and replaces it with a derived
  `whatsappConfigured: boolean`, verified by an e2e test that greps the full JSON response body (not
  just individual fields) for the plaintext token after a real write, and separately confirms the
  database row holds an AES-256-GCM envelope rather than the plaintext.
- **A real crash, caught by live verification, not by review.** The WhatsApp status label's guard
  was `editing !== 'new'` — true when `editing === null` too, since `null !== 'new'`. Opening the
  "Add store" modal (`editing` starts `null`) hit `(null as StoreRow).whatsappConfigured` and
  white-screened the entire page with no error boundary to catch it. Found by actually opening the
  modal in a real browser during verification, not by code review — the bug was invisible in the
  diff because `editing !== 'new'` reads as a correct-looking guard unless you separately hold in
  mind that `editing`'s type is `StoreRow | 'new' | null`, three states, not two. Fixed to
  `editing && editing !== 'new'`, which also lets TypeScript narrow `editing` to `StoreRow` in the
  branch without the `as StoreRow` casts the buggy version needed. Locked in with a regression test
  that renders the real component and opens the real modal, specifically because a shallow test
  asserting only the fixed behavior wouldn't have caught the same bug returning in a different form.
- **Verification:** `apps/api` unit suite grew to 276 tests (new: `stores.service.spec.ts` from
  zero, plus additions to `stripe.service.spec.ts` and `billing.controller.spec.ts` for the tenant
  controller and the new optional redirect/actorType parameters). A new `billing.e2e-spec.ts`
  (51 total e2e tests project-wide) exercises the `manage_organization` gate with a real hq_admin
  vs. a real store_manager token — not just the guard's unit-level logic — and the WhatsApp
  round-trip against a live database. `apps/admin` gained Vitest + Testing Library from zero
  (mirroring D-060's platform-admin setup exactly: jsdom `matchMedia` polyfill, test files excluded
  from the production `tsconfig.json` via a separate `tsconfig.vitest.json`), covering the
  previously-untested auth/refresh interceptor chain and the Stores crash regression. Every new
  page was also driven live in a real browser against the seeded dev database — Billing showing a
  real Enterprise subscription and correctly 503-ing "Manage billing" with no `STRIPE_SECRET_KEY`
  configured, Ledger rendering a real, balanced trial balance (55,965.24 = 55,965.24) with a working
  drill-down into real journal-entry lines, and the WhatsApp config modal round-tripping a token
  end-to-end with the encrypted envelope confirmed directly in Postgres.
