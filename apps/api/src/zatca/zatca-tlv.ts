/**
 * ZATCA QR code payload — TLV (Tag-Length-Value) encoded, then Base64.
 *
 * Phase 1 mandated tags 1–5. Phase 2 adds 6–9 (hash + ECDSA signature +
 * public key, and for standard invoices the certificate signature).
 * Reference: ZATCA E-Invoicing Detailed Technical Guideline, §"QR Code".
 *
 * Every value is UTF-8; length is a single byte, so any value must be ≤ 255
 * bytes. That constraint is real — a long seller name will silently break the
 * QR if not validated, so we throw instead.
 */

export enum ZatcaTag {
  SellerName = 1,
  VatNumber = 2,
  Timestamp = 3,
  InvoiceTotal = 4, // gross, VAT inclusive
  VatTotal = 5,
  InvoiceHash = 6,
  EcdsaSignature = 7,
  EcdsaPublicKey = 8,
  StampSignature = 9, // standard (B2B) invoices only
}

export interface ZatcaQrFields {
  sellerName: string;
  vatNumber: string;
  /** ISO 8601 with timezone, e.g. 2026-07-25T14:30:00+03:00 */
  timestamp: string;
  /** Gross total, VAT inclusive, 2dp */
  invoiceTotal: string;
  /** VAT amount, 2dp */
  vatTotal: string;
  /** Base64 SHA-256 of the canonical XML (Phase 2) */
  invoiceHash?: string;
  /** Base64 ECDSA signature (Phase 2) */
  signature?: string;
  /** Base64 DER public key (Phase 2) */
  publicKey?: string;
  /** Certificate signature — standard invoices only */
  stampSignature?: string;
}

function encodeTag(tag: ZatcaTag, value: string | Buffer): Buffer {
  const valueBuffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  if (valueBuffer.length > 255) {
    throw new Error(
      `ZATCA TLV tag ${tag} is ${valueBuffer.length} bytes; the length field is one byte (max 255)`,
    );
  }
  return Buffer.concat([Buffer.from([tag, valueBuffer.length]), valueBuffer]);
}

/** Builds the raw TLV buffer in ascending tag order, as the spec requires. */
export function buildTlv(fields: ZatcaQrFields): Buffer {
  const parts: Buffer[] = [
    encodeTag(ZatcaTag.SellerName, fields.sellerName),
    encodeTag(ZatcaTag.VatNumber, fields.vatNumber),
    encodeTag(ZatcaTag.Timestamp, fields.timestamp),
    encodeTag(ZatcaTag.InvoiceTotal, fields.invoiceTotal),
    encodeTag(ZatcaTag.VatTotal, fields.vatTotal),
  ];

  // Phase 2 tags are appended only when the cryptographic material exists,
  // so a Phase 1 fallback still produces a valid (shorter) code.
  if (fields.invoiceHash) {
    parts.push(encodeTag(ZatcaTag.InvoiceHash, Buffer.from(fields.invoiceHash, 'base64')));
  }
  if (fields.signature) {
    parts.push(encodeTag(ZatcaTag.EcdsaSignature, Buffer.from(fields.signature, 'base64')));
  }
  if (fields.publicKey) {
    parts.push(encodeTag(ZatcaTag.EcdsaPublicKey, Buffer.from(fields.publicKey, 'base64')));
  }
  if (fields.stampSignature) {
    parts.push(encodeTag(ZatcaTag.StampSignature, Buffer.from(fields.stampSignature, 'base64')));
  }

  return Buffer.concat(parts);
}

export function buildQrBase64(fields: ZatcaQrFields): string {
  return buildTlv(fields).toString('base64');
}

/** Inverse of buildTlv — used by tests and by the compliance self-check. */
export function decodeTlv(base64: string): Record<number, Buffer> {
  const buffer = Buffer.from(base64, 'base64');
  const out: Record<number, Buffer> = {};
  let offset = 0;
  while (offset < buffer.length) {
    const tag = buffer[offset];
    const length = buffer[offset + 1];
    if (length === undefined || offset + 2 + length > buffer.length) {
      throw new Error(`Malformed TLV: tag ${tag} claims ${length} bytes beyond the buffer`);
    }
    out[tag] = buffer.subarray(offset + 2, offset + 2 + length);
    offset += 2 + length;
  }
  return out;
}
