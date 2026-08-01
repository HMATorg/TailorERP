import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));

vi.mock('../api/client', () => ({
  api: apiMocks,
  errMsg: (e: unknown) => String(e),
}));

import Stores from './Stores';

/**
 * Stores page WhatsApp section — regression coverage for a real crash found
 * during live verification (D-062). `editing` is `StoreRow | 'new' | null`;
 * the WhatsApp status label originally guarded only `editing !== 'new'`, which
 * is true when `editing === null` too, so opening the "Add store" modal threw
 * reading `.whatsappConfigured` off `null` and white-screened the whole page.
 */
const rows = [
  {
    id: 'store-1',
    name: 'Riyadh HQ',
    address: null,
    phone: null,
    email: null,
    isHeadquarters: true,
    status: 'active' as const,
    operatingHours: {},
    whatsappPhoneNumberId: null,
    whatsappConfigured: false,
  },
];

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('Stores', () => {
  it('renders the "Add store" modal without crashing while editing is still null-backed ("new")', async () => {
    apiMocks.get.mockResolvedValue({ data: rows });
    const user = userEvent.setup();
    render(<Stores />);

    await waitFor(() => expect(screen.getByText('Riyadh HQ')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /add store/i }));

    // The crash threw before this text could ever render.
    expect(await screen.findByText(/whatsapp/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone number id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/access token/i)).toBeInTheDocument();
  });

  it('shows the configured/not-configured status only for an existing store, never for "new"', async () => {
    apiMocks.get.mockResolvedValue({ data: rows });
    const user = userEvent.setup();
    render(<Stores />);

    await waitFor(() => expect(screen.getByText('Riyadh HQ')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /add store/i }));
    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /close/i }));

    await user.click(screen.getByRole('button', { name: /edit/i }));
    expect(await screen.findByText(/not configured/i)).toBeInTheDocument();
  });
});
