import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import { api, errMsg } from '../api';

const ALL_FEATURES = [
  'orders',
  'inventory_basic',
  'inventory_batches',
  'appointments',
  'pwa',
  'whatsapp',
  'multi_store',
  'regional_managers',
  'transfers',
  'reorder_alerts',
];

interface Plan {
  id: string;
  name: string;
  code: string;
  maxStores: number;
  maxUsers: number;
  features: string[];
  monthlyPrice: string | null;
  yearlyPrice: string | null;
  isPublic: boolean;
  stripeMonthlyPriceId: string | null;
  stripeYearlyPriceId: string | null;
}

export default function Plans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/plans');
      setPlans(data);
    } catch (e) {
      message.error(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (plan: Plan | 'new') => {
    setEditing(plan);
    if (plan === 'new') form.resetFields();
    else form.setFieldsValue(plan);
  };

  return (
    <>
      <Row gutter={[16, 16]}>
        {plans.map((p) => (
          <Col xs={24} md={8} key={p.id}>
            <Card
              title={p.name}
              extra={<Button size="small" onClick={() => open(p)}>Edit</Button>}
            >
              <Typography.Title level={3} style={{ marginTop: 0 }}>
                {p.monthlyPrice ? `SAR ${p.monthlyPrice}/mo` : '—'}
              </Typography.Title>
              <p>
                Up to <b>{p.maxStores}</b> stores · <b>{p.maxUsers}</b> users
              </p>
              {!p.stripeMonthlyPriceId && !p.stripeYearlyPriceId && (
                <Tag color="orange" style={{ marginBlockEnd: 8 }}>
                  Not purchasable — no Stripe price
                </Tag>
              )}
              <div>
                {p.features.map((f) => (
                  <Tag key={f} style={{ marginBlockEnd: 4 }}>
                    {f}
                  </Tag>
                ))}
              </div>
            </Card>
          </Col>
        ))}
        <Col xs={24} md={8}>
          <Button type="dashed" block style={{ height: '100%', minHeight: 180 }} onClick={() => open('new')}>
            + New plan
          </Button>
        </Col>
      </Row>

      <Modal
        open={!!editing}
        title={editing === 'new' ? 'New plan' : `Edit ${(editing as Plan)?.name}`}
        onCancel={() => setEditing(null)}
        footer={null}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (v) => {
            try {
              await api.post('/admin/plans', {
                ...v,
                monthlyPrice: v.monthlyPrice ? Number(v.monthlyPrice) : undefined,
                yearlyPrice: v.yearlyPrice ? Number(v.yearlyPrice) : undefined,
              });
              message.success('Plan saved — feature caches refresh within 5 minutes');
              setEditing(null);
              await load();
            } catch (e) {
              message.error(errMsg(e));
            }
          }}
        >
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="code" label="Code" rules={[{ required: true }]}>
                <Input disabled={editing !== 'new'} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="maxStores" label="Max stores" rules={[{ required: true }]}>
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="maxUsers" label="Max users" rules={[{ required: true }]}>
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="monthlyPrice" label="Monthly price (SAR)">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="yearlyPrice" label="Yearly price (SAR)">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="stripeMonthlyPriceId"
                label="Stripe monthly price ID"
                extra="Required before this plan can be purchased"
              >
                <Input placeholder="price_..." />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="stripeYearlyPriceId" label="Stripe yearly price ID">
                <Input placeholder="price_..." />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="features" label="Features" rules={[{ required: true }]}>
            <Select mode="multiple" options={ALL_FEATURES.map((f) => ({ value: f }))} />
          </Form.Item>
          <Form.Item name="isPublic" label="Publicly listed" valuePropName="checked" initialValue>
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Save plan
          </Button>
        </Form>
      </Modal>
    </>
  );
}
