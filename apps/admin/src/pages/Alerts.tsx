import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import dayjs from 'dayjs';
import { api, errMsg } from '../api/client';
import { useAuthStore } from '../stores/auth';

const alertColors: Record<string, string> = {
  pending: 'red',
  acknowledged: 'orange',
  ordered: 'blue',
  resolved: 'green',
};

export default function Alerts() {
  const { activeStoreId } = useAuthStore();
  const [alerts, setAlerts] = useState<Record<string, unknown>[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>[]>([]);
  const [status, setStatus] = useState<string | undefined>();
  const [settingOpen, setSettingOpen] = useState(false);
  const storeSelected = activeStoreId && activeStoreId !== 'all';

  const load = useCallback(async () => {
    if (!storeSelected) return;
    try {
      const [a, s] = await Promise.all([
        api.get('/inventory/alerts', { params: { status } }),
        api.get('/inventory/reorder-settings'),
      ]);
      setAlerts(a.data);
      setSettings(s.data);
    } catch (e) {
      message.error(errMsg(e));
    }
  }, [storeSelected, status]);

  useEffect(() => {
    void load();
  }, [load, activeStoreId]);

  if (!storeSelected) {
    return <Typography.Paragraph type="secondary">Select a store to view its stock alerts.</Typography.Paragraph>;
  }

  const act = async (id: string, action: 'acknowledged' | 'ordered' | 'resolve') => {
    try {
      if (action === 'resolve') await api.put(`/inventory/alerts/${id}/resolve`, {});
      else await api.put(`/inventory/alerts/${id}`, { status: action });
      await load();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <Tabs
      items={[
        {
          key: 'alerts',
          label: 'Restock alerts',
          children: (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Select
                placeholder="Filter status"
                allowClear
                style={{ width: 180 }}
                options={['pending', 'acknowledged', 'ordered', 'resolved'].map((s) => ({ value: s }))}
                onChange={setStatus}
              />
              <Table
                rowKey="id"
                dataSource={alerts}
                pagination={false}
                columns={[
                  { title: 'Fabric', dataIndex: 'fabricName' },
                  { title: 'Current', dataIndex: 'currentQty' },
                  { title: 'Threshold', dataIndex: 'thresholdQty' },
                  { title: 'Suggested order', dataIndex: 'suggestedOrderQty' },
                  {
                    title: 'Status',
                    dataIndex: 'status',
                    render: (v: string) => <Tag color={alertColors[v]}>{v}</Tag>,
                  },
                  {
                    title: 'Created',
                    dataIndex: 'createdAt',
                    render: (v: string) => dayjs(v).format('DD MMM'),
                  },
                  {
                    title: 'Actions',
                    render: (_, r: Record<string, unknown>) => (
                      <Space>
                        {r.status === 'pending' && (
                          <Button size="small" onClick={() => act(String(r.id), 'acknowledged')}>
                            Acknowledge
                          </Button>
                        )}
                        {['pending', 'acknowledged'].includes(String(r.status)) && (
                          <Button size="small" onClick={() => act(String(r.id), 'ordered')}>
                            Ordered
                          </Button>
                        )}
                        {r.status !== 'resolved' && (
                          <Button size="small" type="primary" ghost onClick={() => act(String(r.id), 'resolve')}>
                            Resolve
                          </Button>
                        )}
                      </Space>
                    ),
                  },
                ]}
              />
            </Space>
          ),
        },
        {
          key: 'settings',
          label: 'Reorder thresholds',
          children: (
            <Card
              size="small"
              extra={
                <Button type="primary" size="small" onClick={() => setSettingOpen(true)}>
                  Set threshold
                </Button>
              }
            >
              <Table
                rowKey="id"
                size="small"
                dataSource={settings}
                pagination={false}
                columns={[
                  { title: 'Fabric', dataIndex: 'fabricName' },
                  { title: 'Min threshold', dataIndex: 'minThreshold' },
                  { title: 'Max threshold', dataIndex: 'maxThreshold' },
                  { title: 'Lead time (days)', dataIndex: 'leadTimeDays' },
                ]}
              />
              <Modal
                open={settingOpen}
                title="Reorder threshold"
                onCancel={() => setSettingOpen(false)}
                footer={null}
                destroyOnHidden
              >
                <Form
                  layout="vertical"
                  onFinish={async (v) => {
                    try {
                      await api.put('/inventory/reorder-settings', v);
                      message.success('Saved — checked daily at 8 AM store time');
                      setSettingOpen(false);
                      await load();
                    } catch (e) {
                      message.error(errMsg(e));
                    }
                  }}
                >
                  <Form.Item name="fabricName" label="Fabric name" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="minThreshold" label="Alert when stock below" rules={[{ required: true }]}>
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="maxThreshold" label="Restock up to">
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="leadTimeDays" label="Supplier lead time (days)">
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block>
                    Save
                  </Button>
                </Form>
              </Modal>
            </Card>
          ),
        },
      ]}
    />
  );
}
