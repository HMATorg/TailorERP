import { useCallback, useEffect, useState } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import { api, errMsg } from '../api/client';
import { useAuthStore } from '../stores/auth';

interface CustomerRow {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  whatsappConsent: boolean;
  language: string;
  _count: { orders: number };
}

export default function Customers() {
  const { activeStoreId } = useAuthStore();
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/customers', { params: { search: search || undefined, page } });
      setRows(data.items);
      setTotal(data.meta.total);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    void load();
  }, [load, activeStoreId]);

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Input.Search
          placeholder="Name, phone, email…"
          allowClear
          onSearch={(v) => {
            setPage(1);
            setSearch(v);
          }}
          style={{ width: 280 }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          New customer
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={{ current: page, total, pageSize: 25, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: 'Name', dataIndex: 'fullName' },
          { title: 'Phone', dataIndex: 'phone' },
          { title: 'Email', dataIndex: 'email', render: (v) => v ?? '—' },
          { title: 'Orders', render: (_, r) => r._count.orders },
          {
            title: 'WhatsApp',
            dataIndex: 'whatsappConsent',
            render: (v: boolean) => (v ? <Tag color="green">opted in</Tag> : <Tag>—</Tag>),
          },
          { title: 'Lang', dataIndex: 'language' },
        ]}
      />

      <Modal open={createOpen} title="New customer" onCancel={() => setCreateOpen(false)} footer={null} destroyOnHidden>
        <Form
          layout="vertical"
          initialValues={{ language: 'en', whatsappConsent: true }}
          onFinish={async (v) => {
            try {
              await api.post('/customers', v);
              message.success('Customer created');
              setCreateOpen(false);
              await load();
            } catch (e) {
              message.error(errMsg(e));
            }
          }}
        >
          <Form.Item name="fullName" label="Full name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="phone"
            label="Phone (E.164)"
            rules={[{ required: true, pattern: /^\+[1-9]\d{7,14}$/, message: 'e.g. +9665xxxxxxxx' }]}
          >
            <Input placeholder="+9665xxxxxxxx" />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="language" label="Preferred language">
            <Select
              options={[
                { value: 'en', label: 'English' },
                { value: 'ar', label: 'العربية' },
                { value: 'ur', label: 'اردو' },
              ]}
            />
          </Form.Item>
          <Form.Item name="whatsappConsent" valuePropName="checked">
            <Checkbox>Customer consents to WhatsApp order updates</Checkbox>
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Create
          </Button>
        </Form>
      </Modal>
    </Space>
  );
}
