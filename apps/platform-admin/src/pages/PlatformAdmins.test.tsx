import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../api', () => ({
  api: apiMocks,
  errMsg: (e: unknown) => String(e),
  useAuth: () => ({ user: { id: 'me-1', email: 'me@tailonix.com', fullName: 'Me', adminLevel: 'super_admin' } }),
}));

import PlatformAdmins from './PlatformAdmins';

/**
 * PlatformAdmins page (D-060) — mirrors the backend's self-deactivation guard
 * (`platform.service.spec.ts`'s "refuses to let a super_admin deactivate their
 * own access") at the UI layer: the signed-in admin's own row must never show
 * a Revoke/Restore control, independent of the API-level 400 that would also
 * catch it.
 */
const rows = [
  {
    id: 'admin-me',
    adminLevel: 'super_admin' as const,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    user: { id: 'me-1', email: 'me@tailonix.com', fullName: 'Me', isActive: true, createdAt: '2026-01-01' },
  },
  {
    id: 'admin-other',
    adminLevel: 'support' as const,
    isActive: true,
    createdAt: '2026-01-02T00:00:00.000Z',
    user: { id: 'other-1', email: 'other@tailonix.com', fullName: 'Other', isActive: true, createdAt: '2026-01-02' },
  },
];

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('PlatformAdmins', () => {
  it('hides the Revoke control on the signed-in admin\'s own row but shows it for others', async () => {
    apiMocks.get.mockResolvedValue({ data: rows });
    render(<PlatformAdmins />);

    await waitFor(() => expect(screen.getByText('me@tailonix.com')).toBeInTheDocument());
    const table = screen.getByRole('table');
    const bodyRows = within(table).getAllByRole('row').slice(1); // drop header row

    const myRow = bodyRows.find((r) => within(r).queryByText('me@tailonix.com'));
    const otherRow = bodyRows.find((r) => within(r).queryByText('other@tailonix.com'));
    expect(myRow).toBeDefined();
    expect(otherRow).toBeDefined();

    expect(within(myRow!).queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument();
    expect(within(otherRow!).getByRole('button', { name: /revoke/i })).toBeInTheDocument();
  });

  it('revoking another admin sends isActive:false and reloads the list', async () => {
    apiMocks.get.mockResolvedValue({ data: rows });
    apiMocks.put.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    render(<PlatformAdmins />);

    await waitFor(() => expect(screen.getByText('other@tailonix.com')).toBeInTheDocument());
    const table = screen.getByRole('table');
    const otherRow = within(table)
      .getAllByRole('row')
      .find((r) => within(r).queryByText('other@tailonix.com'))!;

    await user.click(within(otherRow).getByRole('button', { name: /revoke/i }));
    const confirmButton = await screen.findByRole('button', { name: /^ok$/i });
    await user.click(confirmButton);

    await waitFor(() =>
      expect(apiMocks.put).toHaveBeenCalledWith('/admin/platform-admins/admin-other', { isActive: false }),
    );
    expect(apiMocks.get).toHaveBeenCalledTimes(2); // initial load + post-revoke reload
  });
});
