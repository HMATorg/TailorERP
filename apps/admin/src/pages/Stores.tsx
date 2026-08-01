import { useCallback, useEffect, useState } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import {
  Badge,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  TimePicker,
  Typography,
  message,
} from 'antd';
import dayjs from 'dayjs';
import { api, errMsg } from '../api/client';
import { useAuthStore } from '../stores/auth';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const statusColor: Record<string, string> = { active: '#2E7D32', paused: '#F57F17', closed: '#C62828' };

interface StoreRow {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  isHeadquarters: boolean;
  status: 'active' | 'paused' | 'closed';
  operatingHours: Record<string, { open: string; close: string }>;
  whatsappPhoneNumberId: string | null;
  whatsappConfigured: boolean;
}

export default function Stores() {
  const [rows, setRows] = useState<StoreRow[]>([]);
  const [editing, setEditing] = useState<StoreRow | 'new' | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/stores');
      setRows(data);
    } catch (e) {
      message.error(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openModal = (store: StoreRow | 'new') => {
    setEditing(store);
    if (store === 'new') {
      form.resetFields();
    } else {
      form.setFieldsValue({
        ...store,
        hours: Object.fromEntries(
          DAYS.map((d) => {
            const h = store.operatingHours?.[d];
            return [d, h ? [dayjs(h.open, 'HH:mm'), dayjs(h.close, 'HH:mm')] : undefined];
          }),
        ),
      });
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Stores
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal('new')}>
          Add store
        </Button>
      </Space>

      <Row gutter={[16, 16]}>
        {rows.map((s) => (
          <Col xs={24} md={12} lg={8} key={s.id}>
            <Card
              size="small"
              title={
                <Space>
                  <Badge color={statusColor[s.status]} />
                  {s.name}
                  {s.isHeadquarters && <Typography.Text type="secondary">(HQ)</Typography.Text>}
                </Space>
              }
              extra={
                <Button size="small" onClick={() => openModal(s)}>
                  Edit
                </Button>
              }
            >
              <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
                {s.address ?? 'No address'}
              </Typography.Paragraph>
              <Typography.Text type="secondary">{s.phone ?? ''}</Typography.Text>
            </Card>
          </Col>
        ))}
      </Row>

      <Modal
        open={!!editing}
        title={editing === 'new' ? 'Add store' : `Edit ${(editing as StoreRow)?.name}`}
        onCancel={() => setEditing(null)}
        footer={null}
        destroyOnHidden
        width={620}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (v) => {
            const operatingHours = Object.fromEntries(
              DAYS.filter((d) => v.hours?.[d]).map((d) => [
                d,
                { open: v.hours[d][0].format('HH:mm'), close: v.hours[d][1].format('HH:mm') },
              ]),
            );
            const body = {
              name: v.name,
              address: v.address || undefined,
              phone: v.phone || undefined,
              email: v.email || undefined,
              isHeadquarters: v.isHeadquarters ?? false,
              ...(editing !== 'new' ? { status: v.status } : {}),
              operatingHours,
              ...(v.whatsappPhoneNumberId !== undefined && {
                whatsappPhoneNumberId: v.whatsappPhoneNumberId || undefined,
              }),
              // Blank means "leave the current token alone" — only send it when typed.
              ...(v.whatsappAccessToken && { whatsappAccessToken: v.whatsappAccessToken }),
            };
            try {
              if (editing === 'new') await api.post('/stores', body);
              else await api.put(`/stores/${(editing as StoreRow).id}`, body);
              message.success('Saved');
              setEditing(null);
              await load();
            } catch (e) {
              message.error(errMsg(e));
            }
          }}
        >
          <Row gutter={12}>
            <Col span={16}>
              <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="isHeadquarters" label="Headquarters" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="address" label="Address">
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="phone" label="Phone">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
          {editing !== 'new' && (
            <Form.Item name="status" label="Status">
              <Select options={['active', 'paused', 'closed'].map((s) => ({ value: s }))} />
            </Form.Item>
          )}
          <Typography.Text strong>
            WhatsApp{' '}
            {editing && editing !== 'new' && (
              <Typography.Text type={editing.whatsappConfigured ? 'success' : 'secondary'}>
                — {editing.whatsappConfigured ? 'configured' : 'not configured'}
              </Typography.Text>
            )}
          </Typography.Text>
          <Row gutter={12} style={{ marginBlockStart: 8, marginBlockEnd: editing === 'new' ? 24 : 8 }}>
            <Col span={12}>
              <Form.Item name="whatsappPhoneNumberId" label="Phone Number ID">
                <Input placeholder="From the WhatsApp Cloud API app" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="whatsappAccessToken" label="Access token">
                <Input.Password placeholder={(editing as StoreRow)?.whatsappConfigured ? 'Leave blank to keep current' : 'Paste token'} />
              </Form.Item>
            </Col>
          </Row>
          <Typography.Text strong>Operating hours</Typography.Text>
          <Row gutter={[8, 4]} style={{ marginBlockStart: 8 }}>
            {DAYS.map((d) => (
              <Col span={12} key={d}>
                <Form.Item name={['hours', d]} label={d.toUpperCase()} style={{ marginBottom: 8 }}>
                  <TimePicker.RangePicker format="HH:mm" minuteStep={30} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            ))}
          </Row>
          <Button type="primary" htmlType="submit" block style={{ marginBlockStart: 8 }}>
            Save store
          </Button>
        </Form>
      </Modal>
    </Space>
  );
}
