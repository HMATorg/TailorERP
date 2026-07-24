import { useEffect, useState } from 'react';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api/client';
import BatchSelectorModal, { type BatchAllocation } from '../components/BatchSelectorModal';
import { useAuthStore } from '../stores/auth';

interface CustomerOption {
  id: string;
  fullName: string;
  phone: string;
}

/** allocations keyed by `${itemIndex}-${fabricIndex}` when staff pick batches manually */
type AllocationMap = Record<string, BatchAllocation[]>;

export default function NewOrder() {
  const { activeStoreId } = useAuthStore();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [fabricNames, setFabricNames] = useState<string[]>([]);
  const [allocations, setAllocations] = useState<AllocationMap>({});
  const [selector, setSelector] = useState<{ key: string; fabricName: string; qty: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const searchCustomers = async (q: string) => {
    try {
      const { data } = await api.get('/customers', { params: { search: q || undefined } });
      setCustomers(data.items);
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  useEffect(() => {
    void searchCustomers('');
    api
      .get('/inventory/batches', { params: { status: 'available', pageSize: 100 } })
      .then(({ data }) => {
        setFabricNames([...new Set<string>(data.items.map((b: { fabricName: string }) => b.fabricName))]);
      })
      .catch(() => undefined);
  }, [activeStoreId]);

  if (!activeStoreId || activeStoreId === 'all') {
    return (
      <Typography.Paragraph type="secondary">
        Select a specific store before creating an order.
      </Typography.Paragraph>
    );
  }

  return (
    <Card title="New Order" style={{ maxWidth: 900 }}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ items: [{ quantity: 1, fabrics: [] }] }}
        onFinish={async (values) => {
          setSubmitting(true);
          try {
            const body = {
              customerId: values.customerId,
              dueDate: values.dueDate?.format('YYYY-MM-DD'),
              notes: values.notes || undefined,
              items: values.items.map(
                (
                  item: {
                    garmentType: string;
                    quantity: number;
                    unitPrice: number;
                    description?: string;
                    fabrics?: { fabricName: string; quantity: number }[];
                  },
                  i: number,
                ) => ({
                  garmentType: item.garmentType,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  description: item.description || undefined,
                  fabrics: (item.fabrics ?? []).map((f, j) => {
                    const manual = allocations[`${i}-${j}`];
                    return {
                      fabricName: f.fabricName,
                      quantity: f.quantity,
                      ...(manual?.length
                        ? { batchAllocations: manual.map(({ batchId, quantity }) => ({ batchId, quantity })) }
                        : {}),
                    };
                  }),
                }),
              ),
            };
            const { data } = await api.post('/orders', body);
            message.success(`Order ${data.orderNumber} created`);
            navigate(`/orders/${data.id}`);
          } catch (e) {
            message.error(errMsg(e));
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="customerId" label="Customer" rules={[{ required: true }]}>
              <Select
                showSearch
                placeholder="Search name or phone…"
                filterOption={false}
                onSearch={(v) => void searchCustomers(v)}
                options={customers.map((c) => ({
                  value: c.id,
                  label: `${c.fullName} (${c.phone})`,
                }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="dueDate" label="Due date">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Form.List name="items">
          {(fields, { add, remove }) => (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              {fields.map((field, i) => (
                <Card
                  key={field.key}
                  size="small"
                  title={`Garment ${i + 1}`}
                  extra={
                    fields.length > 1 && (
                      <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                    )
                  }
                >
                  <Row gutter={12}>
                    <Col xs={24} md={8}>
                      <Form.Item name={[field.name, 'garmentType']} label="Garment type" rules={[{ required: true }]}>
                        <Select
                          options={['Thobe', 'Shirt', 'Trousers', 'Suit', 'Abaya', 'Kandura', 'Other'].map((g) => ({
                            value: g,
                          }))}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={4}>
                      <Form.Item name={[field.name, 'quantity']} label="Qty" rules={[{ required: true }]}>
                        <InputNumber min={1} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={5}>
                      <Form.Item name={[field.name, 'unitPrice']} label="Unit price (SAR)" rules={[{ required: true }]}>
                        <InputNumber min={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={7}>
                      <Form.Item name={[field.name, 'description']} label="Notes">
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Form.List name={[field.name, 'fabrics']}>
                    {(fabricFields, fabricOps) => (
                      <Space direction="vertical" style={{ width: '100%' }}>
                        {fabricFields.map((ff, j) => {
                          const key = `${i}-${j}`;
                          const manual = allocations[key];
                          return (
                            <Row gutter={12} key={ff.key} align="middle">
                              <Col xs={24} md={9}>
                                <Form.Item
                                  name={[ff.name, 'fabricName']}
                                  label={j === 0 ? 'Fabric' : undefined}
                                  rules={[{ required: true }]}
                                >
                                  <Select
                                    showSearch
                                    placeholder="Fabric"
                                    options={fabricNames.map((f) => ({ value: f }))}
                                  />
                                </Form.Item>
                              </Col>
                              <Col xs={12} md={5}>
                                <Form.Item
                                  name={[ff.name, 'quantity']}
                                  label={j === 0 ? 'Metres' : undefined}
                                  rules={[{ required: true }]}
                                >
                                  <InputNumber min={0.5} step={0.5} style={{ width: '100%' }} />
                                </Form.Item>
                              </Col>
                              <Col xs={12} md={10}>
                                <Space wrap>
                                  <Button
                                    onClick={() => {
                                      const fabric = form.getFieldValue(['items', field.name, 'fabrics', ff.name]);
                                      if (!fabric?.fabricName || !fabric?.quantity) {
                                        message.warning('Pick a fabric and quantity first');
                                        return;
                                      }
                                      setSelector({ key, fabricName: fabric.fabricName, qty: fabric.quantity });
                                    }}
                                  >
                                    {manual?.length ? 'Batches ✓' : 'Choose batches'}
                                  </Button>
                                  {manual?.length ? (
                                    manual.map((a) => (
                                      <Tag key={a.batchId}>
                                        {a.batchCode}: {a.quantity}
                                      </Tag>
                                    ))
                                  ) : (
                                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                      auto-FIFO
                                    </Typography.Text>
                                  )}
                                  <Button
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => {
                                      fabricOps.remove(ff.name);
                                      setAllocations((a) => {
                                        const next = { ...a };
                                        delete next[key];
                                        return next;
                                      });
                                    }}
                                  />
                                </Space>
                              </Col>
                            </Row>
                          );
                        })}
                        <Button type="dashed" icon={<PlusOutlined />} onClick={() => fabricOps.add()}>
                          Add fabric
                        </Button>
                      </Space>
                    )}
                  </Form.List>
                </Card>
              ))}
              <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ quantity: 1, fabrics: [] })}>
                Add garment
              </Button>
            </Space>
          )}
        </Form.List>

        <Form.Item name="notes" label="Order notes" style={{ marginBlockStart: 16 }}>
          <Input.TextArea rows={2} />
        </Form.Item>

        <Space>
          <Button type="primary" htmlType="submit" loading={submitting} size="large">
            Create order
          </Button>
          <Button onClick={() => navigate('/orders')}>Cancel</Button>
        </Space>
      </Form>

      {selector && (
        <BatchSelectorModal
          open
          fabricName={selector.fabricName}
          requiredQty={selector.qty}
          initial={allocations[selector.key]}
          onCancel={() => setSelector(null)}
          onConfirm={(allocs) => {
            setAllocations((a) => ({ ...a, [selector.key]: allocs }));
            setSelector(null);
          }}
        />
      )}
    </Card>
  );
}
