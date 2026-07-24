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
