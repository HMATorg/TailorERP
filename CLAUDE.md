# Tailonix

Multi-tenant tailoring ERP/POS for the KSA market. npm-workspaces monorepo: NestJS + Prisma +
PostgreSQL + Redis/BullMQ on the API side, React + Vite + Ant Design for the four front ends.

## The memory graph rule

`docs/MEMORY-GRAPH.md` is the single source of truth for **what exists** — apps, API modules,
data models, migrations, engineering decisions, commit history, test shape. It is **generated**,
never hand-written:

```bash
npm run graph
```

**Do not state project facts from memory or from a conversation summary.** Counts, module names,
decision IDs, and migration lists go stale the moment code changes, and a confidently wrong
status report is worse than no report. Regenerate and read the file.

This is enforced, not merely requested (`.claude/settings.json`):

| When | What happens |
| --- | --- |
| `git commit` | Graph is regenerated and staged, so it ships in the same commit as the change it describes |
| Session start | Graph is regenerated and its digest injected into context |
| After compaction | Same — a compacted session re-anchors on the repo, not on the summary |

### Drift is a defect

The generator exits non-zero when two sources of truth in this repo disagree, and prints what
and where. It checks for:

- a `D-0xx` decision cited in code that has no entry in `docs/ENGINEERING-DECISIONS.md`
- duplicate, missing, or out-of-order decision IDs
- a NestJS module on disk that `AppModule` never imports (ships no routes, invisible to tests)
- `AppModule` importing a module that no longer exists
- `schema.prisma` committed more recently than the newest migration

Fix these; do not route around them. Each one means the repo has stopped matching its own
records — the exact condition the graph exists to catch. The first run found two immediately.

Judgment that **cannot** be derived from the repo — why something is blocked, which correct-looking
"fixes" are actually regressions — belongs in the auto-memory files, not in the generated graph.

## Invariants that look like bugs

Do not "correct" these without reading the cited decision first:

- **Deposits post Dr Cash / Cr Unearned Revenue.** The competitor blueprint states this inverted;
  the blueprint is wrong (D-036).
- **VAT is derived by subtraction** (`vat = gross − net`, never re-rounded) so `net + vat === gross`
  holds exactly. Settlement VAT on split payments is a remainder, not a per-payment split (D-037).
- **ZATCA issuance takes `pg_advisory_xact_lock` per tenant.** `FOR UPDATE` on the latest row does
  not serialise inserts and silently loses tax invoices (D-039).
- **Document numbers come from `document_counters`**, never `count(*) + 1` (D-038).

## Verifying

Green tests are not sufficient here, and both gaps have already bitten:

- Anything producing a customer-visible document (receipt, invoice, ticket) must be **rendered and
  read**. A stale response DTO once showed "Deposit paid SAR 0.00" after a 200 payment while every
  test passed, because the tests asserted the database and the customer sees the response.
- Anything touching reservation, numbering, or ZATCA issuance must be run under **concurrent** load:
  `node apps/api/test/concurrency-harness.js` (set `N=32`). 133 serial tests passed while 12
  parallel checkouts produced 1 success and 11 HTTP 500s.

## Local environment

Postgres is on **5436** and Redis on **6380** — the defaults are taken by other projects on this
machine. `npm run infra:up` starts Postgres, Redis and MinIO. Dev servers: API 3000, admin 5173,
PWA 5174, platform-admin 5175, POS 5176 (see `.claude/launch.json`).
