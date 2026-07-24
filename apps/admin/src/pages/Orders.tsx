import { useCallback, useEffect, useState } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Input, Select, Space, Table, Tag, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      <Typography.Paragraph type="secondary">{t('app.selectStorePrompt')}</Typography.Paragraph>
    );
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Space wrap>
          <Input.Search
            placeholder={t('order.searchPlaceholder')}
            allowClear
            onSearch={(v) => {
              setPage(1);
              setSearch(v);
            }}
            style={{ width: 260 }}
          />
          <Select
            placeholder={t('app.status')}
            allowClear
            style={{ width: 140 }}
            options={ORDER_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`, s) }))}
            onChange={(v) => {
              setPage(1);
              setStatus(v);
            }}
          />
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/orders/new')}>
          {t('order.newOrder')}
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
            title: t('order.orderNumber'),
            dataIndex: 'orderNumber',
            render: (v: string, r) => <Link to={`/orders/${r.id}`}>{v}</Link>,
          },
          { title: t('order.customer'), render: (_, r) => r.customer.fullName },
          {
            title: t('order.items'),
            render: (_, r) => r.items.map((i) => `${i.quantity}× ${i.garmentType}`).join(', '),
          },
          {
            title: t('app.status'),
            dataIndex: 'status',
            render: (v: string) => <Tag color={ORDER_STATUS_COLORS[v]}>{t(`status.${v}`, v)}</Tag>,
          },
          { title: `${t('order.total')} (SAR)`, dataIndex: 'totalAmount' },
          {
            title: t('order.balance'),
            render: (_, r) => (Number(r.totalAmount) - Number(r.paidAmount)).toFixed(2),
          },
          {
            title: t('order.due'),
            dataIndex: 'dueDate',
            render: (v: string | null) => (v ? dayjs(v).format('DD MMM') : '—'),
          },
        ]}
      />
    </Space>
  );
}
