import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import dayjs from 'dayjs';
import { useParams } from 'react-router-dom';
import { api, errMsg } from '../api/client';

const movementLabels: Record<string, { label: string; color: string }> = {
  purchase_in: { label: 'Purchase', color: 'green' },
  order_out: { label: 'Order', color: 'blue' },
  transfer_out: { label: 'Transfer out', color: 'orange' },
  transfer_in: { label: 'Transfer in', color: 'cyan' },
  adjustment: { label: 'Adjustment', color: 'purple' },
  return_in: { label: 'Return', color: 'geekblue' },
};

export default function BatchDetail() {
  const { id } = useParams();
  const [batch, setBatch] = useState<Record<string, unknown> | null>(null);
  const [movements, setMovements] = useState<Record<string, unknown>[]>([]);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, m] = await Promise.all([
        api.get(`/inventory/batches/${id}`),
        api.get(`/inventory/batches/${id}/movements`),
      ]);
      setBatch(b.data);
      setMovements(m.data.items);
    } catch (e) {
      message.error(errMsg(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!batch) return <Card loading />;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%', maxWidth: 900 }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {String(batch.fabricName)} — {String(batch.batchCode)}{' '}
          <Tag color={batch.status === 'available' ? 'green' : 'default'}>{String(batch.status)}</Tag>
        </Typography.Title>
        <Button onClick={() => setAdjustOpen(true)}>Adjust quantity</Button>
      </Space>

      <Card size="small">
        <Descriptions column={{ xs: 1, md: 3 }} size="small">
          <Descriptions.Item label="Current stock">
            {String(batch.currentQuantity)} {String(batch.unit)}
          </Descriptions.Item>
          <Descriptions.Item label="Initial">{String(batch.initialQuantity)}</Descriptions.Item>
          <Descriptions.Item label="Cost / unit">SAR {String(batch.costPricePerUnit)}</Descriptions.Item>
          <Descriptions.Item label="Color">{String(batch.color ?? '—')}</Descriptions.Item>
          <Descriptions.Item label="Purchased">{String(batch.purchaseDate).slice(0, 10)}</Descriptions.Item>
          <Descriptions.Item label="Location">{String(batch.storageLocation ?? '—')}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Movement history" size="small">
        <Table
          rowKey="id"
          size="small"
          dataSource={movements}
          pagination={{ pageSize: 20 }}
          columns={[
            {
              title: 'Date',
              dataIndex: 'createdAt',
              render: (v: string) => dayjs(v).format('DD MMM YYYY HH:mm'),
            },
            {
              title: 'Type',
              dataIndex: 'movementType',
              render: (v: string) => {
                const m = movementLabels[v] ?? { label: v, color: 'default' };
                return <Tag color={m.color}>{m.label}</Tag>;
              },
            },
            { title: 'Qty', dataIndex: 'quantity' },
            { title: 'Balance after', dataIndex: 'newBalance' },
            {
              title: 'Reference',
              render: (_, r: Record<string, unknown>) =>
                (r.order as { orderNumber?: string } | null)?.orderNumber ??
                String(r.referenceDocument ?? '—'),
            },
            {
              title: 'By',
              render: (_, r: Record<string, unknown>) =>
                (r.createdBy as { fullName?: string } | null)?.fullName ?? '—',
            },
          ]}
        />
      </Card>

      <Modal open={adjustOpen} title="Adjust quantity" onCancel={() => setAdjustOpen(false)} footer={null} destroyOnHidden>
        <Form
          layout="vertical"
          onFinish={async (v) => {
            try {
              await api.put(`/inventory/batches/${id}/adjust`, v);
              message.success('Adjusted');
              setAdjustOpen(false);
              await load();
            } catch (e) {
              message.error(errMsg(e));
            }
          }}
        >
          <Form.Item
            name="delta"
            label="Delta (negative to reduce)"
            rules={[{ required: true }]}
            extra="e.g. -2.5 for damaged fabric written off"
          >
            <InputNumber step={0.5} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="note" label="Reason" rules={[{ required: true }]}>
            <Input placeholder="Required — appears in the audit ledger" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Apply adjustment
          </Button>
        </Form>
      </Modal>
    </Space>
  );
}
