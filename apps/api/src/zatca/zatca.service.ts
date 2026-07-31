import { randomUUID } from 'crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { decryptSecret } from '../notifications/crypto.util';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ZatcaApiClient } from './zatca-api-client';
import { readCertFacts } from './zatca-cert';
import { GENESIS_PIH, findChainBreak, hashInvoiceXml } from './zatca-hash';
import { signInvoiceXml } from './zatca-sign';
import { buildQrBase64 } from './zatca-tlv';
import { buildUblInvoice, canonicalize, stripSignatureElements, type UblLine } from './zatca-xml';
import { KSA_VAT_RATE, splitInclusive } from './zatca-vat';

/**
 * ZATCA Fatoora Phase 2 issuance (v4 amendment §3).
 *
 * Scope note: the cryptographic *stamp* (tags 7–9) requires a CSID issued by
 * ZATCA against a CSR for a registered device. Everything that does not depend
 * on that — VAT split, UUID, ICV, hash chain, TLV QR, UBL XML — is implemented
 * and enforced here. Onboarding is configuration (see D-029), not a code change.
 */
@Injectable()
export class ZatcaService {
  private readonly logger = new Logger(ZatcaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly apiClient: ZatcaApiClient,
  ) {}

  /**
   * Allocates ICV and PIH under a row lock so two concurrent checkouts cannot
   * take the same counter or chain off the same predecessor. The counter is
   * per-organisation, matching how the device is registered.
   */
  private async allocateChainSlot(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<{ icv: number; previousHash: string }> {
    // `SELECT … ORDER BY icv DESC LIMIT 1 FOR UPDATE` is NOT sufficient: it locks
    // the latest *existing* row, which does nothing to stop two transactions
    // from computing the same next ICV and both inserting. Concurrency testing
    // showed exactly that — half of 14 parallel orders failed to get a tax
    // invoice (D-039).
    //
    // A hash chain is inherently serial (invoice N embeds N-1's hash), so
    // issuance must serialise per tenant. An advisory lock held for the
    // transaction does that without blocking other organisations.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`zatca:${organizationId}`}))
    `;

    const rows = await tx.$queryRaw<{ icv: number | null; invoice_hash: string | null }[]>`
      SELECT icv, invoice_hash FROM invoices
      WHERE organization_id = ${organizationId}::uuid AND icv IS NOT NULL
      ORDER BY icv DESC
      LIMIT 1
    `;
    const last = rows[0];
    return {
      icv: (last?.icv ?? 0) + 1,
      previousHash: last?.invoice_hash ?? GENESIS_PIH,
    };
  }

  /**
   * Turns an existing invoice row into a ZATCA-compliant document:
   * VAT split, UUID, ICV, chained hash, UBL XML, and the TLV QR payload.
   */
  async issue(invoiceId: string, actorId?: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            vatNumber: true,
            defaultCurrency: true,
            taxId: true,
            zatcaCsidEncrypted: true,
            zatcaPrivateKeyEncrypted: true,
          },
        },
        order: {
          include: {
            customer: { select: { fullName: true, phone: true } },
            store: { select: { name: true, address: true } },
            items: true,
            payments: true,
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.zatcaUuid) {
      // Already issued — re-issuing would break the chain and duplicate an ICV.
      return invoice;
    }

    const org = invoice.organization;
    const order = invoice.order;
    const currency = org.defaultCurrency || 'SAR';

    // Order totals are what the customer was quoted, i.e. VAT-inclusive.
    const totals = splitInclusive(order.totalAmount, KSA_VAT_RATE);

    const lines: UblLine[] = order.items.map((item, index) => {
      const lineGross = new Prisma.Decimal(item.unitPrice).mul(item.quantity);
      const line = splitInclusive(lineGross, KSA_VAT_RATE);
      const unit = splitInclusive(item.unitPrice, KSA_VAT_RATE);
      return {
        id: index + 1,
        name: item.garmentType,
        quantity: item.quantity,
        unitCode: 'PCE',
        unitPrice: unit.net.toFixed(2),
        lineNet: line.net.toFixed(2),
        lineVat: line.vat.toFixed(2),
        vatRate: KSA_VAT_RATE.toFixed(2),
      };
    });

    const prepaid = order.payments
      .filter((p) => p.kind === 'deposit')
      .reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));

    const uuid = randomUUID();

    const result = await this.prisma.$transaction(async (tx) => {
      const { icv, previousHash } = await this.allocateChainSlot(tx, org.id);

      const xml = buildUblInvoice({
        invoiceNumber: invoice.invoiceNumber,
        uuid,
        issuedAt: invoice.issuedAt,
        icv,
        previousHash,
        invoiceTypeCode: invoice.zatcaInvoiceType,
        currency,
        seller: {
          name: org.name,
          vatNumber: org.vatNumber ?? org.taxId ?? '000000000000000',
          address: order.store.address,
        },
        buyer: { name: order.customer.fullName, phone: order.customer.phone },
        lines,
        totalNet: totals.net.toFixed(2),
        totalVat: totals.vat.toFixed(2),
        totalGross: totals.gross.toFixed(2),
        prepaidAmount: prepaid.toFixed(2),
      });

      const canonical = canonicalize(xml);
      const invoiceHash = hashInvoiceXml(canonical);

      // Tags 7–9 (the cryptographic stamp) need a CSID — a signing key and a
      // ZATCA-issued certificate for this org (D-057). Orgs that have not
      // completed onboarding fall back to the Phase 1 tags 1–5 QR, same as
      // before (D-029) — the invoice is still saved and printable, just not
      // yet cryptographically stamped.
      let finalXml = canonical;
      let qr: string;
      if (org.zatcaCsidEncrypted && org.zatcaPrivateKeyEncrypted) {
        const encryptionKey = this.config.getOrThrow<string>('TOKEN_ENCRYPTION_KEY');
        const signed = signInvoiceXml({
          baseXml: xml,
          invoiceHash,
          certificatePem: decryptSecret(org.zatcaCsidEncrypted, encryptionKey),
          privateKeyPem: decryptSecret(org.zatcaPrivateKeyEncrypted, encryptionKey),
          isSimplified: invoice.zatcaInvoiceType === 'simplified',
          qr: {
            sellerName: org.name,
            vatNumber: org.vatNumber ?? org.taxId ?? '000000000000000',
            timestamp: invoice.issuedAt.toISOString(),
            invoiceTotal: totals.gross.toFixed(2),
            vatTotal: totals.vat.toFixed(2),
          },
        });
        finalXml = signed.signedXml;
        qr = signed.qrCodeBase64;
      } else {
        qr = buildQrBase64({
          sellerName: org.name,
          vatNumber: org.vatNumber ?? org.taxId ?? '000000000000000',
          timestamp: invoice.issuedAt.toISOString(),
          invoiceTotal: totals.gross.toFixed(2),
          vatTotal: totals.vat.toFixed(2),
          invoiceHash,
        });
      }

      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          zatcaUuid: uuid,
          icv,
          previousHash,
          invoiceHash,
          qrCodeBase64: qr,
          netAmount: totals.net,
          vatAmount: totals.vat,
          vatRate: totals.rate,
          totalAmount: totals.gross,
        },
      });
      return { updated, xml: finalXml, icv };
    });

    // Archives the *signed* document when a CSID is provisioned (the actual
    // submittable file), or the unsigned canonical form otherwise — either
    // way, the exact bytes `invoiceHash` was computed from remain recoverable
    // by re-stripping UBLExtensions/QR/Signature per Section 5 Step 1, which
    // is exactly what verifyChain()'s re-hash check already assumes.
    if (this.storage.isEnabled()) {
      try {
        const key = `zatca/${org.id}/${invoice.invoiceNumber}.xml`;
        await this.storage.putObject(key, Buffer.from(result.xml, 'utf8'), 'application/xml');
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: { xmlUrl: key },
        });
      } catch (err) {
        this.logger.error(`ZATCA XML archive failed: ${(err as Error).message}`);
      }
    }

    await this.audit.log({
      organizationId: org.id,
      storeId: order.storeId,
      actorUserId: actorId,
      actorType: actorId ? 'staff' : 'system',
      action: 'zatca.invoice_issued',
      entityType: 'invoice',
      entityId: invoice.id,
      newValue: {
        icv: result.icv,
        uuid,
        net: totals.net.toFixed(2),
        vat: totals.vat.toFixed(2),
        gross: totals.gross.toFixed(2),
      },
    });

    this.logger.log(
      `ZATCA invoice ${invoice.invoiceNumber} issued — ICV ${result.icv}, VAT ${totals.vat.toFixed(2)} ${currency}`,
    );
    return result.updated;
  }

  /**
   * Compliance self-check. Three independent tests, because each catches a
   * different kind of tampering:
   *
   *  1. **Chain linkage** — each previousHash equals its predecessor's hash.
   *     Catches an edit to any invoice that has successors.
   *  2. **Hash re-computation** — re-hash the archived XML and compare to the
   *     stored hash. Catches an edit to the *last* invoice, or to the amounts
   *     where someone also rewrote the stored hash. Linkage alone cannot see
   *     either of those.
   *  3. **ICV continuity** — no gaps, i.e. nothing was deleted.
   */
  async verifyChain(organizationId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { organizationId, icv: { not: null } },
      orderBy: { icv: 'asc' },
      select: {
        icv: true,
        invoiceNumber: true,
        invoiceHash: true,
        previousHash: true,
        xmlUrl: true,
      },
    });

    const breakIndex = findChainBreak(invoices);

    const gaps: number[] = [];
    invoices.forEach((inv, i) => {
      if (inv.icv !== i + 1) gaps.push(inv.icv!);
    });

    // Re-hash whatever was archived; a mismatch means the row was edited after issue.
    const hashMismatches: string[] = [];
    const unverifiable: string[] = [];
    if (this.storage.isEnabled()) {
      for (const inv of invoices) {
        if (!inv.xmlUrl) {
          unverifiable.push(inv.invoiceNumber);
          continue;
        }
        try {
          const xml = await this.storage.getObject(inv.xmlUrl);
          // The archive holds the final (signed, if a CSID exists) document;
          // strip back to the pre-signature form and re-canonicalise — the
          // exact input invoiceHash was computed from — D-057, mirrors
          // Section 5 Step 1 in reverse.
          const unsigned = canonicalize(stripSignatureElements(xml.toString('utf8')));
          if (hashInvoiceXml(unsigned) !== inv.invoiceHash) {
            hashMismatches.push(inv.invoiceNumber);
          }
        } catch {
          unverifiable.push(inv.invoiceNumber);
        }
      }
    }

    const compliant =
      breakIndex === -1 && gaps.length === 0 && hashMismatches.length === 0;

    return {
      organizationId,
      invoiceCount: invoices.length,
      compliant,
      chainIntact: breakIndex === -1,
      brokenAt: breakIndex === -1 ? null : invoices[breakIndex].invoiceNumber,
      hashMismatches,
      icvGaps: gaps,
      /// Invoices whose XML could not be read — not proof of tampering, but not proof of integrity either
      unverifiable,
    };
  }

  /**
   * Submits the invoice to Fatoora — Reporting for simplified (B2C) invoices,
   * Clearance for standard (B2B) ones (guideline §4). Real submission needs a
   * **production-stage** CSID and its paired API secret from ZATCA onboarding
   * (D-058); a compliance-stage CSID exists only to run onboarding's own
   * compliance checks and is never valid for real Reporting/Clearance calls,
   * so `zatcaEnvironment` must equal `'production'`, not just be present.
   * Without one, the invoice is marked pending and surfaced in the
   * compliance report rather than silently treated as filed (D-029).
   */
  async submit(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        organization: {
          select: { zatcaCsidEncrypted: true, zatcaApiSecretEncrypted: true, zatcaEnvironment: true },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const org = invoice.organization;
    if (
      !this.apiClient.isConfigured() ||
      !org.zatcaCsidEncrypted ||
      !org.zatcaApiSecretEncrypted ||
      org.zatcaEnvironment !== 'production'
    ) {
      this.logger.warn(
        `Invoice ${invoice.invoiceNumber} not submitted — ZATCA is not configured or this tenant has not completed onboarding`,
      );
      return { submitted: false, reason: 'zatca_not_onboarded' as const };
    }

    if (!invoice.zatcaUuid || !invoice.invoiceHash) {
      return { submitted: false, reason: 'not_issued' as const };
    }

    if (!invoice.xmlUrl || !this.storage.isEnabled()) {
      this.logger.error(`Invoice ${invoice.invoiceNumber} has no archived XML to submit`);
      return { submitted: false, reason: 'archive_unavailable' as const };
    }

    const invoiceXml = await this.storage.getObject(invoice.xmlUrl);
    const encryptionKey = this.config.getOrThrow<string>('TOKEN_ENCRYPTION_KEY');
    const certificatePem = decryptSecret(org.zatcaCsidEncrypted, encryptionKey);
    const secret = decryptSecret(org.zatcaApiSecretEncrypted, encryptionKey);
    const credentials = { csid: readCertFacts(certificatePem).certificateDerBase64, secret };

    const request = {
      invoiceHash: invoice.invoiceHash,
      invoiceXmlBase64: invoiceXml.toString('base64'),
    };

    const result =
      invoice.zatcaInvoiceType === 'simplified'
        ? await this.apiClient.reportInvoice(credentials, request)
        : await this.apiClient.clearInvoice(credentials, request);

    const submitted = result.outcome === 'valid' || result.outcome === 'warnings';
    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        submissionStatus: submitted
          ? invoice.zatcaInvoiceType === 'simplified'
            ? 'reported'
            : 'cleared'
          : 'failed',
        submittedAt: submitted ? new Date() : invoice.submittedAt,
        clearanceStatus: result.outcome,
        zatcaResponse: result.raw as Prisma.InputJsonValue,
      },
    });

    if (!submitted) {
      this.logger.error(
        `ZATCA rejected invoice ${invoice.invoiceNumber}: ${result.errors.map((e) => e.message).join('; ')}`,
      );
    }

    return {
      submitted,
      outcome: result.outcome,
      warnings: result.warnings,
      errors: result.errors,
    };
  }
}
