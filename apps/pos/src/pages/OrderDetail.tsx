import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { api, errMsg, useActivePermissions } from '../api';
import PrintCenter, { type PrintCenterData } from '../components/PrintCenter';

interface OrderDetailData {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: string;
  paidAmount: string;
  discountAmount: string;
  dueDate: string | null;
  notes: string | null;
  isUrgent: boolean;
  createdAt: string;
  customer: {
    id: string;
    fullName: string;
    phone: string;
    whatsappConsent: boolean;
    vatNumber: string | null;
    address: string | null;
  };
  items: { id: string; garmentType: string; quantity: number; unitPrice: string }[];
  statusHistory: { id: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string; changedBy: { fullName: string } | null }[];
  payments: { id: string; amount: string; method: string; kind: string; createdAt: string }[];
  tickets: { id: string; ticketCode: string; garmentType: string; station: string }[];
  invoice: {
    id: string;
    invoiceNumber: string;
    icv: number | null;
    netAmount: string;
    vatAmount: string;
    totalAmount: string;
    qrCodeBase64: string | null;
  } | null;
}

const TRACKING_STEPS = ['pending', 'cutting', 'sewing', 'fitting', 'ready', 'delivered'];
const money = (v: string | number) => Number(v).toFixed(2);

/** Balance-settlement + reprint view (D-051) opened from Orders. */
export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const permissions = useActivePermissions();
  const canSettle = permissions.includes('pos_settle');
  const [order, setOrder] = useState<OrderDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer' | 'other'>('cash');
  const [settling, setSettling] = useState(false);

  const balance = order ? Number(order.totalAmount) - Number(order.paidAmount) : 0;

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/orders/${id}`);
      setOrder(data);
      const due = Number(data.totalAmount) - Number(data.paidAmount);
      setAmount(due > 0 ? due : 0);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const settle = async () => {
    if (!order || amount <= 0) return;
    setSettling(true);
    try {
      const { data } = await api.post(`/pos/orders/${order.id}/settle`, { amount, method });
      if (data.markedDelivered) {
        message.success(`Balance settled — order closed out as delivered.`);
      } else if (Number(data.balanceDue) === 0) {
        message.warning('Balance settled, but the workshop has not marked this order ready — confirm before handing over the garment.');
      } else {
        message.success(`Payment of SAR ${money(amount)} recorded.`);
      }
      await load();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSettling(false);
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '48px auto' }} />;
  if (!order) return null;

  const showsNotReadyWarning = balance <= 0 && order.status !== 'delivered' && order.status !== 'cancelled';

  const printData: PrintCenterData = {
    orderNumber: order.orderNumber,
    customerName: order.customer.fullName,
    customerVatNumber: order.customer.vatNumber,
    customerAddress: order.customer.address,
    dueDate: order.dueDate,
    totalAmount: money(order.totalAmount),
    paidAmount: money(order.paidAmount),
    balanceDue: money(balance),
    tickets: order.tickets,
    lines: order.items.map((i) => ({ garmentType: i.garmentType, unitPrice: i.unitPrice })),
    invoice: order.invoice
      ? {
          id: order.invoice.id,
          invoiceNumber: order.invoice.invoiceNumber,
          netAmount: money(order.invoice.netAmount),
          vatAmount: money(order.invoice.vatAmount),
          totalAmount: money(order.invoice.totalAmount),
          qrCodeBase64: order.invoice.qrCodeBase64,
        }
      : null,
  };

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: '0 auto' }}>
      <div className="screen-only">
        <Button icon={<ArrowLeftOutlined />} style={{ marginBlockEnd: 12 }} onClick={() => navigate('/orders')}>
          Back to orders
        </Button>

        <Card>
          <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }} wrap>
            <div>
              <Typography.Title level={3} style={{ margin: 0 }}>
                {order.orderNumber}
              </Typography.Title>
              <Typography.Text type="secondary">
                {order.customer.fullName} · {order.customer.phone}
              </Typography.Text>
            </div>
            <Space>
              {order.isUrgent && <Tag color="red">URGENT</Tag>}
              <Tag color={order.status === 'cancelled' ? 'red' : order.status === 'delivered' ? 'cyan' : 'blue'}>
                {order.status.toUpperCase()}
              </Tag>
            </Space>
          </Space>

          {order.status !== 'cancelled' && (
            <Steps
              size="small"
              style={{ marginBlockStart: 24 }}
              current={order.status === 'delivered' ? TRACKING_STEPS.length : TRACKING_STEPS.indexOf(order.status)}
              items={TRACKING_STEPS.map((s) => ({ title: s[0].toUpperCase() + s.slice(1) }))}
            />
          )}

          {showsNotReadyWarning && (
            <Alert
              style={{ marginBlockStart: 16 }}
              type="warning"
              showIcon
              message="Balance is fully paid but the workshop has not marked this order ready"
              description="Confirm with the tailor that the garment is actually finished before handing it over."
            />
          )}

          <Row gutter={24} style={{ marginBlockStart: 16 }}>
            <Col xs={24} md={12}>
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="Total (incl. VAT)">SAR {money(order.totalAmount)}</Descriptions.Item>
                <Descriptions.Item label="Paid">SAR {money(order.paidAmount)}</Descriptions.Item>
                <Descriptions.Item label="Balance due">
                  <Typography.Text strong type={balance > 0 ? 'danger' : 'success'}>
                    SAR {money(balance)}
                  </Typography.Text>
                </Descriptions.Item>
                {order.dueDate && (
                  <Descriptions.Item label="Due date">{new Date(order.dueDate).toLocaleDateString()}</Descriptions.Item>
                )}
                {order.notes && <Descriptions.Item label="Notes">{order.notes}</Descriptions.Item>}
              </Descriptions>
            </Col>

            <Col xs={24} md={12}>
              {balance > 0 && order.status !== 'cancelled' ? (
                !canSettle ? (
                  <Alert
                    type="warning"
                    showIcon
                    message={`SAR ${money(balance)} outstanding`}
                    description="Ask a cashier or manager to collect this payment."
                  />
                ) : (
                <Card size="small" title="Collect payment">
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <InputNumber
                      size="large"
                      style={{ width: '100%' }}
                      min={0}
                      max={balance}
                      value={amount}
                      onChange={(v) => setAmount(v ?? 0)}
                    />
                    <Select
                      size="large"
                      style={{ width: '100%' }}
                      value={method}
                      onChange={setMethod}
                      options={[
                        { value: 'cash', label: 'Cash' },
                        { value: 'card', label: 'Card' },
                        { value: 'transfer', label: 'Bank transfer' },
                        { value: 'other', label: 'Other' },
                      ]}
                    />
                    <Button
                      type="primary"
                      size="large"
                      block
                      loading={settling}
                      disabled={amount <= 0 || amount > balance}
                      onClick={settle}
                    >
                      Settle SAR {money(amount)}
                    </Button>
                  </Space>
                </Card>
                )
              ) : (
                <Alert type="success" showIcon message="No outstanding balance" />
              )}
            </Col>
          </Row>

          <Table
            style={{ marginBlockStart: 16 }}
            size="small"
            pagination={false}
            rowKey="id"
            title={() => 'Garments'}
            dataSource={order.items}
            columns={[
              { title: 'Garment', dataIndex: 'garmentType' },
              { title: 'Qty', dataIndex: 'quantity' },
              { title: 'Unit price', render: (_, r) => `SAR ${money(r.unitPrice)}` },
            ]}
          />

          <Table
            style={{ marginBlockStart: 16 }}
            size="small"
            pagination={false}
            rowKey="id"
            title={() => 'Payments'}
            dataSource={order.payments}
            columns={[
              { title: 'Date', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString() },
              { title: 'Kind', dataIndex: 'kind', render: (v: string) => <Tag>{v}</Tag> },
              { title: 'Method', dataIndex: 'method' },
              { title: 'Amount', render: (_, r) => `SAR ${money(r.amount)}` },
            ]}
          />

          <Table
            style={{ marginBlockStart: 16 }}
            size="small"
            pagination={false}
            rowKey="id"
            title={() => 'Status history'}
            dataSource={order.statusHistory}
            columns={[
              { title: 'Date', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString() },
              {
                title: 'Change',
                render: (_, r) => `${r.fromStatus ?? '∅'} → ${r.toStatus}`,
              },
              { title: 'By', render: (_, r) => r.changedBy?.fullName ?? '—' },
              { title: 'Note', dataIndex: 'note' },
            ]}
          />
        </Card>
      </div>

      <PrintCenter data={printData} />
    </div>
  );
}
