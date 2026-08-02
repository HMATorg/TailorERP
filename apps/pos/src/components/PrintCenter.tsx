import { useEffect, useState } from 'react';
import { FilePdfOutlined, PrinterOutlined, TagsOutlined } from '@ant-design/icons';
import { Button, Space, Tooltip, Typography, message } from 'antd';
import QRCode from 'qrcode';
import { api, errMsg, useAuth } from '../api';
import { printSection } from '../print';
import Barcode from './Barcode';

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
  customerName: string;
  dueDate?: string | null;
  totalAmount: string;
  paidAmount: string;
  balanceDue: string;
  tickets: PrintCenterTicket[];
  lines: { garmentType: string; unitPrice: number | string }[];
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
        <div className="center bold">{organization?.name ?? 'Tailonix'}</div>
        {store && <div className="center small">{store.name}</div>}
        {organization?.vatNumber && <div className="center small">VAT {organization.vatNumber}</div>}
        <div className="rule" />
        <div className="row small">
          <span>Order</span>
          <span className="bold">{data.orderNumber}</span>
        </div>
        <div className="row small">
          <span>Date</span>
          <span>{new Date().toLocaleString()}</span>
        </div>
        {data.invoice && (
          <div className="row small">
            <span>Invoice</span>
            <span>{data.invoice.invoiceNumber}</span>
          </div>
        )}
        <div className="rule" />
        {data.lines.map((l, i) => (
          <div className="row small" key={i}>
            <span>{l.garmentType}</span>
            <span>SAR {Number(l.unitPrice).toFixed(2)}</span>
          </div>
        ))}
        <div className="rule" />
        {data.invoice ? (
          <>
            <div className="row small">
              <span>Net</span>
              <span>SAR {data.invoice.netAmount}</span>
            </div>
            <div className="row small">
              <span>VAT (15%)</span>
              <span>SAR {data.invoice.vatAmount}</span>
            </div>
          </>
        ) : (
          <div className="row small">
            <span>Subtotal</span>
            <span>SAR {data.totalAmount}</span>
          </div>
        )}
        <div className="row bold">
          <span>Total</span>
          <span>SAR {data.totalAmount}</span>
        </div>
        <div className="row small">
          <span>Paid</span>
          <span>SAR {data.paidAmount}</span>
        </div>
        <div className="row bold">
          <span>Balance due</span>
          <span>SAR {data.balanceDue}</span>
        </div>
        <div className="rule" />
        {qrDataUrl && (
          <div className="center">
            <img src={qrDataUrl} alt="ZATCA QR" style={{ width: 160, height: 160 }} />
          </div>
        )}
        <div className="center small">Thank you for your business</div>
        <div className="center small">
          {data.invoice ? 'Full A4 tax invoice available on request' : 'Provisional receipt — tax invoice pending'}
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
