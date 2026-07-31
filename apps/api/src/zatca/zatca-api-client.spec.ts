import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { ZatcaApiClient } from './zatca-api-client';

describe('ZatcaApiClient (D-057, shapes corrected D-059)', () => {
  const credentials = { csid: 'test-csid', secret: 'test-secret' };
  const request = { invoiceHash: 'aGFzaA==', invoiceXmlBase64: 'PEludm9pY2U+' };

  function client(env: Record<string, string | undefined>) {
    const config = new ConfigService(env);
    return new ZatcaApiClient(config);
  }

  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('isConfigured() reflects whether ZATCA_API_BASE is set', () => {
    expect(client({}).isConfigured()).toBe(false);
    expect(client({ ZATCA_API_BASE: 'https://api.zatca.example' }).isConfigured()).toBe(true);
  });

  it('returns not_configured without calling fetch when ZATCA_API_BASE is unset', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await client({}).reportInvoice(credentials, request);

    expect(result).toEqual({ outcome: 'not_configured', warnings: [], errors: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reportInvoice() posts Basic auth and the exact 2-field body ZATCA documents', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      status: 200,
      type: 'basic',
      json: async () => ({ invoiceHash: request.invoiceHash, status: 'Reported', warnings: null, errors: null }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await client({ ZATCA_API_BASE: 'https://api.zatca.example' }).reportInvoice(credentials, request);

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.zatca.example/invoices/reporting/single',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('test-csid:test-secret').toString('base64')}`,
        }),
        body: JSON.stringify({ invoiceHash: request.invoiceHash, invoice: request.invoiceXmlBase64 }),
      }),
    );
    expect(result.outcome).toBe('valid');
  });

  it('clearInvoice() hits the clearance endpoint', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      status: 200,
      type: 'basic',
      json: async () => ({ invoiceHash: request.invoiceHash, status: 'Cleared', warnings: null, errors: null }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await client({ ZATCA_API_BASE: 'https://api.zatca.example' }).clearInvoice(credentials, request);

    expect(fetchSpy).toHaveBeenCalledWith('https://api.zatca.example/invoices/clearance/single', expect.anything());
    expect(result.outcome).toBe('valid');
  });

  it('maps a non-empty warnings array to the warnings outcome', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      status: 200,
      type: 'basic',
      json: async () => ({
        invoiceHash: request.invoiceHash,
        status: 'Reported',
        warnings: [{ message: 'Buyer VAT number is missing' }],
        errors: null,
      }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await client({ ZATCA_API_BASE: 'https://api.zatca.example' }).reportInvoice(credentials, request);

    expect(result.outcome).toBe('warnings');
    expect(result.warnings).toHaveLength(1);
  });

  it('treats HTTP 202 as a warnings outcome even without an explicit warnings array', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      status: 202,
      type: 'basic',
      json: async () => ({ invoiceHash: request.invoiceHash, status: 'Reported', warnings: null, errors: null }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await client({ ZATCA_API_BASE: 'https://api.zatca.example' }).reportInvoice(credentials, request);

    expect(result.outcome).toBe('warnings');
  });

  it('maps a non-empty errors array (or a 400) to the rejected outcome', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      status: 400,
      type: 'basic',
      json: async () => ({
        invoiceHash: request.invoiceHash,
        status: 'NotReported',
        warnings: null,
        errors: [{ message: 'Invalid invoice hash' }],
      }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await client({ ZATCA_API_BASE: 'https://api.zatca.example' }).reportInvoice(credentials, request);

    expect(result.outcome).toBe('rejected');
    expect(result.httpStatus).toBe(400);
    expect(result.errors).toHaveLength(1);
  });

  it('treats a 303 (wrong endpoint for this document type) as wrong_endpoint, never following the redirect', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ status: 303, type: 'basic', json: async () => ({}) });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await client({ ZATCA_API_BASE: 'https://api.zatca.example' }).clearInvoice(credentials, request);

    expect(fetchSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ redirect: 'manual' }));
    expect(result.outcome).toBe('wrong_endpoint');
  });

  it('returns network_error and never throws when fetch itself rejects', async () => {
    const fetchSpy = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await client({ ZATCA_API_BASE: 'https://api.zatca.example' }).reportInvoice(credentials, request);

    expect(result.outcome).toBe('network_error');
    expect(result.errors[0].message).toContain('ECONNREFUSED');
  });

  it('treats a bare 200 with no warnings/errors as valid (defensive default)', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ status: 200, type: 'basic', json: async () => ({}) });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await client({ ZATCA_API_BASE: 'https://api.zatca.example' }).reportInvoice(credentials, request);

    expect(result.outcome).toBe('valid');
  });

  describe('complianceRequest', () => {
    it('throws a clean BadRequestException (not a bare 500) when ZATCA_API_BASE is unset', async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as unknown as typeof fetch;

      await expect(client({}).complianceRequest('/compliance', {}, { otp: '123456' })).rejects.toThrow(
        /ZATCA is not configured/,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sends only the OTP header when no csid/secret is supplied (the first-ever compliance-CSID request)', async () => {
      const fetchSpy = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ requestID: 'req-1' }) });
      global.fetch = fetchSpy as unknown as typeof fetch;

      await client({ ZATCA_API_BASE: 'https://api.zatca.example' }).complianceRequest(
        '/compliance',
        { csr: 'BASE64CSR' },
        { otp: '123456' },
      );

      const [, init] = fetchSpy.mock.calls[0];
      expect(init.headers.OTP).toBe('123456');
      expect(init.headers.Authorization).toBeUndefined();
    });

    it('sends only Basic auth when csid/secret is supplied with no otp (the production-CSID request)', async () => {
      const fetchSpy = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ requestID: 'req-2' }) });
      global.fetch = fetchSpy as unknown as typeof fetch;

      await client({ ZATCA_API_BASE: 'https://api.zatca.example' }).complianceRequest(
        '/production/csids',
        { compliance_request_id: 'req-1' },
        { csid: 'csid-value', secret: 'csid-secret' },
      );

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.zatca.example/production/csids');
      expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('csid-value:csid-secret').toString('base64')}`);
      expect(init.headers.OTP).toBeUndefined();
    });

    it('sends both Basic auth and an OTP header when all three are supplied (renewal)', async () => {
      const fetchSpy = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      global.fetch = fetchSpy as unknown as typeof fetch;

      await client({ ZATCA_API_BASE: 'https://api.zatca.example' }).complianceRequest(
        '/production/csids/renewal',
        { csr: 'BASE64CSR' },
        { csid: 'csid-value', secret: 'csid-secret', otp: '654321' },
      );

      const [, init] = fetchSpy.mock.calls[0];
      expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('csid-value:csid-secret').toString('base64')}`);
      expect(init.headers.OTP).toBe('654321');
    });

    it('throws with the response body when ZATCA rejects the request', async () => {
      const fetchSpy = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'Invalid OTP' }) });
      global.fetch = fetchSpy as unknown as typeof fetch;

      await expect(
        client({ ZATCA_API_BASE: 'https://api.zatca.example' }).complianceRequest('/compliance', {}, { otp: 'bad-otp' }),
      ).rejects.toThrow(/Invalid OTP/);
    });
  });
});
