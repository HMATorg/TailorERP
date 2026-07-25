# Performance Baseline

**Measured:** 25 July 2026
**Environment:** local Docker (Postgres 15, single container, no read replica), Node 24
**Method:** synthetic tenant via `npm run prisma:seed-scale`, 12 requests per endpoint
after a warm-up, measured end-to-end through the HTTP API (not raw SQL).

Production will differ — managed Postgres, network hops, concurrent load — but the
*query plans* below are environment-independent, and they are what determines whether
these numbers hold as data grows.

## Dataset

| | |
|---|---|
| Stores | 100 (the PRD §5 dashboard target) |
| Orders | 50,000 spread over 2 years |
| Customers | 202,000 |

Two years of spread matters: with only 90 days of data a 7-day dashboard window covers
7.7% of all rows, and Postgres correctly prefers a sequential scan. Real tenants
accumulate history, which is when index selectivity starts to pay.

## Results

### HQ dashboard aggregation — PRD requirement: p95 < 2s for 100 stores

| Query | p50 | p95 | Budget used |
|-------|-----|-----|-------------|
| Default (last 7 days) | 22 ms | **29 ms** | 1.5% |
| 90-day range | 26 ms | **40 ms** | 2% |

### High-traffic endpoints

| Endpoint | p50 | p95 |
|----------|-----|-----|
| Store dashboard | 23 ms | 25 ms |
| Orders list (page 1) | 21 ms | 29 ms |
| Orders list (page 10) | 19 ms | 21 ms |
| Order search by number | 23 ms | 27 ms |
| Customers list | 25 ms | 26 ms |
| Customer search | 28 ms | 30 ms |
| Inventory batches | 15 ms | 16 ms |

## Two problems found and fixed

Both were invisible at demo scale and would only have surfaced in production.

### 1. Dashboard aggregation scanned the whole orders table

`EXPLAIN ANALYZE` showed a **sequential scan on `orders`**, reading all 50,000 rows and
discarding 46,160 to find 3,841. The pre-existing index
`(store_id, customer_id, created_at)` leads with `store_id`, so it cannot serve a
date-range filter spanning every store.

Cost grows linearly with total order history — the query would slow down every year
regardless of the date range requested.

**Fix** (migration `20260725010000`):

```sql
CREATE INDEX orders_store_created_active_idx
  ON orders (store_id, created_at)
  INCLUDE (total_amount)
  WHERE status <> 'cancelled';
```

Partial, because cancelled orders are excluded from every revenue figure; covering, so
the aggregate reads `total_amount` from the index. The plan becomes an index scan whose
cost tracks *matching* rows rather than table size.

### 2. Customer search was a full table scan per keystroke

Search uses `ILIKE '%term%'`, which no B-tree can serve. At 202,000 customers:

| | Execution time |
|---|---|
| Sequential scan (no index) | 94.5 ms |
| GIN trigram index | **19.9 ms** |

4.7× at this size, and the gap widens — the scan is O(n) while the index probe is not.
At the PRD's 1M-customer target the scan alone would exceed 400 ms, on every keystroke,
for every user.

**Fix** (migration `20260725020000`): `pg_trgm` + GIN indexes on `customers.full_name`,
`customers.phone`, and `orders.order_number`.

### 3. Every foreign key was unindexed — customer erasure was unusable

Found by accident: tearing down the load-test data **hung**. Cancelling it and checking
`pg_stat_activity` showed a `DELETE FROM customers` still running after ten minutes.

Postgres does not automatically index foreign keys. Deleting a referenced row requires
scanning each *referencing* table to enforce the constraint — and `orders.customer_id`,
`appointments.customer_id`, and `whatsapp_messages.customer_id` had no leading index.
The composite `(store_id, customer_id, created_at)` cannot serve a lookup by customer
alone. Each of the 200,000 deletions triggered three sequential scans.

An audit found **23 unindexed foreign keys** across the schema — every one a latent
lock-and-scan hazard on deletion.

This is not a test-only concern: PRD §5 requires GDPR/PDPL export and erasure. A
"delete my data" request would have timed out.

**Fix** (migration `20260725030000`): indexes on all 23.

| 200,000 customer deletions | Time |
|---|---|
| Before | cancelled after 10+ min, still running |
| After | **4.85 s** |

## Index maintenance warning

Prisma cannot express **partial** or **covering** indexes. `orders_store_created_active_idx`
therefore exists only in raw migration SQL, with a pointer comment in `schema.prisma`.

The GIN/trigram indexes *are* declared in `schema.prisma` (via the `postgresqlExtensions`
preview feature and `map:` names) specifically so `prisma migrate dev` does not offer to
drop them. Verified with `prisma migrate diff`: no drift.

**If you add a migration that rebuilds `orders`, re-create the partial index by hand.**

## Not yet measured

- **Concurrent load.** These are sequential single-user timings. The TRD calls for k6 at
  500 staff + 2,000 PWA users; connection-pool sizing is untested.
- **FIFO consumption under contention.** Correctness is covered by unit tests, but the
  `SELECT … FOR UPDATE` path has not been exercised with concurrent writers competing
  for the same batch — the most likely source of lock waits in production.
- **Write throughput.** Only read paths were profiled.

## Reproducing

```bash
npm run prisma:seed-scale             # 100 stores, 50k orders, 2k customers
STORES=250 ORDERS=800 npm run prisma:seed-scale
CLEANUP=1 npm run prisma:seed-scale   # remove it again
```

The scale tenant is a separate organisation (`Scale Test Chain`) and never touches the
demo data.
