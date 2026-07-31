import { X509Certificate, createHash } from 'crypto';
import * as asn1js from 'asn1js';

/**
 * Certificate facts the XAdES signing pipeline (D-057) and the QR tags 8–9
 * need, pulled from a PEM CSID certificate. Node's `X509Certificate` covers
 * most of it; the certificate's own CA-issued signature (QR tag 9 — "the
 * ECDSA signature of the cryptographic stamp's public key by ZATCA's
 * technical CA") is not exposed by any Node API, so it's read directly off
 * the DER structure: `Certificate ::= SEQUENCE { tbsCertificate,
 * signatureAlgorithm, signatureValue }` — the third element is exactly that
 * signature.
 */
export interface ZatcaCertFacts {
  /** Base64 DER of the whole certificate, for <ds:X509Certificate>. */
  certificateDerBase64: string;
  /** Base64 SHA-256 of the DER certificate — Section 5 Step 3. */
  certificateHashBase64: string;
  /** RFC 4514-style DN, most-specific first (e.g. "CN=...,OU=...,O=...,C=SA") — <ds:X509IssuerName>. */
  issuerName: string;
  /** Decimal string — <ds:X509SerialNumber>. X.509 stores this as an integer; XAdES renders it decimal. */
  serialNumberDecimal: string;
  /** Base64 SubjectPublicKeyInfo (DER) — QR tag 8, "ECDSA public key". */
  publicKeySpkiBase64: string;
  /** Base64 of the certificate's own CA signature — QR tag 9. */
  caSignatureBase64: string;
}

/**
 * ZATCA's onboarding APIs return a certificate as a base64 `binarySecurityToken`
 * (raw DER, no PEM wrapper) — everything else in this module (`readCertFacts`,
 * `signInvoiceXml`) expects PEM, so onboarding wraps the token through this
 * before storing or using it.
 */
export function derBase64ToPem(derBase64: string): string {
  const lines = derBase64.match(/.{1,64}/g) ?? [derBase64];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

export function readCertFacts(certificatePem: string): ZatcaCertFacts {
  const cert = new X509Certificate(certificatePem);
  const der = cert.raw;

  // Node's `.issuer` is "\n"-joined in encoding order (least-specific first);
  // XAdES's conventional X509IssuerName rendering is most-specific first.
  const issuerName = cert.issuer.split('\n').reverse().join(',');

  const serialNumberDecimal = BigInt(`0x${cert.serialNumber}`).toString(10);

  const publicKeySpkiBase64 = cert.publicKey
    .export({ type: 'spki', format: 'der' })
    .toString('base64');

  const asn1 = asn1js.fromBER(der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength));
  if (asn1.offset === -1) {
    throw new Error('Could not parse certificate DER structure');
  }
  const top = asn1.result as unknown as { valueBlock: { value: unknown[] } };
  const sigValueBlock = top.valueBlock.value[2] as { valueBlock: { valueHexView: Uint8Array } };
  const caSignatureBase64 = Buffer.from(sigValueBlock.valueBlock.valueHexView).toString('base64');

  return {
    certificateDerBase64: der.toString('base64'),
    certificateHashBase64: createHash('sha256').update(der).digest('base64'),
    issuerName,
    serialNumberDecimal,
    publicKeySpkiBase64,
    caSignatureBase64,
  };
}
