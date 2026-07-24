import { useCallback, useEffect, useState } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Input, Select, Space, Table, Tag, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { Link, useNavigate } from 'react-router-dom';
import { ORDER_STATUSES } from '@tailonix/shared';
import { api, errMsg } from '../api/client';
import { useAuthStore } from '../stores/auth';

export const ORDER_STATUS_COLORS: Record<string, string> = {
  pending: 'default',
  cutting: 'processing',
  sewing: 'processing',
  fitting: 'warning',
  ready: 'green',
  delivered: 'success',
  cancelled: 'error',
};

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: string;
  paidAmount: string;
  dueDate: string | null;
  createdAt: string;
  customer: { id: string; fullName: string; phone: string };
  items: { garmentType: string; quantity: number }[];
}

export default function Orders() {
  const { activeStoreId } = useAuthStore();
  const navigate = useNavigate();
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const storeSelected = activeStoreId && activeStoreId !== 'all';

  const load = useCallback(async () => {
    if (!storeSelected) return;
    setLoading(true);
    try {
      const { data } = await api.get('/orders', { params: { search: search || undefined, status, page } });
      setRows(data.items);
      setTotal(data.meta.total);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [storeSelected, search, status, page]);

  useEffect(() => {
    void load();
  }, [load, activeStoreId]);

  if (!storeSelected) {
    return (
      <Typography.Paragraph type="secondary">
        Select a store from the switcher above to view its orders.
      </Typography.Paragraph>
    );
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Space wrap>
          <Input.Search
            placeholder="Order #, customer, phone…"
            allowClear
            onSearch={(v) => {
              setPage(1);
              setSearch(v);
            }}
            style={{ width: 260 }}
          />
          <Select
            placeholder="Status"
            allowClear
            style={{ width: 140 }}
            options={ORDER_STATUSES.map((s) => ({ value: s, label: s }))}
            onChange={(v) => {
              setPage(1);
              setStatus(v);
            }}
          />
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/orders/new')}>
          New Order
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={{ current: page, total, pageSize: 25, onChange: setPage, showSizeChanger: false }}
        onRow={(r) => ({ style: { cursor: 'pointer' }, onClick: () => navigate(`/orders/${r.id}`) })}
        columns={[
          {
            title: 'Order #',
            dataIndex: 'orderNumber',
            render: (v: string, r) => <Link to={`/orders/${r.id}`}>{v}</Link>,
          },
          { title: 'Customer', render: (_, r) => r.customer.fullName },
          {
            title: 'Items',
            render: (_, r) => r.items.map((i) => `${i.quantity}× ${i.garmentType}`).join(', '),
          },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (v: string) => <Tag color={ORDER_STATUS_COLORS[v]}>{v}</Tag>,
          },
          { title: 'Total (SAR)', dataIndex: 'totalAmount' },
          {
            title: 'Balance',
            render: (_, r) => (Number(r.totalAmount) - Number(r.paidAmount)).toFixed(2),
          },
          {
            title: 'Due',
            dataIndex: 'dueDate',
            render: (v: string | null) => (v ? dayjs(v).format('DD MMM') : '—'),
          },
        ]}
      />
    </Space>
  );
}
