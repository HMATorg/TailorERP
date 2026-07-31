import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { verify as ecdsaVerify } from 'crypto';
import { GENESIS_PIH, hashInvoiceXml } from './zatca-hash';
import { readCertFacts } from './zatca-cert';
import { signInvoiceXml, signCanonicalInvoice } from './zatca-sign';
import { decodeTlv, ZatcaTag } from './zatca-tlv';
import { buildUblInvoice, canonicalize, stripSignatureElements } from './zatca-xml';

const FIXTURES = join(__dirname, 'test-fixtures');
const certificatePem = readFileSync(join(FIXTURES, 'test-certificate.pem'), 'utf8');
const privateKeyPem = readFileSync(join(FIXTURES, 'test-private-key.pem'), 'utf8');

describe('ZATCA XAdES signing (D-057)', () => {
  const baseInput = {
    invoiceNumber: 'INV-2026-000042',
    uuid: '3cf5ee18-ee25-44ea-a444-2c37ba7f28be',
    issuedAt: new Date('2026-07-29T14:30:00Z'),
    icv: 42,
    previousHash: GENESIS_PIH,
    invoiceTypeCode: 'simplified' as const,
    currency: 'SAR',
    seller: { name: 'Al Anwar Tailors', vatNumber: '300012345600003', address: 'Jeddah' },
    buyer: { name: 'Saquib Imtiaz', phone: '+966512345678' },
    lines: [
      {
        id: 1,
        name: 'Thobe',
        quantity: 1,
        unitCode: 'PCE',
        unitPrice: '434.78',
        lineNet: '434.78',
        lineVat: '65.22',
        vatRate: '15.00',
      },
    ],
    totalNet: '434.78',
    totalVat: '65.22',
    totalGross: '500.00',
  };

  function sign(overrides: Partial<Parameters<typeof signInvoiceXml>[0]> = {}) {
    const baseXml = buildUblInvoice(baseInput);
    const invoiceHash = hashInvoiceXml(canonicalize(baseXml));
    return signInvoiceXml({
      baseXml,
      invoiceHash,
      certificatePem,
      privateKeyPem,
      signingTime: new Date('2026-07-29T14:30:05Z'),
      isSimplified: true,
      qr: {
        sellerName: baseInput.seller.name,
        vatNumber: baseInput.seller.vatNumber,
        timestamp: baseInput.issuedAt.toISOString(),
        invoiceTotal: baseInput.totalGross,
        vatTotal: baseInput.totalVat,
      },
      ...overrides,
    });
  }

  it('produces a signature that verifies against the certificate\'s own public key', () => {
    const baseXml = buildUblInvoice(baseInput);
    const canonical = canonicalize(baseXml);
    const signatureBase64 = signCanonicalInvoice(canonical, privateKeyPem);

    const ok = ecdsaVerify(
      'sha256',
      Buffer.from(canonical, 'utf8'),
      { key: certificatePem, dsaEncoding: 'der' },
      Buffer.from(signatureBase64, 'base64'),
    );
    expect(ok).toBe(true);
  });

  it('rejects the signature if a single character of the invoice changes', () => {
    const canonical = canonicalize(buildUblInvoice(baseInput));
    const signatureBase64 = signCanonicalInvoice(canonical, privateKeyPem);
    const tampered = canonical.replace('434.78', '999.99');

    const ok = ecdsaVerify(
      'sha256',
      Buffer.from(tampered, 'utf8'),
      { key: certificatePem, dsaEncoding: 'der' },
      Buffer.from(signatureBase64, 'base64'),
    );
    expect(ok).toBe(false);
  });

  it('splices UBLExtensions in as the first child of <Invoice>, before ProfileID', () => {
    const { signedXml } = sign();
    const extIndex = signedXml.indexOf('<ext:UBLExtensions>');
    const profileIndex = signedXml.indexOf('<cbc:ProfileID>');
    expect(extIndex).toBeGreaterThan(-1);
    expect(extIndex).toBeLessThan(profileIndex);
  });

  it('carries the exact invoice hash into the UBLExtensions invoiceSignedData reference', () => {
    const baseXml = buildUblInvoice(baseInput);
    const invoiceHash = hashInvoiceXml(canonicalize(baseXml));
    const { signedXml } = sign({ baseXml, invoiceHash });
    expect(signedXml).toContain(
      `<ds:Reference Id="invoiceSignedData" URI="">`,
    );
    expect(signedXml).toContain(`<ds:DigestValue>${invoiceHash}</ds:DigestValue>`);
  });

  it('embeds the certificate and populates issuer/serial from it, not placeholders', () => {
    const { signedXml } = sign();
    const cert = readCertFacts(certificatePem);
    expect(signedXml).toContain(`<ds:X509Certificate>${cert.certificateDerBase64}</ds:X509Certificate>`);
    expect(signedXml).toContain(`<ds:X509SerialNumber>${cert.serialNumberDecimal}</ds:X509SerialNumber>`);
    expect(signedXml).toContain('CN=TSTZATCA-Code-Signing');
  });

  it('adds a QR AdditionalDocumentReference carrying the full 9-tag payload for a simplified invoice', () => {
    const { signedXml, qrCodeBase64 } = sign();
    expect(signedXml).toContain('<cbc:ID>QR</cbc:ID>');
    expect(signedXml).toContain(qrCodeBase64);

    const decoded = decodeTlv(qrCodeBase64);
    expect(Object.keys(decoded).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('omits QR tag 9 (CA signature over the CSID) for a standard (B2B) invoice', () => {
    const { qrCodeBase64, stampSignatureBase64 } = sign({ isSimplified: false });
    expect(stampSignatureBase64).toBeUndefined();
    const decoded = decodeTlv(qrCodeBase64);
    expect(Object.keys(decoded).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('canonicalize(stripSignatureElements(signedXml)) reproduces invoiceHash — the verifyChain() round-trip', () => {
    const baseXml = buildUblInvoice(baseInput);
    const canonical = canonicalize(baseXml);
    const invoiceHash = hashInvoiceXml(canonical);
    const { signedXml } = sign({ baseXml, invoiceHash });

    // stripSignatureElements() undoes the splice, restoring the raw (still
    // pretty-printed) baseXml — verifyChain() must re-canonicalize before
    // re-hashing, exactly as the original issue() path did.
    const restored = stripSignatureElements(signedXml);
    expect(restored).toBe(baseXml);
    expect(hashInvoiceXml(canonicalize(restored))).toBe(invoiceHash);
  });

  it('the SignedProperties hash changes if the signing time changes, proving it is not a stale placeholder', () => {
    const a = sign({ signingTime: new Date('2026-07-29T14:30:05Z') });
    const b = sign({ signingTime: new Date('2026-07-29T15:00:00Z') });
    const digestOf = (xml: string) => xml.match(/URI="#xadesSignedProperties">\s*<ds:DigestMethod[^>]*\/>\s*<ds:DigestValue>([^<]+)</)?.[1];
    expect(digestOf(a.signedXml)).toBeDefined();
    expect(digestOf(a.signedXml)).not.toBe(digestOf(b.signedXml));
  });
});
