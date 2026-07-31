import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Descriptions,
  Form,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { Link, useParams } from 'react-router-dom';
import { api, errMsg, useAuth } from '../api';

/** Where apps/admin lives — the impersonation handoff link points here. */
const ADMIN_APP_URL = import.meta.env.VITE_ADMIN_APP_URL ?? 'http://localhost:5173';

interface OrgDetail {
  id: string;
  name: string;
  status: string;
  defaultCurrency: string;
  timezone: string;
  createdAt: string;
  subscription: {
    status: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd?: boolean;
    plan: { id: string; name: string; code: string; maxStores: number; maxUsers: number };
  } | null;
  stores: { id: string; name: string; status: string; isHeadquarters: boolean }[];
  _count: { users: number; customers: number; orders: number };
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

const invoiceStatusColors: Record<string, string> = {
  paid: 'green',
  open: 'blue',
  draft: 'default',
  uncollectible: 'red',
  void: 'default',
};

export default function TenantDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [plans, setPlans] = useState<{ id: string; code: string; name: string }[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [impersonationUrl, setImpersonationUrl] = useState<string | null>(null);
  const canImpersonate = ['super_admin', 'support'].includes(user?.adminLevel ?? '');
  const canBill = ['super_admin', 'billing'].includes(user?.adminLevel ?? '');
  const isSuperAdmin = user?.adminLevel === 'super_admin';

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/organizations/${id}`);
      setOrg(data);
    } catch (e) {
      message.error(errMsg(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
    api.get('/admin/plans').then(({ data }) => setPlans(data)).catch(() => undefined);
    if (canBill) {
      api
        .get(`/admin/billing/organizations/${id}/invoices`)
        .then(({ data }) => setInvoices(data))
        .catch((e) => message.error(errMsg(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, id]);

  if (!org) return <Card loading />;

  const suspend = async (status: 'active' | 'suspended') => {
    try {
      await api.put(`/admin/organizations/${org.id}`, { status });
      message.success(status === 'suspended' ? 'Organisation suspended' : 'Organisation reactivated');
      await load();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  /** Opens the Stripe-hosted billing portal in a new tab. */
  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const { data } = await api.post(`/admin/billing/organizations/${org.id}/portal`);
      window.open(data.url, '_blank', 'noopener');
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setPortalLoading(false);
    }
  };

  const impersonate = async () => {
    try {
      const { data } = await api.post(`/admin/organizations/${org.id}/impersonate`);
      // Deliberately does NOT auto-open a tab here — a synthetic click after
      // this await has already lost the click's user-activation window, and
      // this exact family of bug took three rounds to fix elsewhere in this
      // product (D-047/D-049/D-050). Rendering a real <a> the operator
      // clicks themselves is a genuine second gesture, so no popup blocker
      // has anything to object to.
      setImpersonationUrl(`${ADMIN_APP_URL}/impersonate?token=${encodeURIComponent(data.accessToken)}`);
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%', maxWidth: 900 }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {org.name}{' '}
          <Tag color={org.status === 'active' ? 'green' : 'red'}>{org.status}</Tag>
        </Typography.Title>
        <Space wrap>
          <Link to={`/audit?org=${org.id}`}>
            <Button>View audit trail</Button>
          </Link>
          {canImpersonate && (
            <Popconfirm
              title="Impersonate this tenant's HQ Admin for 30 minutes? All actions are logged."
              onConfirm={() => void impersonate()}
            >
              <Button>Impersonate HQ Admin</Button>
            </Popconfirm>
          )}
          {isSuperAdmin &&
            (org.status === 'active' ? (
              <Popconfirm title="Suspend this organisation? Staff logins will be blocked." onConfirm={() => suspend('suspended')}>
                <Button danger>Suspend</Button>
              </Popconfirm>
            ) : (
              <Button onClick={() => suspend('active')}>Reactivate</Button>
            ))}
        </Space>
      </Space>

      <Card title="Overview" size="small">
        <Descriptions column={{ xs: 1, md: 3 }} size="small">
          <Descriptions.Item label="Stores">{org.stores.length}</Descriptions.Item>
          <Descriptions.Item label="Users">{org._count.users}</Descriptions.Item>
          <Descriptions.Item label="Customers">{org._count.customers}</Descriptions.Item>
          <Descriptions.Item label="Orders">{org._count.orders}</Descriptions.Item>
          <Descriptions.Item label="Currency">{org.defaultCurrency}</Descriptions.Item>
          <Descriptions.Item label="Timezone">{org.timezone}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        title="Subscription"
        size="small"
        extra={
          canBill && (
            <Space>
              <Button size="small" onClick={() => setCheckoutOpen(true)}>
                Start paid subscription
              </Button>
              <Button size="small" onClick={() => void openPortal()} loading={portalLoading}>
                Billing portal
              </Button>
              <Button size="small" type="primary" onClick={() => setPlanOpen(true)}>
                Change plan
              </Button>
            </Space>
          )
        }
      >
        {org.subscription ? (
          <Descriptions column={{ xs: 1, md: 3 }} size="small">
            <Descriptions.Item label="Plan">{org.subscription.plan.name}</Descriptions.Item>
            <Descriptions.Item label="Status">
              <Tag color={org.subscription.status === 'active' ? 'green' : 'orange'}>
                {org.subscription.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Period ends">
              {org.subscription.currentPeriodEnd.slice(0, 10)}
              {org.subscription.cancelAtPeriodEnd && (
                <Tag color="red" style={{ marginInlineStart: 8 }}>
                  cancels at period end
                </Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Store limit">{org.subscription.plan.maxStores}</Descriptions.Item>
            <Descriptions.Item label="User limit">{org.subscription.plan.maxUsers}</Descriptions.Item>
          </Descriptions>
        ) : (
          <Typography.Text type="secondary">No subscription</Typography.Text>
        )}
      </Card>

      {canBill && (
        <Card title="Invoices" size="small">
          {invoices && invoices.length > 0 ? (
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={invoices}
              columns={[
                { title: 'Number', render: (_, r) => r.number ?? r.id },
                {
                  title: 'Status',
                  render: (_, r) =>
                    r.status ? <Tag color={invoiceStatusColors[r.status] ?? 'default'}>{r.status}</Tag> : '—',
                },
                {
                  title: 'Amount paid',
                  render: (_, r) => `${(r.amountPaid / 100).toFixed(2)} ${r.currency.toUpperCase()}`,
                },
                { title: 'Date', dataIndex: 'created', render: (v: string) => v.slice(0, 10) },
                {
                  title: '',
                  render: (_, r) =>
                    r.hostedInvoiceUrl && (
                      <a href={r.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer">
                        View
                      </a>
                    ),
                },
              ]}
            />
          ) : (
            <Typography.Text type="secondary">
              {invoices ? 'No invoices yet' : 'Loading…'}
            </Typography.Text>
          )}
        </Card>
      )}

      <Card title="Stores" size="small">
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={org.stores}
          columns={[
            { title: 'Name', dataIndex: 'name' },
            { title: 'HQ', render: (_, s) => (s.isHeadquarters ? '✓' : '') },
            { title: 'Status', dataIndex: 'status', render: (v: string) => <Tag>{v}</Tag> },
          ]}
        />
      </Card>

      <Modal
        open={checkoutOpen}
        title="Start paid subscription"
        onCancel={() => setCheckoutOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          Creates a Stripe Checkout session. The link opens in a new tab — send it to the
          tenant, or complete it with them on a call.
        </Typography.Paragraph>
        <Form
          layout="vertical"
          initialValues={{ interval: 'monthly', planCode: org.subscription?.plan.code }}
          onFinish={async (v) => {
            try {
              const { data } = await api.post(
                `/admin/billing/organizations/${org.id}/checkout`,
                v,
              );
              window.open(data.url, '_blank', 'noopener');
              setCheckoutOpen(false);
            } catch (e) {
              message.error(errMsg(e));
            }
          }}
        >
          <Form.Item name="planCode" label="Plan" rules={[{ required: true }]}>
            <Select options={plans.map((p) => ({ value: p.code, label: p.name }))} />
          </Form.Item>
          <Form.Item name="interval" label="Billing interval" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'yearly', label: 'Yearly' },
              ]}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Create checkout link
          </Button>
        </Form>
      </Modal>

      <Modal
        open={!!impersonationUrl}
        title="Impersonation session ready (30 min, fully audited)"
        onCancel={() => setImpersonationUrl(null)}
        footer={null}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          Opens {org.name}'s HQ Admin account in the tenant admin app. All actions taken during
          this session are logged under your identity.
        </Typography.Paragraph>
        <Button
          type="primary"
          block
          href={impersonationUrl ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setImpersonationUrl(null)}
        >
          Open impersonated session
        </Button>
      </Modal>

      <Modal open={planOpen} title="Change plan" onCancel={() => setPlanOpen(false)} footer={null} destroyOnHidden>
        <Form
          layout="vertical"
          initialValues={{ planId: org.subscription?.plan.id }}
          onFinish={async (v) => {
            try {
              await api.put(`/admin/organizations/${org.id}/subscription`, v);
              message.success('Plan updated');
              setPlanOpen(false);
              await load();
            } catch (e) {
              message.error(errMsg(e));
            }
          }}
        >
          <Form.Item name="planId" label="Plan" rules={[{ required: true }]}>
            <Select options={plans.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="status" label="Subscription status">
            <Select
              allowClear
              options={['trialing', 'active', 'past_due', 'suspended', 'cancelled'].map((s) => ({ value: s }))}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Apply
          </Button>
        </Form>
      </Modal>
    </Space>
  );
}
