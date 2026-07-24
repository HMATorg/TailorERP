Below is the complete Technical Architecture Document for Tailonix. It describes the system’s high‑level design, all major components, interactions, deployment strategy, security layers, and architectural decisions. It is intended as a stand‑alone reference for the engineering team and technical stakeholders.

---

# Technical Architecture Document  
**Product:** Tailonix – Complete Enterprise Platform  
**Version:** 1.0  
**Author:** Lead Product Designer & Full‑Stack Production Engineer  
**Date:** 26 July 2026  
**Status:** Approved  

---

## 1. Introduction

### 1.1 Purpose
This document defines the technical architecture of the Tailonix platform. It provides a detailed blueprint of how the system is structured, how its components communicate, how data flows, and how non‑functional requirements (scalability, security, availability) are achieved. It extends the Technical Requirements Document (TRD) by focusing on the architectural patterns, deployment topology, and cross‑cutting concerns.

### 1.2 Scope
The architecture covers:
- Tenant‑facing Enterprise application (multi‑store management, inventory, appointments)
- Customer self‑service PWA (order tracking, booking, WhatsApp integration)
- Internal Platform Administration (tenant lifecycle, subscription & licensing)
- Background processing (notifications, reorder cron, PDF generation)
- Integrations (WhatsApp Cloud API, Stripe, SMS/Email gateways)

### 1.3 Audience
Engineering leads, backend/frontend developers, DevOps engineers, QA architects, and product leadership.

---

## 2. Architecture Overview (C4 Model – System Context)

```text
                                                ┌────────────────────┐
                                                │    WhatsApp        │
                                                │    Cloud API       │
                                                └────────▲───────────┘
                                                         │
┌──────────────┐      HTTPS        ┌────────────────────┼────────────────────┐
│  Admin Users │───────────────────▶                    │                    │
│  (Browser)   │                   │     Tailonix       │   ┌────────────┐   │
└──────────────┘                   │     Platform       │   │   Stripe   │   │
                                   │                    ◀───┤   API      │   │
┌──────────────┐                   │  (Monolith /       │   └────────────┘   │
│  Customers   │───────────────────▶   Modular          │                    │
│  (PWA)       │      HTTPS        │   NestJS App)      │   ┌────────────┐   │
└──────────────┘                   │                    │   │  Email/SMS │   │
                                   │                    ◀───┤  Gateways  │   │
┌──────────────┐                   └────────┬───────────┘   └────────────┘   │
│  Platform    │───────────────────────────┘│
│  Admins      │      HTTPS                 │
└──────────────┘                            │
                                            │
              ┌─────────────────┬───────────┴───────────┬──────────────┐
              ▼                 ▼                       ▼              ▼
      ┌──────────┐     ┌──────────────┐       ┌──────────────┐  ┌──────────┐
      │PostgreSQL│     │    Redis     │       │   AWS S3     │  │  BullMQ  │
      │ Database │     │ (Cache/Queue)│       │ (File Store) │  │ (Worker) │
      └──────────┘     └──────────────┘       └──────────────┘  └──────────┘
```

**Key points:**
- **Monolithic NestJS application** (modular) serves all APIs: tenant admin, customer PWA, platform admin.
- **BullMQ** based on Redis handles async jobs (WhatsApp, push, emails, cron).
- **Database** is a single PostgreSQL cluster with logical separation of platform and tenant schemas.
- **File storage** is S3 for invoices, logos, etc.
- Integrations with external services are abstracted behind service modules.

---

## 3. Architectural Principles & Key Decisions

| Principle | Decision |
|-----------|----------|
| **Modular Monolith First** | A single deployable NestJS application with clear bounded contexts. Easy to develop, test, and later split into microservices if needed. |
| **Hybrid Multi‑Tenancy** | Tenant data is isolated by `organization_id` / `store_id`. Customer data is shared at org level; transactions at store level. No separate databases per tenant. |
| **Event‑Driven Async Processing** | All non‑critical operations (WhatsApp sending, reorder alerts, invoice PDFs) are pushed to BullMQ queues to keep API responses fast. |
| **API Gateway pattern** | All external requests go through an API gateway (initially handled by a single NestJS app with a unified routing layer; future: separate gateway with rate limiting, auth). |
| **Stateless Services** | The API servers are stateless; session/JWT tokens carry all context. This allows horizontal scaling. |
| **Separation of Platform & Tenant** | Platform admin APIs and tenant APIs are in the same app but guarded by distinct middleware. Platform admin UI is served from a separate subdomain. |
| **Security by Design** | RBAC at every request, encrypted secrets, audit trails for all mutations, HTTPS only. |

---

## 4. System Components and Modules (Container View)

### 4.1 NestJS Application Modules

The backend is structured into feature modules, each encapsulating its own logic, entities, services, and controllers.

```text
┌────────────────────────────────────────────────────────┐
│                    NestJS Application                   │
│                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Auth Module  │  │ Org & Store  │  │  User & RBAC │  │
│  │ (JWT, OTP)    │  │ Management   │  │ Module        │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Order Mgmt  │  │ Inventory &   │  │ Appointments  │  │
│  │              │  │ Batch Module  │  │ Module        │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Customer    │  │ WhatsApp &    │  │ Platform Admin│  │
│  │  PWA API     │  │ Notification  │  │ Module        │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │           Shared Services (Mailer, PDF,          │  │
│  │           Audit, File Upload, Feature Flags)     │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

**Key interactions:**
- `Auth Module` issues JWTs for staff (RBAC) and customers (phone OTP). Platform admin uses a separate guard checking the `platform_admins` table.
- `Order Mgmt` emits an `order.status.changed` event that is picked up by `WhatsApp & Notification` module, which queues a job.
- `Inventory & Batch` module handles FIFO logic using database transactions.
- `Platform Admin` module exposes endpoints under `/admin/*` and is only accessible from the admin subdomain/IP range.

### 4.2 Background Workers (BullMQ)

Separate processes (or run as a separate thread in the same container for simplicity) that consume queues:

- `whatsapp-queue`: Send templated messages, upload media.
- `notification-queue`: Web push delivery via VAPID keys.
- `email-queue`: Digest emails for reorder alerts, staff invitations.
- `cron-queue`: Repeatable jobs for daily reorder check, invoice generation, etc.

Workers share the same codebase but instantiate only the necessary modules. They connect to the same Redis and PostgreSQL.

### 4.3 Frontend Applications

- **Admin SPA (React):** Hosted on a CDN. Communicates with backend via REST APIs under `/api/v1`. Contains store‑switcher state, RBAC‑aware routing.
- **Customer PWA (Vue/React):** Lightweight, also on CDN. Uses OTP auth, service worker for offline caching and push notifications.
- **Platform Admin SPA (React):** Served under a separate subdomain (`admin.tailonix.com`). Strictly separated; only accessible with platform admin JWT.

### 4.4 Database Layer

- **PostgreSQL 15** – primary transactional database. All tables reside in a single database, using UUIDs and RLS for logical isolation (optional).
- **Redis 7** – used for:
  - BullMQ job queue backend
  - Feature flag cache per organization (TTL 5 min)
  - Rate limiting counters
  - Session store (if needed)
  - Temporary OTP storage (with expiry)
- **AWS S3** – object storage for generated invoices, logos, batch labels, measurement photos. Pre‑signed URLs for direct upload from clients.

### 4.5 External Integrations (Service Modules)

Each integration is encapsulated in a dedicated module with interfaces to allow easy swapping.

| Integration | Protocol | Purpose |
|-------------|----------|---------|
| **WhatsApp Cloud API** | REST + Webhooks | Send order updates, invoices. Receive delivery receipts. |
| **Stripe** | REST + Webhooks | Manage subscriptions, handle payments. |
| **Email (AWS SES)** | SMTP / API | Send invitations, digest alerts. |
| **SMS (Twilio)** | REST | Fallback for OTP and notifications. |
| **Push Notifications** | Web Push API | Send in‑browser push to customers via service worker. |

---

## 5. Data Architecture

### 5.1 Database Schema Design (Logical View)

The schema is divided into three logical groups:

1. **Platform Layer**: `platform_admins`, `subscription_plans`, `organization_subscriptions`. This data is only accessible via Platform Admin APIs.
2. **Organization Layer**: `organizations`, `stores`, `users`, `user_store_roles`, `customers`, `suppliers`. Customers are shared within an org, but transactional data is scoped per store.
3. **Transactional Data**: `orders`, `inventory_batches`, `inventory_movements`, `appointments`, `inventory_restock_alerts`. These always carry `store_id` and `organization_id`.

**Data Isolation Strategy:**
- All queries for transactional data include `WHERE store_id = :currentStoreId`.
- The `currentStoreId` is extracted from the JWT or the `X-Store-Id` header, validated against the user’s assignments in `user_store_roles`.
- For HQ/Regional dashboards, aggregation queries bypass the store filter but still restrict to the user’s authorized stores.

### 5.2 Caching Strategy

- **Feature Flags**: When a tenant’s subscription or feature overrides change, an event is emitted to invalidate the Redis cache for that org. Otherwise, features are cached for 5 minutes.
- **Reorder Settings**: Frequently read, rarely written – cached per store with TTL 15 minutes.
- **OTP Codes**: Stored in Redis with TTL 5 minutes (hashed). Key: `otp:{phoneNumber}`.

### 5.3 File Storage

- All user‑generated files (logos, invoice PDFs) are stored in S3.
- A separate bucket per environment (dev/staging/prod).
- Access: private by default; pre‑signed URLs generated when needed (e.g., temporary download link for invoice).
- Invoice PDFs are generated on the server (using PDFKit) and then streamed to S3; WhatsApp media uploads use the S3 URL (or we upload the buffer directly to WhatsApp API and then discard).

---

## 6. Integration Architecture

### 6.1 WhatsApp Integration Flow

```
Order Status Change
       │
       v
API emits event: 'order.status.changed'
       │
       v
Notification Service (module) publishes job to BullMQ 'whatsapp' queue
       │
       v
Worker picks job:
  - Resolves customer phone & consent
  - Loads store's WhatsApp phone number ID and access token (decrypted)
  - Fetches message template and fills variables
  - Calls POST /{phone-number-id}/messages (Meta API)
  - Stores log in whatsapp_messages table
       │
       v
(Asynchronously) WhatsApp delivers message, sends webhook to our endpoint
       │
       v
Webhook handler updates status (delivered/read/failed) in whatsapp_messages
```

### 6.2 Stripe Integration Flow

- Subscription creation: When a tenant signs up (self‑service or manual), the platform admin creates a Stripe Checkout session, or uses the Stripe API directly. The `organization_subscriptions` record stores the `stripe_subscription_id`.
- Webhook events (e.g., `invoice.paid`, `customer.subscription.updated`) update the subscription status and period in our DB.
- Billing portal: Stripe Customer Portal is embedded for self‑service plan changes; webhooks sync the changes.

### 6.3 Web Push Integration

- Customer PWA registers a service worker and subscribes to push using VAPID public key. The subscription object is sent to `POST /customer/devices`.
- On notification event, the worker uses `web-push` library to send to all registered devices of the customer.

---

## 7. Security Architecture

### 7.1 Authentication & Authorization

- **Tenant Staff:**  
  - Login with email/password → JWT (access token 1h, refresh token 7d, stored in httpOnly cookie or secure storage).  
  - JWT payload: `{ sub: userId, org_id }`.  
  - For store‑scoped APIs, the middleware fetches the user’s roles from `user_store_roles` for the given `X-Store-Id` header. Effective permissions are computed (role defaults + JSONB overrides).  
  - If the required permission is missing → 403.

- **Customer (PWA):**  
  - Phone + OTP → short‑lived JWT (15 min) with `{ sub: customerId, org_id }`.  
  - Rate limited to 3 OTP requests per 15 min per phone.  
  - Refresh via rotating refresh token.

- **Platform Admin:**  
  - Login with separate credentials (email/password + optional 2FA). JWT includes `platform_admin: true` and `admin_level`.  
  - Middleware validates against `platform_admins` table; access to tenant data is blocked unless impersonating.

### 7.2 Data Protection

- All data in transit: TLS 1.3, HSTS.
- Secrets (WhatsApp tokens, DB passwords, Stripe keys) stored in environment variables or a vault (AWS Secrets Manager); encrypted at rest in the vault.
- Customer PII (phone numbers) hashed with bcrypt for OTP storage, and stored encrypted (AES‑256) in the database for long‑term.
- Database encryption at rest (enabled on RDS).

### 7.3 Network Security

- The application is deployed behind a load balancer / API gateway. Only the gateway is exposed to the internet; all other services (DB, Redis, workers) are in a private subnet.
- Admin subdomain (`admin.tailonix.com`) may be additionally restricted by IP whitelist (corporate VPN).

### 7.4 Impersonation & Audit

- Impersonation by platform support generates a time‑limited JWT (30 min) scoped to a specific tenant’s HQ Admin. The impersonation event is logged with the support agent’s identity.
- All mutations (order status, inventory movements, role changes, plan changes) write to an `audit_logs` table with actor, old and new values, timestamp.

---

## 8. Deployment Architecture

### 8.1 Environments

| Environment | Purpose | Infrastructure |
|-------------|---------|----------------|
| **Development** | Local Docker Compose, hot reload | Developer machines |
| **Staging** | Pre‑production testing | Kubernetes cluster (small nodes) |
| **Production** | Live environment | Kubernetes cluster (HA, multi‑AZ) |

### 8.2 Containerization & Orchestration

- Each component (NestJS API, Worker, Frontends) is built as a Docker image.
- Kubernetes manifests define Deployments, Services, Ingress.
- Horizontal Pod Autoscaler (HPA) on API pods based on CPU/memory.
- Database: Managed PostgreSQL (AWS RDS) with read replicas for reporting queries (optional initially).
- Redis: AWS ElastiCache (or self‑managed) with replication and automatic failover.

### 8.3 CI/CD Pipeline (GitHub Actions)

1. **Code push** → run lint, unit tests, build Docker image.
2. **Merge to main** → deploy to staging automatically.
3. **Manual promotion** → canary deployment to production (e.g., 10% traffic), then full rollout.
4. Database migrations run as a Kubernetes Job before the new API pods are started.

---

## 9. High Availability & Disaster Recovery

### 9.1 Availability Targets
- Core APIs (tenant admin & PWA): 99.9% uptime (monthly).
- Background workers: 99.5% (delay tolerance).

### 9.2 Redundancy
- API pods run across multiple availability zones (AZ).
- PostgreSQL Multi‑AZ deployment with automated backups (point‑in‑time recovery).
- Redis cluster with replicas.

### 9.3 Disaster Recovery
- Database: Daily automated snapshots (retained 30 days) + continuous transaction logs to S3 for PITR.
- S3 buckets: versioning enabled.
- Infrastructure as Code (Terraform) to recreate the entire environment in another region within hours.
- RTO (Recovery Time Objective): < 4 hours; RPO (Recovery Point Objective): < 1 hour for transactional data.

---

## 10. Performance & Scalability Design

### 10.1 Scaling Strategies
- **Stateless API:** Scale horizontally by adding pods.
- **Read‑heavy reporting:** Offload to read replicas; consider materialized views for HQ dashboard aggregations.
- **Caching:** Redis caching for frequently accessed data (features, plans, store settings).
- **Queue‑based async:** All external communications and heavy processing moved to BullMQ, isolating API response times.

### 10.2 Performance Benchmarks (Targets)
- HQ Dashboard (100 stores) aggregation: < 2 seconds at p95.
- Order creation with FIFO batch selection: < 500 ms.
- WhatsApp notification send (from status change to API call): < 10 seconds.
- PWA initial load on 3G: < 3 seconds.

### 10.3 Load Testing
- k6 scripts will simulate peak traffic (2000 concurrent customers, 500 staff) before launch. Auto‑scaling thresholds will be tuned accordingly.

---

## 11. Observability & Monitoring Architecture

### 11.1 Logging
- All applications output structured JSON logs to stdout.
- Logs are collected by Fluentd/CloudWatch and indexed in Elasticsearch (ELK stack) or CloudWatch Logs Insights.
- Each log entry contains `traceId` for correlation (future: OpenTelemetry).

### 11.2 Metrics & Dashboards
- **Prometheus** scrapes metrics from the NestJS app (using `prom-client`) and BullMQ.
- **Grafana** dashboards for:
  - API request rates, latencies, error rates
  - Queue sizes and processing times
  - WhatsApp API delivery success/failure
  - Database connection pool usage
  - Redis cache hit ratio

### 11.3 Alerting
- Critical alerts (PagerDuty): 5xx error rate > 1%, DB connection pool exhaustion, queue backlog > 1000.
- Warning alerts (Slack/email): WhatsApp failure rate > 5%, high API latency p95 > 1s, low disk space.

---

## 12. Technology Stack Justification

| Technology | Why Chosen |
|------------|------------|
| **NestJS** | Mature, opinionated, TypeScript, modular architecture, built‑in support for guards, pipes, queues. Easy to refactor into microservices later. |
| **PostgreSQL** | Robust, supports advanced features (JSONB, window functions, materialized views), excellent multi‑tenancy support with row‑level security. |
| **Redis** | Fast in‑memory store for caching, rate limiting, and as a job queue backend (BullMQ). Battle‑tested. |
| **BullMQ** | Reliable, feature‑rich Node.js queue based on Redis, supports repeatable jobs, delayed jobs, and concurrency. |
| **React** | Rich ecosystem, strong TypeScript support, component libraries (Ant Design), good for admin dashboards. |
| **Vue (for PWA)** | Lightweight, excellent performance, easier to build a minimal PWA, but React is also acceptable. The architecture does not mandate one; we pick based on team skills. |
| **Docker/Kubernetes** | Industry standard for container orchestration, enables seamless scaling and deployment strategies. |
| **Stripe** | Leader in subscription billing, extensive APIs and webhooks, easy to integrate. |
| **WhatsApp Cloud API** | Direct Meta integration, no additional markup per message, native Gulf‑region reach. |

---

## 13. Appendix: Detailed Component Diagram (Textual Description)

```text
[Customer Browser]
    |
    | (HTTPS)
    v
[CloudFront CDN]  (static assets: PWA, admin SPA)
    |
    v
[Application Load Balancer]
    |
    | (path-based routing: /api/* -> NestJS; default -> CDN)
    v
[NestJS Pods] (replica set)
    |
    |--- connects to: PostgreSQL, Redis (cache & queue)
    |
    |--- calls: WhatsApp API, Stripe API, SES, Twilio
    |
[BullMQ Worker Pods] (separate replica set, same image different command)
    |
    |--- consumes: whatsapp-queue, notification-queue, email-queue, cron-queue
    |
[Redis Cluster] (ElastiCache)  <---> BullMQ UI (optional dashboard)
[PostgreSQL Multi-AZ] (RDS) <---> Read Replica (for reporting queries)
[S3 Bucket] (invoices, logos)
```

---

**This Technical Architecture Document provides the comprehensive blueprint for building and deploying Tailonix. All subsequent design and implementation work should align with these architectural principles and specifications.**