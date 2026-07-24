import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './api';
import Appointments from './pages/Appointments';
import Login from './pages/Login';
import Orders from './pages/Orders';
import OrderTracking from './pages/OrderTracking';
import Profile from './pages/Profile';

function Shell() {
  const accessToken = useAuth((s) => s.accessToken);
  const { t } = useTranslation();
  if (!accessToken) return <Navigate to="/login" replace />;
  return (
    <div className="shell">
      <Outlet />
      <nav className="tabbar">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="tab-icon">🧵</span>
          {t('nav.orders')}
        </NavLink>
        <NavLink to="/appointments" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="tab-icon">📅</span>
          {t('nav.appointments')}
        </NavLink>
        <NavLink to="/profile" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="tab-icon">👤</span>
          {t('nav.profile')}
        </NavLink>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Shell />}>
          <Route path="/" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderTracking />} />
          <Route path="/appointments" element={<Appointments />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
