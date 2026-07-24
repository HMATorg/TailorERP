Here is the complete, finalised Product Requirements Document (PRD) for the full Tailonix platform—covering the tenant-facing enterprise features and the internal SaaS management system. It is written for a cross‑functional team of engineers, designers, and business stakeholders.

---

# Product Requirements Document  
**Product:** Tailonix – Complete Enterprise Platform  
**Version:** 3.0 (Enterprise + Platform Administration)  
**Author:** Lead Product Designer & Full‑Stack Production Engineer  
**Date:** July 24, 2026  
**Status:** Approved for Implementation  

---

## 1. Executive Summary

Tailonix is evolving from a single‑store tailoring order manager into a **full‑stack retail operating system** for tailoring chains and franchises across the Gulf region. This PRD defines two integrated product areas:

1. **Tailonix Enterprise** (tenant‑facing)  
   - Multi‑store management with hierarchical roles  
   - Customer self‑service PWA with WhatsApp messaging  
   - Batch‑tracked inventory with automated reorder alerts  

2. **Tailonix Platform** (SaaS provider‑facing)  
   - Tenant lifecycle and subscription management  
   - Role‑based access for Tailonix internal teams (Super Admin, Billing, Support)  
   - Licensing enforcement and feature gating  

**Goal:** Increase ARPU, reduce operational churn for large tailoring businesses, and cement Tailonix as the market leader through a seamless digital experience.

---

## 2. Product Vision & Strategy

- **For tailoring chains:** A single, unified dashboard to run multiple branches, track every fabric roll, and keep end customers engaged via WhatsApp and a mobile web portal—without any IT overhead.  
- **For Tailonix (the SaaS provider):** A backend platform to manage tenants, plans, and billing while maintaining data isolation and security.

**Core differentiators:**  
- Hybrid multi‑tenant architecture that shares customer profiles but isolates transactional data.  
- Native WhatsApp integration for order updates and invoices, leveraging Gulf‑region messaging dominance.  
- Granular permission system that maps exactly to real tailoring shop hierarchies (owner, regional manager, branch manager, tailor, cashier).

---

## 3. Target Personas

### A. Tenant‑Side (Tailoring Chain)

| Persona | Role | Key Needs |
|---------|------|-----------|
| **HQ Admin (Owner)** | Chain owner or top manager | View aggregated metrics across all branches, create new stores, assign staff roles, transfer stock, access master reports. |
| **Regional Manager** | Area supervisor | Monitor a cluster of stores, view comparative analytics, approve inter‑store transfers for their region. |
| **Store Manager** | Single branch manager | Manage daily orders, local inventory, appointments, reorder alerts. Must see only their store’s data. |
| **Tailor** | Production staff | Update order status, select fabric batches (FIFO), view customer measurements. |
| **Cashier** | Front‑desk staff | Process payments, create walk‑in orders, handle checkout. No inventory or production access. |
| **End Customer** | Clothing client | Track orders, book appointments, view measurements, receive WhatsApp notifications and invoices. |

### B. Platform‑Side (Tailonix Internal)

| Persona | Role | Key Needs |
|---------|------|-----------|
| **Platform Super Admin** | Tailonix CTO / Lead Engineer | Full system access: manage tenants, subscription plans, feature flags, global config, impersonate tenants for support. |
| **Billing Specialist** | Finance operations | View/manage subscriptions, invoices, payment history; handle plan upgrades/downgrades. |
| **Support Agent** | Customer support | Look up tenant details, impersonate HQ Admins (with audit trail), troubleshoot issues. |

---

## 4. Functional Requirements

### 4.1 Multi‑Store Unified Management

**User Stories:**
- **HQ‑1:** As HQ Admin, I can view a dashboard that shows aggregated revenue, order count, and top‑selling items for all stores, with the ability to filter by date range.
- **HQ‑2:** As HQ Admin, I can create new stores under my organization, providing name, address, phone, and whether it is a headquarter.
- **HQ‑3:** As HQ Admin, I can transfer fabric inventory (batches) from one store to another, with the system automatically adjusting stock levels at both ends.
- **HQ‑4:** As HQ Admin, I can invite staff to any store and assign them a role (Store Manager, Tailor, etc.) via a Team Management page.
- **SM‑1:** As Store Manager, I log in and see only my store’s data (orders, appointments, inventory); other stores are inaccessible.
- **RM‑1:** As Regional Manager, I see an aggregated view of my assigned stores’ performance, but I cannot access stores outside my region.

**Key Requirements:**
- All store‑scoped data (orders, inventory, appointments) must be isolated by `store_id`.
- A store switcher in the admin UI allows HQ/Regional users to change the context of the entire dashboard.
- The “Team Management” interface allows HQ Admins to assign one user to multiple stores with potentially different roles (e.g., Regional Manager across 5 stores).

### 4.2 Client Mini‑Program (PWA)

**User Stories:**
- **C‑1:** As a customer, I scan a QR code on my receipt and am taken directly to my order tracking page without installing an app.
- **C‑2:** I log in securely using my phone number and a one‑time password (OTP) received via SMS or WhatsApp.
- **C‑3:** I can track my order status on a visual timeline (Pending → Cutting → Sewing → Fitting → Ready → Delivered).
- **C‑4:** I can view my historical measurements from any store I’ve visited.
- **C‑5:** I can book an appointment for measurement or fitting, choosing an available time slot.
- **C‑6:** I receive a push notification when my order status changes or my appointment is approaching.
- **C‑7:** I can tap a floating “Chat with Us” button that opens WhatsApp with my order reference pre‑filled.

**Key Requirements:**
- The PWA must be installable on mobile home screens and work offline (cached static assets and last known order status).
- Full RTL support (Arabic/Urdu) with automatic language detection.
- OTP expiry: 5 minutes; rate limited to 3 requests per 15 minutes per phone number.

### 4.3 Enhanced Inventory – Batch Tracking & Auto‑Reorder

**User Stories:**
- **I‑1:** As Store Manager, I can log a fabric purchase: supplier, batch code, quantity, cost, purchase date.
- **I‑2:** When a tailor adds fabric to an order, they select the oldest available batch (FIFO) from a dropdown that shows current quantities.
- **I‑3:** I can view a complete movement history (purchases, order consumption, transfers, adjustments) for any batch.
- **I‑4:** I set minimum and maximum thresholds per fabric; the system automatically generates a restock alert when stock falls below the minimum.
- **I‑5:** I receive a daily digest of low‑stock alerts via email / in‑app notification.

**Key Requirements:**
- Inventory movements must be an append‑only ledger; negative stock prevented at database level.
- FIFO consumption automatically distributes the required quantity across multiple batches if one batch is insufficient.
- The cron job runs daily at 8 AM store local time, checks thresholds, and creates alerts with suggested order quantities.

### 4.4 WhatsApp Integration for Order Updates & Invoicing

**User Stories:**
- **W‑1:** As a customer, I receive a professional WhatsApp message when my order status changes (e.g., stitching complete, ready for pickup).
- **W‑2:** When my order is ready, I receive a pickup notification with store name and order reference.
- **W‑3:** After order completion, I receive a PDF invoice via WhatsApp.
- **W‑4:** As a store, all WhatsApp messages are sent from my verified business number, not a generic one.

**Key Requirements:**
- Integration with WhatsApp Business Cloud API (direct Meta integration).
- Each store must have its own WhatsApp phone number ID and access token (encrypted at rest).
- Customers must opt in for WhatsApp communications (consent captured at PWA signup or in‑store).
- Message templates are pre‑approved and used for all proactive outreach; placeholder variables are filled per message.
- Fallback: if WhatsApp delivery fails, fall back to push notification (PWA) or SMS.
- Audit trail: all messages logged with delivery status.

### 4.5 Platform Administration (SaaS Management)

**User Stories:**
- **PA‑1:** As Platform Super Admin, I can view all tenant organisations, filter by status, and drill into their details.
- **PA‑2:** I can manually create a new organisation for an enterprise client, set its plan, and generate HQ Admin credentials.
- **PA‑3:** I define subscription plans (Basic, Pro, Enterprise) with feature flags, store/user limits, and pricing.
- **PA‑4:** I can upgrade/downgrade a tenant’s plan, extend trial periods, or suspend an organisation for non‑payment.
- **PA‑5:** As Support Agent, I can securely impersonate a tenant’s HQ Admin for troubleshooting, with all actions logged.
- **PA‑6:** As Billing Specialist, I can view invoices, payment history, and manage Stripe‑linked subscriptions.

**Key Requirements:**
- The Platform Admin interface must be a separate web application (or isolated route tree) accessible only to users with a `platform_admins` record.
- Feature gating: every tenant API request checks the organisation’s enabled feature set (cached in Redis) and returns 402 if not allowed.
- Impersonation must generate time‑limited tokens (max 30 minutes) and log all actions under the impersonator’s identity.
- Platform admins cannot accidentally see tenant‑specific data unless impersonating (and that is audited).

### 4.6 Roles & Permissions Finalised

The system has **7 roles**, fully defined with default permissions and the ability for HQ Admins to override permissions per user per store.

| Role | Scope | Default Key Permissions |
|------|-------|------------------------|
| **Platform Super Admin** | All tenants, platform config | Tenant CRUD, plan management, impersonation, global metrics. |
| **Platform Billing** | All tenants (read‑only + billing) | View/manage subscriptions, invoices, plans. |
| **Platform Support** | All tenants (limited) | View tenant details, impersonate (with approval). |
| **HQ Admin** | Single organisation (all stores) | All 17 base permissions including manage_roles, manage_stores, transfer_inventory. |
| **Regional Manager** | Multiple assigned stores | View dashboard, view orders, view inventory, manage customers (for their stores). |
| **Store Manager** | Single store | View dashboard, manage orders, manage inventory batches, process payments. |
| **Tailor** | Single store | View orders, update order status, select batches, view customer measurements. |
| **Cashier** | Single store | Create orders, process payments, view customers. |
| **End Customer** | Self‑service | Order tracking, appointment booking, measurement viewer. |

The **17 granular permissions** (view_dashboard, manage_roles, etc.) can be added/removed per user via the Team Management UI, overriding role defaults.

---

## 5. Non‑Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Performance** | HQ dashboard aggregation for 100 stores < 2 seconds. WhatsApp message delivery < 30 seconds after event trigger. PWA initial load < 3 seconds on 3G. |
| **Scalability** | Support 1,000+ stores and 1M+ customers without degradation. API rate limiting: 100 req/min for public endpoints, 1000 req/min for authenticated. |
| **Availability** | 99.9% uptime for core POS/order creation; 99.5% for customer‑facing PWA. |
| **Security** | OWASP Top 10 compliance. JWT with short expiry (15 min) and refresh tokens. All data in transit over TLS 1.3. Encrypted storage of WhatsApp tokens. RBAC enforced at API layer. |
| **Data Residency & Compliance** | Tenant data belongs to the organisation; export/delete facilities for GDPR/PDPL. Soft deletes and full audit trails for all critical operations. |
| **Usability** | PWA Lighthouse score > 90 (PWA). Minimum touch target 44px. Full RTL layout support. |
| **Localisation** | Support Arabic, Urdu, English. Auto‑detect language from browser headers. |

---

## 6. Scope & Out of Scope

**In Scope (this PRD):**
- Multi‑store hierarchy, role‑based access, HQ dashboard.
- PWA for customers: OTP auth, order tracking, appointment booking, push notifications.
- Inventory batch tracking with FIFO, movements audit, and reorder alerts.
- WhatsApp messaging for order updates and invoices.
- Platform admin tool for tenant and subscription management.

**Out of Scope (future phases):**
- Native mobile apps (iOS/Android) – the PWA satisfies immediate needs.
- AI‑powered demand forecasting for inventory.
- Customer loyalty programmes.
- Multi‑language product cataloguing (global fabric database).
- White‑label mobile app publishing.

---

## 7. Assumptions & Dependencies

- WhatsApp Business Cloud API will be approved for the necessary message templates (order updates, invoices).
- Stripe (or similar) is available in the target markets for subscription billing.
- Tenant users have internet access and modern browsers (Chrome/Safari/Firefox last 2 versions).
- Customers have WhatsApp installed and phone numbers capable of receiving OTPs.

---

## 8. Success Metrics

- **Adoption:** 40% of existing stores migrate to multi‑store plan within 6 months.
- **Engagement:** 50% of active customers use the PWA for order tracking within 90 days of pilot.
- **Operational Efficiency:** 25% reduction in stock‑outs reported by pilot stores using reorder alerts.
- **Customer Satisfaction:** WhatsApp message read rate > 80%, customer NPS improvement of +15.
- **Revenue:** 30% increase in ARPU for chains using the Enterprise plan vs. Basic.

---

## 9. Release & Rollout Strategy

1. **Private Beta (2 stores, 4 weeks):** Multi‑store and inventory batch features. Gather feedback.
2. **Public Pilot (10 stores, 6 weeks):** Include PWA and WhatsApp notifications. Monitor performance and message deliverability.
3. **General Availability:** All features enabled, marketing push. Platform Admin tool used internally from Day 1.

Feature flags will allow turning on/off advanced features per tenant during rollout.

---

## 10. Appendices

- **Appendix A:** Detailed Permission Matrix (17 permissions × 6 internal roles)
- **Appendix B:** WhatsApp Message Template Examples (EN/AR)
- **Appendix C:** Subscription Plan Feature Grid (Basic, Pro, Enterprise)
- **Appendix D:** Design System Tokens (Colors, Typography, Spacing)

*(These appendices to be maintained in the shared repository alongside this PRD.)*

---

**Document Ownership:** Lead Product Designer & Full‑Stack Production Engineer  
**Next Steps:** Backend lead to finalise API contracts. Frontend lead to start component library with RTL. QA to prepare test cases from user stories.