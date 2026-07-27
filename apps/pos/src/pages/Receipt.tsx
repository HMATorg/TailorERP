import { useEffect, useState } from 'react';
import {
  CheckCircleFilled,
  FilePdfOutlined,
  PrinterOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Col, Descriptions, Row, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import QRCode from 'qrcode';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, errMsg, useAuth } from '../api';
import Barcode from '../components/Barcode';
import { printSection } from '../print';

/**
 * Print Center (v4 §1 amendment, D-047): three distinct physical documents
 * off one order, matching what a professional tailor counter actually hands
 * over — a thermal receipt at the till, a barcoded tag stitched or pinned to
 * each garment for the workshop to scan, and the full ZATCA tax invoice as a
 * PDF for a customer who wants (or is legally owed) a proper A4 document.
 *
 * The QR encodes the ZATCA TLV payload the API generated — rendered here, not
 * re-derived, so what is printed always matches what was hashed and archived.
 */
export default function Receipt() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation() as { state: Record<string, any> | null };
  const { organization, stores, activeStoreId } = useAuth();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const invoice = state?.invoice;
  const store = stores.find((s) => s.id === activeStoreId);
  const lines: { garmentType: string; unitPrice: number }[] = state?.lines ?? [];

  useEffect(() => {
    if (!invoice?.qrCodeBase64) return;
    void QRCode.toDataURL(invoice.qrCodeBase64, { width: 220, margin: 1 }).then(setQrDataUrl);
  }, [invoice?.qrCodeBase64]);

  if (!state) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          type="info"
          message="Receipt not in memory"
          description="Reopen this order from the order list to reprint."
        />
        <Button style={{ marginBlockStart: 12 }} onClick={() => navigate('/')}>
          New order
        </Button>
      </div>
    );
  }

  const downloadA4 = async () => {
    if (!invoice?.id) return; // button is disabled in this case — see render below
    setDownloadingPdf(true);
    try {
      // A plain window.open(apiUrl) would hit the API with no Authorization
      // header; fetching the bytes ourselves and handing the browser a blob URL
      // keeps the request authenticated.
      //
      // This used to try to *open* that blob in a new tab — first via
      // window.open(), then via a synthetic <a target="_blank"> click, on the
      // reasoning that a plain navigation isn't a popup. Both were reported
      // broken by a real user in a real browser, on two separate attempts.
      // Rather than tune a third variant of "open a tab," this forces a
      // *download* instead: `<a download>` is not a popup and is not subject
      // to popup-blocker heuristics at all in any mainstream browser — it is
      // the same mechanism every "export as PDF" button on the web relies on,
      // which is exactly why it is the safer bet after two failures of the
      // open-a-tab family. The cashier gets a saved file rather than a fragile
      // preview tab, which is also closer to how a real handover works.
      const { data } = await api.get(`/invoices/${invoice.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
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
    <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <div className="screen-only">
        <Card>
          <Space align="center" style={{ marginBlockEnd: 16 }}>
            <CheckCircleFilled style={{ fontSize: 32, color: '#2E7D32' }} />
            <div>
              <Typography.Title level={3} style={{ margin: 0 }}>
                Order {state.orderNumber} created
              </Typography.Title>
              <Typography.Text type="secondary">
                {state.tickets?.length} production ticket(s) · {state.totalReservedMeters}m fabric reserved
              </Typography.Text>
            </div>
          </Space>

          <Row gutter={24}>
            <Col xs={24} md={14}>
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="Total (incl. VAT)">SAR {state.totalAmount}</Descriptions.Item>
                <Descriptions.Item label="Deposit paid">SAR {state.paidAmount}</Descriptions.Item>
                <Descriptions.Item label="Balance due on collection">
                  <Typography.Text strong type={Number(state.balanceDue) > 0 ? 'danger' : 'success'}>
                    SAR {state.balanceDue}
                  </Typography.Text>
                </Descriptions.Item>
              </Descriptions>

              {invoice ? (
                <Descriptions column={1} bordered size="small" style={{ marginBlockStart: 16 }} title="ZATCA tax invoice">
                  <Descriptions.Item label="Invoice #">{invoice.invoiceNumber}</Descriptions.Item>
                  <Descriptions.Item label="Net">SAR {invoice.netAmount}</Descriptions.Item>
                  <Descriptions.Item label="VAT (15%)">SAR {invoice.vatAmount}</Descriptions.Item>
                  <Descriptions.Item label="Gross">SAR {invoice.totalAmount}</Descriptions.Item>
                  <Descriptions.Item label="Counter (ICV)">{invoice.icv}</Descriptions.Item>
                </Descriptions>
              ) : (
                <Alert
                  style={{ marginBlockStart: 16 }}
                  type="warning"
                  showIcon
                  message="Tax invoice not generated"
                  description="The order is saved. Re-issue the invoice from the admin app before handover."
                />
              )}
            </Col>

            <Col xs={24} md={10} style={{ textAlign: 'center' }}>
              {qrDataUrl ? (
                <>
                  <img src={qrDataUrl} alt="ZATCA QR code" style={{ width: 220, height: 220 }} />
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                    ZATCA-compliant QR — scan to verify
                  </Typography.Paragraph>
                </>
              ) : (
                <Typography.Text type="secondary">No QR available</Typography.Text>
              )}
            </Col>
          </Row>

          <Table
            style={{ marginBlockStart: 16 }}
            size="small"
            pagination={false}
            rowKey="ticketCode"
            dataSource={state.tickets ?? []}
            columns={[
              { title: 'Ticket', dataIndex: 'ticketCode' },
              { title: 'Garment', dataIndex: 'garmentType' },
              { title: 'Station', dataIndex: 'station', render: (v: string) => <Tag>{v}</Tag> },
            ]}
          />

          <Typography.Title level={5} style={{ marginBlockStart: 24 }}>
            Print Center
          </Typography.Title>
          <Space wrap style={{ marginBlockStart: 8 }}>
            <Button
              type="primary"
              size="large"
              icon={<PrinterOutlined />}
              onClick={() => printSection('thermal')}
            >
              Print thermal receipt
            </Button>
            <Button
              size="large"
              icon={<TagsOutlined />}
              disabled={!state.tickets?.length}
              onClick={() => printSection('tags')}
            >
              Print garment tags ({state.tickets?.length ?? 0})
            </Button>
            <Tooltip
              title={invoice ? undefined : 'No tax invoice was issued for this order — see the warning above'}
            >
              <Button
                size="large"
                icon={<FilePdfOutlined />}
                loading={downloadingPdf}
                disabled={!invoice}
                onClick={downloadA4}
              >
                A4 tax invoice (PDF)
              </Button>
            </Tooltip>
          </Space>

          <div>
            <Button style={{ marginBlockStart: 16 }} onClick={() => navigate('/')}>
              New order
            </Button>
          </div>
        </Card>
      </div>

      {/* ---- Thermal receipt (80mm) — shown only while body.printing-thermal ---- */}
      <div className="print-only thermal-receipt">
        <div className="center bold">{organization?.name ?? 'Tailonix'}</div>
        {store && <div className="center small">{store.name}</div>}
        {organization?.vatNumber && <div className="center small">VAT {organization.vatNumber}</div>}
        <div className="rule" />
        <div className="row small">
          <span>Order</span>
          <span className="bold">{state.orderNumber}</span>
        </div>
        <div className="row small">
          <span>Date</span>
          <span>{new Date().toLocaleString()}</span>
        </div>
        {invoice && (
          <div className="row small">
            <span>Invoice</span>
            <span>{invoice.invoiceNumber}</span>
          </div>
        )}
        <div className="rule" />
        {lines.map((l, i) => (
          <div className="row small" key={i}>
            <span>{l.garmentType}</span>
            <span>SAR {Number(l.unitPrice).toFixed(2)}</span>
          </div>
        ))}
        <div className="rule" />
        {invoice ? (
          <>
            <div className="row small">
              <span>Net</span>
              <span>SAR {invoice.netAmount}</span>
            </div>
            <div className="row small">
              <span>VAT (15%)</span>
              <span>SAR {invoice.vatAmount}</span>
            </div>
          </>
        ) : (
          <div className="row small">
            <span>Subtotal</span>
            <span>SAR {state.totalAmount}</span>
          </div>
        )}
        <div className="row bold">
          <span>Total</span>
          <span>SAR {state.totalAmount}</span>
        </div>
        <div className="row small">
          <span>Paid</span>
          <span>SAR {state.paidAmount}</span>
        </div>
        <div className="row bold">
          <span>Balance due</span>
          <span>SAR {state.balanceDue}</span>
        </div>
        <div className="rule" />
        {qrDataUrl && (
          <div className="center">
            <img src={qrDataUrl} alt="ZATCA QR" style={{ width: 160, height: 160 }} />
          </div>
        )}
        <div className="center small">Thank you for your business</div>
        <div className="center small">
          {invoice
            ? 'Full A4 tax invoice available on request'
            : 'Provisional receipt — tax invoice pending'}
        </div>
      </div>

      {/* ---- Garment tag labels — shown only while body.printing-tags ---- */}
      <div className="print-only garment-tags">
        {(state.tickets ?? []).map((t: { id: string; ticketCode: string; garmentType: string; station: string }) => (
          <div className="garment-tag" key={t.id}>
            <div className="tag-title">
              {state.orderNumber} · {t.garmentType}
            </div>
            <div className="tag-meta">
              {state.customerName}
              {state.dueDate ? ` · due ${new Date(state.dueDate).toLocaleDateString()}` : ''}
            </div>
            <Barcode value={t.ticketCode} height={30} fontSize={10} />
          </div>
        ))}
      </div>
    </div>
  );
}
