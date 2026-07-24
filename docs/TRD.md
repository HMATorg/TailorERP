Here is the complete Technical Requirements Document (TRD) for the entire Tailonix platform—covering every technical decision, architecture, schema, API, integration, and operational detail necessary for your engineering team to build the product as specified.

---

# Technical Requirements Document  
**Product:** Tailonix – Complete Enterprise Platform  
**Version:** 3.0  
**Author:** Lead Product Designer & Full‑Stack Production Engineer  
**Date:** July 24, 2026  
**Status:** Final for Engineering Hand‑off  

---

## Table of Contents
1. [System Architecture](#1-system-architecture)
2. [Technology Stack](#2-technology-stack)
3. [Database Design & Schema](#3-database-design--schema)
4. [API Specification](#4-api-specification)
5. [Business Logic & Algorithms](#5-business-logic--algorithms)
6. [Frontend Architecture](#6-frontend-architecture)
7. [Security Design](#7-security-design)
8. [Integrations](#8-integrations)
9. [Performance & Scalability](#9-performance--scalability)
10. [Deployment & Infrastructure](#10-deployment--infrastructure)
11. [Monitoring & Observability](#11-monitoring--observability)
12. [Testing & Quality Gates](#12-testing--quality-gates)

---

## 1. System Architecture

### 1.1 High‑Level Diagram

```
[Client Browser / PWA]
       |
       | HTTPS
       v
[CDN (Static Assets)]
       |
       v
[Load Balancer / API Gateway]
       |
       v
[Web Application (Node.js / NestJS)]
       |            |            |
       |            |            |
[PostgreSQL]   [Redis]    [BullMQ (Queue)]
       |            |            |
       |            |            |
 [S3 / Blob]   [WhatsApp API]  [Stripe API]
```

- **Frontends:** React admin dashboard, Vue‑based PWA (or React PWA), separate React app for Platform Admin.
- **Backend:** Monolithic NestJS application (modular) initially; can be split into microservices later. Serves both tenant and platform admin APIs.
- **Queue System:** BullMQ backed by Redis for background jobs: WhatsApp sending, push notifications, cron jobs (reorder alerts), email digests.
- **Caching:** Redis for feature flags, session data, rate limiting, and hot tenant configuration.
- **File Storage:** AWS S3 (or compatible) for invoice PDFs, organization logos, measurement images.
- **Database:** PostgreSQL 15 with read replicas for heavy reporting queries.

### 1.2 Multi‑Tenancy Model

**Hybrid Tenancy (Organization‑level + Store‑level):**

- **Organization:** Shared customer profiles, supplier master, global fabric catalog.
- **Store:** Transactional data (orders, inventory batches, appointments, movements) isolated by `store_id`.
- **Data Isolation:** Every query for store‑scoped resources **must** include `store_id` and validate against the user’s assigned stores via `user_store_roles`. Cross‑store aggregated endpoints explicitly use `organization_id` and bypass per‑store checks only for HQ/Regional roles.

**Platform admin data** resides in a completely separate set of tables (`platform_admins`, `subscription_plans`, `organization_subscriptions`) and is never exposed to tenant APIs.

---

## 2. Technology Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| **Backend Framework** | Node.js + NestJS (TypeScript) | Modular monolith, easy to break out later |
| **Database** | PostgreSQL 15 | Primary datastore |
| **Cache** | Redis 7 | BullMQ backend, feature flag cache, rate limiting |
| **Queue** | BullMQ | WhatsApp sending, push notifications, cron jobs |
| **File Storage** | AWS S3 / MinIO | Invoices, logos, static assets |
| **Admin Frontend** | React 18 + TypeScript, Redux Toolkit / Zustand | Ant Design Pro (supports RTL) |
| **PWA Frontend** | Vue 3 + Vite (or React) + Workbox | Lightweight, offline support |
| **Platform Admin** | React 18 + TypeScript, same design system | Isolated route tree or subdomain |
| **Push Notifications** | Web Push API (VAPID) | Service worker in PWA |
| **WhatsApp** | Meta WhatsApp Business Cloud API | Direct REST integration |
| **Payments** | Stripe | Subscription billing |
| **CI/CD** | GitHub Actions | Docker build, test, deploy |
| **Container Orchestration** | Kubernetes (or Docker Compose initially) | Horizontal scaling |
| **Monitoring** | Sentry, Prometheus + Grafana, ELK | Errors, metrics, logs |

---

## 3. Database Design & Schema

All tables use UUID primary keys generated via `gen_random_uuid()`. Timestamps default to `NOW()`.

### 3.1 Organization & Stores

```sql
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    logo_url TEXT,
    tax_id VARCHAR(100),
    default_currency VARCHAR(10) DEFAULT 'SAR',
    timezone VARCHAR(50) DEFAULT 'Asia/Riyadh',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    phone VARCHAR(50),
    email VARCHAR(255),
    is_headquarters BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'active',
    whatsapp_phone_number_id VARCHAR(50),
    whatsapp_access_token_encrypted TEXT,
    operating_hours JSONB DEFAULT '{}', -- e.g. {"mon":{"open":"09:00","close":"18:00"}}
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### 3.2 Users & Roles (Tenant)

```sql
-- Core users table (shared between tenants, but scoped by organization via user_store_roles)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    phone VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE user_store_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL, -- 'hq_admin','regional_manager','store_manager','tailor','cashier'
    permissions JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(user_id, store_id)
);
```

### 3.3 Customers & Appointments

```sql
ALTER TABLE customers ADD COLUMN organization_id UUID REFERENCES organizations(id);
ALTER TABLE customers ADD COLUMN preferred_store_id UUID REFERENCES stores(id);
ALTER TABLE customers ADD COLUMN whatsapp_consent BOOLEAN DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN whatsapp_phone VARCHAR(20);

CREATE TABLE customer_store_visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    store_id UUID NOT NULL REFERENCES stores(id),
    last_visit_date TIMESTAMP DEFAULT NOW(),
    notes TEXT
);

CREATE TABLE customer_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    device_token TEXT NOT NULL,
    platform VARCHAR(20), -- 'web','android','ios'
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    store_id UUID NOT NULL REFERENCES stores(id),
    assigned_tailor_id UUID REFERENCES users(id),
    appointment_type VARCHAR(50) NOT NULL, -- 'measurement','first_fitting','final_fitting','pickup'
    scheduled_at TIMESTAMP NOT NULL,
    duration_minutes INTEGER DEFAULT 30,
    status VARCHAR(20) DEFAULT 'scheduled',
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### 3.4 Inventory & Suppliers

```sql
CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    payment_terms VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE inventory_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id),
    supplier_id UUID REFERENCES suppliers(id),
    fabric_name VARCHAR(255) NOT NULL,
    fabric_code VARCHAR(100),
    batch_code VARCHAR(100) UNIQUE NOT NULL,
    color VARCHAR(50),
    unit VARCHAR(20) DEFAULT 'meter',
    initial_quantity DECIMAL(12,2) NOT NULL,
    current_quantity DECIMAL(12,2) NOT NULL,
    cost_price_per_unit DECIMAL(12,2) NOT NULL,
    selling_price_per_unit DECIMAL(12,2),
    purchase_date DATE NOT NULL,
    expiry_date DATE,
    storage_location VARCHAR(100),
    status VARCHAR(20) DEFAULT 'available', -- 'available','depleted','quarantined'
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES inventory_batches(id),
    order_id UUID REFERENCES orders(id),
    movement_type VARCHAR(20) NOT NULL, -- 'purchase_in','order_out','transfer_out','transfer_in','adjustment','return_in'
    quantity DECIMAL(12,2) NOT NULL,
    previous_balance DECIMAL(12,2) NOT NULL,
    new_balance DECIMAL(12,2) NOT NULL,
    reference_document VARCHAR(255),
    note TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE inventory_reorder_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id),
    fabric_name VARCHAR(255) NOT NULL,
    min_threshold DECIMAL(12,2) NOT NULL,
    max_threshold DECIMAL(12,2),
    lead_time_days INTEGER DEFAULT 7
);

CREATE TABLE inventory_restock_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id),
    fabric_name VARCHAR(255) NOT NULL,
    current_qty DECIMAL(12,2),
    threshold_qty DECIMAL(12,2),
    suggested_order_qty DECIMAL(12,2),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP,
    resolved_by UUID REFERENCES users(id)
);
```

### 3.5 WhatsApp Messaging

```sql
CREATE TABLE whatsapp_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    language VARCHAR(10) NOT NULL,
    category VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    header_type VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    store_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    message_type VARCHAR(30) NOT NULL,
    reference_id UUID,
    wa_message_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'queued',
    payload JSONB,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### 3.6 Platform Administration

```sql
CREATE TABLE platform_admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
    admin_level VARCHAR(20) DEFAULT 'operator', -- 'super_admin','billing','support'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE subscription_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    max_stores INTEGER DEFAULT 1,
    max_users INTEGER DEFAULT 10,
    features JSONB DEFAULT '[]',
    monthly_price DECIMAL(10,2),
    yearly_price DECIMAL(10,2),
    is_public BOOLEAN DEFAULT TRUE
);

CREATE TABLE organization_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) UNIQUE,
    plan_id UUID NOT NULL REFERENCES subscription_plans(id),
    status VARCHAR(20) DEFAULT 'active',
    trial_ends_at TIMESTAMP,
    current_period_start TIMESTAMP NOT NULL,
    current_period_end TIMESTAMP NOT NULL,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    stripe_subscription_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);
```

### 3.7 Audit Logs (Shared)

An existing `audit_logs` table extended with `store_id`, `organization_id`, `action`, `old_value`, `new_value`. All sensitive operations (order status changes, inventory transfers, role changes) must write to this table.

---

## 4. API Specification

### 4.1 Authentication & Authorization

- **Tenant Staff:** Bearer JWT (access token 1h, refresh token 7d). JWT payload: `{ sub: user_id, org_id, store_id? }`.  
  RBAC: Middleware decodes token, loads `user_store_roles` for the requested `X-Store-Id` header (or default store), computes effective permissions (role defaults merged with JSONB overrides). If required permission missing → 403.
- **Customer PWA:** Phone + OTP → JWT (15 min). Rate limit OTP: 3 req/15 min/phone. Refresh via rotating refresh token.
- **Platform Admin:** Separate JWT with a `platform_admin` claim. Validated against `platform_admins` table.

### 4.2 API Endpoints (Categorized)

#### Tenant Admin API (prefix `/api/v1`)

| Group | Method | Endpoint | Auth | Description |
|-------|--------|----------|------|-------------|
| **Stores** | GET | `/stores` | Staff | List stores accessible by current user |
| | POST | `/stores` | HQ Admin | Create a new store |
| | PUT | `/stores/{id}/transfer` | HQ Admin | Transfer inventory between stores |
| **Dashboard** | GET | `/dashboard/hq` | HQ/Regional | Aggregated KPIs across allowed stores |
| | GET | `/dashboard/store` | Store+ | Single store KPIs |
| **Inventory Batches** | POST | `/inventory/batches` | Store Manager+ | Add batch (purchase) |
| | GET | `/inventory/batches` | Store Manager+ | List/search batches |
| | GET | `/inventory/batches/{id}/movements` | Store Manager+ | Audit trail |
| | POST | `/inventory/transfer` | HQ Admin | Inter‑store stock move |
| | GET | `/inventory/alerts` | Store Manager | Pending restock alerts |
| | PUT | `/inventory/alerts/{id}/resolve` | Store Manager | Resolve alert |
| **Suppliers** | CRUD | `/suppliers` | HQ Admin | Manage supplier list |
| **Orders** | POST | `/orders` | Staff | Create order (with batch selection) |
| | PUT | `/orders/{id}/status` | Tailor+ | Update order status → triggers notification |
| **User Management** | POST | `/users/invite` | HQ Admin | Invite staff to store(s) |
| | GET | `/users` | HQ Admin | List staff and their roles |
| | PUT | `/users/{id}/roles` | HQ Admin | Update roles/permissions |

#### Customer PWA API (prefix `/api/v1/customer`)

| Group | Method | Endpoint | Auth | Description |
|-------|--------|----------|------|-------------|
| **Auth** | POST | `/auth/otp` | None | Request OTP |
| | POST | `/auth/verify` | None | Verify OTP → tokens |
| | POST | `/auth/refresh` | Refresh | Rotate access token |
| **Orders** | GET | `/orders` | JWT | Customer’s orders |
| | GET | `/orders/{id}` | JWT | Detailed order timeline |
| **Appointments** | GET | `/appointments` | JWT | My appointments |
| | POST | `/appointments` | JWT | Book appointment |
| | PUT | `/appointments/{id}` | JWT | Reschedule/cancel |
| **Measurements** | GET | `/measurements` | JWT | View measurement history |
| **Devices** | POST | `/devices` | JWT | Register push token |

#### Platform Admin API (prefix `/api/v1/admin`, subdomain `admin.tailonix.com`)

| Group | Method | Endpoint | Auth | Description |
|-------|--------|----------|------|-------------|
| **Organizations** | GET | `/organizations` | Super Admin/Billing | List all tenants |
| | POST | `/organizations` | Super Admin | Create tenant (manual) |
| | PUT | `/organizations/{id}` | Super Admin | Update/suspend tenant |
| **Subscriptions** | GET | `/organizations/{id}/subscription` | Super Admin/Billing | Get subscription details |
| | PUT | `/organizations/{id}/subscription` | Super Admin/Billing | Change plan, renew, cancel |
| **Plans** | CRUD | `/plans` | Super Admin | Manage subscription plans |
| **Impersonation** | POST | `/organizations/{id}/impersonate` | Support | Generate time‑limited JWT for HQ Admin view |
| **Audit** | GET | `/audit-logs` | Super Admin | Platform‑wide audit log view |

All endpoints require HTTPS. Input validation via class‑validator / Zod. Responses follow JSON:API or a consistent envelope `{ data, meta, errors }`.

---

## 5. Business Logic & Algorithms

### 5.1 FIFO Batch Consumption

When an order requires `X` units of a fabric:

1. Query `inventory_batches` for the store, fabric_name (or fabric_code), `status = 'available'`, order by `purchase_date ASC`.
2. Iterate batches, subtract from `current_quantity`, record movements (`order_out`). If a batch is depleted, set `status = 'depleted'`.
3. If total available < X, return 422 with available quantity.
4. Wrap in a database transaction; acquire row locks (`SELECT ... FOR UPDATE`) on batches to prevent race conditions.

### 5.2 Inter‑Store Transfer

1. Validate source/destination belong to same organization.
2. Source batch: decrement, create `transfer_out` movement.
3. Destination: If a batch with same `fabric_name`, `color`, `batch_code` exists, increment its `current_quantity`. Otherwise, create a new batch with `movement_type = 'transfer_in'` in movements.
4. Atomic transaction.

### 5.3 Appointment Slot Availability

- Get store operating hours from `stores.operating_hours`.
- Query overlapping appointments for the same store and (optionally) tailor where `status IN ('scheduled','confirmed','in_progress')` and time range overlaps.
- A slot is available if no overlap and within operating hours.
- Appointment duration is configurable per type (default 30 min).

### 5.4 Auto‑Reorder Cron Job

- BullMQ repeatable job, cron expression: `0 8 * * *` (runs 8 AM store local time; job fetches stores whose current local time matches 8 AM based on `organizations.timezone`).
- For each store, join `inventory_batches` with `inventory_reorder_settings` on fabric_name and store_id where `current_quantity <= min_threshold`.
- For each match, insert `inventory_restock_alerts` with `suggested_order_qty = max_threshold - current_quantity`.
- Aggregate alerts per store and send email digest + in‑app notification.

### 5.5 WhatsApp Notification Trigger

When order status changes:

1. Worker picks up event from BullMQ (pushed by API after status update).
2. Retrieves customer’s phone, consent, store’s WhatsApp credentials, and appropriate template.
3. Calls WhatsApp Cloud API `POST /{phone-number-id}/messages` with template.
4. Logs message in `whatsapp_messages` with `wa_message_id` and status `sent`.
5. Webhook endpoint receives delivery/read receipts and updates the log.
6. If API call fails, fallback to push notification (via `web-push` to customer devices) or SMS.

For invoice sending:
- Generate PDF using PDFKit/Laika, upload to S3, get URL.
- Send document message via WhatsApp: upload media to WhatsApp API, then send document message referencing the media ID.

---

## 6. Frontend Architecture

### 6.1 Admin Dashboard (React)

- **State Management:** Zustand store holds current user, active store (from switcher), permissions.
- **API Layer:** Axios instance with interceptors; attaches `Authorization` header and `X-Store-Id`.
- **Routing:** React Router, protected routes with permission checks.
- **Component Library:** Ant Design (configures RTL easily via `ConfigProvider`).
- **Store Switcher:** On change, resets all store‑scoped data and refetches.
- **Build:** Vite, bundled as a SPA, served via CDN.

### 6.2 Client PWA (Vue 3 or React)

- **Framework:** Vue 3 + Pinia (or React + Zustand) for minimal overhead.
- **Service Worker:** Workbox with strategies: static assets (cache first), API (network first with offline fallback showing cached last data).
- **Install Prompt:** Custom banner after 2nd visit, using `beforeinstallprompt`.
- **Push Notifications:** Uses Web Push API; subscription object stored in `customer_devices`. Background sync for offline booking (future).
- **RTL:** CSS logical properties, dynamic `dir` attribute.

### 6.3 Platform Admin (React)

- Separate SPA deployed to `admin.tailonix.com` (or a protected `/admin` route with IP whitelisting).
- Authenticated with platform admin JWT; checks `platform_admins` table on every request.

---

## 7. Security Design

- **Transport:** TLS 1.3 only. HSTS enabled.
- **JWT:** Signed with RS256; short expiry (1h access, 7d refresh). Refresh tokens stored in httpOnly cookie or encrypted local storage. Customer JWTs 15 min.
- **RBAC:** Enforced server‑side; permission checks on every API call.
- **Input Validation:** Every endpoint validates with Zod/class‑validator. SQL injection prevented via parameterized queries (TypeORM/Prisma).
- **Rate Limiting:** 100 req/min public, 1000 req/min authenticated. OTP limited to 3 per 15 min.
- **WhatsApp Tokens:** Encrypted at rest using AES‑256‑GCM (key in vault).
- **Impersonation:** Time‑limited JWT (max 30 min), all actions logged with impersonator identity.
- **Audit:** All mutations (orders, inventory, roles) logged.
- **Penetration Testing:** Mandatory before production release.

---

## 8. Integrations

### 8.1 WhatsApp Business Cloud API

- **Setup:** WABA registered with Meta. Each store has its own phone number ID and access token.
- **Sending:** REST call to `https://graph.facebook.com/v18.0/{phone-number-id}/messages`. Use pre‑approved templates.
- **Webhooks:** Subscribe to `messages` events for delivery/read receipts. Endpoint: `POST /webhooks/whatsapp`. Verify signature via `x-hub-signature-256`.

### 8.2 Stripe (Subscriptions)

- **Checkout:** Use Stripe Checkout or custom UI to create subscriptions. Webhook endpoint `POST /webhooks/stripe` handles `invoice.paid`, `customer.subscription.updated`, etc.
- **Sync:** Webhook updates `organization_subscriptions` status and period.
- **Billing Portal:** Stripe Customer Portal for self‑service plan changes.

### 8.3 Email & SMS Providers

- **Email:** AWS SES or SendGrid for digests and invitations.
- **SMS:** Fallback for notifications; integrate with Twilio or local Gulf SMS gateway.

---

## 9. Performance & Scalability

- **Database Indexes:**
  - `inventory_batches`: composite (`store_id`, `fabric_name`, `purchase_date`, `status`) for FIFO queries.
  - `user_store_roles`: (`user_id`, `store_id`, `is_active`).
  - `appointments`: (`store_id`, `assigned_tailor_id`, `scheduled_at`).
  - `orders`: (`store_id`, `customer_id`, `created_at`).
- **Caching:** Redis caches: enabled features per org (TTL 5 min), subscription plans, frequent store settings.
- **API Response Times:** Aggregated dashboard queries use materialized views refreshed periodically (cron) if raw query >2s.
- **Horizontal Scaling:** Stateless NestJS containers behind load balancer. BullMQ workers can scale independently.
- **CDN:** CloudFront for static assets and PWA.

---

## 10. Deployment & Infrastructure

- **Containerization:** Docker images for API, workers, and frontend.
- **Orchestration:** Kubernetes (production) / Docker Compose (staging). Use namespaces for environment isolation.
- **CI/CD:** GitHub Actions builds Docker images, runs tests, deploys to staging; manual promotion to production with canary releases.
- **Database Migrations:** Run via Prisma/TypeORM migration tool during deployment; backwards‑compatible (additive first, destructive later).

---

## 11. Monitoring & Observability

- **Logging:** Structured JSON logs to stdout, collected by ELK or CloudWatch.
- **Metrics:** Prometheus + Grafana dashboards: request rates, latencies, error rates, BullMQ queue sizes, WhatsApp delivery success rate.
- **Alerts:** PagerDuty on: 5xx error rate >1%, queue backlog >1000, WhatsApp delivery failure >5%.
- **Tracing:** OpenTelemetry (future) for distributed traces across API and workers.

---

## 12. Testing & Quality Gates

- **Unit Tests:** Jest, coverage target 80%+ on business logic (FIFO, appointment availability, permissions merging).
- **Integration Tests:** Supertest on API endpoints, test database rollback. All critical user stories covered.
- **E2E:** Cypress for admin flows (store switch, transfer, batch consumption) and PWA flows (booking, tracking). Run on CI.
- **Performance Tests:** k6 load tests simulating 500 concurrent staff and 2000 PWA users. Benchmark: p95 < 2s for dashboard aggregation.
- **Security:** OWASP ZAP automated scan, manual RBAC penetration test.
- **Gate:** PR merged only if unit/integration tests pass, no new vulnerabilities, and linting succeeds.

---

**End of Document**  
This TRD is now the engineering blueprint for Tailonix. Implementation may commence immediately.