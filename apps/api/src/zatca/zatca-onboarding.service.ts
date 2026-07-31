import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { decryptSecret, encryptSecret } from '../notifications/crypto.util';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { ZatcaApiClient } from './zatca-api-client';
import { derBase64ToPem, readCertFacts } from './zatca-cert';
import { generateCsr, type ZatcaCsrFields } from './zatca-csr';
import { GENESIS_PIH, hashInvoiceXml } from './zatca-hash';
import { signInvoiceXml } from './zatca-sign';
import { buildUblInvoice, canonicalize } from './zatca-xml';
import { KSA_VAT_RATE, splitInclusive } from './zatca-vat';

/**
 * ZATCA onboarding orchestration (Detailed Technical Guideline §3.3) — D-058,
 * request shapes and the renewal flow corrected against a real primary
 * source in D-059.
 *
 * Three explicit, separately-triggered steps, matching how a real shop owner
 * actually walks through this: get an OTP from the FATOORA portal (or
 * Developer Portal sandbox) — something only a human with real ZATCA access
 * can do, never this system — paste it in, request a Compliance CSID, run
 * the compliance checks, then request the Production CSID. Each step
 * persists its own result so the flow survives a page reload between steps,
 * not just a single in-memory session.
 *
 * **Endpoint paths and the CSR/response field names are now confirmed**
 * against "User Manual — Developer Portal Manual Version 3": Compliance CSID
 * takes an OTP header (no prior credential exists yet) and a `{ csr }` body;
 * the response carries a `binarySecurityToken` (the issued certificate, raw
 * base64 DER — wrapped into PEM before storage) and a `secret`, used
 * together as HTTP Basic Auth for everything after. What the manual
 * describes only at the level of *screenshots*, not printed field names —
 * the literal `/compliance` and `/production/csids` path segments, and the
 * exact key `compliance_request_id` — remain this module's own best-effort
 * reconstruction and should be confirmed against the real Swagger files
 * before use, same caveat as the CSR's residual unknowns.
 *
 * **Renewal is a single call, not "redo onboarding"** — an earlier version
 * of this file called `requestComplianceCsid` then `requestProductionCsid`
 * in sequence, which the manual's own walkthrough (§2.3.10.4) contradicts:
 * renewal authenticates with an existing CSID and submits a fresh OTP *and*
 * fresh CSR together, receiving a new Production CSID directly. The manual
 * is internally inconsistent about *which* existing CSID authenticates the
 * call — its summary table (§2.3.11) says a Compliance CSID, matching how
 * the sandbox lets you test the Renewal API in isolation without a full
 * prior onboarding; but authenticating a live renewal with the org's
 * *current Production* CSID is the standard PKI pattern (prove possession of
 * your current live credential to get the next one) and is what this
 * implements — a judgment call, flagged here rather than guessed silently.
 * A fresh CSR means a fresh key pair, so renewal also replaces the stored
 * private key, unlike onboarding's Compliance→Production step which reuses
 * the original one.
 *
 * **Compliance checks are intentionally partial.** ZATCA's real compliance
 * suite expects six sample documents (standard/simplified × invoice/credit
 * note/debit note). This system does not model credit or debit notes
 * anywhere yet — building fake ones just to fill the count would either be
 * rejected by ZATCA or misrepresent what was actually checked. `runComplianceChecks`
 * submits the two document types this system genuinely produces (one
 * standard, one simplified tax invoice) and says so in its result, rather
 * than claiming a six-check pass it did not run.
 */
@Injectable()
export class ZatcaOnboardingService {
  private readonly logger = new Logger(ZatcaOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly apiClient: ZatcaApiClient,
  ) {}

  private async getOrg(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        vatNumber: true,
        taxId: true,
        zatcaCsidEncrypted: true,
        zatcaPrivateKeyEncrypted: true,
        zatcaApiSecretEncrypted: true,
        zatcaEnvironment: true,
        zatcaComplianceRequestId: true,
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  private encryptionKey(): string {
    return this.config.getOrThrow<string>('TOKEN_ENCRYPTION_KEY');
  }

  status(organizationId: string) {
    return this.getOrg(organizationId).then((org) => ({
      stage: (org.zatcaEnvironment as 'compliance' | 'production' | null) ?? 'not_started',
      hasCredentials: !!(org.zatcaCsidEncrypted && org.zatcaApiSecretEncrypted),
    }));
  }

  /**
   * Step 1 — generates a fresh key pair + CSR and submits it against ZATCA's
   * Compliance CSID endpoint with the OTP the user obtained from the portal.
   * Stores the returned certificate + secret as the org's *compliance-stage*
   * credential — usable only for compliance-check calls, not real Reporting/
   * Clearance (`submit()` on `ZatcaService` checks `zatcaEnvironment ===
   * 'production'` before ever using it — see D-058).
   */
  async requestComplianceCsid(organizationId: string, otp: string, csrFields: ZatcaCsrFields, actorId?: string) {
    const org = await this.getOrg(organizationId);
    const { csrPem, privateKeyPem } = generateCsr(csrFields);

    const response = await this.apiClient.complianceRequest<{
      requestID: string;
      dispositionMessage?: string;
      binarySecurityToken: string;
      secret: string;
    }>('/compliance', { csr: Buffer.from(csrPem, 'utf8').toString('base64') }, { otp });

    const key = this.encryptionKey();
    await this.prisma.organization.update({
      where: { id: org.id },
      data: {
        zatcaCsidEncrypted: encryptSecret(derBase64ToPem(response.binarySecurityToken), key),
        zatcaPrivateKeyEncrypted: encryptSecret(privateKeyPem, key),
        zatcaApiSecretEncrypted: encryptSecret(response.secret, key),
        zatcaComplianceRequestId: response.requestID,
        zatcaEnvironment: 'compliance',
      },
    });

    await this.audit.log({
      organizationId: org.id,
      actorUserId: actorId,
      actorType: actorId ? 'staff' : 'system',
      action: 'zatca.compliance_csid_requested',
      entityType: 'organization',
      entityId: org.id,
    });

    this.logger.log(`ZATCA compliance CSID issued for org ${org.id} (request ${response.requestID})`);
    return { requestId: response.requestID, dispositionMessage: response.dispositionMessage };
  }

  /**
   * Step 2 — submits the two sample invoice types this system produces
   * against ZATCA's compliance-check endpoint using the compliance CSID from
   * step 1. See the module doc comment for why this is 2 checks, not 6.
   */
  async runComplianceChecks(organizationId: string) {
    const org = await this.getOrg(organizationId);
    if (org.zatcaEnvironment !== 'compliance' || !org.zatcaCsidEncrypted || !org.zatcaApiSecretEncrypted) {
      throw new BadRequestException('Request a Compliance CSID before running compliance checks');
    }

    const key = this.encryptionKey();
    const certificatePem = decryptSecret(org.zatcaCsidEncrypted, key);
    const privateKeyPem = decryptSecret(org.zatcaPrivateKeyEncrypted!, key);
    const secret = decryptSecret(org.zatcaApiSecretEncrypted, key);
    const credentials = { csid: readCertFacts(certificatePem).certificateDerBase64, secret };

    const results = [];
    for (const invoiceTypeCode of ['standard', 'simplified'] as const) {
      const sample = buildSampleInvoice(org, invoiceTypeCode);
      const baseXml = buildUblInvoice(sample);
      const canonical = canonicalize(baseXml);
      const invoiceHash = hashInvoiceXml(canonical);
      const { signedXml } = signInvoiceXml({
        baseXml,
        invoiceHash,
        certificatePem,
        privateKeyPem,
        isSimplified: invoiceTypeCode === 'simplified',
        qr: {
          sellerName: org.name,
          vatNumber: org.vatNumber ?? org.taxId ?? '000000000000000',
          timestamp: sample.issuedAt.toISOString(),
          invoiceTotal: sample.totalGross,
          vatTotal: sample.totalVat,
        },
      });

      const result = await this.apiClient.complianceRequest(
        '/compliance/invoices',
        { invoiceHash, invoice: Buffer.from(signedXml, 'utf8').toString('base64') },
        credentials,
      );
      results.push({ invoiceTypeCode, ...(result as object) });
    }

    return {
      checksRun: results.length,
      note: 'Covers standard and simplified tax invoices only — this system does not yet model credit/debit notes, so it cannot run the full 6-document ZATCA compliance suite.',
      results,
    };
  }

  /**
   * Step 3 — exchanges the compliance CSID for a Production CSID. Reuses the
   * same key pair (ZATCA issues a new certificate for the CSR already on
   * file, not a new one), so only the certificate and secret are replaced.
   */
  async requestProductionCsid(organizationId: string, actorId?: string) {
    const org = await this.getOrg(organizationId);
    if (org.zatcaEnvironment !== 'compliance' || !org.zatcaComplianceRequestId || !org.zatcaApiSecretEncrypted) {
      throw new BadRequestException('Complete the Compliance CSID step before requesting a Production CSID');
    }

    const key = this.encryptionKey();
    const certificatePem = decryptSecret(org.zatcaCsidEncrypted!, key);
    const secret = decryptSecret(org.zatcaApiSecretEncrypted, key);
    const csid = readCertFacts(certificatePem).certificateDerBase64;

    const response = await this.apiClient.complianceRequest<{
      requestID: string;
      binarySecurityToken: string;
      secret: string;
    }>('/production/csids', { compliance_request_id: org.zatcaComplianceRequestId }, { csid, secret });

    await this.prisma.organization.update({
      where: { id: org.id },
      data: {
        zatcaCsidEncrypted: encryptSecret(derBase64ToPem(response.binarySecurityToken), key),
        zatcaApiSecretEncrypted: encryptSecret(response.secret, key),
        zatcaEnvironment: 'production',
      },
    });

    await this.audit.log({
      organizationId: org.id,
      actorUserId: actorId,
      actorType: actorId ? 'staff' : 'system',
      action: 'zatca.production_csid_issued',
      entityType: 'organization',
      entityId: org.id,
    });

    this.logger.log(`ZATCA production CSID issued for org ${org.id} — live invoice submission now enabled`);
    return { stage: 'production' as const };
  }

  /**
   * Renewal — a single call, not a re-run of onboarding (see the module doc
   * comment for why an earlier version of this method was wrong). Proves
   * possession of the *current* Production CSID via Basic Auth, submits a
   * fresh OTP and fresh CSR together, and receives a new Production CSID
   * directly. A fresh CSR means a fresh key pair, so the stored private key
   * is replaced along with the certificate and secret — unlike the
   * Compliance→Production step of onboarding, which reuses one key pair
   * throughout.
   */
  async renewProductionCsid(organizationId: string, otp: string, csrFields: ZatcaCsrFields, actorId?: string) {
    const org = await this.getOrg(organizationId);
    if (org.zatcaEnvironment !== 'production' || !org.zatcaCsidEncrypted || !org.zatcaApiSecretEncrypted) {
      throw new BadRequestException('No production CSID on file to renew');
    }

    const key = this.encryptionKey();
    const currentCertificatePem = decryptSecret(org.zatcaCsidEncrypted, key);
    const currentSecret = decryptSecret(org.zatcaApiSecretEncrypted, key);
    const currentCsid = readCertFacts(currentCertificatePem).certificateDerBase64;

    const { csrPem, privateKeyPem } = generateCsr(csrFields);

    const response = await this.apiClient.complianceRequest<{
      binarySecurityToken: string;
      secret: string;
    }>(
      '/production/csids/renewal',
      { csr: Buffer.from(csrPem, 'utf8').toString('base64') },
      { csid: currentCsid, secret: currentSecret, otp },
    );

    await this.prisma.organization.update({
      where: { id: org.id },
      data: {
        zatcaCsidEncrypted: encryptSecret(derBase64ToPem(response.binarySecurityToken), key),
        zatcaPrivateKeyEncrypted: encryptSecret(privateKeyPem, key),
        zatcaApiSecretEncrypted: encryptSecret(response.secret, key),
        zatcaEnvironment: 'production',
      },
    });

    await this.audit.log({
      organizationId: org.id,
      actorUserId: actorId,
      actorType: actorId ? 'staff' : 'system',
      action: 'zatca.production_csid_renewed',
      entityType: 'organization',
      entityId: org.id,
    });

    this.logger.log(`ZATCA production CSID renewed for org ${org.id}`);
    return { stage: 'production' as const };
  }

  /**
   * Local-only revocation: wipes the stored CSID/key/secret so this system
   * immediately stops being able to sign or submit invoices with it, and
   * resets the onboarding stage to "not started". Deliberately does **not**
   * attempt a remote ZATCA revocation call — unlike every other endpoint in
   * this file, revocation isn't described step-by-step in the guideline
   * text available here, and guessing at that contract is worse than not
   * having it: a wrong local wipe is safely recoverable by re-onboarding,
   * a wrong remote revocation call is not. If a device is compromised,
   * revoke it here immediately and separately revoke it from the real
   * FATOORA portal, which this system cannot do on your behalf.
   */
  async revokeLocally(organizationId: string, actorId?: string) {
    const org = await this.getOrg(organizationId);
    await this.prisma.organization.update({
      where: { id: org.id },
      data: {
        zatcaCsidEncrypted: null,
        zatcaPrivateKeyEncrypted: null,
        zatcaApiSecretEncrypted: null,
        zatcaComplianceRequestId: null,
        zatcaEnvironment: null,
      },
    });
    await this.audit.log({
      organizationId: org.id,
      actorUserId: actorId,
      actorType: actorId ? 'staff' : 'system',
      action: 'zatca.csid_revoked_locally',
      entityType: 'organization',
      entityId: org.id,
    });
    this.logger.warn(`ZATCA CSID revoked locally for org ${org.id} — re-onboarding required before invoices can be submitted`);
    return { stage: 'not_started' as const };
  }
}

function buildSampleInvoice(
  org: { id: string; name: string; vatNumber: string | null; taxId: string | null },
  invoiceTypeCode: 'standard' | 'simplified',
) {
  const totals = splitInclusive('115.00', KSA_VAT_RATE);
  return {
    invoiceNumber: `COMPLIANCE-${invoiceTypeCode.toUpperCase()}-${Date.now()}`,
    uuid: randomUUID(),
    issuedAt: new Date(),
    icv: 1,
    previousHash: GENESIS_PIH,
    invoiceTypeCode,
    currency: 'SAR',
    seller: {
      name: org.name,
      vatNumber: org.vatNumber ?? org.taxId ?? '000000000000000',
      address: 'Compliance test address',
    },
    buyer: { name: 'ZATCA Compliance Test Buyer', phone: '+966500000000' },
    lines: [
      {
        id: 1,
        name: 'Compliance test garment',
        quantity: 1,
        unitCode: 'PCE',
        unitPrice: totals.net.toFixed(2),
        lineNet: totals.net.toFixed(2),
        lineVat: totals.vat.toFixed(2),
        vatRate: KSA_VAT_RATE.toFixed(2),
      },
    ],
    totalNet: totals.net.toFixed(2),
    totalVat: totals.vat.toFixed(2),
    totalGross: totals.gross.toFixed(2),
  };
}
