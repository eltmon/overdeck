import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AnywhereStatusCard } from '../AnywhereStatusCard';
import type { AnywhereStatus } from '../anywhereApi';

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

function baseStatus(overrides: Partial<AnywhereStatus> = {}): AnywhereStatus {
  return {
    machine: { environmentId: '0f0e0d0c-1111-4000-8000-000000000000', label: 'desk' },
    addresses: [{ origin: 'http://127.0.0.1:3011', loopback: true }, { origin: 'https://desk.tailnet.ts.net', loopback: false }],
    devices: { active: 2 },
    vault: { state: 'ready', backend: 'git@example.com:me/vault.git' },
    problems: [],
    viewer: { kind: 'root-session' },
    ...overrides,
  };
}

function renderCard(status: AnywhereStatus, onAction = vi.fn()) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, status))));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AnywhereStatusCard onAction={onAction} />
    </QueryClientProvider>,
  );
  return { ...view, onAction };
}

describe('AnywhereStatusCard (PAN-4445)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the machine, reachable addresses, paired devices and a ready vault', async () => {
    renderCard(baseStatus());
    expect(await screen.findByText('https://desk.tailnet.ts.net')).toBeInTheDocument();
    expect(screen.getByText('0f0e0d0c')).toBeInTheDocument();
    expect(screen.getByTestId('anywhere-paired-devices')).toHaveTextContent('2');
    expect(screen.getByText('Ready (git@example.com:me/vault.git)')).toBeInTheDocument();
    expect(screen.queryByText('http://127.0.0.1:3011')).toBeNull();
  });

  it('renders the no-reachable-address problem with an Add an address button', async () => {
    const user = userEvent.setup();
    const { onAction } = renderCard(baseStatus({
      addresses: [{ origin: 'http://127.0.0.1:3011', loopback: true }],
      problems: [{
        code: 'no-reachable-address',
        message: 'No address another device can reach is trusted yet.',
        action: { kind: 'pair-dialog' },
      }],
    }));

    expect(await screen.findByText('No address another device can reach is trusted yet.')).toBeInTheDocument();
    expect(screen.getByText('Only this machine')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add an address' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'pair-dialog' });
  });

  it('shows Not set up and a Set up button for a vault that is off', async () => {
    const user = userEvent.setup();
    const { onAction } = renderCard(baseStatus({ vault: { state: 'off', backend: null } }));

    expect(await screen.findByText('Not set up')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set up' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'settings-section', section: 'session-vault' });
  });

  it('opens Session Vault for a locked vault', async () => {
    const user = userEvent.setup();
    const { onAction } = renderCard(baseStatus({
      vault: { state: 'locked', backend: 'b' },
      problems: [{ code: 'vault-locked', message: 'Session Vault is locked.', action: { kind: 'settings-section', section: 'session-vault' } }],
    }));

    expect(await screen.findByText('Locked on this machine')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Session Vault' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'settings-section', section: 'session-vault' });
  });

  it('renders a How to fix link and no button for a pending rotation, and never names a pan command', async () => {
    const { container } = renderCard(baseStatus({
      vault: { state: 'rotation-pending', backend: 'b' },
      problems: [{
        code: 'vault-rotation-pending',
        message: 'A vault key rotation started on this machine has not finished.',
        action: { kind: 'none', docsUrl: 'https://overdeck.ai/configuration/session-vault' },
      }],
    }));

    const problems = await screen.findByRole('list', { name: 'Anywhere problems' });
    const link = within(problems).getByRole('link', { name: 'How to fix' });
    expect(link).toHaveAttribute('href', 'https://overdeck.ai/configuration/session-vault');
    expect(within(problems).queryByRole('button')).toBeNull();
    expect(screen.getByText('Key rotation unfinished')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(/\bpan (vault|pair|devices)\b/);
  });

  it('shows an unreadable identity', async () => {
    renderCard(baseStatus({ machine: null }));
    expect(await screen.findByText('Identity unreadable')).toBeInTheDocument();
  });
});
