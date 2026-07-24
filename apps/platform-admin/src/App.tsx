import { useState } from 'react';
import {
  AuditOutlined,
  LogoutOutlined,
  ShopOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Layout, Menu, Space, Typography } from 'antd';
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import axios from 'axios';
import { errMsg, useAuth } from './api';
import Audit from './pages/Audit';
import Plans from './pages/Plans';
import TenantDetail from './pages/TenantDetail';
import Tenants from './pages/Tenants';

function Login() {
  const { setSession, accessToken } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  if (accessToken) return <Navigate to="/" replace />;
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#263238' }}>
      <Card style={{ width: 380 }}>
        <Typography.Title level={3} style={{ color: '#00695C', textAlign: 'center' }}>
          Tailonix Platform
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          Internal administration — authorised staff only
        </Typography.Paragraph>
        {error && <Alert type="error" message={error} style={{ marginBlockEnd: 12 }} />}
        <Form
          layout="vertical"
          onFinish={async (v) => {
            try {
              const { data } = await axios.post('/api/v1/auth/platform/login', v);
              setSession(data);
              navigate('/');
            } catch (e) {
              setError(errMsg(e));
            }
          }}
        >
          <Form.Item name="email" rules={[{ required: true, type: 'email' }]}>
            <Input placeholder="Email" size="large" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, min: 8 }]}>
            <Input.Password placeholder="Password" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large">
            Sign in
          </Button>
        </Form>
      </Card>
    </div>
  );
}

function Shell() {
  const { user, accessToken, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  if (!accessToken) return <Navigate to="/login" replace />;

  const key = location.pathname.startsWith('/plans')
    ? '/plans'
    : location.pathname.startsWith('/audit')
      ? '/audit'
      : '/';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider theme="dark" width={220}>
        <div style={{ padding: '16px 20px', fontWeight: 700, fontSize: 16, color: '#fff' }}>
          Tailonix <span style={{ color: '#F9A825' }}>Platform</span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[key]}
          items={[
            { key: '/', icon: <ShopOutlined />, label: <Link to="/">Tenants</Link> },
            { key: '/plans', icon: <TagsOutlined />, label: <Link to="/plans">Plans</Link> },
            { key: '/audit', icon: <AuditOutlined />, label: <Link to="/audit">Audit Logs</Link> },
          ]}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
          }}
        >
          <Space>
            <Typography.Text>
              {user?.fullName} <Typography.Text type="secondary">({user?.adminLevel})</Typography.Text>
            </Typography.Text>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={() => {
                logout();
                navigate('/login');
              }}
            />
          </Space>
        </Layout.Header>
        <Layout.Content style={{ padding: 24 }}>
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Shell />}>
          <Route path="/" element={<Tenants />} />
          <Route path="/tenants/:id" element={<TenantDetail />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/audit" element={<Audit />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
