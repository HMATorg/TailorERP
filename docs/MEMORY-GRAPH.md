# Tailonix Memory Graph

> **Generated file — do not edit.** Rewritten by `node tools/memory-graph.mjs`,
> which reads git, the Prisma schema, the NestJS module graph, and the decisions
> log. Hand edits are lost on the next run. Judgment that cannot be derived from
> the repo — why something is blocked, what a trap looks like — belongs in the
> auto-memory directory, not here.

**Parent** `fff88f3` on `main` · **generated** 2026-07-26 17:02Z · staged into the commit being created on top of it

_History below runs to the parent; the commit carrying this file is its child._

## Drift

No drift. Every decision cited in code exists in the log, every module on disk is
wired into `AppModule`, decision numbering is dense and ordered, and the schema is
not ahead of its migrations.

## Subsystem graph

Edges are `imports:` declarations read out of each `*.module.ts`.

```mermaid
graph LR
  Billing --> Auth
  Billing --> Platform
  Customer --> Appointments
  Customer --> Measurements
  Customers --> Measurements
  Invoices --> Zatca
  Notifications --> Invoices
  Orders --> Inventory
  Orders --> Notifications
  Platform --> Auth
  Pos --> Inventory
  Pos --> Invoices
  Pos --> Workshop
  Team --> Notifications
  Workshop --> Inventory
  Workshop --> Measurements
```

## Applications

| App | Package | Dev port | TS/TSX files | Direct deps |
| --- | --- | --- | --- | --- |
| `apps/admin` | `@tailonix/admin` | 5173 | 23 | 11 |
| `apps/api` | `@tailonix/api` | 3000 | 124 | 21 |
| `apps/platform-admin` | `@tailonix/platform-admin` | 5175 | 8 | 8 |
| `apps/pos` | `@tailonix/pos` | 5176 | 8 | 12 |
| `apps/pwa` | `@tailonix/pwa` | 5174 | 14 | 9 |

## API modules

24 feature modules, all wired into `AppModule`.

| Module | Path | Depends on |
| --- | --- | --- |
| `AppointmentsModule` | `apps/api/src/appointments/appointments.module.ts` | — |
| `AuditModule` | `apps/api/src/audit/audit.module.ts` | — |
| `AuthModule` | `apps/api/src/auth/auth.module.ts` | — |
| `BillingModule` | `apps/api/src/billing/billing.module.ts` | `AuthModule`, `PlatformModule` |
| `CommonModule` | `apps/api/src/common/common.module.ts` | — |
| `CustomerModule` | `apps/api/src/customer-api/customer.module.ts` | `AppointmentsModule`, `MeasurementsModule` |
| `CustomersModule` | `apps/api/src/customers/customers.module.ts` | `MeasurementsModule` |
| `DashboardModule` | `apps/api/src/dashboard/dashboard.module.ts` | — |
| `HealthModule` | `apps/api/src/health/health.module.ts` | — |
| `InventoryModule` | `apps/api/src/inventory/inventory.module.ts` | — |
| `InvoicesModule` | `apps/api/src/invoices/invoices.module.ts` | `ZatcaModule` |
| `LedgerModule` | `apps/api/src/ledger/ledger.module.ts` | — |
| `MeasurementsModule` | `apps/api/src/measurements/measurements.module.ts` | — |
| `NotificationsModule` | `apps/api/src/notifications/notifications.module.ts` | `InvoicesModule` |
| `OrdersModule` | `apps/api/src/orders/orders.module.ts` | `InventoryModule`, `NotificationsModule` |
| `PlatformModule` | `apps/api/src/platform/platform.module.ts` | `AuthModule` |
| `PosModule` | `apps/api/src/pos/pos.module.ts` | `InventoryModule`, `InvoicesModule`, `WorkshopModule` |
| `PrismaModule` | `apps/api/src/prisma/prisma.module.ts` | — |
| `RedisModule` | `apps/api/src/redis/redis.module.ts` | — |
| `StorageModule` | `apps/api/src/storage/storage.module.ts` | — |
| `StoresModule` | `apps/api/src/stores/stores.module.ts` | — |
| `TeamModule` | `apps/api/src/team/team.module.ts` | `NotificationsModule` |
| `WorkshopModule` | `apps/api/src/workshop/workshop.module.ts` | `InventoryModule`, `MeasurementsModule` |
| `ZatcaModule` | `apps/api/src/zatca/zatca.module.ts` | — |

## Data model

36 models, 27 enums, 9 migrations.

<details><summary>Models</summary>

`Appointment` · `AuditLog` · `Customer` · `CustomerDevice` · `CustomerStoreVisit` · `DocumentCounter` · `FabricReservation` · `InventoryBatch` · `InventoryMovement` · `InventoryReorderSetting` · `InventoryRestockAlert` · `Invitation` · `Invoice` · `JournalEntry` · `LedgerAccount` · `LedgerLine` · `Measurement` · `Notification` · `Order` · `OrderItem` · `OrderItemFabric` · `OrderStatusHistory` · `Organization` · `OrganizationSubscription` · `Payment` · `PlatformAdmin` · `ProductionTicket` · `ProductionTicketHistory` · `RefreshToken` · `Store` · `SubscriptionPlan` · `Supplier` · `User` · `UserStoreRole` · `WhatsappMessage` · `WhatsappTemplate`

</details>

| # | Migration |
| --- | --- |
| 1 | `20260724173445_init` |
| 2 | `20260724173510_db_check_constraints` |
| 3 | `20260725000000_stripe_billing_fields` |
| 4 | `20260725010000_dashboard_aggregation_index` |
| 5 | `20260725020000_customer_search_trigram` |
| 6 | `20260725030000_foreign_key_indexes` |
| 7 | `20260725100000_v4_tailoring_amendment` |
| 8 | `20260726000000_double_entry_ledger` |
| 9 | `20260726100000_document_counters` |

## Engineering decisions

44 recorded in `docs/ENGINEERING-DECISIONS.md`. "Cited by" counts source
files that reference the decision in a comment — an uncited decision is not wrong,
but it is the first place to look when something has quietly been undone.

| ID | Decision | Cited by |
| --- | --- | --- |
| `D-001` | Staff JWT expiry — PRD vs TRD conflict | — |
| `D-002` | `batch_code` uniqueness — schema bug in TRD | 2 file(s) |
| `D-003` | Base tables the TRD assumes but never defines | 1 file(s) |
| `D-004` | HQ Admin scoping — org-level role vs per-store rows | 3 file(s) |
| `D-005` | PWA framework — Vue vs React left open by TRD | — |
| `D-006` | ORM — TypeORM vs Prisma left open by TRD | — |
| `D-007` | Negative stock prevention "at database level" | 1 file(s) |
| `D-008` | Store timezone for the 8 AM reorder cron | 2 file(s) |
| `D-009` | OTP length — 4 digits per wireframes | 1 file(s) |
| `D-010` | Order number & status model | 3 file(s) |
| `D-011` | Dev-first infrastructure | — |
| `D-012` | Monorepo layout | — |
| `D-013` | Customer identity | 1 file(s) |
| `D-014` | Validation library | — |
| `D-015` | Notification channel priority and fallback | — |
| `D-016` | `validateEnv` must return the whole config | — |
| `D-017` | Service worker owns push (Workbox `injectManifest`) | — |
| `D-018` | Stripe is the source of truth for subscription state | 1 file(s) |
| `D-019` | Stripe SDK v22 field relocations | — |
| `D-020` | Billing degrades, it does not crash | — |
| `D-021` | Invoice PDFs are Latin-only for now — **superseded by D-040** | — |
| `D-022` | Invoices are generated, not stored-and-served | — |
| `D-023` | Invoicing triggers on delivery | — |
| `D-024` | Partial covering index for the dashboard aggregation | 2 file(s) |
| `D-025` | Trigram indexes for substring search | 2 file(s) |
| `D-026` | Index every foreign key | 1 file(s) |
| `D-027` | Measurements become a versioned matrix, enforced by the database | — |
| `D-028` | VAT is derived by subtraction, not by re-multiplication | — |
| `D-029` | ZATCA Phase 2 — what is implemented and what needs onboarding | 1 file(s) |
| `D-030` | Compliance verification needs hash re-computation, not just chain linkage | — |
| `D-031` | Reserve at checkout, deduct at cutting | — |
| `D-032` | Yield is computed from the customer's own active measurements | — |
| `D-033` | POS checkout is one call, not a wizard of independent endpoints | — |
| `D-034` | The POS is a separate app, not a section of the admin SPA | — |
| `D-035` | Returning a pre-update row printed the wrong balance | — |
| `D-036` | The blueprint states the deposit posting backwards | 3 file(s) |
| `D-037` | VAT on split payments is a remainder, not a per-payment split | 1 file(s) |
| `D-038` | Document numbers need an atomic counter, not `count(*) + 1` | 3 file(s) |
| `D-039` | `FOR UPDATE` on the latest row does not serialise inserts | 1 file(s) |
| `D-040` | Arabic invoices need a font, not a shaping engine | 2 file(s) |
| `D-041` | Creating an invoice issues it; the PDF is rendered after | 1 file(s) |
| `D-042` | The invoice footer anchors to the page box, not a constant | 1 file(s) |
| `D-043` | POS and the workshop get their own permissions | 2 file(s) |
| `D-044` | One read model for measurements, and it is read-only | 1 file(s) |

## Tests

| Suite | Files | Declared cases |
| --- | --- | --- |
| unit | 12 | 128 |
| e2e | 0 | 0 |

Counts are parsed from `it(` / `test(` call sites, so they include any case that is
currently skipped. They are a shape check, not a substitute for running the suite.

## History

| Commit | Date | Subject |
| --- | --- | --- |
| `fff88f3` | 2026-07-26 | Drop the hook pre-filter that was missing real commits |
| `252b394` | 2026-07-26 | Make the printed invoice a valid KSA tax invoice |
| `b685805` | 2026-07-26 | @ Stop the graph hook from dirtying the index on unrelated commands |
| `871ab64` | 2026-07-26 | @ Label the graph header honestly when it is generated pre-commit |
| `6975af1` | 2026-07-26 | @ Derive the project memory graph from the repo instead of recalling it |
| `b137d23` | 2026-07-26 | Fix two concurrency bugs found by load-testing the counter |
| `21a995b` | 2026-07-26 | Add double-entry ledger: deposits as liability, realised on handover |
| `1748eb1` | 2026-07-26 | Add tablet POS app: counter flow, measurement diagram, workshop Kanban |
| `d8d326a` | 2026-07-25 | v4: yield engine, fabric reservations, workshop Kanban, POS checkout |
| `0283a3a` | 2026-07-25 | v4 amendment: KSA tailoring domain + ZATCA Fatoora Phase 2 |
| `2076c4a` | 2026-07-25 | Profile at PRD scale; fix three index problems found |
| `410df3b` | 2026-07-25 | Add invoice PDF generation, object storage, and WhatsApp document send |
| `7e0a776` | 2026-07-25 | Add Stripe subscription billing and fix broken invitation link |
| `79a92be` | 2026-07-25 | Add email digests for low stock and staff invitations |
| `8b1c00a` | 2026-07-25 | Add web push delivery and fix env config stripping undeclared vars |
| `9719c9e` | 2026-07-25 | Add i18n and native RTL support (en/ar/ur) |
| `8b5283c` | 2026-07-25 | Add customers module, e2e tests, and CI e2e stage |
| `27fcde1` | 2026-07-24 | Initial implementation: Tailonix multi-tenant tailoring platform |

