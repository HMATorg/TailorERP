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
import { useParams } from 'react-router-dom';
import { api, errMsg, useAuth } from '../api';

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
    plan: { id: string; name: string; code: string; maxStores: number; maxUsers: number };
  } | null;
  stores: { id: string; name: string; status: string; isHeadquarters: boolean }[];
  _count: { users: number; customers: number; orders: number };
}

export default function TenantDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [plans, setPlans] = useState<{ id: string; code: string; name: string }[]>([]);
  const [planOpen, setPlanOpen] = useState(false);
  const canImpersonate = ['super_admin', 'support'].includes(user?.adminLevel ?? '');
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
  }, [load]);

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

  const impersonate = async () => {
    try {
      const { data } = await api.post(`/admin/organizations/${org.id}/impersonate`);
      Modal.info({
        title: 'Impersonation token issued (30 min, fully audited)',
        content: (
          <Typography.Paragraph copyable={{ text: data.accessToken }} style={{ wordBreak: 'break-all' }}>
            Paste this token into the tenant admin app's session storage, or use it as a Bearer
            token for API calls. All actions are logged under your identity.
          </Typography.Paragraph>
        ),
        width: 520,
      });
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
          <Button size="small" type="primary" onClick={() => setPlanOpen(true)}>
            Change plan
          </Button>
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
            </Descriptions.Item>
            <Descriptions.Item label="Store limit">{org.subscription.plan.maxStores}</Descriptions.Item>
            <Descriptions.Item label="User limit">{org.subscription.plan.maxUsers}</Descriptions.Item>
          </Descriptions>
        ) : (
          <Typography.Text type="secondary">No subscription</Typography.Text>
        )}
      </Card>

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
