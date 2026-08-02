import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api, useAuth } from '../api';
import OrderDetail from './OrderDetail';

/**
 * "Collect payment" is gated by pos_settle (D-066) — previously rendered
 * unconditionally, so a tailor (who has update_order_status but not
 * pos_settle) could see and try to submit a payment the API would 403 on
 * with no warning it was ever going to fail.
 */
const order = {
  id: 'order-1',
  orderNumber: 'ORD-000200',
  status: 'pending',
  totalAmount: '400.00',
  paidAmount: '0.00',
  discountAmount: '0.00',
  dueDate: null,
  notes: null,
  isUrgent: false,
  createdAt: new Date().toISOString(),
  customer: { id: 'cust-1', fullName: 'Ahmed Al-Ghamdi', phone: '+966599112233', whatsappConsent: true },
  items: [{ id: 'item-1', garmentType: 'Thobe', quantity: 1, unitPrice: '400.00' }],
  statusHistory: [],
  payments: [],
  tickets: [],
  invoice: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuth.setState({
    user: null,
    organization: null,
    stores: [],
    activeStoreId: null,
    accessToken: null,
    refreshToken: null,
  });
});

function renderOrderDetail() {
  return render(
    <MemoryRouter initialEntries={['/orders/order-1']}>
      <Routes>
        <Route path="/orders/:id" element={<OrderDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OrderDetail — Collect payment gated by pos_settle', () => {
  beforeEach(() => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: order });
    useAuth.setState({
      accessToken: 'test-token',
      user: { id: 'user-1', fullName: 'Test User', orgRole: null },
      stores: [{ id: 'store-1', name: 'Jeddah — Corniche', permissions: [] } as never],
      activeStoreId: 'store-1',
    } as never);
  });

  it('a tailor without pos_settle sees a read-only balance notice, not a working settle form', async () => {
    useAuth.setState((s) => ({
      stores: s.stores.map((store) => ({ ...store, permissions: ['view_orders', 'update_order_status'] })),
    }));
    renderOrderDetail();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ORD-000200' })).toBeInTheDocument());
    expect(screen.getByText(/outstanding/i)).toBeInTheDocument();
    expect(screen.getByText(/ask a cashier or manager/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /settle/i })).not.toBeInTheDocument();
  });

  it('a cashier with pos_settle sees the real settle form', async () => {
    useAuth.setState((s) => ({
      stores: s.stores.map((store) => ({
        ...store,
        permissions: ['view_orders', 'use_pos', 'pos_checkout', 'pos_settle'],
      })),
    }));
    renderOrderDetail();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ORD-000200' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /settle/i })).toBeInTheDocument();
    expect(screen.queryByText(/ask a cashier or manager/i)).not.toBeInTheDocument();
  });
});
