import { useCallback, useEffect, useState } from 'react';
import { FilePdfOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { ORDER_STATUS_TRANSITIONS, TRACKING_STEPS, type OrderStatus } from '@tailonix/shared';
import { api, errMsg } from '../api/client';
import { ORDER_STATUS_COLORS } from './Orders';

interface OrderDetailData {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: string;
  paidAmount: string;
  discountAmount: string;
  dueDate: string | null;
  notes: string | null;
  isUrgent: boolean;
  createdAt: string;
  customer: { id: string; fullName: string; phone: string; whatsappConsent: boolean };
  createdBy: { fullName: string | null } | null;
  items: {
    id: string;
    garmentType: string;
    description: string | null;
    quantity: number;
    unitPrice: string;
    fabrics: { quantityUsed: string; batch: { batchCode: string; fabricName: string; color: string | null } }[];
  }[];
  statusHistory: { toStatus: OrderStatus; createdAt: string; changedBy: { fullName: string | null } | null }[];
  payments: { id: string; amount: string; method: string; createdAt: string }[];
}

export default function OrderDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const [order, setOrder] = useState<OrderDetailData | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invoiceBusy, setInvoiceBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/orders/${id}`);
      setOrder(data);
    } catch (e) {
      message.error(errMsg(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!order) return <Card loading />;

  const nextStatuses = ORDER_STATUS_TRANSITIONS[order.status] ?? [];
  const balance = (Number(order.totalAmount) - Number(order.paidAmount)).toFixed(2);
  const reachedAt = new Map(order.statusHistory.map((h) => [h.toStatus, h.createdAt]));
  const stepIndex = TRACKING_STEPS.indexOf(order.status);

  /** Creates the invoice if needed, then downloads the PDF. */
  const downloadInvoice = async () => {
    setInvoiceBusy(true);
    try {
      const { data: invoice } = await api.post(`/invoices/orders/${order.id}`);
      const { data } = await api.get(`/invoices/${invoice.id}/download`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoice.invoiceNumber}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setInvoiceBusy(false);
    }
  };

  const changeStatus = async (status: OrderStatus) => {
    setBusy(true);
    try {
      await api.put(`/orders/${order.id}/status`, { status });
      message.success(`Status updated to ${status}`);
      await load();
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%', maxWidth: 1000 }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {order.orderNumber}{' '}
          {order.isUrgent && (
            <Tag color="red" style={{ marginInlineStart: 8 }}>
              URGENT
            </Tag>
          )}
          <Tag color={ORDER_STATUS_COLORS[order.status]} style={{ marginInlineStart: 8 }}>
            {order.status}
          </Tag>
        </Typography.Title>
        <Space wrap>
          <Button icon={<FilePdfOutlined />} loading={invoiceBusy} onClick={() => void downloadInvoice()}>
            {t('order.invoice')}
          </Button>
          {nextStatuses.map((s) =>
            s === 'cancelled' ? (
              <Popconfirm key={s} title="Cancel this order?" onConfirm={() => changeStatus(s)}>
                <Button danger loading={busy}>
                  Cancel order
                </Button>
              </Popconfirm>
            ) : (
              <Button key={s} type="primary" ghost loading={busy} onClick={() => changeStatus(s)}>
                Mark {s}
              </Button>
            ),
          )}
        </Space>
      </Space>

      {order.status !== 'cancelled' && (
        <Card>
          <Steps
            size="small"
            current={order.status === 'delivered' ? TRACKING_STEPS.length : stepIndex}
            items={[
              ...TRACKING_STEPS.map((step) => ({
                title: t(`status.${step}`, step),
                description: reachedAt.has(step)
                  ? dayjs(reachedAt.get(step)).format('DD MMM HH:mm')
                  : undefined,
              })),
              {
                title: t('status.delivered'),
                description: reachedAt.has('delivered')
                  ? dayjs(reachedAt.get('delivered')).format('DD MMM HH:mm')
                  : undefined,
              },
            ]}
          />
        </Card>
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="Customer" size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Name">{order.customer.fullName}</Descriptions.Item>
              <Descriptions.Item label="Phone">{order.customer.phone}</Descriptions.Item>
              <Descriptions.Item label="WhatsApp updates">
                {order.customer.whatsappConsent ? <Tag color="green">opted in</Tag> : <Tag>no consent</Tag>}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card
            title="Payment"
            size="small"
            extra={
              Number(balance) > 0 && (
                <Button size="small" type="primary" onClick={() => setPayOpen(true)}>
                  Record payment
                </Button>
              )
            }
          >
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Total">SAR {order.totalAmount}</Descriptions.Item>
              <Descriptions.Item label="Paid">SAR {order.paidAmount}</Descriptions.Item>
              <Descriptions.Item label="Balance">
                <Typography.Text type={Number(balance) > 0 ? 'danger' : 'success'}>SAR {balance}</Typography.Text>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <Card title="Items" size="small">
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={order.items}
          columns={[
            { title: 'Garment', dataIndex: 'garmentType' },
            { title: 'Qty', dataIndex: 'quantity', width: 60 },
            { title: 'Unit price', dataIndex: 'unitPrice', width: 100 },
            {
              title: 'Fabric batches (FIFO)',
              render: (_, r) => (
                <Space wrap>
                  {r.fabrics.map((f, i) => (
                    <Tag key={i}>
                      {f.batch.fabricName} · {f.batch.batchCode}: {f.quantityUsed}m
                    </Tag>
                  ))}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {order.payments.length > 0 && (
        <Card title="Payment history" size="small">
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={order.payments}
            columns={[
              { title: 'Date', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('DD MMM YYYY HH:mm') },
              { title: 'Amount (SAR)', dataIndex: 'amount' },
              { title: 'Method', dataIndex: 'method' },
            ]}
          />
        </Card>
      )}

      <Modal
        open={payOpen}
        title="Record payment"
        onCancel={() => setPayOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Form
          layout="vertical"
          initialValues={{ amount: Number(balance), method: 'cash' }}
          onFinish={async (v) => {
            try {
              await api.post(`/orders/${order.id}/payments`, v);
              message.success('Payment recorded');
              setPayOpen(false);
              await load();
            } catch (e) {
              message.error(errMsg(e));
            }
          }}
        >
          <Form.Item name="amount" label="Amount (SAR)" rules={[{ required: true }]}>
            <InputNumber min={0.01} max={Number(balance)} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="method" label="Method">
            <Select options={['cash', 'card', 'transfer', 'other'].map((m) => ({ value: m }))} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Save
          </Button>
        </Form>
      </Modal>
    </Space>
  );
}
