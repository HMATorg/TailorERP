import { useState } from 'react';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Result, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../api/client';
import LanguageSwitcher from '../components/LanguageSwitcher';

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#E0F2F1' }}>
      <Card style={{ width: 420, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>{children}</Card>
    </div>
  );

  if (!token) {
    return shell(
      <Result
        status="error"
        title={t('invite.invalidTitle')}
        subTitle={t('invite.invalidBody')}
        extra={
          <Button type="primary" onClick={() => navigate('/login')}>
            {t('app.signIn')}
          </Button>
        }
      />,
    );
  }

  if (done) {
    return shell(
      <Result
        status="success"
        title={t('invite.successTitle')}
        subTitle={t('invite.successBody')}
        extra={
          <Button type="primary" onClick={() => navigate('/login')}>
            {t('app.signIn')}
          </Button>
        }
      />,
    );
  }

  return shell(
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <LanguageSwitcher />
      </div>
      <Typography.Title level={3} style={{ color: '#00695C', textAlign: 'center' }}>
        {t('app.name')}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
        {t('invite.subtitle')}
      </Typography.Paragraph>
      {error && <Alert type="error" message={error} style={{ marginBlockEnd: 16 }} />}
      <Form
        layout="vertical"
        onFinish={async ({ fullName, password }) => {
          setLoading(true);
          setError(null);
          try {
            await api.post('/users/accept-invite', { token, fullName, password });
            setDone(true);
          } catch (e) {
            setError(errMsg(e));
          } finally {
            setLoading(false);
          }
        }}
      >
        <Form.Item name="fullName" label={t('customer.fullName')}>
          <Input prefix={<UserOutlined />} size="large" />
        </Form.Item>
        <Form.Item
          name="password"
          label={t('invite.choosePassword')}
          rules={[{ required: true, min: 8, message: t('invite.passwordRule') }]}
          hasFeedback
        >
          <Input.Password prefix={<LockOutlined />} size="large" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label={t('invite.confirmPassword')}
          dependencies={['password']}
          hasFeedback
          rules={[
            { required: true },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || getFieldValue('password') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('invite.passwordMismatch'))),
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} size="large" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block size="large" loading={loading}>
          {t('invite.accept')}
        </Button>
      </Form>
    </>,
  );
}
