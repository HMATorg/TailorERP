import { useCallback, useEffect, useState } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { STORE_ROLES } from '@tailonix/shared';
import { api, errMsg } from '../api/client';
import { useAuthStore } from '../stores/auth';

const roleColors: Record<string, string> = {
  hq_admin: '#00695C',
  regional_manager: '#1565C0',
  store_manager: '#1565C0',
  tailor: '#2E7D32',
  cashier: '#757575',
};

interface TeamUser {
  id: string;
  email: string;
  fullName: string | null;
  orgRole: 'hq_admin' | null;
  isActive: boolean;
  storeRoles: { storeId: string; role: string; store: { name: string } }[];
}

export default function Team() {
  const { stores, user: me } = useAuthStore();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [invites, setInvites] = useState<Record<string, unknown>[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/users');
      setUsers(data.users);
      setInvites(data.pendingInvites);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (u: TeamUser) => {
    try {
      await api.put(`/users/${u.id}/status`, { isActive: !u.isActive });
      await load();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Team
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setInviteOpen(true)}>
          Invite user
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={users}
        pagination={false}
        columns={[
          {
            title: 'User',
            render: (_, u) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{u.fullName ?? '—'}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {u.email}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: 'Roles / Stores',
            render: (_, u) => (
              <Space wrap>
                {u.orgRole === 'hq_admin' && <Tag color={roleColors.hq_admin}>HQ Admin — all stores</Tag>}
                {u.storeRoles.map((r) => (
                  <Tag key={r.storeId} color={roleColors[r.role]}>
                    {r.role.replace('_', ' ')} — {r.store.name}
                  </Tag>
                ))}
              </Space>
            ),
          },
          {
            title: 'Status',
            render: (_, u) =>
              u.isActive ? <Tag color="green">Active</Tag> : <Tag color="red">Inactive</Tag>,
          },
          {
            title: '',
            render: (_, u) =>
              u.id !== me?.id && (
                <Popconfirm
                  title={`${u.isActive ? 'Deactivate' : 'Reactivate'} ${u.email}?`}
                  onConfirm={() => toggleActive(u)}
                >
                  <Button size="small" danger={u.isActive}>
                    {u.isActive ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </Popconfirm>
              ),
          },
        ]}
      />

      {invites.length > 0 && (
        <>
          <Typography.Title level={5}>Pending invitations</Typography.Title>
          <Table
            rowKey="id"
            size="small"
            dataSource={invites}
            pagination={false}
            columns={[
              { title: 'Email', dataIndex: 'email' },
              { title: 'Name', dataIndex: 'fullName', render: (v) => v ?? '—' },
              { title: 'Sent', dataIndex: 'createdAt', render: (v: string) => v.slice(0, 10) },
            ]}
          />
        </>
      )}

      <Modal open={inviteOpen} title="Invite user" onCancel={() => setInviteOpen(false)} footer={null} destroyOnHidden width={560}>
        <Form
          layout="vertical"
          initialValues={{ assignments: [{}] }}
          onFinish={async (v) => {
            try {
              const { data } = await api.post('/users/invite', {
                email: v.email,
                fullName: v.fullName || undefined,
                asHqAdmin: v.asHqAdmin || undefined,
                assignments: v.asHqAdmin ? undefined : v.assignments,
              });
              message.success(
                data.devAcceptToken
                  ? `Invitation created — dev accept token: ${data.devAcceptToken.slice(0, 12)}…`
                  : 'Invitation sent',
              );
              setInviteOpen(false);
              await load();
            } catch (e) {
              message.error(errMsg(e));
            }
          }}
        >
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="fullName" label="Full name">
            <Input />
          </Form.Item>
          <Form.Item name="asHqAdmin" label="HQ Admin (org-wide access to all stores)" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.asHqAdmin !== b.asHqAdmin}>
            {({ getFieldValue }) =>
              !getFieldValue('asHqAdmin') && (
                <Form.List name="assignments">
                  {(fields, { add, remove }) => (
                    <Space direction="vertical" style={{ width: '100%' }}>
                      {fields.map((f) => (
                        <Space key={f.key} align="baseline" style={{ width: '100%' }}>
                          <Form.Item name={[f.name, 'storeId']} rules={[{ required: true }]} style={{ minWidth: 220 }}>
                            <Select placeholder="Store" options={stores.map((s) => ({ value: s.id, label: s.name }))} />
                          </Form.Item>
                          <Form.Item name={[f.name, 'role']} rules={[{ required: true }]} style={{ minWidth: 170 }}>
                            <Select
                              placeholder="Role"
                              options={STORE_ROLES.map((r) => ({ value: r, label: r.replace('_', ' ') }))}
                            />
                          </Form.Item>
                          {fields.length > 1 && (
                            <Button type="text" danger onClick={() => remove(f.name)}>
                              ✕
                            </Button>
                          )}
                        </Space>
                      ))}
                      <Button type="dashed" onClick={() => add()} block>
                        + Add store assignment
                      </Button>
                    </Space>
                  )}
                </Form.List>
              )
            }
          </Form.Item>
          <Button type="primary" htmlType="submit" block style={{ marginBlockStart: 16 }}>
            Send invitation
          </Button>
        </Form>
      </Modal>
    </Space>
  );
}
