import { InvoicePdfService, type InvoiceData } from './invoice-pdf.service';

/**
 * Reads the invoice back the way an auditor's PDF reader would.
 *
 * The previous helper decoded PDFKit's hex TJ arrays as latin1, which only
 * worked while the document used the WinAnsi built-in fonts. With an embedded
 * subset those hex values are glyph ids, so text now comes out through the
 * ToUnicode CMap via pdf.js. That makes the assertions stricter than before:
 * they only pass if the PDF is genuinely text-extractable, which a tax document
 * has to be.
 */
async function readPdf(pdf: Buffer): Promise<{ text: string; pages: number }> {
  // pdfjs-dist is pinned to the 3.x line because 4+ ships ESM only and Jest
  // runs these as CommonJS. The legacy build is the one that runs outside a
  // browser; nothing here rasterises, so Node needing no canvas is fine.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: false,
    disableFontFace: true,
  }).promise;

  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    text += content.items.map((i: any) => i.str).join('\n') + '\n';
  }
  return { text, pages: doc.numPages };
}

const baseData: InvoiceData = {
  invoiceNumber: 'INV-2026-000042',
  issuedAt: new Date('2026-07-25T10:00:00Z'),
  organizationName: 'خياطة الأنوار',
  organizationVatNumber: '300012345600003',
  storeName: 'فرع جدة الكورنيش',
  storeAddress: 'طريق الملك عبدالعزيز',
  storePhone: '+966500000002',
  customerName: 'محمد عبدالله',
  customerPhone: '+966512345678',
  orderNumber: 'ORD-000001',
  currency: 'SAR',
  lines: [
    { garmentType: 'ثوب سعودي', description: 'قطن أبيض', quantity: 2, unitPrice: '250.00' },
  ],
  subtotal: '500.00',
  discount: '0',
  total: '500.00',
  netAmount: '434.78',
  vatAmount: '65.22',
  vatRate: '15.00',
  paid: '500.00',
  qrCodeBase64: 'AQ5TZWxsZXICDzMwMDAxMjM0NTYwMDAwMw==',
};

describe('InvoicePdfService', () => {
  const service = new InvoicePdfService();

  it('produces a valid PDF', async () => {
    const pdf = await service.generate(baseData);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(500);
  });

  it('fits a normal invoice on a single page', async () => {
    // The QR block plus its caption used to spill onto a second, near-empty page.
    const { pages } = await readPdf(await service.generate(baseData));
    expect(pages).toBe(1);
  });

  it('stays on one page with the fullest realistic totals block', async () => {
    // Two garments, a discount and a part payment is what a real counter sale
    // looks like, and it produces every totals row at once: subtotal, discount,
    // net, VAT, gross, paid, balance. That combination is what pushed the QR
    // caption onto a second page.
    const { pages, text } = await readPdf(
      await service.generate({
        ...baseData,
        lines: [
          { garmentType: 'ثوب سعودي', description: 'قطن أبيض', quantity: 2, unitPrice: '250.00' },
          { garmentType: 'بشت مطرز', description: 'صوف أسود', quantity: 1, unitPrice: '900.00' },
        ],
        subtotal: '1400.00',
        discount: '50.00',
        total: '1350.00',
        netAmount: '1173.91',
        vatAmount: '176.09',
        paid: '500.00',
      }),
    );
    expect(pages).toBe(1);
    expect(text).toContain('Balance due');
    expect(text).toContain('850.00'); // 1350 − 500
    expect(text).toContain('Scan to verify');
  });

  it('renders Arabic as real, extractable characters rather than boxes', async () => {
    const { text } = await readPdf(await service.generate(baseData));
    // Assertions are per word, not per phrase: pdf.js reconstructs RTL runs in
    // visual order and splits the lam-alef ligature back into two code points,
    // so whole-phrase matching tests pdf.js's heuristics rather than our output.
    for (const word of ['خياطة', 'محمد', 'ثوب', 'قطن', 'الضريبة', 'المدفوع']) {
      expect(text).toContain(word);
    }
  });

  it('states the three figures a KSA tax invoice must show', async () => {
    const { text } = await readPdf(await service.generate(baseData));
    expect(text).toContain('434.78'); // net
    expect(text).toContain('65.22'); //  VAT
    expect(text).toContain('500.00'); // gross
    expect(text).toContain('Total excluding VAT');
    expect(text).toContain('Total including VAT');
    expect(text).toContain('300012345600003'); // seller VAT registration
  });

  it('carries the parties and the order reference', async () => {
    const { text } = await readPdf(await service.generate(baseData));
    expect(text).toContain('ORD-000001');
    expect(text).toContain('INV-2026-000042');
    expect(text).toContain('+966512345678');
  });

  it('embeds the ZATCA QR as an image, and says so when it is absent', async () => {
    const withQr = await service.generate(baseData);
    expect(/\/Subtype\s*\/Image/.test(withQr.toString('latin1'))).toBe(true);

    const withoutQr = await service.generate({ ...baseData, qrCodeBase64: null });
    expect(/\/Subtype\s*\/Image/.test(withoutQr.toString('latin1'))).toBe(false);
    // An unissued invoice must look unfinished rather than merely lack a QR.
    expect((await readPdf(withoutQr)).text).toContain('QR not yet issued');
  });

  it('marks a fully paid invoice rather than showing a balance', async () => {
    const { text } = await readPdf(await service.generate(baseData));
    expect(text).toContain('Paid in full');
    expect(text).not.toContain('Balance due');
  });

  it('shows the outstanding balance when partially paid', async () => {
    const { text } = await readPdf(await service.generate({ ...baseData, paid: '200.00' }));
    expect(text).toContain('Balance due');
    expect(text).toContain('300.00');
    expect(text).not.toContain('Paid in full');
  });

  it('shows a discount line only when a discount applies', async () => {
    const without = await readPdf(await service.generate(baseData));
    expect(without.text).not.toContain('Discount');

    const withDiscount = await readPdf(
      await service.generate({ ...baseData, discount: '50.00', total: '450.00' }),
    );
    expect(withDiscount.text).toContain('Discount');
  });

  it('paginates rather than overflowing with many line items', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({
      garmentType: `بند ${i + 1}`,
      description: null,
      quantity: 1,
      unitPrice: '100.00',
    }));
    const { text, pages } = await readPdf(await service.generate({ ...baseData, lines }));
    expect(pages).toBeGreaterThan(1);
    // Word order comes back visually reversed, so match the parts that do not
    // depend on direction: every row's amount, and the last item's index.
    expect(text).toContain('بند');
    expect(text).toContain('40');
    expect((text.match(/100\.00/g) ?? []).length).toBeGreaterThanOrEqual(40);
  });

  it('omits optional store fields cleanly', async () => {
    const pdf = await service.generate({
      ...baseData,
      organizationVatNumber: null,
      organizationTaxId: null,
      storeAddress: null,
      storePhone: null,
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await readPdf(pdf)).text).not.toContain('الرقم الضريبي');
  });
});
