import { useEffect, useState } from 'react';
import { Card, Col, Row, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import { Link } from 'react-router-dom';
import { api, errMsg } from '../api';

interface Metrics {
  organizations: { total: number; byStatus: Record<string, number> };
  subscriptions: { byStatus: Record<string, number> };
  stores: number;
  users: number;
  estimatedMonthlyRecurringRevenueSar: number;
  recentSignups: { id: string; name: string; createdAt: string; plan: string | null }[];
}

const subStatusColors: Record<string, string> = {
  active: 'green',
  trialing: 'blue',
  past_due: 'orange',
  suspended: 'red',
  cancelled: 'default',
};

/** Platform-wide metrics (D-060) — PRD §4.5 grants this to every admin level, read-only. */
export default function Dashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    api
      .get('/admin/metrics')
      .then(({ data }) => setMetrics(data))
      .catch((e) => message.error(errMsg(e)));
  }, []);

  if (!metrics) return <Card loading />;

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        Platform Overview
      </Typography.Title>

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Organisations" value={metrics.organizations.total} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Stores" value={metrics.stores} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Staff users" value={metrics.users} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="Est. MRR (SAR)"
              value={metrics.estimatedMonthlyRecurringRevenueSar}
              precision={2}
            />
          </Card>
        </Col>
      </Row>

      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        Est. MRR is a rough estimate from active/trialing plan list prices — Stripe remains the
        source of truth for actual billed revenue.
      </Typography.Paragraph>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="Organisations by status" size="small">
            <Space wrap>
              {Object.entries(metrics.organizations.byStatus).map(([status, count]) => (
                <Tag key={status} color={status === 'active' ? 'green' : 'red'}>
                  {status}: {count}
                </Tag>
              ))}
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="Subscriptions by status" size="small">
            <Space wrap>
              {Object.entries(metrics.subscriptions.byStatus).map(([status, count]) => (
                <Tag key={status} color={subStatusColors[status] ?? 'default'}>
                  {status}: {count}
                </Tag>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>

      <Card title="Recent signups" size="small">
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={metrics.recentSignups}
          columns={[
            { title: 'Organisation', render: (_, r) => <Link to={`/tenants/${r.id}`}>{r.name}</Link> },
            { title: 'Plan', render: (_, r) => (r.plan ? <Tag color="geekblue">{r.plan}</Tag> : '—') },
            { title: 'Created', dataIndex: 'createdAt', render: (v: string) => v.slice(0, 10) },
          ]}
        />
      </Card>
    </Space>
  );
}
