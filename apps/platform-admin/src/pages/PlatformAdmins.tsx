import { useCallback, useEffect, useState } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { api, errMsg, useAuth } from '../api';

const levelColors: Record<string, string> = {
  super_admin: 'gold',
  billing: 'geekblue',
  support: 'green',
};

interface AdminRow {
  id: string;
  adminLevel: 'super_admin' | 'billing' | 'support';
  isActive: boolean;
  createdAt: string;
  user: { id: string; email: string; fullName: string | null; isActive: boolean; createdAt: string };
}

/** Platform admin account management (D-060) — previously only the seeded super_admin existed. */
export default function PlatformAdmins() {
  const { user: me } = useAuth();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/platform-admins');
      setRows(data);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setActive = async (row: AdminRow, isActive: boolean) => {
    try {
      await api.put(`/admin/platform-admins/${row.id}`, { isActive });
      message.success(isActive ? 'Access restored' : 'Access revoked');
      await load();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const changeLevel = async (row: AdminRow, adminLevel: string) => {
    try {
      await api.put(`/admin/platform-admins/${row.id}`, { adminLevel });
      message.success('Admin level updated');
      await load();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Platform Admins
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          New Platform Admin
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          {
            title: 'Admin',
            render: (_, r) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{r.user.fullName ?? '—'}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {r.user.email}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: 'Level',
            render: (_, r) => (
              <Select
                size="small"
                value={r.adminLevel}
                style={{ width: 140 }}
                onChange={(v) => void changeLevel(r, v)}
                options={['super_admin', 'billing', 'support'].map((l) => ({ value: l, label: l }))}
              />
            ),
          },
          {
            title: 'Status',
            render: (_, r) => (
              <Tag color={r.isActive ? levelColors[r.adminLevel] : 'red'}>
                {r.isActive ? 'active' : 'revoked'}
              </Tag>
            ),
          },
          { title: 'Created', dataIndex: 'createdAt', render: (v: string) => v.slice(0, 10) },
          {
            title: '',
            render: (_, r) =>
              r.user.id !== me?.id && (
                <Popconfirm
                  title={`${r.isActive ? 'Revoke' : 'Restore'} ${r.user.email}'s platform access?`}
                  onConfirm={() => void setActive(r, !r.isActive)}
                >
                  <Button size="small" danger={r.isActive}>
                    {r.isActive ? 'Revoke' : 'Restore'}
                  </Button>
                </Popconfirm>
              ),
          },
        ]}
      />

      <Modal
        open={createOpen}
        title="New platform admin"
        onCancel={() => setCreateOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Form
          layout="vertical"
          initialValues={{ adminLevel: 'support' }}
          onFinish={async (v) => {
            try {
              await api.post('/admin/platform-admins', v);
              message.success('Platform admin created');
              setCreateOpen(false);
              await load();
            } catch (e) {
              message.error(errMsg(e));
            }
          }}
        >
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 8 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="fullName" label="Full name">
            <Input />
          </Form.Item>
          <Form.Item name="adminLevel" label="Admin level" rules={[{ required: true }]}>
            <Select options={['super_admin', 'billing', 'support'].map((l) => ({ value: l, label: l }))} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Create
          </Button>
        </Form>
      </Modal>
    </Space>
  );
}
