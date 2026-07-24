import { useEffect, useState } from 'react';
import { Card, Col, DatePicker, Row, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api/client';
import { useAuthStore } from '../stores/auth';

interface HqData {
  totals: { revenue: string; orderCount: number; pendingAlerts: number; storeCount: number } | null;
  stores: { storeId: string; storeName: string; revenue: string; orderCount: number; avgOrderValue: string }[];
}

interface StoreData {
  today: { revenue: string; orderCount: number };
  yesterday: { revenue: string; orderCount: number };
  activeOrdersByStatus: Record<string, number>;
  pendingAlerts: number;
  todayAppointments: {
    id: string;
    scheduledAt: string;
    appointmentType: string;
    status: string;
    customer: { fullName: string; phone: string };
  }[];
}

const statusColors: Record<string, string> = {
  pending: 'default',
  cutting: 'processing',
  sewing: 'processing',
  fitting: 'warning',
  ready: 'success',
};

export default function Dashboard() {
  const { activeStoreId, setActiveStore, user } = useAuthStore();
  const { t } = useTranslation();
  const isAll = activeStoreId === 'all';
  const [hq, setHq] = useState<HqData | null>(null);
  const [store, setStore] = useState<StoreData | null>(null);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(7, 'day'), dayjs()]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeStoreId) return;
    setLoading(true);
    const load = async () => {
      try {
        if (isAll) {
          const { data } = await api.get<HqData>('/dashboard/hq', {
            params: { from: range[0].toISOString(), to: range[1].toISOString() },
          });
          setHq(data);
        } else {
          const { data } = await api.get<StoreData>('/dashboard/store');
          setStore(data);
        }
      } catch (e) {
        message.error(errMsg(e));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [activeStoreId, isAll, range]);

  if (isAll) {
    return (
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t('dashboard.hqOverview')} — {user?.organization.name}
          </Typography.Title>
          <DatePicker.RangePicker
            value={range}
            onChange={(v) => v?.[0] && v?.[1] && setRange([v[0], v[1]])}
            allowClear={false}
          />
        </Space>
        <Row gutter={[16, 16]}>
          <Col xs={12} lg={6}>
            <Card loading={loading}>
              <Statistic title={t('dashboard.revenue')} value={hq?.totals?.revenue ?? '0'} prefix="SAR" />
            </Card>
          </Col>
          <Col xs={12} lg={6}>
            <Card loading={loading}>
              <Statistic title={t('dashboard.orders')} value={hq?.totals?.orderCount ?? 0} />
            </Card>
          </Col>
          <Col xs={12} lg={6}>
            <Card loading={loading}>
              <Statistic title={t('dashboard.stores')} value={hq?.totals?.storeCount ?? 0} />
            </Card>
          </Col>
          <Col xs={12} lg={6}>
            <Card loading={loading}>
              <Statistic
                title={t('dashboard.lowStockAlerts')}
                value={hq?.totals?.pendingAlerts ?? 0}
                valueStyle={(hq?.totals?.pendingAlerts ?? 0) > 0 ? { color: '#C62828' } : undefined}
              />
            </Card>
          </Col>
        </Row>
        <Card title={t('dashboard.storePerformance')} loading={loading}>
          <Table
            rowKey="storeId"
            dataSource={hq?.stores ?? []}
            pagination={false}
            onRow={(row) => ({
              style: { cursor: 'pointer' },
              onClick: () => setActiveStore(row.storeId),
            })}
            columns={[
              { title: t('store.name'), dataIndex: 'storeName', sorter: (a, b) => a.storeName.localeCompare(b.storeName) },
              {
                title: `${t('dashboard.revenue')} (SAR)`,
                dataIndex: 'revenue',
                sorter: (a, b) => Number(a.revenue) - Number(b.revenue),
                defaultSortOrder: 'descend',
              },
              { title: t('dashboard.orders'), dataIndex: 'orderCount' },
              {
                title: t('dashboard.avgOrderValue'),
                dataIndex: 'avgOrderValue',
                render: (v: string) => Number(v).toFixed(2),
              },
            ]}
          />
        </Card>
      </Space>
    );
  }

  const revToday = Number(store?.today.revenue ?? 0);
  const revYesterday = Number(store?.yesterday.revenue ?? 0);
  const delta = revYesterday > 0 ? ((revToday - revYesterday) / revYesterday) * 100 : null;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            <Statistic
              title={t('dashboard.revenueToday')}
              value={revToday}
              prefix="SAR"
              suffix={
                delta !== null ? (
                  <Typography.Text type={delta >= 0 ? 'success' : 'danger'} style={{ fontSize: 13 }}>
                    {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%
                  </Typography.Text>
                ) : undefined
              }
            />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            <Statistic title={t('dashboard.ordersToday')} value={store?.today.orderCount ?? 0} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            <Statistic
              title={t('dashboard.activeOrders')}
              value={Object.values(store?.activeOrdersByStatus ?? {}).reduce((a, b) => a + b, 0)}
            />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            <Statistic
              title={t('dashboard.lowStockAlerts')}
              value={store?.pendingAlerts ?? 0}
              valueStyle={(store?.pendingAlerts ?? 0) > 0 ? { color: '#C62828' } : undefined}
            />
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card title={t('dashboard.workInProgress')} loading={loading}>
            <Space wrap>
              {Object.entries(store?.activeOrdersByStatus ?? {}).map(([status, count]) => (
                <Tag key={status} color={statusColors[status] ?? 'default'} style={{ fontSize: 14, padding: '4px 10px' }}>
                  {t(`status.${status}`, status)}: {count}
                </Tag>
              ))}
              {Object.keys(store?.activeOrdersByStatus ?? {}).length === 0 && (
                <Typography.Text type="secondary">{t('dashboard.noActiveOrders')}</Typography.Text>
              )}
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title={t('dashboard.todaysAppointments')} loading={loading}>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={store?.todayAppointments ?? []}
              columns={[
                {
                  title: t('appointment.time'),
                  dataIndex: 'scheduledAt',
                  render: (v: string) => dayjs(v).format('HH:mm'),
                },
                { title: t('order.customer'), render: (_, r) => r.customer.fullName },
                {
                  title: t('appointment.type'),
                  dataIndex: 'appointmentType',
                  render: (v: string) => t(`appointment.${v}`, v),
                },
                {
                  title: t('app.status'),
                  dataIndex: 'status',
                  render: (v: string) => <Tag>{t(`apptStatus.${v}`, v)}</Tag>,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
