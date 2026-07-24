# UI/UX Wireframes Document  
**Product:** Tailonix Enterprise Platform  
**Version:** 1.0  
**Author:** Lead Product Designer & Full‑Stack Production Engineer  
**Date:** July 26, 2026  
**Status:** Final for Design Handoff  

---

## 1. Design Principles & System

### 1.1 Core Design Principles
- **Professional yet warm** – Tailoring is both luxury and personal. Clean layouts, generous whitespace, subtle gold accents, and elegant typography.
- **Efficiency first** – For staff (store managers, tailors), minimise clicks. Commonly used actions surfaced immediately; secondary actions tucked behind contextual menus.
- **Context-aware** – The active store is always visible; the UI reacts to role and permissions. Unavailable actions are hidden, not disabled.
- **Mobile-optimised for customers** – The PWA is a mobile-first experience; touch targets ≥44 px, minimal scrolling, clear call‑to‑action buttons.
- **RTL native** – All layouts use CSS logical properties and flip seamlessly for Arabic/Urdu.

### 1.2 Design System Tokens

**Colours**
- Primary: Deep Teal `#00695C`
- Primary Light: `#E0F2F1`
- Secondary: Gold `#F9A825`
- Neutral: White `#FFFFFF`, Charcoal `#212121`, Grey `#757575`
- Status: Ready `#2E7D32`, In Progress `#F57F17`, Alert `#C62828`, Scheduled `#1565C0`
- Surface: Card background `#FAFAFA`, Input field `#F5F5F5`

**Typography**
- Arabic/Urdu: **Tajawal** (Google Font) – Regular 400, Medium 500, Bold 700
- Latin: **Inter** – Regular 400, Medium 500, Semibold 600
- Scale (base 16 px): Caption 12 px, Body 14 px, Body L 16 px, Subtitle 18 px, Title 24 px, Headline 32 px

**Spacing & Borders**
- 4 px base grid; common spacing: 8, 16, 24, 32, 48 px
- Border radius: cards 8 px, buttons 6 px, inputs 4 px
- Shadows: subtle layered shadow for cards, drawers, modals

**Iconography**
- **Phosphor Icons** (consistent, clean, RTL-friendly). Line style primarily, filled for active states.

### 1.3 Responsive Breakpoints
- Mobile: 0 – 768 px
- Tablet: 768 – 1024 px
- Desktop: 1024 px+

---

## 2. User Flows

### 2.1 HQ Admin – Manage Store & Assign Staff
```
Login → Dashboard (HQ view) → Sidebar “Stores” → Store list → Click “Add Store” → Modal with form → Save → 
Go to “Team” → Invite user → Select store(s) + role → Send invitation → Notification appears.
```
### 2.2 Store Manager – Create Order with Batch Selection
```
Login → Dashboard (Store view) → Quick action “New Order” → Select customer → Add garment → 
Choose fabric → Modal “Select Batch” (list of batches, oldest first) → Choose batch & quantity → 
Add to order → Complete order → Trigger status update (Tailor) → WhatsApp notification sent.
```
### 2.3 Customer – Track Order via PWA
```
Scan QR on receipt → Deep link opens PWA → OTP screen → Enter phone → Get OTP → Verify → 
Order tracking page → Visual stepper with current status → Tap “Chat” → WhatsApp opens with prefilled text.
```
### 2.4 Customer – Book Appointment
```
PWA → Appointments tab → Select store (if multiple) → Calendar with available dates → Select date → 
Time slots grid → Select slot → Choose type → Confirm → Success card with “Add to Calendar”.
```
### 2.5 Platform Super Admin – Manage Tenant Subscription
```
Login to admin.tailonix.com → Dashboard (all tenants) → Search tenant → Click tenant row → 
Subscription tab → Change plan → Select new plan from dropdown → Confirm → Stripe sync → Logged.
```

---

## 3. Screen‑by‑Screen Wireframe Descriptions

### 3.1 Admin Dashboard – HQ View (Desktop)

**Top Bar (Sticky, 64 px height)**
- Left: **Tailonix logo** (link to dashboard) + **Store Switcher** dropdown.  
  The dropdown shows the current store name with a small store icon. Click opens a searchable list of all stores in the org, each with a coloured status dot (green=active, yellow=paused, red=closed). The active store is highlighted.  
  For HQ Admin, an extra option “All Stores (HQ Overview)” sits at the top and is the default.
- Right side: **Notification bell** (with red badge for low‑stock alerts), **Help** icon (opens knowledge base), **User avatar** (dropdown: Profile, Logout).
- Below top bar: **Breadcrumb** not needed; the store context is clear.

**Main Content Area (Padding 24 px)**
- **KPI Row** (4 cards in a flex row)
  - Total Revenue Today (with % change vs yesterday, green/red arrow)
  - Total Orders (with count and trend)
  - Active Tailors (number, optional: utilisation %)
  - Low Stock Alerts (clickable, routes to Inventory Alerts page)
- **Section: Store Performance Table**
  - Title: “Store Performance” with date range picker (default: This Week).
  - Table columns: Store Name (sortable), Revenue, Orders, Avg Order Value, Status. Each row is clickable to drill into that store’s dashboard (or if “All Stores” is active, drill sets the store context).
- **Section: Inventory Health Heatmap**
  - A grid of fabric cards (like tiles). Each card shows fabric name, colour, and a health bar (green if stock >50% of max threshold, yellow 20‑50%, red <20%). Hover shows exact qty. Click navigates to inventory batches filtered for that fabric.
- **Section: Revenue Trend**
  - Line chart showing revenue per day, with a toggle to compare stores (multi‑line). Below chart, a summary table.

**Responsive:** On tablet, KPI cards stack 2×2. On mobile, the table becomes a card list, heatmap becomes a scrollable list, chart hidden, store switcher collapses to icon.

### 3.2 Team Management (HQ Admin)

**Header:** “Team” with “+ Invite User” button (right).

**User Table:**
- Columns: User (avatar + name), Email, Roles/Stores (badge per store, e.g., “Store Manager – Dubai Mall”), Status (Active/Inactive), Actions (edit icon, deactivate icon).
- Each row clickable → Edit modal.

**Invite User Modal (triggered by button):**
- Step 1: Enter email, full name, phone (optional).
- Step 2: Assign to store(s). A multi‑select dropdown of stores. For each selected store, a role dropdown appears (Store Manager, Tailor, etc.). Default: Store Manager.
- Step 3 (optional, expandable): “Customise Permissions”. A toggle opens a grid of 17 permission checkboxes. If any modified, a warning that it overrides role defaults.
- Action: “Send Invitation” (creates user, sends email).

**Edit User Modal:** Same as invite but prefilled. Also shows current active roles and the ability to add another store+role combo, or remove existing (with confirmation). Deactivate button turns user inactive; reactivate available.

### 3.3 Order Creation – Fabric Batch Selector

**Context:** In the order creation form, when a tailor/staff adds a garment and selects fabric, a “Select Batch” modal appears.

**Modal Layout:**
- Title: “Select Batch – {Fabric Name}”
- Search bar to filter by batch code.
- Table: Batch Code, Color, Available Qty, Storage Location. The list is sorted by purchase date ascending (FIFO). Each row has a quantity input (default 0).
- Summary at bottom: “You need {required_qty} metres total. Selected: {selected_qty}.”
- Action: “Add to Order” (disabled until selected_qty meets required_qty, or if insufficient stock total, show warning).
- If total available < required_qty, a red banner: “Insufficient stock. Available: {total_available}”.

**Edge case:** When multiple batches selected, they are added as line items under the fabric with batch codes noted.

### 3.4 Inventory – Batch Detail & Movements

**Batch Detail Page:**
- Header: Fabric name, batch code, status badge, current quantity with unit. Action buttons: “Transfer” (for HQ Admin), “Edit” (manage quantity adjustments), “Print Label”.
- **Info card:** Supplier, purchase date, cost price, location, color.
- **Movements Tab (default):** Timestamped table: Date, Type (with icon: purchase in, order out, transfer, adjustment), Quantity, Balance after, Reference (order#), Created by. Paginated.
- **Alerts Tab:** Shows if any reorder setting exists for this fabric; link to configure.

**Transfer Modal (triggered from batch detail or from inventory list multi‑select):**
- Select destination store (dropdown of other stores in org).
- Quantity to transfer (max = current_quantity). Input with unit.
- Note (optional).
- Confirmation button: “Transfer”. On success, batch list updates.

### 3.5 Inventory Alerts (Store Manager)

**Page:** List of alerts generated by cron job, grouped by fabric.

- Filter: Status (pending, acknowledged, ordered, resolved), Fabric name search.
- Each alert card: Fabric name, current qty, threshold, suggested order qty, status badge, created date.
- Actions: “Acknowledge” (changes to acknowledged), “Resolve” (opens resolve modal with note), “Order” (future feature, placeholder).
- Bulk action: “Acknowledge All” for pending alerts.

### 3.6 Client PWA – Key Screens (Mobile‑First, 375 px width)

**a. OTP Login**
- Centred card with Tailonix logo, app name in Arabic/English.
- Phone number input with country code dropdown (default +966).
- “Send OTP” button (Teal, full width). Below: “We’ll text you a 4‑digit code.”
- After sending: OTP input (4 separate boxes, auto‑advance), timer showing “Resend in 0:45”.
- Error state: “Invalid code” shake animation. Success: navigates to order tracking.

**b. Order Tracking**
- Header: Store name (or “My Order”).
- Order # and status badge (e.g., “In Progress” amber).
- **Visual Stepper:** Horizontal dot‑stepper (vertical on very small screens) with 5 steps: Pending, Cutting, Sewing, Fitting, Ready. Completed steps filled with teal and checkmark; current step teal outlined with animated pulse; future steps grey. Below each step a timestamp if completed.
- **Details card:** Estimated completion date, assigned tailor, fabric used.
- **Measurement summary card:** Collapsed; tap to expand and show key measurements.
- **Floating Action Button (FAB):** WhatsApp icon, green circle, “Chat with Us”. Click opens `wa.me` with pre‑filled message: “Hi, I have a question about order #12345.”
- **Navigation:** Bottom tab bar with icons: Orders (home), Appointments, Profile. Active tab teal, others grey.

**c. Appointment Booking Flow**
- Tab “Appointments” → shows list of upcoming appointments.
- FAB “+ Book” → Store Selector (if customer visited multiple, else skip).
- **Calendar:** Month view, swipeable. Days with availability highlighted with a teal dot. Selecting a day shows time slots below.
- **Time Slots:** Grid of 30‑min slots (e.g., 9:00, 9:30). Available slots white with teal border, booked slots greyed out with “Booked” label. Tap to select.
- **Type Picker:** Radio buttons: Measurement, First Fitting, Final Fitting, Pickup.
- **Confirmation:** Summary card, “Confirm Appointment” button. Success screen with animated checkmark and option to “Add to Calendar” (downloads .ics file).
- **Cancel/Reschedule:** From appointment detail (three‑dot menu → Reschedule or Cancel). Cancel asks for reason (optional).

**d. Measurement Profile**
- List of measurement cards grouped by garment type (e.g., Shirt, Trousers). Each card shows a mini table of measurements (collar, chest, sleeve, etc.) with dates.
- Tap to expand full details.
- “Request Update” button (sends request to store, future).

**e. Push Notification Opt‑in**
- After first successful order tracking, a bottom sheet appears: “Stay updated! Allow notifications when your order status changes.” Two buttons: “Allow” (triggers browser push prompt) and “Maybe Later”. Opt‑in later via Profile.

**f. Offline State**
- Service worker caches last fetched order data. If offline, a yellow banner: “You’re offline. Showing last saved data from [timestamp].” Stepper may be outdated; a refresh icon triggers reconnection.

### 3.7 Platform Admin (Super Admin, Billing, Support)

**a. Tenant Organisations List**
- Table: Organisation Name, Plan (badge), Stores Count, Status (active, past_due, suspended), Created Date, Actions (view details, impersonate).
- Filters: search by name, plan, status.
- “+ New Organisation” button opens creation modal (manual provisioning).

**b. Organisation Detail Page**
- Tabs: Overview (store count, user count, subscription status), Subscription (current plan, start/end, billing history, change plan button), Audit Logs (filterable).
- “Impersonate HQ Admin” button (for support/super admin): A modal with warning “You will be logged in as the HQ Admin of this organisation for 30 minutes. All actions will be logged.” Confirm generates a temporary link that opens a new browser window with tenant session.

**c. Subscription Plan Management**
- List of plans (Basic, Pro, Enterprise). Card layout or table.
- Each plan: Name, price, max stores/users, feature list (checkbox grid). Edit button opens modal to modify plan features/limits.

**d. Global Audit Logs**
- Searchable, filterable table of all actions across tenants: date, org, user, action, details (JSON diff). Support staff use this to investigate issues.

---

## 4. Component Library Highlights

- **Store Switcher:** A composite component with dropdown, search, status dots. Used in top bar and in any context where store selection is needed (e.g., reporting).
- **Role Badge:** Small chip displaying role name with icon (e.g., briefcase for manager, scissors for tailor). Colour-coded: teal for admin, blue for manager, green for tailor, grey for cashier.
- **Status Stepper (PWA):** Custom Vue/React component using flex layout, animated with CSS transitions.
- **FAB (WhatsApp):** Fixed position bottom-right (or left for RTL), with subtle bounce animation on page load to draw attention.
- **Empty States:** Illustrations and helpful text for pages with no data (e.g., “No orders yet”).
- **Loading Skeleton:** Card‑shaped placeholders with shimmer animation for all list/table views.

---

## 5. RTL & Localisation Support

- All layouts use CSS logical properties (`padding-inline-start`, `margin-inline-end`, etc.) so flipping `dir="rtl"` on `<html>` automatically mirrors the UI.
- Icons that imply direction (arrows, chat bubble) are flipped or replaced with RTL equivalents.
- Typography: Tajawal font size slightly larger (Arabic readability). Line height increased.
- The store switcher dropdown, modal animations, and stepper all respect direction.
- Language detection: based on browser `Accept-Language` header, with manual toggle in profile (saved to backend).

---

## 6. Micro‑interactions & States

- **Button hover:** Slight scale (1.02) and shadow increase. Active: press effect.
- **OTP input:** Auto‑focus next box on digit entry, backspace moves to previous. Success animation: boxes turn green with checkmark.
- **Notification bell:** Red badge count, drops a panel with latest alerts. Clicking an alert navigates to relevant page.
- **Drag & drop (future):** Reorder measurements? Not in scope now.
- **Error feedback:** Inline validation errors under inputs; toast notifications for server errors (top‑right).
- **Success toast:** After creating order, inviting user, etc., a green toast slides in from top with brief message.

---

## 7. File Naming & Asset Handoff

All wireframe screens will be delivered as a Figma file with:
- **Pages:** Admin Dashboard (HQ, Store), Team Management, Order Creation (with Batch), Inventory (Batch Detail, Alerts), PWA (Login, Tracking, Appointments, Measurements), Platform Admin (Tenants, Subscription, Audit).
- **Components:** Maintain a shared component library (buttons, inputs, cards, badges, store switcher).
- **Variants:** Each screen includes RTL variant, dark mode placeholders (future), and all interaction states (hover, active, error, empty).

---

**This wireframe document provides a complete blueprint for the UI/UX design phase. Designers can now create high‑fidelity mockups based on these detailed descriptions, flows, and principles.**