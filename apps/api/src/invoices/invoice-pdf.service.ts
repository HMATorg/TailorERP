import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface InvoiceLine {
  garmentType: string;
  description?: string | null;
  quantity: number;
  unitPrice: string;
}

export interface InvoiceData {
  invoiceNumber: string;
  issuedAt: Date;
  organizationName: string;
  organizationTaxId?: string | null;
  storeName: string;
  storeAddress?: string | null;
  storePhone?: string | null;
  customerName: string;
  customerPhone: string;
  orderNumber: string;
  currency: string;
  lines: InvoiceLine[];
  subtotal: string;
  discount: string;
  total: string;
  paid: string;
}

const TEAL = '#00695C';
const GREY = '#757575';
const CHARCOAL = '#212121';

/**
 * Invoice PDF (TRD §5.5). Latin-only by design: PDFKit's standard fonts cannot
 * shape Arabic, and bundling a shaping-capable font is a separate decision
 * (see D-021). Arabic invoices therefore render the Latin/numeric layout.
 */
@Injectable()
export class InvoicePdfService {
  async generate(data: InvoiceData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const money = (v: string) => `${data.currency} ${Number(v).toFixed(2)}`;

    // Header
    doc.fillColor(TEAL).fontSize(24).font('Helvetica-Bold').text(data.organizationName, 50, 50);
    doc.fillColor(GREY).fontSize(9).font('Helvetica');
    if (data.organizationTaxId) doc.text(`Tax ID: ${data.organizationTaxId}`);
    doc.text(data.storeName);
    if (data.storeAddress) doc.text(data.storeAddress);
    if (data.storePhone) doc.text(data.storePhone);

    doc
      .fillColor(CHARCOAL)
      .fontSize(20)
      .font('Helvetica-Bold')
      .text('INVOICE', 400, 50, { align: 'right' });
    doc
      .fillColor(GREY)
      .fontSize(10)
      .font('Helvetica')
      .text(data.invoiceNumber, 400, 76, { align: 'right' })
      .text(data.issuedAt.toISOString().slice(0, 10), 400, 90, { align: 'right' });

    // Bill-to
    doc.moveTo(50, 130).lineTo(545, 130).strokeColor('#E0E0E0').stroke();
    doc.fillColor(GREY).fontSize(9).text('BILL TO', 50, 145);
    doc.fillColor(CHARCOAL).fontSize(12).font('Helvetica-Bold').text(data.customerName, 50, 158);
    doc.fillColor(GREY).fontSize(10).font('Helvetica').text(data.customerPhone, 50, 174);
    doc.text(`Order ${data.orderNumber}`, 400, 158, { align: 'right' });

    // Line items
    let y = 215;
    doc.rect(50, y - 6, 495, 22).fill('#F5F5F5');
    doc.fillColor(GREY).fontSize(9).font('Helvetica-Bold');
    doc.text('ITEM', 58, y).text('QTY', 350, y).text('UNIT', 400, y).text('AMOUNT', 470, y);
    y += 26;

    doc.font('Helvetica').fontSize(10);
    for (const line of data.lines) {
      const amount = (Number(line.unitPrice) * line.quantity).toFixed(2);
      doc.fillColor(CHARCOAL).text(line.garmentType, 58, y, { width: 280 });
      if (line.description) {
        doc.fillColor(GREY).fontSize(8).text(line.description, 58, y + 12, { width: 280 });
        doc.fontSize(10);
      }
      doc
        .fillColor(CHARCOAL)
        .text(String(line.quantity), 350, y)
        .text(Number(line.unitPrice).toFixed(2), 400, y)
        .text(amount, 470, y);
      y += line.description ? 34 : 22;

      if (y > 700) {
        doc.addPage();
        y = 60;
      }
    }

    // Totals
    doc.moveTo(330, y + 4).lineTo(545, y + 4).strokeColor('#E0E0E0').stroke();
    y += 14;
    const totalRow = (label: string, value: string, bold = false) => {
      doc
        .fillColor(bold ? CHARCOAL : GREY)
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 12 : 10)
        .text(label, 330, y)
        .text(value, 430, y, { align: 'right', width: 115 });
      y += bold ? 20 : 16;
    };
    totalRow('Subtotal', money(data.subtotal));
    if (Number(data.discount) > 0) totalRow('Discount', `-${money(data.discount)}`);
    totalRow('Total', money(data.total), true);
    totalRow('Paid', money(data.paid));

    const balance = (Number(data.total) - Number(data.paid)).toFixed(2);
    if (Number(balance) > 0) {
      doc.fillColor('#C62828').font('Helvetica-Bold').fontSize(11);
      doc.text('Balance due', 330, y).text(money(balance), 430, y, { align: 'right', width: 115 });
    } else {
      doc.fillColor('#2E7D32').font('Helvetica-Bold').fontSize(11).text('PAID IN FULL', 330, y);
    }

    doc
      .fillColor(GREY)
      .font('Helvetica')
      .fontSize(8)
      .text('Thank you for your business.', 50, 780, { align: 'center', width: 495 });

    doc.end();
    return done;
  }
}
