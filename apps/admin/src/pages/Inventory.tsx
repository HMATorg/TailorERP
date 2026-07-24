import { useCallback, useEffect, useState } from 'react';
import { PlusOutlined, SwapOutlined } from '@ant-design/icons';
import {
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api/client';
import { useAuthStore } from '../stores/auth';

interface Batch {
  id: string;
  fabricName: string;
  fabricCode: string | null;
  batchCode: string;
  color: string | null;
  unit: string;
  initialQuantity: string;
  currentQuantity: string;
  costPricePerUnit: string;
  purchaseDate: string;
  storageLocation: string | null;
  status: string;
  supplier: { id: string; name: string } | null;
}

const statusTag: Record<string, string> = { available: 'green', depleted: 'default', quarantined: 'red' };

export default function Inventory() {
  const { activeStoreId, user, stores } = useAuthStore();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Batch[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [transferBatch, setTransferBatch] = useState<Batch | null>(null);
  const storeSelected = activeStoreId && activeStoreId !== 'all';
  const isHq = user?.orgRole === 'hq_admin';

  const load = useCallback(async () => {
    if (!storeSelected) return;
    setLoading(true);
    try {
      const { data } = await api.get('/inventory/batches', {
        params: { search: search || undefined, page },
      });
      setRows(data.items);
      setTotal(data.meta.total);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [storeSelected, search, page]);

  useEffect(() => {
    void load();
  }, [load, activeStoreId]);

  if (!storeSelected) {
    return (
      <Typography.Paragraph type="secondary">
        Select a store from the switcher above to view its inventory.
      </Typography.Paragraph>
    );
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Input.Search
          placeholder="Fabric, batch code…"
          allowClear
          onSearch={(v) => {
            setPage(1);
            setSearch(v);
          }}
          style={{ width: 280 }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
          Log purchase
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={{ current: page, total, pageSize: 25, onChange: setPage, showSizeChanger: false }}
        onRow={(r) => ({ style: { cursor: 'pointer' }, onClick: () => navigate(`/inventory/${r.id}`) })}
        columns={[
          { title: 'Fabric', dataIndex: 'fabricName' },
          { title: 'Batch', dataIndex: 'batchCode' },
          { title: 'Color', dataIndex: 'color', render: (v) => v ?? '—' },
          {
            title: 'Stock',
            render: (_, r) => {
              const pct = Math.round((Number(r.currentQuantity) / Number(r.initialQuantity)) * 100);
              return (
                <Space direction="vertical" size={0} style={{ width: 140 }}>
                  <Typography.Text style={{ fontSize: 12 }}>
                    {r.currentQuantity}/{r.initialQuantity} {r.unit}
                  </Typography.Text>
                  <Progress
                    percent={pct}
                    size="small"
                    showInfo={false}
                    strokeColor={pct > 50 ? '#2E7D32' : pct > 20 ? '#F57F17' : '#C62828'}
                  />
                </Space>
              );
            },
          },
          { title: 'Purchased', dataIndex: 'purchaseDate', render: (v: string) => v.slice(0, 10) },
          { title: 'Supplier', render: (_, r) => r.supplier?.name ?? '—' },
          { title: 'Status', dataIndex: 'status', render: (v: string) => <Tag color={statusTag[v]}>{v}</Tag> },
          ...(isHq
            ? [
                {
                  title: '',
                  width: 60,
                  render: (_: unknown, r: Batch) => (
                    <Button
                      type="text"
                      icon={<SwapOutlined />}
                      title="Transfer to another store"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTransferBatch(r);
                      }}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />

      <Modal open={addOpen} title="Log fabric purchase" onCancel={() => setAddOpen(false)} footer={null} destroyOnHidden>
        <Form
          layout="vertical"
          onFinish={async (v) => {
            try {
              await api.post('/inventory/batches', {
                ...v,
                purchaseDate: v.purchaseDate.format('YYYY-MM-DD'),
              });
              message.success('Batch added');
              setAddOpen(false);
              await load();
            } catch (e) {
              message.error(errMsg(e));
            }
          }}
        >
          <Form.Item name="fabricName" label="Fabric name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name="batchCode" label="Batch code" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item name="color" label="Color" style={{ flex: 1, marginInlineStart: 8 }}>
              <Input />
            </Form.Item>
          </Space.Compact>
          <Space.Compact block>
            <Form.Item name="quantity" label="Quantity (m)" rules={[{ required: true }]} style={{ flex: 1 }}>
              <InputNumber min={0.5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="costPricePerUnit"
              label="Cost / unit (SAR)"
              rules={[{ required: true }]}
              style={{ flex: 1, marginInlineStart: 8 }}
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Space.Compact>
          <Space.Compact block>
            <Form.Item name="purchaseDate" label="Purchase date" rules={[{ required: true }]} style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="storageLocation" label="Storage location" style={{ flex: 1, marginInlineStart: 8 }}>
              <Input placeholder="e.g. Rack A1" />
            </Form.Item>
          </Space.Compact>
          <Button type="primary" htmlType="submit" block>
            Add batch
          </Button>
        </Form>
      </Modal>

      <Modal
        open={!!transferBatch}
        title={`Transfer ${transferBatch?.batchCode} — ${transferBatch?.fabricName}`}
        onCancel={() => setTransferBatch(null)}
        footer={null}
        destroyOnHidden
      >
        <Form
          layout="vertical"
          onFinish={async (v) => {
            try {
              await api.post('/inventory/transfer', { batchId: transferBatch!.id, ...v });
              message.success('Transfer complete');
              setTransferBatch(null);
              await load();
            } catch (e) {
              message.error(errMsg(e));
            }
          }}
        >
          <Form.Item name="destinationStoreId" label="Destination store" rules={[{ required: true }]}>
            <Select
              options={stores
                .filter((s) => s.id !== activeStoreId)
                .map((s) => ({ value: s.id, label: s.name }))}
            />
          </Form.Item>
          <Form.Item
            name="quantity"
            label={`Quantity (max ${transferBatch?.currentQuantity})`}
            rules={[{ required: true }]}
          >
            <InputNumber min={0.5} max={Number(transferBatch?.currentQuantity)} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="note" label="Note">
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Transfer
          </Button>
        </Form>
      </Modal>
    </Space>
  );
}
