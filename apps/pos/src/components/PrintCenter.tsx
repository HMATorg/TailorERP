import { useEffect, useState } from 'react';
import { FilePdfOutlined, PrinterOutlined, TagsOutlined } from '@ant-design/icons';
import { Button, Space, Tooltip, Typography, message } from 'antd';
import QRCode from 'qrcode';
import { api, errMsg, useAuth } from '../api';
import { printSection } from '../print';
import Barcode from './Barcode';

/** Bilingual label pairs for the thermal receipt's fixed rows (D-072) — the
 * reference receipt this was redesigned against pairs a short English
 * mnemonic with the Arabic label on every row, not just the header. */
const PAYMENT_METHOD_LABELS: Record<string, { en: string; ar: string }> = {
  cash: { en: 'Cash', ar: 'نقدي' },
  card: { en: 'Card', ar: 'بطاقة' },
  transfer: { en: 'Bank transfer', ar: 'تحويل بنكي' },
  other: { en: 'Other', ar: 'أخرى' },
};

/** One row of the thermal receipt's info/totals blocks: English label left,
 * value centered and bold, Arabic label right — matches the reference
 * receipt's row layout exactly instead of an English-only list. */
function BiRow({ en, ar, value, bold }: { en: string; ar: string; value: string; bold?: boolean }) {
  return (
    <div className={`birow small${bold ? ' bold' : ''}`}>
      <span className="en">{en}</span>
      <span className="val">{value}</span>
      <span className="ar">{ar}</span>
    </div>
  );
}

export interface PrintCenterTicket {
  id: string;
  ticketCode: string;
  garmentType: string;
  station: string;
}

export interface PrintCenterInvoice {
  id: string;
  invoiceNumber: string;
  netAmount: string;
  vatAmount: string;
  totalAmount: string;
  qrCodeBase64?: string | null;
}

export interface PrintCenterData {
  orderNumber: string;
  /** When the order was actually created — not "now", so a reprint days
   * later still shows the invoice's real date/time (D-072). */
  createdAt?: string | Date;
  /** Whoever rang this order up — the order's creator on a reprint, the
   * current session on a fresh checkout (both resolved by the caller). */
  cashierName?: string | null;
  /** How the amount collected so far was paid — omitted (not shown) if
   * nothing has been paid yet. */
  depositMethod?: string | null;
  customerName: string;
  customerVatNumber?: string | null;
  customerAddress?: string | null;
  dueDate?: string | null;
  totalAmount: string;
  paidAmount: string;
  balanceDue: string;
  tickets: PrintCenterTicket[];
  lines: { garmentType: string; unitPrice: number | string; quantity?: number }[];
  invoice: PrintCenterInvoice | null;
}

/**
 * Print Center (v4 §1 amendment, D-047; extracted D-051). The three physical
 * documents a counter hands over — thermal receipt, barcoded garment tags,
 * A4 tax invoice — driven off one normalized shape so a freshly-checked-out
 * order and one reopened from history print byte-for-byte the same thing.
 * Splitting this out of Receipt.tsx is what makes that guarantee possible:
 * before, a second reprint view would have meant a second, driftable copy of
 * this markup and of the print-CSS bugs it took three rounds to fix.
 */
export default function PrintCenter({ data }: { data: PrintCenterData }) {
  const { organization, stores, activeStoreId } = useAuth();
  const store = stores.find((s) => s.id === activeStoreId);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  // The order's actual creation time, not render time — a reprint days later
  // must still show when the invoice was really issued (D-072).
  const issuedAt = data.createdAt ? new Date(data.createdAt) : new Date();

  useEffect(() => {
    if (!data.invoice?.qrCodeBase64) {
      setQrDataUrl(null);
      return;
    }
    void QRCode.toDataURL(data.invoice.qrCodeBase64, { width: 220, margin: 1 }).then(setQrDataUrl);
  }, [data.invoice?.qrCodeBase64]);

  const downloadA4 = async () => {
    const invoice = data.invoice;
    if (!invoice?.id) return; // button is disabled in this case — see render below
    setDownloadingPdf(true);
    try {
      // Forced download via <a download> — not a popup, immune to popup-blocker
      // heuristics in every mainstream browser. Two earlier attempts at
      // *opening* the PDF in a new tab (window.open, then a synthetic
      // target="_blank" click) each shipped fine in one verified test and then
      // failed for a real user in a real browser; this mechanism has no
      // popup-blocker exposure at all, so there's no equivalent failure mode
      // left to hit (D-050).
      const { data: blob } = await api.get(`/invoices/${invoice.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoice.invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <>
      <div className="screen-only">
        <Typography.Title level={5} style={{ marginBlockStart: 24 }}>
          Print Center
        </Typography.Title>
        <Space wrap style={{ marginBlockStart: 8 }}>
          <Button type="primary" size="large" icon={<PrinterOutlined />} onClick={() => printSection('thermal')}>
            Print thermal receipt
          </Button>
          <Button
            size="large"
            icon={<TagsOutlined />}
            disabled={!data.tickets.length}
            onClick={() => printSection('tags')}
          >
            Print garment tags ({data.tickets.length})
          </Button>
          <Tooltip
            title={data.invoice ? undefined : 'No tax invoice was issued for this order — see the warning above'}
          >
            <Button
              size="large"
              icon={<FilePdfOutlined />}
              loading={downloadingPdf}
              disabled={!data.invoice}
              onClick={downloadA4}
            >
              A4 tax invoice (PDF)
            </Button>
          </Tooltip>
        </Space>
      </div>

      {/* ---- Thermal receipt (80mm) — shown only while body.printing-thermal ---- */}
      <div className="print-only thermal-receipt">
        {organization?.logoUrl && (
          <div className="center">
            <img src={organization.logoUrl} alt="" style={{ maxWidth: 120, maxHeight: 60 }} />
          </div>
        )}
        <div className="center bold">{organization?.name ?? 'Tailonix'}</div>
        {store && <div className="center small">{store.name}</div>}
        {store?.address && <div className="center small">{store.address}</div>}
        <div className="rule" />
        {organization?.vatNumber && (
          <BiRow en="VAT No." ar="الرقم الضريبي" value={organization.vatNumber} />
        )}
        {organization?.crNumber && (
          <BiRow en="CR No." ar="رقم السجل التجاري" value={organization.crNumber} />
        )}
        {organization?.licenseNumber && (
          <BiRow en="License No." ar="رقم الرخصة" value={organization.licenseNumber} />
        )}
        <div className="rule" />
        <div className="center bold title">TAX INVOICE · فاتورة ضريبية</div>
        {data.invoice && <BiRow en="Inv. No." ar="رقم الفاتورة" value={data.invoice.invoiceNumber} />}
        <BiRow en="Inv. Date" ar="تاريخ الفاتورة" value={issuedAt.toLocaleDateString()} />
        <BiRow en="Inv. Time" ar="وقت الفاتورة" value={issuedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />
        <BiRow en="Order" ar="رقم الطلب" value={data.orderNumber} />
        <BiRow en="Client" ar="العميل" value={data.customerName} />
        {data.customerVatNumber && <BiRow en="Client VAT No." ar="الرقم الضريبي للعميل" value={data.customerVatNumber} />}
        {data.cashierName && <BiRow en="Cashier" ar="الكاشير" value={data.cashierName} />}
        {data.customerAddress && <div className="small">Address / العنوان: {data.customerAddress}</div>}
        <div className="rule" />
        <table className="doc-table">
          <thead>
            <tr>
              <th>Product · المنتج</th>
              <th>Qty · الكمية</th>
              <th>Price · السعر</th>
              <th>Total · الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l, i) => {
              const qty = l.quantity ?? 1;
              const unit = Number(l.unitPrice);
              return (
                <tr key={i}>
                  <td>{l.garmentType}</td>
                  <td className="center">{qty}</td>
                  <td className="right">{unit.toFixed(2)}</td>
                  <td className="right">{(unit * qty).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="rule" />
        {data.invoice ? (
          <>
            <BiRow en="Net" ar="الصافي" value={`SAR ${data.invoice.netAmount}`} />
            <BiRow en="VAT (15%)" ar="ضريبة القيمة المضافة" value={`SAR ${data.invoice.vatAmount}`} />
          </>
        ) : (
          <BiRow en="Subtotal" ar="الإجمالي قبل الضريبة" value={`SAR ${data.totalAmount}`} />
        )}
        <BiRow en="Total + VAT" ar="الإجمالي شامل الضريبة" value={`SAR ${data.totalAmount}`} bold />
        {data.depositMethod && (
          <BiRow
            en="Payment method"
            ar="طريقة الدفع"
            value={PAYMENT_METHOD_LABELS[data.depositMethod]?.en ?? data.depositMethod}
          />
        )}
        <BiRow en="Paid" ar="المدفوع" value={`SAR ${data.paidAmount}`} />
        <BiRow en="Balance due" ar="المتبقي" value={`SAR ${data.balanceDue}`} bold />
        <BiRow en="Item Quan." ar="عدد الأصناف" value={String(data.lines.length)} />
        <div className="rule" />
        {organization?.receiptNote && (
          <div className="center small rtl" style={{ marginBlockEnd: 6 }}>
            {organization.receiptNote}
          </div>
        )}
        {qrDataUrl && (
          <div className="center">
            <img src={qrDataUrl} alt="ZATCA QR" style={{ width: 160, height: 160 }} />
          </div>
        )}
        <div className="center small">Thank you for your business</div>
        <div className="center small">
          {data.invoice ? 'Full A4 tax invoice available on request' : 'Provisional receipt — tax invoice pending'}
        </div>
        <div className="center small rtl">
          Garment pickup by appointment · استلام الملابس حسب الموعد المحدد
          {store?.phone ? ` · ${store.phone}` : ''}
        </div>
      </div>

      {/* ---- Garment tag labels — shown only while body.printing-tags ---- */}
      <div className="print-only garment-tags">
        {data.tickets.map((t) => (
          <div className="garment-tag" key={t.id}>
            <div className="tag-title">
              {data.orderNumber} · {t.garmentType}
            </div>
            <div className="tag-meta">
              {data.customerName}
              {data.dueDate ? ` · due ${new Date(data.dueDate).toLocaleDateString()}` : ''}
            </div>
            {/* Narrower bar width (JsBarcode's default of 2px renders a 13-char
                ORD-NNNNNN-NN code at ~338px, wider than a 62mm label's ~212px
                printable area and visibly overflowing the tag's border) —
                1px keeps it comfortably scannable by a cheap 1D scanner while
                fitting within the label. */}
            <Barcode value={t.ticketCode} height={30} fontSize={10} width={1} />
          </div>
        ))}
      </div>
    </>
  );
}
