import { BrowserRouter, Route, Routes } from 'react-router-dom';
import AppLayout from './layout/AppLayout';
import AcceptInvite from './pages/AcceptInvite';
import Alerts from './pages/Alerts';
import Appointments from './pages/Appointments';
import BatchDetail from './pages/BatchDetail';
import Billing from './pages/Billing';
import Customers from './pages/Customers';
import Dashboard from './pages/Dashboard';
import Impersonate from './pages/Impersonate';
import Inventory from './pages/Inventory';
import InvoicesList from './pages/InvoicesList';
import Ledger from './pages/Ledger';
import Login from './pages/Login';
import NewOrder from './pages/NewOrder';
import OrderDetail from './pages/OrderDetail';
import Orders from './pages/Orders';
import Settings from './pages/Settings';
import Stores from './pages/Stores';
import Team from './pages/Team';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/impersonate" element={<Impersonate />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/new" element={<NewOrder />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/inventory/:id" element={<BatchDetail />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/appointments" element={<Appointments />} />
          <Route path="/invoices" element={<InvoicesList />} />
          <Route path="/team" element={<Team />} />
          <Route path="/stores" element={<Stores />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
