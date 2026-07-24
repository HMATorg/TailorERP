import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { Navigate, useNavigate } from 'react-router-dom';
import { errMsg } from '../api/client';
import { useAuthStore } from '../stores/auth';

export default function Login() {
  const { login, accessToken } = useAuthStore();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (accessToken) return <Navigate to="/" replace />;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#E0F2F1',
      }}
    >
      <Card style={{ width: 380, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <Typography.Title level={3} style={{ color: '#00695C', textAlign: 'center' }}>
          Tailonix
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          Staff sign in
        </Typography.Paragraph>
        {error && <Alert type="error" message={error} style={{ marginBlockEnd: 16 }} />}
        <Form
          layout="vertical"
          onFinish={async ({ email, password }) => {
            setLoading(true);
            setError(null);
            try {
              await login(email, password);
              navigate('/');
            } catch (e) {
              setError(errMsg(e));
            } finally {
              setLoading(false);
            }
          }}
        >
          <Form.Item name="email" rules={[{ required: true, type: 'email' }]}>
            <Input prefix={<MailOutlined />} placeholder="Email" size="large" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, min: 8 }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={loading}>
            Sign in
          </Button>
        </Form>
      </Card>
    </div>
  );
}
