# Tailonix

Full-stack retail operating system for tailoring chains and franchises (Gulf region).
Multi-store management, batch-tracked inventory with FIFO, customer PWA with OTP auth,
WhatsApp order notifications, and a SaaS platform-administration layer.

## Repository layout

| Path | What it is |
|------|-----------|
| `apps/api` | NestJS modular monolith — tenant API, customer PWA API, platform admin API, BullMQ workers |
| `apps/admin` | React admin SPA (staff dashboard, Ant Design, RTL) |
| `apps/pwa` | React customer PWA (order tracking, appointment booking) |
| `apps/platform-admin` | React SPA for Tailonix internal teams (tenants, plans, billing) |
| `packages/shared` | Shared TypeScript types, roles/permissions constants, status enums |
| `docs/` | PRD, TRD, Architecture doc, wireframes, engineering decisions log |

## Prerequisites

- Node.js ≥ 20, npm ≥ 10
- Docker Desktop (Postgres 15, Redis 7, MinIO for local dev)

## Getting started

```bash
npm install
docker compose up -d          # postgres :5432, redis :6379, minio :9000/:9001
cp apps/api/.env.example apps/api/.env
npm run db:migrate            # apply Prisma migrations
npm run db:seed               # seed platform admin + demo tenant
npm run dev:api               # API on http://localhost:3000/api/v1
npm run dev:admin             # admin SPA on http://localhost:5173
npm run dev:pwa               # customer PWA on http://localhost:5174
npm run dev:platform-admin    # platform admin on http://localhost:5175
```

## Testing

```bash
npm run test --workspaces --if-present   # unit: FIFO, permissions, slot availability
npm run test:e2e -w @tailonix/api        # e2e: platform admin API (needs docker + seed)
```

## Seeded dev logins

Password for all: `Tailonix@Dev1`

| Role | Credential |
|------|-----------|
| Platform super admin | `admin@tailonix.com` |
| HQ Admin (tenant) | `owner@alanwar.example` |
| Store Manager | `manager.jeddah@alanwar.example` |
| Tailor | `tailor.jeddah@alanwar.example` |
| Customer (PWA) | phone `+966512345678` — OTP is printed to the API log in dev |

## Key documents

- [PRD](docs/PRD.md) — product requirements (v3.0)
- [TRD](docs/TRD.md) — technical requirements (v3.0)
- [Technical Architecture](docs/Technical%20Architecture%20Document.md)
- [UI/UX Wireframes](docs/UI-UX-wireframe.md)
- [Engineering Decisions Log](docs/ENGINEERING-DECISIONS.md) — where implementation
  deviates from or fills gaps in the specs, with rationale
