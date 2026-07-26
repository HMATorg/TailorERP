import { Injectable, OnModuleInit } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { AR, AR_BOLD, assertFontsPresent, registerInvoiceFonts } from './invoice-fonts';

export interface InvoiceLine {
  garmentType: string;
  description?: string | null;
  quantity: number;
  /** VAT-inclusive, matching how the customer was quoted. */
  unitPrice: string;
}

export interface InvoiceData {
  invoiceNumber: string;
  issuedAt: Date;
  organizationName: string;
  organizationVatNumber?: string | null;
  organizationTaxId?: string | null;
  storeName: string;
  storeAddress?: string | null;
  storePhone?: string | null;
  customerName: string;
  customerPhone: string;
  orderNumber: string;
  currency: string;
  lines: InvoiceLine[];
  /** Sum of line totals, VAT-inclusive, before discount. */
  subtotal: string;
  discount: string;
  /** Gross payable = net + VAT. */
  total: string;
  /** Net of VAT. */
  netAmount: string;
  vatAmount: string;
  /** Percentage, e.g. "15.00". */
  vatRate: string;
  paid: string;
  /** Base64 TLV payload from the ZATCA service; absent until the invoice is issued. */
  qrCodeBase64?: string | null;
  simplified?: boolean;
}

const TEAL = '#00695C';
const GREY = '#757575';
const LIGHT = '#9E9E9E';
const CHARCOAL = '#212121';
const RULE = '#E0E0E0';

// A4 content box. A4 is 841.89pt tall and the margin is 50, so content must end
// by 791.89 — anything drawn past that is what PDFKit spills onto a new page.
const LEFT = 50;
const RIGHT = 545;
const PAGE_BOTTOM = 791.89;
/** QR (96) + its caption + breathing room above. */
const FOOTER_HEIGHT = 124;
const FOOTER_TOP = PAGE_BOTTOM - FOOTER_HEIGHT;

/**
 * KSA tax invoice (TRD §5.5, ZATCA Fatoora Phase 2).
 *
 * Arabic-first and right-to-left, because Article 53 of the VAT Implementing
 * Regulations requires tax invoices to be issued in Arabic; English is carried
 * alongside as the secondary language. Arabic and English are always drawn as
 * separate runs rather than concatenated into one string — a single mixed
 * string is laid out by the bidi algorithm and the result reads correctly but
 * places punctuation unpredictably, which is not worth the risk on a legal
 * document.
 */
@Injectable()
export class InvoicePdfService implements OnModuleInit {
  /** Surface a missing font at boot, not when a customer is waiting at the counter. */
  onModuleInit(): void {
    assertFontsPresent();
  }

  async generate(data: InvoiceData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    registerInvoiceFonts(doc);

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    // Amounts stay in Western digits: that is what ZATCA's own samples use and
    // what the QR payload carries, so the printed figure matches the scanned one.
    const money = (v: string) => `${Number(v).toFixed(2)} ${data.currency}`;

    const qr = await this.renderQr(data.qrCodeBase64);

    this.header(doc, data);
    this.parties(doc, data);
    const afterItems = this.lineItems(doc, data);
    const afterTotals = this.totals(doc, data, money, afterItems);
    this.footer(doc, qr, afterTotals);

    doc.end();
    return done;
  }

  /**
   * ZATCA specifies the QR carries the base64 TLV string itself. Rendering is
   * best-effort: a QR failure must not cost the counter its invoice, and the
   * absence is visible on the page rather than silent.
   */
  private async renderQr(payload?: string | null): Promise<Buffer | null> {
    if (!payload) return null;
    try {
      return await QRCode.toBuffer(payload, {
        type: 'png',
        errorCorrectionLevel: 'M',
        margin: 0,
        width: 300,
      });
    } catch {
      return null;
    }
  }

  /** Arabic label with its English counterpart underneath, right-aligned. */
  private label(
    doc: PDFKit.PDFDocument,
    ar: string,
    en: string,
    x: number,
    y: number,
    width: number,
    size = 9,
  ): void {
    doc.font(AR).fontSize(size).fillColor(GREY).text(ar, x, y, { width, align: 'right' });
    doc.font(AR).fontSize(size - 2).fillColor(LIGHT).text(en, x, y + size + 1, { width, align: 'right' });
  }

  private header(doc: PDFKit.PDFDocument, data: InvoiceData): void {
    // Seller block on the right — the reading origin in an RTL document.
    doc
      .font(AR_BOLD)
      .fontSize(20)
      .fillColor(TEAL)
      .text(data.organizationName, 280, 50, { width: RIGHT - 280, align: 'right' });

    let y = 78;
    doc.font(AR).fontSize(9).fillColor(GREY);
    const vat = data.organizationVatNumber ?? data.organizationTaxId;
    if (vat) {
      // The seller's VAT registration number is mandatory on a tax invoice.
      doc.text(`الرقم الضريبي ${vat}`, 280, y, { width: RIGHT - 280, align: 'right' });
      y += 13;
    }
    for (const l of [data.storeName, data.storeAddress, data.storePhone]) {
      if (!l) continue;
      doc.text(l, 280, y, { width: RIGHT - 280, align: 'right' });
      y += 12;
    }

    // Document identity on the left.
    doc
      .font(AR_BOLD)
      .fontSize(15)
      .fillColor(CHARCOAL)
      .text(data.simplified === false ? 'فاتورة ضريبية' : 'فاتورة ضريبية مبسطة', LEFT, 50, {
        width: 210,
        align: 'left',
      });
    doc
      .font(AR)
      .fontSize(8)
      .fillColor(LIGHT)
      .text(data.simplified === false ? 'Tax Invoice' : 'Simplified Tax Invoice', LEFT, 70, {
        width: 210,
        align: 'left',
      });

    doc.font(AR).fontSize(10).fillColor(GREY);
    doc.text(data.invoiceNumber, LEFT, 88, { width: 210, align: 'left' });
    doc.text(data.issuedAt.toISOString().slice(0, 10), LEFT, 102, { width: 210, align: 'left' });
  }

  private parties(doc: PDFKit.PDFDocument, data: InvoiceData): void {
    doc.moveTo(LEFT, 132).lineTo(RIGHT, 132).strokeColor(RULE).stroke();

    this.label(doc, 'فاتورة إلى', 'Bill to', 300, 145, RIGHT - 300);
    doc
      .font(AR_BOLD)
      .fontSize(12)
      .fillColor(CHARCOAL)
      .text(data.customerName, 300, 168, { width: RIGHT - 300, align: 'right' });
    doc
      .font(AR)
      .fontSize(10)
      .fillColor(GREY)
      .text(data.customerPhone, 300, 185, { width: RIGHT - 300, align: 'right' });

    this.label(doc, 'رقم الطلب', 'Order no.', LEFT, 145, 200);
    doc
      .font(AR)
      .fontSize(11)
      .fillColor(CHARCOAL)
      .text(data.orderNumber, LEFT, 168, { width: 200, align: 'left' });
  }

  /** RTL table: item on the right, amount on the left. Returns the y cursor. */
  private lineItems(doc: PDFKit.PDFDocument, data: InvoiceData): number {
    const COL = {
      amount: { x: LEFT, w: 100 },
      unit: { x: 160, w: 80 },
      qty: { x: 250, w: 40 },
      item: { x: 300, w: RIGHT - 300 },
    };

    let y = 218;
    doc.rect(LEFT, y - 6, RIGHT - LEFT, 30).fill('#F5F5F5');
    this.label(doc, 'البند', 'Item', COL.item.x, y, COL.item.w, 9);
    this.label(doc, 'الكمية', 'Qty', COL.qty.x, y, COL.qty.w, 9);
    this.label(doc, 'السعر', 'Unit', COL.unit.x, y, COL.unit.w, 9);
    this.label(doc, 'المبلغ', 'Amount', COL.amount.x, y, COL.amount.w, 9);
    y += 34;

    for (const line of data.lines) {
      const amount = (Number(line.unitPrice) * line.quantity).toFixed(2);

      doc
        .font(AR)
        .fontSize(10)
        .fillColor(CHARCOAL)
        .text(line.garmentType, COL.item.x, y, { width: COL.item.w, align: 'right' });
      if (line.description) {
        doc
          .font(AR)
          .fontSize(8)
          .fillColor(GREY)
          .text(line.description, COL.item.x, y + 13, { width: COL.item.w, align: 'right' });
      }

      doc.font(AR).fontSize(10).fillColor(CHARCOAL);
      doc.text(String(line.quantity), COL.qty.x, y, { width: COL.qty.w, align: 'right' });
      doc.text(Number(line.unitPrice).toFixed(2), COL.unit.x, y, { width: COL.unit.w, align: 'right' });
      doc.text(amount, COL.amount.x, y, { width: COL.amount.w, align: 'right' });

      y += line.description ? 36 : 24;
      // Stop before the footer band; the totals block guards its own boundary.
      if (y > FOOTER_TOP - 40) {
        doc.addPage();
        y = 60;
      }
    }
    return y;
  }

  /** Returns the y cursor after the last row, so the footer can place itself. */
  private totals(
    doc: PDFKit.PDFDocument,
    data: InvoiceData,
    money: (v: string) => string,
    startY: number,
  ): number {
    // Totals sit on the left, where an RTL line ends.
    const LABEL = { x: 170, w: 150 };
    const VALUE = { x: LEFT, w: 110 };
    // Worst case is 7 rows: subtotal, discount, net, VAT, gross, paid, balance.
    const BLOCK_HEIGHT = 190;

    let y = startY + 6;
    if (y + BLOCK_HEIGHT > PAGE_BOTTOM) {
      doc.addPage();
      y = 60;
    }

    doc.moveTo(LEFT, y).lineTo(330, y).strokeColor(RULE).stroke();
    y += 12;

    const row = (ar: string, en: string, value: string, opts: { bold?: boolean; color?: string } = {}) => {
      const size = opts.bold ? 11 : 9;
      doc
        .font(opts.bold ? AR_BOLD : AR)
        .fontSize(size)
        .fillColor(opts.color ?? (opts.bold ? CHARCOAL : GREY))
        .text(ar, LABEL.x, y, { width: LABEL.w, align: 'right' });
      doc
        .font(AR)
        .fontSize(7)
        .fillColor(LIGHT)
        .text(en, LABEL.x, y + size + 1, { width: LABEL.w, align: 'right' });
      doc
        .font(opts.bold ? AR_BOLD : AR)
        .fontSize(size)
        .fillColor(opts.color ?? (opts.bold ? CHARCOAL : GREY))
        .text(value, VALUE.x, y, { width: VALUE.w, align: 'right' });
      y += size + 14;
    };

    if (Number(data.discount) > 0) {
      row('المجموع الفرعي', 'Subtotal', money(data.subtotal));
      row('الخصم', 'Discount', `-${money(data.discount)}`);
    }

    // The three figures ZATCA requires a tax invoice to state explicitly.
    row('الإجمالي غير شامل الضريبة', 'Total excluding VAT', money(data.netAmount));
    row(
      `ضريبة القيمة المضافة ${Number(data.vatRate).toFixed(0)}%`,
      'VAT',
      money(data.vatAmount),
    );
    row('الإجمالي شامل الضريبة', 'Total including VAT', money(data.total), { bold: true });

    row('المدفوع', 'Paid', money(data.paid));
    const balance = (Number(data.total) - Number(data.paid)).toFixed(2);
    if (Number(balance) > 0.004) {
      row('المبلغ المتبقي', 'Balance due', money(balance), { bold: true, color: '#C62828' });
    } else {
      doc
        .font(AR_BOLD)
        .fontSize(11)
        .fillColor('#2E7D32')
        .text('مدفوعة بالكامل', LABEL.x, y, { width: LABEL.w, align: 'right', lineBreak: false });
      doc
        .font(AR)
        .fontSize(7)
        .fillColor(LIGHT)
        .text('Paid in full', LABEL.x, y + 12, { width: LABEL.w, align: 'right', lineBreak: false });
      y += 26;
    }
    return y;
  }

  private footer(doc: PDFKit.PDFDocument, qr: Buffer | null, afterTotals: number): void {
    // Anchor the footer to the page box rather than a hand-tuned constant. The
    // trailing near-empty page came from a fixed y that happened to push the QR
    // caption past the bottom margin once the totals block grew — a discount row
    // and a balance-due row were enough. Only start a new page when the content
    // above genuinely reaches into the footer band.
    if (afterTotals > FOOTER_TOP) doc.addPage();
    const y = FOOTER_TOP;

    // Every call below is lineBreak:false so PDFKit can never paginate on its
    // own account and reintroduce the blank page.
    if (qr) {
      doc.image(qr, RIGHT - 96, y, { width: 96 });
      doc
        .font(AR)
        .fontSize(7)
        .fillColor(LIGHT)
        .text('امسح للتحقق · Scan to verify', RIGHT - 150, y + 100, {
          width: 150,
          align: 'right',
          lineBreak: false,
        });
    } else {
      // Visible rather than silent: an unissued invoice should look unfinished.
      doc
        .font(AR)
        .fontSize(7)
        .fillColor('#C62828')
        .text('لم يتم إصدار رمز الاستجابة السريعة · QR not yet issued', RIGHT - 220, y, {
          width: 220,
          align: 'right',
          lineBreak: false,
        });
    }

    doc
      .font(AR)
      .fontSize(9)
      .fillColor(GREY)
      .text('شكرًا لتعاملكم معنا', LEFT, y + 60, { width: 240, align: 'left', lineBreak: false });
    doc
      .font(AR)
      .fontSize(7)
      .fillColor(LIGHT)
      .text('Thank you for your business.', LEFT, y + 74, {
        width: 240,
        align: 'left',
        lineBreak: false,
      });
  }
}
