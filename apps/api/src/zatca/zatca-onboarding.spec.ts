import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { decryptSecret, encryptSecret } from '../notifications/crypto.util';
import { readCertFacts } from './zatca-cert';
import { ZatcaOnboardingService } from './zatca-onboarding.service';

/**
 * `ZatcaOnboardingService` (D-058) — mocks `ZatcaApiClient.complianceRequest`
 * rather than `fetch`, since the client itself is already covered by
 * `zatca-api-client.spec.ts`. Real certificate/key fixtures are used (not
 * placeholder strings) so the encrypt/decrypt round-trip and
 * `readCertFacts()` calls this service makes are exercised for real, the
 * same discipline `zatca-submit.spec.ts` and `zatca-sign.spec.ts` already
 * follow.
 */
const ENCRYPTION_KEY = 'b'.repeat(64);
const FIXTURES = join(__dirname, 'test-fixtures');
const certificatePem = readFileSync(join(FIXTURES, 'test-certificate.pem'), 'utf8');
const certDerBase64 = readCertFacts(certificatePem).certificateDerBase64;
const binarySecurityToken = certDerBase64; // ZATCA returns raw DER base64, same bytes as our own encoding

const csrFields = {
  commonName: 'Al Anwar Tailors — Jeddah POS 1',
  egsSerialNumber: '1-Tailonix|2-1.0|3-11111111-2222-3333-4444-555555555555',
  organizationIdentifier: '300012345600003',
  organizationUnitName: 'Jeddah — Corniche',
  organizationName: 'Al Anwar Tailors',
  countryName: 'SA',
  invoiceType: '1100',
  location: 'Jeddah, Al Andalus District',
  industry: 'Tailoring and garment manufacturing',
};

function build(orgOverrides: Record<string, unknown> = {}) {
  const org = {
    id: 'org-1',
    name: 'Al Anwar Tailors',
    vatNumber: '300012345600003',
    taxId: null,
    zatcaCsidEncrypted: null as string | null,
    zatcaPrivateKeyEncrypted: null as string | null,
    zatcaApiSecretEncrypted: null as string | null,
    zatcaEnvironment: null as string | null,
    zatcaComplianceRequestId: null as string | null,
    ...orgOverrides,
  };

  const prisma = {
    organization: {
      findUnique: jest.fn(async () => org),
      update: jest.fn(async (args: any) => Object.assign(org, args.data)),
    },
  };
  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'TOKEN_ENCRYPTION_KEY') return ENCRYPTION_KEY;
      throw new Error(`missing config ${key}`);
    }),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const apiClient = {
    complianceRequest: jest.fn(),
  };

  const service = new ZatcaOnboardingService(prisma as any, config as any, audit as any, apiClient as any);
  return { service, prisma, org, audit, apiClient };
}

describe('ZatcaOnboardingService.status', () => {
  it('reports not_started before any onboarding has happened', async () => {
    const { service } = build();
    expect(await service.status('org-1')).toEqual({ stage: 'not_started', hasCredentials: false });
  });

  it('reports the stage and credential presence once onboarded', async () => {
    const { service } = build({
      zatcaEnvironment: 'production',
      zatcaCsidEncrypted: 'x',
      zatcaApiSecretEncrypted: 'y',
    });
    expect(await service.status('org-1')).toEqual({ stage: 'production', hasCredentials: true });
  });
});

describe('ZatcaOnboardingService.requestComplianceCsid', () => {
  it('submits the CSR + OTP and stores the returned certificate, secret, and request id', async () => {
    const { service, prisma, apiClient } = build();
    apiClient.complianceRequest.mockResolvedValue({
      requestID: 'req-123',
      dispositionMessage: 'ISSUED',
      binarySecurityToken,
      secret: 'compliance-secret',
    });

    const result = await service.requestComplianceCsid('org-1', '123456', csrFields, 'user-1');

    expect(apiClient.complianceRequest).toHaveBeenCalledWith(
      '/compliance',
      expect.objectContaining({ csr: expect.any(String) }),
      { otp: '123456' },
    );
    expect(result).toEqual({ requestId: 'req-123', dispositionMessage: 'ISSUED' });

    const data = prisma.organization.update.mock.calls[0][0].data;
    expect(data.zatcaEnvironment).toBe('compliance');
    expect(data.zatcaComplianceRequestId).toBe('req-123');
    expect(decryptSecret(data.zatcaApiSecretEncrypted, ENCRYPTION_KEY)).toBe('compliance-secret');
    expect(decryptSecret(data.zatcaCsidEncrypted, ENCRYPTION_KEY)).toContain('-----BEGIN CERTIFICATE-----');
    expect(decryptSecret(data.zatcaPrivateKeyEncrypted, ENCRYPTION_KEY)).toContain('-----BEGIN PRIVATE KEY-----');
  });
});

describe('ZatcaOnboardingService.runComplianceChecks', () => {
  it('refuses to run before a compliance CSID exists', async () => {
    const { service } = build();
    await expect(service.runComplianceChecks('org-1')).rejects.toThrow(BadRequestException);
  });

  it('submits one standard and one simplified sample invoice using the compliance CSID', async () => {
    const { service, apiClient } = build({
      zatcaEnvironment: 'compliance',
      zatcaCsidEncrypted: encrypt(certificatePem),
      zatcaPrivateKeyEncrypted: encrypt(readFileSync(join(FIXTURES, 'test-private-key.pem'), 'utf8')),
      zatcaApiSecretEncrypted: encrypt('compliance-secret'),
    });
    apiClient.complianceRequest.mockResolvedValue({ invoiceHash: 'h', status: 'Reported', warnings: null, errors: null });

    const result = await service.runComplianceChecks('org-1');

    expect(apiClient.complianceRequest).toHaveBeenCalledTimes(2);
    const [path, body, auth] = apiClient.complianceRequest.mock.calls[0];
    expect(path).toBe('/compliance/invoices');
    expect(body).not.toHaveProperty('uuid');
    expect(auth).toEqual({ csid: certDerBase64, secret: 'compliance-secret' });
    expect(result.checksRun).toBe(2);
    expect(result.results.map((r: any) => r.invoiceTypeCode)).toEqual(['standard', 'simplified']);
  });
});

describe('ZatcaOnboardingService.requestProductionCsid', () => {
  it('refuses to run before compliance checks have a request id on file', async () => {
    const { service } = build();
    await expect(service.requestProductionCsid('org-1')).rejects.toThrow(BadRequestException);
  });

  it('exchanges the compliance request id for a production CSID and secret', async () => {
    const { service, prisma, apiClient } = build({
      zatcaEnvironment: 'compliance',
      zatcaCsidEncrypted: encrypt(certificatePem),
      zatcaApiSecretEncrypted: encrypt('compliance-secret'),
      zatcaComplianceRequestId: 'req-123',
    });
    apiClient.complianceRequest.mockResolvedValue({
      requestID: 'req-456',
      binarySecurityToken,
      secret: 'production-secret',
    });

    const result = await service.requestProductionCsid('org-1', 'user-1');

    expect(apiClient.complianceRequest).toHaveBeenCalledWith(
      '/production/csids',
      { compliance_request_id: 'req-123' },
      { csid: certDerBase64, secret: 'compliance-secret' },
    );
    expect(result).toEqual({ stage: 'production' });

    const data = prisma.organization.update.mock.calls[0][0].data;
    expect(data.zatcaEnvironment).toBe('production');
    expect(decryptSecret(data.zatcaApiSecretEncrypted, ENCRYPTION_KEY)).toBe('production-secret');
  });
});

describe('ZatcaOnboardingService.renewProductionCsid', () => {
  it('refuses to run when there is no production CSID on file', async () => {
    const { service } = build();
    await expect(service.renewProductionCsid('org-1', '123456', csrFields)).rejects.toThrow(BadRequestException);
  });

  it('authenticates with the CURRENT production CSID and sends OTP + a fresh CSR together, not the old two-call chain', async () => {
    const { service, prisma, apiClient } = build({
      zatcaEnvironment: 'production',
      zatcaCsidEncrypted: encrypt(certificatePem),
      zatcaPrivateKeyEncrypted: encrypt(readFileSync(join(FIXTURES, 'test-private-key.pem'), 'utf8')),
      zatcaApiSecretEncrypted: encrypt('old-production-secret'),
    });
    apiClient.complianceRequest.mockResolvedValue({
      binarySecurityToken,
      secret: 'new-production-secret',
    });

    const result = await service.renewProductionCsid('org-1', '654321', csrFields, 'user-1');

    // A single call — not requestComplianceCsid() followed by requestProductionCsid().
    expect(apiClient.complianceRequest).toHaveBeenCalledTimes(1);
    expect(apiClient.complianceRequest).toHaveBeenCalledWith(
      '/production/csids/renewal',
      expect.objectContaining({ csr: expect.any(String) }),
      { csid: certDerBase64, secret: 'old-production-secret', otp: '654321' },
    );
    expect(result).toEqual({ stage: 'production' });

    const data = prisma.organization.update.mock.calls[0][0].data;
    expect(data.zatcaEnvironment).toBe('production');
    expect(decryptSecret(data.zatcaApiSecretEncrypted, ENCRYPTION_KEY)).toBe('new-production-secret');
    // A fresh CSR means a fresh key pair — the stored private key must change too.
    expect(decryptSecret(data.zatcaPrivateKeyEncrypted, ENCRYPTION_KEY)).not.toBe(
      readFileSync(join(FIXTURES, 'test-private-key.pem'), 'utf8'),
    );
  });
});

describe('ZatcaOnboardingService.revokeLocally', () => {
  it('wipes all stored ZATCA credentials and resets the stage', async () => {
    const { service, prisma } = build({
      zatcaEnvironment: 'production',
      zatcaCsidEncrypted: 'x',
      zatcaPrivateKeyEncrypted: 'y',
      zatcaApiSecretEncrypted: 'z',
      zatcaComplianceRequestId: 'req-123',
    });

    const result = await service.revokeLocally('org-1', 'user-1');

    expect(result).toEqual({ stage: 'not_started' });
    const data = prisma.organization.update.mock.calls[0][0].data;
    expect(data).toEqual({
      zatcaCsidEncrypted: null,
      zatcaPrivateKeyEncrypted: null,
      zatcaApiSecretEncrypted: null,
      zatcaComplianceRequestId: null,
      zatcaEnvironment: null,
    });
  });
});

function encrypt(plaintext: string): string {
  return encryptSecret(plaintext, ENCRYPTION_KEY);
}
