import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { api, useAuth } from './api';
import App from './App';

/**
 * The Shell's tab nav and route guards (D-066). The backend has always
 * refused `/pos/*` without `use_pos` and `/workshop/*` without
 * `view_workshop` (a tailor has "no till", a cashier has "no workshop" —
 * packages/shared/src/permissions.ts) but the POS app never captured the
 * per-store `permissions` array the login response already ships for
 * exactly this purpose, so every role saw every tab and a restricted user
 * landed on a page that would 403 on its first request instead of being
 * routed somewhere they can actually use.
 */
const RESET_AUTH = {
  user: null,
  organization: null,
  stores: [],
  activeStoreId: null,
  accessToken: null,
  refreshToken: null,
};

function loginAs(permissions: string[]) {
  useAuth.setState({
    ...RESET_AUTH,
    accessToken: 'test-token',
    user: { id: 'user-1', fullName: 'Test User', orgRole: null },
    stores: [{ id: 'store-1', name: 'Jeddah — Corniche', permissions } as never],
    activeStoreId: 'store-1',
  });
}

beforeEach(() => {
  vi.spyOn(api, 'get').mockImplementation((url: string) => {
    if (url.includes('/workshop/board')) return Promise.resolve({ data: { columns: [] } });
    if (url === '/orders') return Promise.resolve({ data: { items: [], meta: { total: 0 } } });
    if (url.includes('/pos/customers')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuth.setState(RESET_AUTH);
  window.history.pushState({}, '', '/');
});

describe('Shell navigation — role-aware tabs and route guards', () => {
  const navLabels = () =>
    [...document.querySelectorAll('.ant-segmented-item-label')].map((l) => l.textContent?.trim());

  it('a tailor (no use_pos) never lands on Counter: redirected to Orders, tab hidden', async () => {
    loginAs(['view_orders', 'view_workshop', 'manage_workshop']);
    render(<App />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument());
    expect(navLabels()).toEqual(['Orders', 'Workshop']);
  });

  it('a cashier (no view_workshop) sees Counter and Orders but not Workshop', async () => {
    loginAs(['view_orders', 'create_orders', 'use_pos', 'pos_checkout', 'pos_settle']);
    render(<App />);

    await waitFor(() => expect(navLabels()).toEqual(['Counter', 'Orders']));
  });

  it('a cashier navigating straight to /workshop by URL is redirected to Orders, not shown a 403 page', async () => {
    loginAs(['view_orders', 'use_pos', 'pos_checkout', 'pos_settle']);
    window.history.pushState({}, '', '/workshop');
    render(<App />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument());
  });

  it('an hq_admin-equivalent with every permission sees all three tabs', async () => {
    loginAs(['view_orders', 'use_pos', 'pos_checkout', 'pos_settle', 'view_workshop', 'manage_workshop']);
    render(<App />);

    await waitFor(() => expect(navLabels()).toEqual(['Counter', 'Orders', 'Workshop']));
  });
});
