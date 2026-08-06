import { useCallback, useEffect, useState } from 'react';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Card, Col, Empty, Form, Input, Modal, Row, Space, Switch, Tag, Typography, Upload, message } from 'antd';
import { api, errMsg } from '../api/client';

interface ButtonDesignRow {
  id: string;
  serialNumber: string;
  imageUrl: string;
  label: string | null;
  isActive: boolean;
}

/** Keeps the login response and any list payload reasonably small (D-071). */
const MAX_IMAGE_BYTES = 300 * 1024;

interface FormValues {
  serialNumber: string;
  label?: string;
}

export default function Buttons() {
  const [rows, setRows] = useState<ButtonDesignRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<ButtonDesignRow | 'new' | null>(null);
  const [imageDataUri, setImageDataUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const load = useCallback(async (includeInactive: boolean) => {
    setLoading(true);
    try {
      const { data } = await api.get<ButtonDesignRow[]>('/buttons', {
        params: includeInactive ? { includeInactive: 'true' } : undefined,
      });
      setRows(data);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(showInactive);
  }, [load, showInactive]);

  const openModal = (row: ButtonDesignRow | 'new') => {
    setEditing(row);
    if (row === 'new') {
      form.resetFields();
      setImageDataUri(null);
    } else {
      form.setFieldsValue({ serialNumber: row.serialNumber, label: row.label ?? undefined });
      setImageDataUri(row.imageUrl);
    }
  };

  const pickImage = (file: File): boolean => {
    if (file.size > MAX_IMAGE_BYTES) {
      message.error(`Image must be under ${Math.round(MAX_IMAGE_BYTES / 1024)}KB`);
      return false;
    }
    const reader = new FileReader();
    reader.onload = () => setImageDataUri(reader.result as string);
    reader.onerror = () => message.error('Could not read that file');
    reader.readAsDataURL(file);
    return false; // handled entirely client-side — no auto-upload to any endpoint
  };

  const save = async (v: FormValues) => {
    if (editing === 'new' && !imageDataUri) {
      message.error('Upload a photo of the button first');
      return;
    }
    setSaving(true);
    try {
      const body = {
        serialNumber: v.serialNumber,
        label: v.label || undefined,
        ...(editing === 'new'
          ? { imageUrl: imageDataUri }
          : imageDataUri !== (editing as ButtonDesignRow).imageUrl
            ? { imageUrl: imageDataUri }
            : {}),
      };
      if (editing === 'new') await api.post('/buttons', body);
      else await api.put(`/buttons/${(editing as ButtonDesignRow).id}`, body);
      message.success('Saved');
      setEditing(null);
      await load(showInactive);
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: ButtonDesignRow) => {
    try {
      await api.put(`/buttons/${row.id}`, { isActive: !row.isActive });
      message.success(row.isActive ? 'Button deactivated' : 'Button reactivated');
      await load(showInactive);
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Buttons
        </Typography.Title>
        <Space>
          <Space size="small">
            <Switch size="small" checked={showInactive} onChange={setShowInactive} />
            <Typography.Text type="secondary">Show inactive</Typography.Text>
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal('new')}>
            Add button
          </Button>
        </Space>
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
        Photographed button catalog — serial number and photo, picked from at the POS instead of a
        typed description.
      </Typography.Paragraph>

      {!loading && rows.length === 0 && <Empty description="No buttons yet" />}

      <Row gutter={[16, 16]}>
        {rows.map((b) => (
          <Col xs={12} sm={8} md={6} lg={4} key={b.id}>
            <Card
              size="small"
              hoverable
              style={{ opacity: b.isActive ? 1 : 0.55 }}
              cover={
                <img
                  src={b.imageUrl}
                  alt={b.serialNumber}
                  style={{ height: 110, objectFit: 'contain', padding: 8, background: '#FAFAFA' }}
                />
              }
              actions={[
                <span key="edit" onClick={() => openModal(b)}>
                  Edit
                </span>,
                <span key="toggle" onClick={() => toggleActive(b)}>
                  {b.isActive ? 'Deactivate' : 'Reactivate'}
                </span>,
              ]}
            >
              <Card.Meta
                title={
                  <Space size={4}>
                    #{b.serialNumber}
                    {!b.isActive && <Tag color="default">Inactive</Tag>}
                  </Space>
                }
                description={b.label ?? <Typography.Text type="secondary">—</Typography.Text>}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Modal
        open={!!editing}
        title={editing === 'new' ? 'Add button' : `Edit #${(editing as ButtonDesignRow)?.serialNumber}`}
        onCancel={() => setEditing(null)}
        footer={null}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item name="serialNumber" label="Serial number" rules={[{ required: true }]}>
            <Input placeholder="153" maxLength={20} />
          </Form.Item>
          <Form.Item name="label" label="Label (optional)">
            <Input placeholder="Pearl round" maxLength={100} />
          </Form.Item>
          <Form.Item label="Photo">
            <Space align="start">
              {imageDataUri && (
                <img
                  src={imageDataUri}
                  alt="Button"
                  style={{ width: 80, height: 80, objectFit: 'contain', border: '1px solid #E0E0E0', borderRadius: 4, padding: 4 }}
                />
              )}
              <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} beforeUpload={pickImage}>
                <Button icon={<UploadOutlined />}>{imageDataUri ? 'Replace photo' : 'Upload photo'}</Button>
              </Upload>
            </Space>
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} block>
            Save button
          </Button>
        </Form>
      </Modal>
    </Space>
  );
}
