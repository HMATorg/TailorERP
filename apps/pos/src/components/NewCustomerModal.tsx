import { useEffect } from 'react';
import { Alert, Checkbox, Form, Input, Modal, Select } from 'antd';
import { api, errMsg } from '../api';

/** A query that reads as the start of a phone number rather than a name. */
const looksLikePhone = (q: string) => /^[+\d][\d\s-]*$/.test(q.trim());

/**
 * On-the-spot walk-in registration (v4 §1 amendment, D-046).
 *
 * The whole point is that this is the *only* step between a stranger walking
 * in and the counter taking their measurements — no admin app, no manager
 * hand-off. `POST /customers` is the same endpoint the admin app's "New
 * customer" dialog already calls; this is not a parallel, lighter-weight path
 * that could drift from it, just this role's first legitimate reach for it.
 */
export default function NewCustomerModal({
  open,
  initialQuery,
  onCancel,
  onCreated,
}: {
  open: boolean;
  /** Whatever the cashier had already typed into the search box, if anything. */
  initialQuery: string;
  onCancel: () => void;
  onCreated: (customerId: string) => void;
}) {
  const [form] = Form.useForm();

  useEffect(() => {
    if (!open) return;
    const q = initialQuery.trim();
    form.resetFields();
    if (q) {
      form.setFieldsValue(looksLikePhone(q) ? { phone: q } : { fullName: q });
    }
  }, [open, initialQuery, form]);

  return (
    <Modal
      open={open}
      title="Register new customer"
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText="Register & continue"
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBlockEnd: 16 }}
        message="Next you'll take their measurements right here at the counter."
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={{ language: 'en', whatsappConsent: true }}
        onFinish={async (v) => {
          try {
            const { data } = await api.post('/customers', v);
            onCreated(data.id);
          } catch (e) {
            void form.setFields([{ name: 'phone', errors: [errMsg(e)] }]);
          }
        }}
      >
        <Form.Item
          name="fullName"
          label="Full name"
          rules={[{ required: true, message: 'Enter the customer’s name' }]}
        >
          <Input size="large" autoFocus placeholder="Full name" />
        </Form.Item>
        <Form.Item
          name="phone"
          label="Phone (E.164)"
          rules={[
            { required: true, message: 'Enter a phone number' },
            { pattern: /^\+[1-9]\d{7,14}$/, message: 'e.g. +9665xxxxxxxx' },
          ]}
        >
          <Input size="large" inputMode="tel" placeholder="+9665xxxxxxxx" />
        </Form.Item>
        <Form.Item name="email" label="Email (optional)" rules={[{ type: 'email' }]}>
          <Input size="large" placeholder="name@example.com" />
        </Form.Item>
        <Form.Item name="language" label="Preferred language">
          <Select
            size="large"
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
      </Form>
    </Modal>
  );
}
