import { useCallback, useEffect, useState } from 'react';
import { CreditCardOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Empty, Space, Table, Tag, Typography, message } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../api/client';

interface PlanRow {
  id: string;
  code: string;
  name: string;
  maxStores: number;
  maxUsers: number;
  monthlyPrice: string | null;
  yearlyPrice: string | null;
}

interface SubscriptionData {
  status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  plan: PlanRow;
}

interface InvoiceRow {
  id: string;
  number: string | null;
  status: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  created: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

const statusColors: Record<string, string> = {
  trialing: 'blue',
  active: 'green',
  past_due: 'orange',
  suspended: 'red',
  cancelled: 'default',
};

/** Tenant self-serve billing (D-062) — reads the same Stripe data platform-admin sees, scoped to this org alone. */
export default function Billing() {
  const [params, setParams] = useSearchParams();
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [subRes, plansRes, invoicesRes] = await Promise.all([
        api.get<SubscriptionData | null>('/billing/subscription'),
        api.get<PlanRow[]>('/billing/plans'),
        api.get<InvoiceRow[]>('/billing/invoices'),
      ]);
      setSubscription(subRes.data);
      setPlans(plansRes.data);
      setInvoices(invoicesRes.data);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const checkout = params.get('checkout');
    if (checkout === 'success') message.success('Subscription updated');
    else if (checkout === 'cancelled') message.info('Checkout cancelled');
    if (checkout) {
      params.delete('checkout');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const openPortal = async () => {
    setBusy(true);
    try {
      const { data } = await api.post<{ url: string }>('/billing/portal');
      window.location.href = data.url;
    } catch (e) {
      message.error(errMsg(e));
      setBusy(false);
    }
  };

  const subscribe = async (planCode: string) => {
    setBusy(true);
    try {
      const { data } = await api.post<{ url: string }>('/billing/checkout', { planCode, interval: 'monthly' });
      window.location.href = data.url;
    } catch (e) {
      message.error(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        <CreditCardOutlined /> Billing
      </Typography.Title>

      <Card title="Current plan" loading={loading}>
        {subscription ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            {subscription.cancelAtPeriodEnd && (
              <Alert
                type="warning"
                showIcon
                message={`Your subscription will end on ${new Date(subscription.currentPeriodEnd).toLocaleDateString()} and will not renew.`}
              />
            )}
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Plan">{subscription.plan.name}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag color={statusColors[subscription.status]}>{subscription.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Stores / Users">
                Up to {subscription.plan.maxStores} store(s), {subscription.plan.maxUsers} user(s)
              </Descriptions.Item>
              <Descriptions.Item label="Current period">
                {new Date(subscription.currentPeriodStart).toLocaleDateString()} –{' '}
                {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
              </Descriptions.Item>
            </Descriptions>
            <Button type="primary" onClick={openPortal} loading={busy}>
              Manage billing
            </Button>
          </Space>
        ) : (
          <Empty description="No active subscription">
            <Space direction="vertical">
              {plans.map((p) => (
                <Button key={p.id} onClick={() => subscribe(p.code)} loading={busy}>
                  Subscribe to {p.name}
                  {p.monthlyPrice ? ` — SAR ${p.monthlyPrice}/mo` : ''}
                </Button>
              ))}
            </Space>
          </Empty>
        )}
      </Card>

      <Card title="Invoice history" loading={loading}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={invoices}
          locale={{ emptyText: 'No invoices yet' }}
          columns={[
            { title: 'Date', dataIndex: 'created', render: (v: string) => new Date(v).toLocaleDateString() },
            { title: 'Number', dataIndex: 'number', render: (v: string | null) => v ?? '—' },
            {
              title: 'Amount',
              render: (_, r) => `${(r.amountPaid || r.amountDue) / 100} ${r.currency.toUpperCase()}`,
            },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (v: string | null) => (v ? <Tag>{v}</Tag> : '—'),
            },
            {
              title: '',
              render: (_, r) =>
                r.invoicePdf && (
                  <a href={r.invoicePdf} target="_blank" rel="noopener noreferrer">
                    Download
                  </a>
                ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
