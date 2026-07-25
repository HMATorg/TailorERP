# Amendment v4 — Competitor Blueprint Gap Analysis

**Source:** industry-tested competitor blueprint (KSA thobe/suit tailoring POS)
**Date:** 25 July 2026
**Status:** analysis complete, implementation in progress

This maps the blueprint against what Tailonix has today. It is deliberately blunt about
what is new, because one item (ZATCA) is a legal requirement rather than a feature.

---

## The headline: ZATCA Fatoora Phase 2 is mandatory, and we have none of it

Phase 2 ("Integration Phase") e-invoicing is **law** for VAT-registered businesses in
Saudi Arabia. Non-compliance carries penalties and, in practice, blocks operation.

Our current `invoices` table has: number, total, PDF URL, timestamps. It has **no VAT
field at all** — not even a 15% line. Everything below is new work:

| Requirement | Status |
|---|---|
| 15% KSA VAT (net / tax / gross split) | **missing** — totals are tax-free today |
| UUID per invoice | missing |
| Invoice hash (SHA-256) + **hash chain** (PIH) | missing |
| Cryptographic stamp (ECDSA secp256k1) | missing |
| UBL 2.1 XML generation | missing |
| Base64 **TLV** QR (9 tags, Phase 2) | missing |
| Fatoora API clearance/reporting | missing |
| Simplified (B2C) vs Standard (B2B) distinction | missing |
| Counter (ICV) monotonic per device | missing |

**Honest constraint:** the cryptographic stamp requires a CSR submitted to ZATCA and a
production CSID issued back. I can implement the full algorithm and the sandbox flow,
but going live needs the client's ZATCA portal credentials and a registered device. I
will build it so onboarding is a configuration step, not a code change.

---

## Domain model gaps

### Measurements — restructure required

| Blueprint | Today |
|---|---|
| Fixed matrix M1–M8, **centimetres** | free-form JSON, comment says inches |
| Versioned snapshots + `is_active` toggle | flat rows, no version, no active flag |
| Arabic labels (الطول، الكتف، الكم…) | none |
| 2D interactive diagram | none |

The `is_active` toggle matters operationally: the blueprint is explicit that cutters must
work from exactly one valid frame. Today nothing prevents ambiguity.

### Garment design configuration — entirely new

One order carries N garments, each with its own configuration:

- **Collar:** Qallabi 1-button / Qallabi 2-button / Rounded Sada / Open V-neck
- **Cuff:** Formal Kabak (cufflinks) / Standard buttoned Sada
- **Pocket:** Standard upper-left patch / Sleek hidden side / Reinforced mobile slot
- **Stitching:** Hidden plain / Visible dual Sawai / Embroidered Zari

Today `order_items` has only `garmentType` + free-text description. No structured
variants, so the workshop cannot be told what to make.

### Fabric rolls — partial

We have batches with FIFO. The blueprint adds:

- Manufacturer trace: brand, **origin** (e.g. Toyobo Japan), fabric type, colour shade code
- **Minimum usable safety point (3.5 m)** — below this the roll leaves storefront
  availability for adult thobes. We have reorder thresholds, which are a *purchasing*
  signal; this is a *sellability* rule. Different thing.
- **Reservation** — yield held at checkout, deducted at cutting. We deduct immediately.

### Yield calculation — new

```
Target Meter Yield = (Total Length × 2) + Sleeve Length + 0.20 m hem allowance
Validation: Current Roll Balance − Yield ≥ 3.5 m
```

Derives fabric need from the customer's own measurements. Nothing like this exists.

### Workshop Kanban — new

Split-ticket production: the invoice becomes one card per garment, moving through
Cutting (التفصيل) → Stitching (الخياطة) → Quality/Press (الكوي والجودة), barcode-scanned
at each station, with worker allocation. Our order status is a single flat enum on the
whole order — it cannot represent three thobes at three different stations.

### Deposit accounting — new

50% deposit → **Unearned Revenue (liability)**; on final settlement → **Realized Revenue**.
We record payments against an order with no ledger semantics.

### Customer tiering — new

Lifetime order counter driving tier levels. Not present.

---

## What already covers the blueprint

Worth stating so we do not rebuild it:

- Multi-store, RBAC, store switching ✔
- WhatsApp Cloud API + templates + webhooks + delivery status ✔ (Phase 5 comms loop)
- Customer PWA with order tracking ✔
- FIFO batch consumption with row locks ✔ (extends to reservation)
- Audit trail on every mutation ✔ (ZATCA needs this anyway)
- Invoice PDF pipeline ✔ (becomes the ZATCA-compliant document)
- Arabic/RTL across both apps ✔

---

## Implementation order

Sequenced by risk and dependency, not by blueprint order:

1. **Schema foundation** — measurements matrix, garment variants, roll trace, ZATCA
   invoice fields, reservations, production tickets
2. **ZATCA core** — VAT, UUID, hash chain, TLV QR, UBL XML (highest legal risk)
3. **Yield + reservation** — the material maths gate
4. **Workshop Kanban** — split tickets and stations
5. **POS front-of-house flow** — the counter experience tying it together
6. **Deposit ledger + customer tiers**

Decisions arising are recorded as D-027 onward in
[ENGINEERING-DECISIONS.md](ENGINEERING-DECISIONS.md).
