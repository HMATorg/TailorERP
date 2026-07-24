import { useCallback, useEffect, useState } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import { Link } from 'react-router-dom';
import { api, errMsg } from '../api';

const statusColors: Record<string, string> = {
  active: 'green',
  suspended: 'red',
  past_due: 'orange',
  trialing: 'blue',
  cancelled: 'default',
};

interface OrgRow {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  subscription: { status: string; plan: { name: string; code: string } } | null;
  _count: { stores: number; users: number };
}

export default function Tenants() {
  const [rows, setRows] = useState<OrgRow[]>([]);
  const [plans, setPlans] = useState<{ code: string; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/organizations', {
        params: { search: search || undefined },
      });
      setRows(data);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
    api.get('/admin/plans').then(({ data }) => setPlans(data)).catch(() => undefined);
  }, [load]);

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Input.Search
          placeholder="Organisation name…"
          allowClear
          onSearch={setSearch}
          style={{ width: 280 }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          New Organisation
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          {
            title: 'Organisation',
            render: (_, r) => <Link to={`/tenants/${r.id}`}>{r.name}</Link>,
          },
          {
            title: 'Plan',
            render: (_, r) =>
              r.subscription ? <Tag color="geekblue">{r.subscription.plan.name}</Tag> : <Tag>none</Tag>,
          },
          { title: 'Stores', render: (_, r) => r._count.stores },
          { title: 'Users', render: (_, r) => r._count.users },
          {
            title: 'Org status',
            dataIndex: 'status',
            render: (v: string) => <Tag color={statusColors[v]}>{v}</Tag>,
          },
          {
            title: 'Subscription',
            render: (_, r) =>
              r.subscription ? (
                <Tag color={statusColors[r.subscription.status]}>{r.subscription.status}</Tag>
              ) : (
                '—'
              ),
          },
          { title: 'Created', dataIndex: 'createdAt', render: (v: string) => v.slice(0, 10) },
        ]}
      />

      <Modal
        open={createOpen}
        title="Provision new organisation"
        onCancel={() => setCreateOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Form
          layout="vertical"
          initialValues={{ planCode: 'enterprise' }}
          onFinish={async (v) => {
            try {
              await api.post('/admin/organizations', v);
              message.success('Organisation provisioned');
              setCreateOpen(false);
              await load();
            } catch (e) {
              message.error(errMsg(e));
            }
          }}
        >
          <Form.Item name="name" label="Organisation name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="planCode" label="Plan" rules={[{ required: true }]}>
            <Select options={plans.map((p) => ({ value: p.code, label: p.name }))} />
          </Form.Item>
          <Form.Item name="hqAdminEmail" label="HQ Admin email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="hqAdminPassword" label="HQ Admin password" rules={[{ required: true, min: 8 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="hqAdminFullName" label="HQ Admin name">
            <Input />
          </Form.Item>
          <Form.Item name="hqStoreName" label="HQ store name">
            <Input placeholder="Defaults to '<org> — HQ'" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Provision
          </Button>
        </Form>
      </Modal>
    </Space>
  );
}
