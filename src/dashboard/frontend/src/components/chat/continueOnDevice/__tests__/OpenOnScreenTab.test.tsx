/** PAN-4455 WI-7: the "Open on another screen" tab. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { AnywhereStatus } from '../../../Settings/anywhere/anywhereApi';
import type { ContinueTarget } from '../continueOnDeviceStore';

const api = vi.hoisted(() => ({ issuePairingLink: vi.fn(), addTrustedAddress: vi.fn() }));
vi.mock('../../../Settings/anywhere/anywhereApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../Settings/anywhere/anywhereApi')>()),
  issuePairingLink: api.issuePairingLink,
  addTrustedAddress: api.addTrustedAddress,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { OpenOnScreenTab } = await import('../OpenOnScreenTab');

const LOCAL = { origin: 'http://127.0.0.1:3011', loopback: true };
const DESK = { origin: 'https://desk.example', loopback: false };

function status(overrides: Partial<AnywhereStatus> = {}): AnywhereStatus {
  return {
    machine: { environmentId: '0f0e0d0c-0000-4000-8000-000000000000', label: 'desk' },
    addresses: [LOCAL, DESK],
    devices: { active: 0 },
    vault: { state: 'ready', backend: 'dir:/x' },
    problems: [],
    viewer: { kind: 'root-session' },
    ...overrides,
  };
}

function target(overrides: Partial<ContinueTarget> = {}): ContinueTarget {
  return { name: 'conv-42', id: 42, title: 'Fix the parser', harness: 'claude-code', sessionAlive: true, viewMode: 'conversation', ...overrides };
}

function renderTab(s: AnywhereStatus, t: ContinueTarget = target()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OpenOnScreenTab target={t} status={s} />
    </QueryClientProvider>,
  );
}

describe('OpenOnScreenTab (PAN-4455 WI-7)', () => {
  beforeEach(() => {
    api.issuePairingLink.mockReset();
    api.addTrustedAddress.mockReset();
    api.issuePairingLink.mockResolvedValue({
      status: 200,
      body: { credential: 'odp_test', expiresAt: new Date(Date.now() + 600_000).toISOString(), pairingPath: '/#pair=odp_test' },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the plain link and its QR code before any click and never a loopback origin', () => {
    const { container } = renderTab(status());
    expect(screen.getByTestId('continue-link')).toHaveValue('https://desk.example/conv/42');
    expect(screen.getByAltText('Conversation QR code').getAttribute('src')).toMatch(/^data:image\//);
    expect(screen.getByLabelText('Also pair the device')).toBeChecked();
    expect(api.issuePairingLink).not.toHaveBeenCalled();
    expect(container.innerHTML).not.toContain('127.0.0.1');
  });

  it('adds ?view=terminal when the panel was in terminal view', () => {
    renderTab(status(), target({ viewMode: 'terminal' }));
    expect(screen.getByTestId('continue-link')).toHaveValue('https://desk.example/conv/42?view=terminal');
  });

  it('Create pairing link swaps in the pairing fragment; unchecking restores the plain link', async () => {
    const user = userEvent.setup();
    renderTab(status());
    await user.click(screen.getByRole('button', { name: 'Create pairing link' }));
    await waitFor(() => expect(screen.getByTestId('continue-link')).toHaveValue('https://desk.example/conv/42#pair=odp_test'));
    expect((screen.getByTestId('continue-link') as HTMLInputElement).value).toMatch(/^https:\/\/desk\.example\/conv\/42#pair=odp_/);
    expect(screen.getByText(/Expires in 10 minutes · works once/)).toBeInTheDocument();
    expect(api.issuePairingLink).toHaveBeenCalledTimes(1);

    await user.click(screen.getByLabelText('Also pair the device'));
    expect(screen.getByTestId('continue-link')).toHaveValue('https://desk.example/conv/42');
  });

  it('a 403 from the pairing route explains where links can be created', async () => {
    api.issuePairingLink.mockResolvedValue({ status: 403, body: { error: 'forbidden' } });
    const user = userEvent.setup();
    renderTab(status());
    await user.click(screen.getByRole('button', { name: 'Create pairing link' }));
    expect(await screen.findByText(/Pairing links can be created only from a browser on this machine/)).toBeInTheDocument();
    expect(screen.getByTestId('continue-link')).toHaveValue('https://desk.example/conv/42');
  });

  it('a paired device sees no pairing checkbox and never requests a credential', () => {
    renderTab(status({ viewer: { kind: 'device' } }));
    expect(screen.queryByLabelText('Also pair the device')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create pairing link' })).toBeNull();
    expect(screen.getByTestId('continue-link')).toHaveValue('https://desk.example/conv/42');
    expect(api.issuePairingLink).not.toHaveBeenCalled();
  });

  it('with no reachable address: no QR code, and Add an address trusts the typed origin', async () => {
    api.addTrustedAddress.mockResolvedValue({ status: 200, body: { origin: 'https://desk.example', added: true } });
    const user = userEvent.setup();
    renderTab(status({ addresses: [LOCAL] }));
    expect(screen.queryByAltText('Conversation QR code')).toBeNull();
    expect(screen.getByText('No address another device can reach is trusted yet.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Address'), 'https://desk.example');
    await user.click(screen.getByRole('button', { name: 'Add an address' }));
    expect(api.addTrustedAddress).toHaveBeenCalledWith('https://desk.example');
    await waitFor(() => expect(screen.getByTestId('continue-link')).toHaveValue('https://desk.example/conv/42'));
  });

  it('with no reachable address, a non-root viewer is told where to add one', () => {
    renderTab(status({ addresses: [LOCAL], viewer: { kind: 'device' } }));
    expect(screen.queryByRole('button', { name: 'Add an address' })).toBeNull();
    expect(screen.getByText('Add an address from a browser on this machine (Settings → Anywhere).')).toBeInTheDocument();
  });
});
