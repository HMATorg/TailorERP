import { inflateSync } from 'zlib';
import { InvoicePdfService, type InvoiceData } from './invoice-pdf.service';

/** Decodes PDFKit's hex-encoded TJ arrays back into readable text. */
function extractText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const streams = [...raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)];
  let text = '';
  for (const match of streams) {
    let data = Buffer.from(match[1], 'latin1');
    try {
      data = inflateSync(data);
    } catch {
      /* uncompressed stream */
    }
    for (const tj of data.toString('latin1').matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      for (const hex of tj[1].matchAll(/<([0-9a-fA-F]+)>/g)) {
        text += Buffer.from(hex[1], 'hex').toString('latin1');
      }
      text += '\n';
    }
  }
  return text;
}

const baseData: InvoiceData = {
  invoiceNumber: 'INV-2026-000042',
  issuedAt: new Date('2026-07-25T10:00:00Z'),
  organizationName: 'Al Anwar Tailors',
  organizationTaxId: '300012345600003',
  storeName: 'Jeddah Corniche',
  storeAddress: 'King Road',
  storePhone: '+966500000002',
  customerName: 'Saquib Imtiaz',
  customerPhone: '+966512345678',
  orderNumber: 'ORD-000001',
  currency: 'SAR',
  lines: [
    { garmentType: 'Thobe', description: 'White cotton', quantity: 2, unitPrice: '250.00' },
  ],
  subtotal: '500.00',
  discount: '0',
  total: '500.00',
  paid: '500.00',
};

describe('InvoicePdfService', () => {
  const service = new InvoicePdfService();

  it('produces a valid PDF', async () => {
    const pdf = await service.generate(baseData);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(500);
  });

  it('includes the parties, order reference, and tax id', async () => {
    const text = extractText(await service.generate(baseData));
    expect(text).toContain('Al Anwar Tailors');
    expect(text).toContain('300012345600003');
    expect(text).toContain('Saquib Imtiaz');
    expect(text).toContain('ORD-000001');
    expect(text).toContain('INV-2026-000042');
  });

  it('renders line items with computed amounts', async () => {
    const text = extractText(await service.generate(baseData));
    expect(text).toContain('Thobe');
    expect(text).toContain('White cotton');
    expect(text).toContain('250.00');
    expect(text).toContain('500.00'); // 2 × 250
  });

  it('marks a fully paid invoice as PAID IN FULL', async () => {
    const text = extractText(await service.generate(baseData));
    expect(text).toContain('PAID IN FULL');
    expect(text).not.toContain('Balance due');
  });

  it('shows the outstanding balance when partially paid', async () => {
    const text = extractText(await service.generate({ ...baseData, paid: '200.00' }));
    expect(text).toContain('Balance due');
    expect(text).toContain('SAR 300.00');
    expect(text).not.toContain('PAID IN FULL');
  });

  it('shows a discount line only when a discount applies', async () => {
    const without = extractText(await service.generate(baseData));
    expect(without).not.toContain('Discount');

    const withDiscount = extractText(
      await service.generate({ ...baseData, discount: '50.00', total: '450.00' }),
    );
    expect(withDiscount).toContain('Discount');
  });

  it('paginates rather than overflowing with many line items', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({
      garmentType: `Garment ${i + 1}`,
      description: null,
      quantity: 1,
      unitPrice: '100.00',
    }));
    const pdf = await service.generate({ ...baseData, lines });
    const text = extractText(pdf);
    expect(text).toContain('Garment 1');
    expect(text).toContain('Garment 40');
    // A second page must have been added
    expect(raw(pdf).match(/\/Type\s*\/Page[^s]/g)?.length ?? 0).toBeGreaterThan(1);
  });

  it('omits optional store fields cleanly', async () => {
    const pdf = await service.generate({
      ...baseData,
      organizationTaxId: null,
      storeAddress: null,
      storePhone: null,
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(extractText(pdf)).not.toContain('Tax ID');
  });
});

function raw(pdf: Buffer): string {
  return pdf.toString('latin1');
}
