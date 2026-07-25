import { createHash } from 'crypto';

/**
 * ZATCA hash chain (PIH — Previous Invoice Hash).
 *
 * Each invoice hashes its own canonical XML and embeds the previous invoice's
 * hash, so the sequence is tamper-evident: altering an old invoice invalidates
 * every hash after it. The first invoice of a chain uses a fixed genesis value
 * defined by ZATCA (base64 of "0").
 */
export const GENESIS_PIH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';

/** SHA-256 of the canonical XML, base64 — the form ZATCA carries in the QR. */
export function hashInvoiceXml(canonicalXml: string): string {
  return createHash('sha256').update(canonicalXml, 'utf8').digest('base64');
}

/**
 * Verifies a chain is intact.
 * Returns the index of the first broken link, or -1 when the chain is sound.
 */
export function findChainBreak(
  invoices: { invoiceHash: string | null; previousHash: string | null }[],
): number {
  for (let i = 0; i < invoices.length; i++) {
    const expected = i === 0 ? GENESIS_PIH : invoices[i - 1].invoiceHash;
    if (invoices[i].previousHash !== expected) return i;
  }
  return -1;
}
