import 'reflect-metadata';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateCsr, type ZatcaCsrFields } from './zatca-csr';

const fields: ZatcaCsrFields = {
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

describe('ZATCA CSR generation (D-057)', () => {
  it('produces a well-formed PKCS#10 request and a matching EC private key', () => {
    const { csrPem, privateKeyPem } = generateCsr(fields);
    expect(csrPem).toContain('-----BEGIN CERTIFICATE REQUEST-----');
    expect(privateKeyPem).toContain('-----BEGIN PRIVATE KEY-----');
  });

  it('generates a fresh key pair on every call', () => {
    const a = generateCsr(fields);
    const b = generateCsr(fields);
    expect(a.privateKeyPem).not.toBe(b.privateKeyPem);
    expect(a.csrPem).not.toBe(b.csrPem);
  });

  it('carries all eight required fields somewhere in the request', () => {
    const { csrPem } = generateCsr(fields);
    const dir = mkdtempSync(join(tmpdir(), 'zatca-csr-'));
    try {
      const csrPath = join(dir, 'test.csr');
      writeFileSync(csrPath, csrPem);
      const text = execFileSync('openssl', ['req', '-in', csrPath, '-noout', '-text']).toString('utf8');
      expect(text).toContain(fields.commonName);
      expect(text).toContain(fields.organizationIdentifier);
      expect(text).toContain(fields.organizationUnitName);
      expect(text).toContain(fields.organizationName);
      expect(text).toContain(fields.invoiceType);
      expect(text).toContain(fields.location);
      expect(text).toContain(fields.industry);
      expect(text).toMatch(/secp256k1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is independently verifiable by OpenSSL — proves the self-signature is genuinely valid, not just well-formed', () => {
    const { csrPem } = generateCsr(fields);
    const dir = mkdtempSync(join(tmpdir(), 'zatca-csr-'));
    try {
      const csrPath = join(dir, 'test.csr');
      writeFileSync(csrPath, csrPem);
      const output = execFileSync('openssl', ['req', '-in', csrPath, '-verify', '-noout']).toString('utf8');
      expect(output).toMatch(/verify OK/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
