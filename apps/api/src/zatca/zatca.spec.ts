import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { GENESIS_PIH, findChainBreak, hashInvoiceXml } from './zatca-hash';
import { ZatcaTag, buildQrBase64, buildTlv, decodeTlv } from './zatca-tlv';
import { KSA_VAT_RATE, addExclusive, splitInclusive } from './zatca-vat';
import { buildUblInvoice, canonicalize } from './zatca-xml';

describe('VAT (15% KSA)', () => {
  it('splits a VAT-inclusive price so net + vat === gross exactly', () => {
    const { net, vat, gross } = splitInclusive('575.00');
    expect(net.toFixed(2)).toBe('500.00');
    expect(vat.toFixed(2)).toBe('75.00');
    expect(net.plus(vat).toFixed(2)).toBe(gross.toFixed(2));
  });

  it('never breaks the net + vat = gross identity on awkward amounts', () => {
    // Amounts chosen to force rounding in different directions
    for (const amount of ['0.01', '0.07', '33.33', '99.99', '1000.005', '12345.67']) {
      const { net, vat, gross } = splitInclusive(amount);
      expect(net.plus(vat).toFixed(2)).toBe(gross.toFixed(2));
    }
  });

  it('adds VAT to a net amount', () => {
    const { net, vat, gross } = addExclusive('500.00');
    expect(net.toFixed(2)).toBe('500.00');
    expect(vat.toFixed(2)).toBe('75.00');
    expect(gross.toFixed(2)).toBe('575.00');
  });

  it('round-trips inclusive → exclusive for typical order values', () => {
    const original = new Prisma.Decimal('1150.00');
    const split = splitInclusive(original);
    const rebuilt = addExclusive(split.net);
    expect(rebuilt.gross.toFixed(2)).toBe(original.toFixed(2));
  });

  it('uses 15 as the standard rate', () => {
    expect(KSA_VAT_RATE.toFixed(2)).toBe('15.00');
  });

  it('handles zero', () => {
    const { net, vat, gross } = splitInclusive('0.00');
    expect(net.toFixed(2)).toBe('0.00');
    expect(vat.toFixed(2)).toBe('0.00');
    expect(gross.toFixed(2)).toBe('0.00');
  });
});

describe('TLV QR encoding', () => {
  const base = {
    sellerName: 'Al Anwar Tailors',
    vatNumber: '300012345600003',
    timestamp: '2026-07-25T14:30:00Z',
    invoiceTotal: '575.00',
    vatTotal: '75.00',
  };

  it('encodes tag, length, then value for each field', () => {
    const buffer = buildTlv(base);
    expect(buffer[0]).toBe(ZatcaTag.SellerName);
    expect(buffer[1]).toBe(Buffer.from(base.sellerName, 'utf8').length);
  });

  it('round-trips through base64', () => {
    const decoded = decodeTlv(buildQrBase64(base));
    expect(decoded[ZatcaTag.SellerName].toString('utf8')).toBe(base.sellerName);
    expect(decoded[ZatcaTag.VatNumber].toString('utf8')).toBe(base.vatNumber);
    expect(decoded[ZatcaTag.InvoiceTotal].toString('utf8')).toBe('575.00');
    expect(decoded[ZatcaTag.VatTotal].toString('utf8')).toBe('75.00');
  });

  it('emits only the five Phase 1 tags when no crypto material is present', () => {
    const decoded = decodeTlv(buildQrBase64(base));
    expect(Object.keys(decoded).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('appends the Phase 2 hash and signature tags when supplied', () => {
    const decoded = decodeTlv(
      buildQrBase64({
        ...base,
        invoiceHash: Buffer.from('hash-bytes').toString('base64'),
        signature: Buffer.from('sig-bytes').toString('base64'),
        publicKey: Buffer.from('key-bytes').toString('base64'),
      }),
    );
    expect(decoded[ZatcaTag.InvoiceHash].toString()).toBe('hash-bytes');
    expect(decoded[ZatcaTag.EcdsaSignature].toString()).toBe('sig-bytes');
    expect(decoded[ZatcaTag.EcdsaPublicKey].toString()).toBe('key-bytes');
  });

  it('handles Arabic seller names (multi-byte lengths)', () => {
    const arabic = 'خياط الأنوار';
    const decoded = decodeTlv(buildQrBase64({ ...base, sellerName: arabic }));
    expect(decoded[ZatcaTag.SellerName].toString('utf8')).toBe(arabic);
    // length byte must count BYTES, not characters
    expect(decoded[ZatcaTag.SellerName].length).toBe(Buffer.from(arabic, 'utf8').length);
  });

  it('refuses a value longer than the one-byte length field allows', () => {
    expect(() => buildTlv({ ...base, sellerName: 'x'.repeat(256) })).toThrow(/one byte/);
  });

  it('rejects a malformed TLV buffer rather than returning partial data', () => {
    const truncated = Buffer.from([1, 200, 65]).toString('base64'); // claims 200 bytes, has 1
    expect(() => decodeTlv(truncated)).toThrow(/Malformed TLV/);
  });
});

describe('hash chain', () => {
  it('produces a stable base64 SHA-256 of the canonical XML', () => {
    const hash = hashInvoiceXml('<Invoice>test</Invoice>');
    expect(hash).toBe(hashInvoiceXml('<Invoice>test</Invoice>'));
    expect(Buffer.from(hash, 'base64')).toHaveLength(32);
  });

  it('changes completely when a single character changes', () => {
    expect(hashInvoiceXml('<Invoice>1</Invoice>')).not.toBe(hashInvoiceXml('<Invoice>2</Invoice>'));
  });

  it('accepts a chain whose first link is the genesis PIH', () => {
    const chain = [
      { invoiceHash: 'h1', previousHash: GENESIS_PIH },
      { invoiceHash: 'h2', previousHash: 'h1' },
      { invoiceHash: 'h3', previousHash: 'h2' },
    ];
    expect(findChainBreak(chain)).toBe(-1);
  });

  it('detects tampering in the middle of the chain', () => {
    const chain = [
      { invoiceHash: 'h1', previousHash: GENESIS_PIH },
      { invoiceHash: 'h2', previousHash: 'WRONG' },
      { invoiceHash: 'h3', previousHash: 'h2' },
    ];
    expect(findChainBreak(chain)).toBe(1);
  });

  it('detects a first invoice that does not start from genesis', () => {
    expect(findChainBreak([{ invoiceHash: 'h1', previousHash: 'something-else' }])).toBe(0);
  });

  it('treats an empty ledger as intact', () => {
    expect(findChainBreak([])).toBe(-1);
  });
});

describe('UBL 2.1 document', () => {
  const input = {
    invoiceNumber: 'INV-2026-000042',
    uuid: '3cf5ee18-ee25-44ea-a444-2c37ba7f28be',
    issuedAt: new Date('2026-07-25T14:30:00Z'),
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
        quantity: 2,
        unitCode: 'PCE',
        unitPrice: '217.39',
        lineNet: '434.78',
        lineVat: '65.22',
        vatRate: '15.00',
      },
    ],
    totalNet: '434.78',
    totalVat: '65.22',
    totalGross: '500.00',
    prepaidAmount: '250.00',
  };

  it('carries the identifiers ZATCA requires', () => {
    const xml = buildUblInvoice(input);
    expect(xml).toContain('<cbc:ID>INV-2026-000042</cbc:ID>');
    expect(xml).toContain(`<cbc:UUID>${input.uuid}</cbc:UUID>`);
    expect(xml).toContain('<cbc:IssueDate>2026-07-25</cbc:IssueDate>');
    expect(xml).toContain('<cbc:IssueTime>14:30:00</cbc:IssueTime>');
  });

  it('embeds the ICV and previous hash', () => {
    const xml = buildUblInvoice(input);
    expect(xml).toContain('<cbc:ID>ICV</cbc:ID>');
    expect(xml).toContain('<cbc:UUID>42</cbc:UUID>');
    expect(xml).toContain('<cbc:ID>PIH</cbc:ID>');
    expect(xml).toContain(GENESIS_PIH);
  });

  it('marks a simplified (B2C) invoice with code 0200000', () => {
    expect(buildUblInvoice(input)).toContain('name="0200000"');
  });

  it('marks a standard (B2B) invoice with code 0100000', () => {
    expect(buildUblInvoice({ ...input, invoiceTypeCode: 'standard' })).toContain('name="0100000"');
  });

  it('states net, VAT, and gross totals', () => {
    const xml = buildUblInvoice(input);
    expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="SAR">434.78</cbc:TaxExclusiveAmount>');
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="SAR">500.00</cbc:TaxInclusiveAmount>');
    expect(xml).toContain('<cbc:TaxAmount currencyID="SAR">65.22</cbc:TaxAmount>');
  });

  it('reduces the payable amount by the deposit already taken', () => {
    // 500.00 gross − 250.00 prepaid = 250.00 still owed
    expect(buildUblInvoice(input)).toContain(
      '<cbc:PayableAmount currencyID="SAR">250.00</cbc:PayableAmount>',
    );
  });

  it('escapes XML metacharacters in party names', () => {
    const xml = buildUblInvoice({
      ...input,
      seller: { ...input.seller, name: 'Smith & Sons <Tailors>' },
    });
    expect(xml).toContain('Smith &amp; Sons &lt;Tailors&gt;');
    expect(xml).not.toContain('<Tailors>');
  });

  it('includes the buyer VAT number only for B2B', () => {
    expect(buildUblInvoice(input)).not.toContain('<cac:PartyTaxScheme>\n        <cbc:CompanyID>3001');
    const b2b = buildUblInvoice({
      ...input,
      buyer: { ...input.buyer, vatNumber: '300099999900003' },
    });
    expect(b2b).toContain('300099999900003');
  });

  it('canonicalises deterministically so the hash is reproducible', () => {
    const a = canonicalize(buildUblInvoice(input));
    const b = canonicalize(buildUblInvoice(input).replace(/\n/g, '\r\n') + '   \n');
    expect(hashInvoiceXml(a)).toBe(hashInvoiceXml(b));
  });

  it('emits one InvoiceLine per garment', () => {
    const xml = buildUblInvoice({
      ...input,
      lines: [input.lines[0], { ...input.lines[0], id: 2, name: 'Bisht' }],
    });
    expect(xml.match(/<cac:InvoiceLine>/g)).toHaveLength(2);
    expect(xml).toContain('<cbc:Name>Bisht</cbc:Name>');
  });
});
