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
    tailscale: { nextStep: 'not-installed', serveUrl: null, magicDnsName: null },
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

  it('shows a ready Tailscale row with the Serve URL (PAN-1254)', async () => {
    renderCard(baseStatus({ tailscale: { nextStep: 'ready', serveUrl: 'https://desk.tailnet.ts.net', magicDnsName: 'desk.tailnet.ts.net' } }));
    expect(await screen.findByTestId('anywhere-tailscale')).toHaveTextContent('Ready (https://desk.tailnet.ts.net)');
  });

  it('shows Not installed, Signed out and Needs HTTPS for the earlier steps', async () => {
    const { unmount } = renderCard(baseStatus());
    expect(await screen.findByTestId('anywhere-tailscale')).toHaveTextContent('Not installed');
    unmount();
    const second = renderCard(baseStatus({ tailscale: { nextStep: 'login', serveUrl: null, magicDnsName: null } }));
    expect(await screen.findByTestId('anywhere-tailscale')).toHaveTextContent('Signed out');
    second.unmount();
    renderCard(baseStatus({ tailscale: { nextStep: 'enable-https', serveUrl: null, magicDnsName: 'desk.tailnet.ts.net' } }));
    expect(await screen.findByTestId('anywhere-tailscale')).toHaveTextContent('Needs HTTPS');
  });

  it('renders Protect the dashboard for unprotected Tailscale Serve', async () => {
    const user = userEvent.setup();
    const { onAction } = renderCard(baseStatus({
      tailscale: { nextStep: 'protect', serveUrl: 'https://desk.tailnet.ts.net', magicDnsName: 'desk.tailnet.ts.net' },
      problems: [{
        code: 'tailscale-serve-unprotected',
        message: 'Tailscale Serve sends tailnet visitors to this dashboard, but a token is not required to sign in.',
        action: { kind: 'tailscale-setup' },
      }],
    }));
    expect(await screen.findByTestId('anywhere-tailscale')).toHaveTextContent('Set up unfinished');
    await user.click(screen.getByRole('button', { name: 'Protect the dashboard' }));
    expect(onAction).toHaveBeenCalledWith({ kind: 'tailscale-setup' });
  });
});

describe('AnywhereStatusCard relay and directory (PAN-2356 WI-18)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows Using relay and this month\'s traffic', async () => {
    renderCard(baseStatus({
      directory: { state: 'online', plan: 'tester', url: 'https://connect.overdeck.ai', refusal: null },
      relay: { using: true, bytesUsed: 12_345_000_000, capBytes: 50_000_000_000, stopped: false },
    }));
    const relay = await screen.findByTestId('anywhere-relay');
    expect(relay).toHaveTextContent('Using relay');
    expect(relay).toHaveTextContent('12.3 of 50 GB relay traffic this month');
  });

  it('shows the cap message and an Add 50 GB link once the allowance is used', async () => {
    renderCard(baseStatus({
      directory: { state: 'online', plan: 'tester', url: 'https://connect.overdeck.ai', refusal: null },
      relay: { using: false, bytesUsed: 50_000_000_000, capBytes: 50_000_000_000, stopped: true },
    }));
    const cap = await screen.findByTestId('anywhere-relay-cap');
    expect(cap).toHaveTextContent('Relay allowance used; install Tailscale or add 50 GB');
    const link = within(cap).getByRole('link', { name: 'Add 50 GB' });
    expect(link).toHaveAttribute('href', 'https://overdeck.ai/anywhere');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows no relay text without a relay status', async () => {
    renderCard(baseStatus({ directory: null, relay: null }));
    await screen.findByText('desk');
    expect(screen.queryByTestId('anywhere-relay')).toBeNull();
    expect(screen.queryByTestId('anywhere-relay-cap')).toBeNull();
    expect(document.body.textContent).not.toMatch(/relay/i);
  });

  it('shows a refused directory as a problem line', async () => {
    renderCard(baseStatus({
      directory: { state: 'refused', plan: 'free', url: 'https://connect.overdeck.ai', refusal: 'The free account includes 3 machines' },
      relay: null,
    }));
    expect(await screen.findByTestId('anywhere-directory-refusal')).toHaveTextContent('The free account includes 3 machines');
  });
});
