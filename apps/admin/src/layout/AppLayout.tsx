import { useMemo } from 'react';
import {
  AppstoreOutlined,
  BellOutlined,
  BookOutlined,
  CalendarOutlined,
  CreditCardOutlined,
  DashboardOutlined,
  FileTextOutlined,
  InboxOutlined,
  LogoutOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  ShoppingOutlined,
  TeamOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Alert, Avatar, Dropdown, Layout, Menu, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import LanguageSwitcher from '../components/LanguageSwitcher';
import StoreSwitcher from '../components/StoreSwitcher';
import { useAuthStore } from '../stores/auth';

const { Header, Sider, Content } = Layout;

export default function AppLayout() {
  const { user, accessToken, isImpersonating, logout } = useAuthStore();
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const isHq = user?.orgRole === 'hq_admin';

  const menuItems = useMemo(
    () => [
      { key: '/', icon: <DashboardOutlined />, label: <Link to="/">{t('nav.dashboard')}</Link> },
      { key: '/orders', icon: <ShoppingOutlined />, label: <Link to="/orders">{t('nav.orders')}</Link> },
      { key: '/customers', icon: <UserOutlined />, label: <Link to="/customers">{t('nav.customers')}</Link> },
      { key: '/inventory', icon: <InboxOutlined />, label: <Link to="/inventory">{t('nav.inventory')}</Link> },
      { key: '/alerts', icon: <WarningOutlined />, label: <Link to="/alerts">{t('nav.alerts')}</Link> },
      { key: '/appointments', icon: <CalendarOutlined />, label: <Link to="/appointments">{t('nav.appointments')}</Link> },
      { key: '/invoices', icon: <FileTextOutlined />, label: <Link to="/invoices">{t('nav.invoices')}</Link> },
      ...(isHq
        ? [
            { key: '/team', icon: <TeamOutlined />, label: <Link to="/team">{t('nav.team')}</Link> },
            { key: '/stores', icon: <ShopOutlined />, label: <Link to="/stores">{t('nav.stores')}</Link> },
            { key: '/billing', icon: <CreditCardOutlined />, label: <Link to="/billing">{t('nav.billing')}</Link> },
            { key: '/ledger', icon: <BookOutlined />, label: <Link to="/ledger">{t('nav.ledger')}</Link> },
            {
              key: '/settings',
              icon: <SafetyCertificateOutlined />,
              label: <Link to="/settings">{t('nav.settings')}</Link>,
            },
          ]
        : []),
    ],
    [isHq, t],
  );

  if (!accessToken) return <Navigate to="/login" replace />;

  const selectedKey =
    menuItems
      .map((i) => i.key)
      .filter((k) => k !== '/' && location.pathname.startsWith(k))
      .sort((a, b) => b.length - a.length)[0] ?? '/';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" width={220} breakpoint="lg" collapsedWidth={64}>
        <div style={{ padding: '16px 20px', fontWeight: 700, fontSize: 18, color: '#00695C' }}>
          {t('app.name')}
        </div>
        <Menu mode="inline" selectedKeys={[selectedKey]} items={menuItems} style={{ borderInlineEnd: 0 }} />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBlockEnd: '1px solid #f0f0f0',
            gap: 12,
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <StoreSwitcher />
          <Space size="large">
            <LanguageSwitcher />
            <BellOutlined style={{ fontSize: 18, color: '#757575' }} />
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'org',
                    label: <Typography.Text type="secondary">{user?.organization.name}</Typography.Text>,
                    disabled: true,
                  },
                  { type: 'divider' },
                  {
                    key: 'logout',
                    icon: <LogoutOutlined />,
                    label: t('app.logout'),
                    onClick: () => {
                      logout();
                      navigate('/login');
                    },
                  },
                ],
              }}
            >
              <Space style={{ cursor: 'pointer' }}>
                <Avatar style={{ background: '#00695C' }} icon={<AppstoreOutlined />}>
                  {user?.fullName?.[0]}
                </Avatar>
                <span>{user?.fullName}</span>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ padding: 24 }}>
          {isImpersonating && (
            <Alert
              type="warning"
              showIcon
              banner
              closable={false}
              style={{ marginBlockEnd: 16 }}
              message={
                <Space>
                  <span>
                    You are viewing <strong>{user?.organization.name}</strong> as Tailonix platform
                    support. This session ends automatically and cannot be renewed.
                  </span>
                  <a
                    onClick={() => {
                      logout();
                      navigate('/login');
                    }}
                  >
                    End impersonation
                  </a>
                </Space>
              }
            />
          )}
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
