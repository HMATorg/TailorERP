/**
 * Renders a representative KSA tax invoice to a file, for eyeballing layout
 * changes without standing up the API.
 *
 *   npx ts-node -T scripts/sample-invoice.ts out.pdf
 *
 * Defaults to the fullest realistic case — two garments, a discount and a part
 * payment — because that produces every totals row at once and is what pushed
 * the footer onto a second page (D-042).
 */
import { writeFileSync } from 'node:fs';
import { InvoicePdfService, type InvoiceData } from '../src/invoices/invoice-pdf.service';

const data: InvoiceData = {
  invoiceNumber: 'INV-2026-000042',
  issuedAt: new Date('2026-07-25T10:00:00Z'),
  organizationName: 'خياطة الأنوار',
  organizationVatNumber: '300012345600003',
  storeName: 'فرع جدة الكورنيش',
  storeAddress: 'طريق الملك عبدالعزيز، جدة',
  storePhone: '+966500000002',
  customerName: 'محمد عبدالله السالم',
  customerPhone: '+966512345678',
  orderNumber: 'ORD-000001',
  currency: 'SAR',
  lines: [
    {
      garmentType: 'ثوب سعودي',
      description: 'قطن أبيض — ياقة مقلوبة',
      quantity: 2,
      unitPrice: '250.00',
    },
    { garmentType: 'بشت مطرز', description: 'صوف أسود', quantity: 1, unitPrice: '900.00' },
  ],
  subtotal: '1400.00',
  discount: '50.00',
  total: '1350.00',
  netAmount: '1173.91',
  vatAmount: '176.09',
  vatRate: '15.00',
  paid: '500.00',
  qrCodeBase64:
    'AQ5YaXlhdGF0IEFsIEFud2FyAg8zMDAwMTIzNDU2MDAwMDMDFDIwMjYtMDctMjVUMTA6MDA6MDBaBAcxMzUwLjAwBQYxNzYuMDk=',
};

(async () => {
  const out = process.argv[2] ?? 'sample-invoice.pdf';
  writeFileSync(out, await new InvoicePdfService().generate(data));
  console.log('wrote', out);
})();
