import { useCallback, useEffect, useState } from 'react';
import { SearchOutlined } from '@ant-design/icons';
import { Card, Input, Select, Table, Tag, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api';

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: string;
  paidAmount: string;
  createdAt: string;
  isUrgent: boolean;
  customer: { id: string; fullName: string; phone: string };
  items: { id: string; garmentType: string; quantity: number }[];
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'default',
  cutting: 'gold',
  sewing: 'blue',
  fitting: 'purple',
  ready: 'green',
  delivered: 'cyan',
  cancelled: 'red',
};

const STATUS_OPTIONS = ['pending', 'cutting', 'sewing', 'fitting', 'ready', 'delivered', 'cancelled'];

/**
 * Order lookup and reprint (D-051): the counter had no way to find an order
 * again after checkout beyond scrolling back through browser history — a
 * customer coming back for a lost receipt or to settle a balance had nowhere
 * to be served from. Search hits the same GET /orders a cashier already has
 * view_orders access to; opening a row leads to OrderDetail, which reuses the
 * same Print Center as a fresh checkout.
 */
export default function Orders() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/orders', {
        params: { search: search || undefined, status, page, pageSize },
      });
      setItems(data.items);
      setTotal(data.meta.total);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [search, status, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
      <Card size="small">
        <Typography.Title level={4} style={{ marginBlockStart: 0 }}>
          Orders
        </Typography.Title>
        <div style={{ display: 'flex', gap: 12, marginBlockEnd: 16, flexWrap: 'wrap' }}>
          <Input
            allowClear
            size="large"
            style={{ maxWidth: 360 }}
            prefix={<SearchOutlined />}
            placeholder="Search order #, customer name or phone"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
          <Select
            allowClear
            size="large"
            style={{ minWidth: 180 }}
            placeholder="All statuses"
            value={status}
            onChange={(v) => {
              setPage(1);
              setStatus(v);
            }}
            options={STATUS_OPTIONS.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
          />
        </div>

        <Table<OrderRow>
          rowKey="id"
          loading={loading}
          dataSource={items}
          onRow={(record) => ({ onClick: () => navigate(`/orders/${record.id}`), style: { cursor: 'pointer' } })}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
          columns={[
            {
              title: 'Order #',
              render: (_, r) => (
                <span>
                  {r.orderNumber} {r.isUrgent && <Tag color="red">URGENT</Tag>}
                </span>
              ),
            },
            {
              title: 'Customer',
              render: (_, r) => (
                <span>
                  {r.customer.fullName} <Typography.Text type="secondary">{r.customer.phone}</Typography.Text>
                </span>
              ),
            },
            {
              title: 'Garments',
              render: (_, r) => r.items.map((i) => i.garmentType).join(', '),
            },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (v: string) => <Tag color={STATUS_COLOR[v]}>{v.toUpperCase()}</Tag>,
            },
            {
              title: 'Total',
              render: (_, r) => `SAR ${Number(r.totalAmount).toFixed(2)}`,
            },
            {
              title: 'Balance due',
              render: (_, r) => {
                const balance = Number(r.totalAmount) - Number(r.paidAmount);
                return (
                  <Typography.Text type={balance > 0 ? 'danger' : 'success'} strong>
                    SAR {balance.toFixed(2)}
                  </Typography.Text>
                );
              },
            },
            {
              title: 'Date',
              dataIndex: 'createdAt',
              render: (v: string) => new Date(v).toLocaleDateString(),
            },
          ]}
        />
      </Card>
    </div>
  );
}
