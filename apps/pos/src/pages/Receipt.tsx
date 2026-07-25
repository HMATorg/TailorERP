import { useEffect, useState } from 'react';
import { CheckCircleFilled, PrinterOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Descriptions, Row, Space, Table, Tag, Typography } from 'antd';
import QRCode from 'qrcode';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

/**
 * Simplified tax invoice for the customer (v4 Phase 3 §3). The QR encodes the
 * ZATCA TLV payload the API generated — we render it, we do not re-derive it,
 * so what is printed always matches what was hashed and archived.
 */
export default function Receipt() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation() as { state: Record<string, any> | null };
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const invoice = state?.invoice;

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

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
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
            { title: 'Station', dataIndex: 'station', render: (v: string) => <Tag>{v}</Tag> },
          ]}
        />

        <Space style={{ marginBlockStart: 16 }}>
          <Button type="primary" size="large" icon={<PrinterOutlined />} onClick={() => window.print()}>
            Print
          </Button>
          <Button size="large" onClick={() => navigate('/')}>
            New order
          </Button>
        </Space>
      </Card>
    </div>
  );
}
