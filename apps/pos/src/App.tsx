import { useState } from 'react';
import { LogoutOutlined, ScissorOutlined, ShopOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Layout, Segmented, Select, Space, Typography } from 'antd';
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { errMsg, useAuth } from './api';
import Counter from './pages/Counter';
import Receipt from './pages/Receipt';
import Workshop from './pages/Workshop';

function Login() {
  const { login, accessToken } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (accessToken) return <Navigate to="/" replace />;

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#00695C' }}>
      <Card style={{ width: 420 }}>
        <Typography.Title level={2} style={{ color: '#00695C', textAlign: 'center', marginBlockEnd: 0 }}>
          Tailonix
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          Point of Sale
        </Typography.Paragraph>
        {error && <Alert type="error" message={error} style={{ marginBlockEnd: 12 }} />}
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
            <Input size="large" placeholder="Email" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, min: 8 }]}>
            <Input.Password size="large" placeholder="Password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={loading} style={{ height: 52 }}>
            Sign in
          </Button>
        </Form>
      </Card>
    </div>
  );
}

function Shell() {
  const { accessToken, user, stores, activeStoreId, setStore, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  if (!accessToken) return <Navigate to="/login" replace />;

  const mode = location.pathname.startsWith('/workshop') ? 'workshop' : 'counter';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header
        className="no-print"
        style={{
          background: '#00695C',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          paddingInline: 16,
        }}
      >
        <Space size="large">
          <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>
            Tailonix
          </Typography.Title>
          <Segmented
            size="large"
            value={mode}
            onChange={(v) => navigate(v === 'workshop' ? '/workshop' : '/')}
            options={[
              { value: 'counter', label: 'Counter', icon: <ShopOutlined /> },
              { value: 'workshop', label: 'Workshop', icon: <ScissorOutlined /> },
            ]}
          />
        </Space>
        <Space>
          <Select
            value={activeStoreId ?? undefined}
            onChange={setStore}
            options={stores.map((s) => ({ value: s.id, label: s.name }))}
            style={{ minWidth: 190 }}
            size="large"
          />
          <Typography.Text style={{ color: '#fff' }}>{user?.fullName}</Typography.Text>
          <Button
            type="text"
            icon={<LogoutOutlined style={{ color: '#fff' }} />}
            onClick={() => {
              logout();
              navigate('/login');
            }}
          />
        </Space>
      </Layout.Header>
      <Layout.Content style={{ background: '#FAFAFA' }}>
        <Outlet />
      </Layout.Content>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Shell />}>
          <Route path="/" element={<Counter />} />
          <Route path="/receipt/:id" element={<Receipt />} />
          <Route path="/workshop" element={<Workshop />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
