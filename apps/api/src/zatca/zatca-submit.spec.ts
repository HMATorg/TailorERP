import { readFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { encryptSecret } from '../notifications/crypto.util';
import type { ZatcaSubmissionResult } from './zatca-api-client';
import { readCertFacts } from './zatca-cert';
import { ZatcaService } from './zatca.service';

/**
 * `ZatcaService.submit()` (D-057) — the Reporting/Clearance call this
 * project can only exercise against a mock, since it needs a real ZATCA
 * CSID no test environment has. Mirrors the constructor-injection mocking
 * pattern already used by `invoices.service.spec.ts` rather than Nest's
 * TestingModule, which nothing else in this module uses.
 */
const ENCRYPTION_KEY = 'a'.repeat(64); // 32-byte hex, same shape as TOKEN_ENCRYPTION_KEY
const FIXTURES = join(__dirname, 'test-fixtures');
const certificatePem = readFileSync(join(FIXTURES, 'test-certificate.pem'), 'utf8');
const certDerBase64 = readCertFacts(certificatePem).certificateDerBase64;

const dec = (v: string) => new Prisma.Decimal(v);

const baseInvoice = {
  id: 'inv-1',
  invoiceNumber: 'INV-2026-000001',
  zatcaUuid: '3cf5ee18-ee25-44ea-a444-2c37ba7f28be',
  invoiceHash: 'aGFzaA==',
  xmlUrl: 'zatca/org-1/INV-2026-000001.xml',
  zatcaInvoiceType: 'simplified' as 'simplified' | 'standard',
  submittedAt: null as Date | null,
  organization: {
    zatcaCsidEncrypted: encryptSecret(certificatePem, ENCRYPTION_KEY),
    zatcaApiSecretEncrypted: encryptSecret('device-secret', ENCRYPTION_KEY),
    zatcaEnvironment: 'production' as string | null,
  },
};

function build(opts: { invoice?: Partial<typeof baseInvoice> | null; apiConfigured?: boolean } = {}) {
  const invoice = opts.invoice === null ? null : { ...baseInvoice, ...opts.invoice };

  const prisma = {
    invoice: {
      findUnique: jest.fn(async () => invoice),
      update: jest.fn(async (args: any) => ({ ...invoice, ...args.data })),
    },
  };
  const config = {
    get: jest.fn((key: string) => (key === 'TOKEN_ENCRYPTION_KEY' ? ENCRYPTION_KEY : undefined)),
    getOrThrow: jest.fn((key: string) => {
      if (key === 'TOKEN_ENCRYPTION_KEY') return ENCRYPTION_KEY;
      throw new Error(`missing config ${key}`);
    }),
  };
  const storage = {
    isEnabled: jest.fn(() => true),
    getObject: jest.fn(async () => Buffer.from('<Invoice>signed</Invoice>', 'utf8')),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const okResult: ZatcaSubmissionResult = {
    outcome: 'valid',
    httpStatus: 200,
    warnings: [],
    errors: [],
    raw: { validationResults: { status: 'PASS' } },
  };
  const apiClient = {
    isConfigured: jest.fn(() => opts.apiConfigured ?? true),
    reportInvoice: jest.fn(async (): Promise<ZatcaSubmissionResult> => okResult),
    clearInvoice: jest.fn(async (): Promise<ZatcaSubmissionResult> => okResult),
  };

  const service = new ZatcaService(prisma as any, config as any, storage as any, audit as any, apiClient as any);
  return { service, prisma, storage, apiClient };
}

describe('ZatcaService.submit', () => {
  it('returns zatca_not_onboarded without calling the API when ZATCA is not configured', async () => {
    const { service, apiClient } = build({ apiConfigured: false });
    const result = await service.submit('inv-1');
    expect(result).toEqual({ submitted: false, reason: 'zatca_not_onboarded' });
    expect(apiClient.reportInvoice).not.toHaveBeenCalled();
  });

  it('returns zatca_not_onboarded when the org has no CSID or secret on file', async () => {
    const { service, apiClient } = build({
      invoice: {
        organization: {
          ...baseInvoice.organization,
          zatcaCsidEncrypted: null as any,
          zatcaApiSecretEncrypted: null as any,
        },
      },
    });
    const result = await service.submit('inv-1');
    expect(result).toEqual({ submitted: false, reason: 'zatca_not_onboarded' });
    expect(apiClient.reportInvoice).not.toHaveBeenCalled();
  });

  it('returns zatca_not_onboarded when the org only has a compliance-stage CSID, not production', async () => {
    const { service, apiClient } = build({
      invoice: { organization: { ...baseInvoice.organization, zatcaEnvironment: 'compliance' } },
    });
    const result = await service.submit('inv-1');
    expect(result).toEqual({ submitted: false, reason: 'zatca_not_onboarded' });
    expect(apiClient.reportInvoice).not.toHaveBeenCalled();
  });

  it('returns not_issued when the invoice has no ZATCA UUID yet', async () => {
    const { service } = build({ invoice: { zatcaUuid: null as any } });
    const result = await service.submit('inv-1');
    expect(result).toEqual({ submitted: false, reason: 'not_issued' });
  });

  it('returns archive_unavailable when there is no archived XML to submit', async () => {
    const { service } = build({ invoice: { xmlUrl: null as any } });
    const result = await service.submit('inv-1');
    expect(result).toEqual({ submitted: false, reason: 'archive_unavailable' });
  });

  it('reports a simplified invoice, deriving Basic-auth credentials from the certificate and secret', async () => {
    const { service, apiClient, storage } = build();
    const result = await service.submit('inv-1');

    expect(storage.getObject).toHaveBeenCalledWith(baseInvoice.xmlUrl);
    expect(apiClient.reportInvoice).toHaveBeenCalledWith(
      { csid: certDerBase64, secret: 'device-secret' },
      {
        invoiceHash: baseInvoice.invoiceHash,
        invoiceXmlBase64: Buffer.from('<Invoice>signed</Invoice>', 'utf8').toString('base64'),
      },
    );
    expect(apiClient.clearInvoice).not.toHaveBeenCalled();
    expect(result.submitted).toBe(true);
    expect(result.outcome).toBe('valid');
  });

  it('clears a standard invoice instead of reporting it', async () => {
    const { service, apiClient } = build({ invoice: { zatcaInvoiceType: 'standard' as const } });
    await service.submit('inv-1');
    expect(apiClient.clearInvoice).toHaveBeenCalled();
    expect(apiClient.reportInvoice).not.toHaveBeenCalled();
  });

  it('persists reported status and the raw response on success', async () => {
    const { service, prisma } = build();
    await service.submit('inv-1');
    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({
          submissionStatus: 'reported',
          clearanceStatus: 'valid',
          zatcaResponse: { validationResults: { status: 'PASS' } },
        }),
      }),
    );
  });

  it('persists failed status and leaves submittedAt untouched when ZATCA rejects the invoice', async () => {
    const { service, prisma, apiClient } = build();
    apiClient.reportInvoice.mockResolvedValueOnce({
      outcome: 'rejected',
      httpStatus: 400,
      warnings: [],
      errors: [{ message: 'Invalid invoice hash' }],
      raw: { validationResults: { status: 'ERROR' } },
    });

    const result = await service.submit('inv-1');

    expect(result.submitted).toBe(false);
    expect(result.outcome).toBe('rejected');
    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ submissionStatus: 'failed', submittedAt: null }),
      }),
    );
  });
});
