import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

import { AccountCard } from '../AccountCard';
import { planLabel, relayResetDate, type AccountView } from '../accountApi';

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

function view(overrides: Partial<AccountView> = {}): AccountView {
  return {
    signedIn: true,
    githubLogin: 'octocat',
    manageUrl: 'https://account.overdeck.ai/account',
    plan: 'tester',
    tokenRejected: false,
    relay: { month: '2026-11', bytesUsed: 12_300_000_000, capBytes: 50_000_000_000, stopped: false },
    canSignIn: true,
    accountError: null,
    signIn: { state: 'idle', authorizeUrl: null, message: null },
    ...overrides,
  };
}

function renderCard(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(fetchImpl);
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AccountCard />
    </QueryClientProvider>,
  );
  return { ...result, fetchMock };
}

function renderView(account: AccountView) {
  return renderCard(() => Promise.resolve(jsonResponse(200, account)));
}

describe('AccountCard (PAN-4960)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the tester plan, relay use with its reset date, the invite sentence and Manage account (ac1)', async () => {
    renderView(view());
    expect(await screen.findByText('octocat')).toBeInTheDocument();
    expect(screen.getByText('Tester')).toBeInTheDocument();
    expect(screen.getByTestId('account-relay')).toHaveTextContent('12.3 of 50 GB relay traffic this month · Resets on 2026-12-01 (UTC)');
    expect(screen.getByText('Paid plans are invite-only for now.')).toBeInTheDocument();
    const manage = screen.getByTestId('account-manage');
    expect(manage).toHaveTextContent('Manage account');
    expect(manage).toHaveAttribute('href', 'https://account.overdeck.ai/account');
    expect(manage).toHaveAttribute('target', '_blank');
    expect(manage).toHaveAttribute('rel', 'noreferrer');
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('shows the free plan without relay, and the directory hint without a relay status (ac2)', async () => {
    const { unmount } = renderView(view({ plan: 'free', relay: null }));
    expect(await screen.findByText('Free account')).toBeInTheDocument();
    expect(screen.getByTestId('account-relay')).toHaveTextContent('Not included in the free account');
    unmount();
    renderView(view({ relay: null }));
    expect(await screen.findByTestId('account-relay')).toHaveTextContent('Shows when this machine is connected to the directory');
  });

  it('shows no price and no Add 50 GB control (ac2)', async () => {
    const { container } = renderView(view());
    await screen.findByText('octocat');
    expect(container.textContent).not.toContain('$');
    expect(container.textContent).not.toContain('Add 50 GB');
  });

  it('shows the pan account login hint and no button to a viewer who cannot sign in (ac3)', async () => {
    renderView(view({ signedIn: false, githubLogin: null, manageUrl: null, plan: null, relay: null, canSignIn: false }));
    expect(await screen.findByTestId('account-sign-in-hint')).toHaveTextContent('Sign in on this machine with pan account login.');
    expect(screen.getByText('Not signed in to overdeck.ai.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByTestId('account-manage')).toBeNull();
  });

  it('posts the sign-in and then links to the overdeck.ai sign-in page (ac4)', async () => {
    const user = userEvent.setup();
    const signedOut = view({ signedIn: false, githubLogin: null, manageUrl: null, plan: null, relay: null });
    const authorizeUrl = 'https://account.overdeck.ai/auth/start?state=abc';
    let started = false;
    const { fetchMock } = renderCard((url, init) => {
      if (url === '/api/account/sign-in' && init?.method === 'POST') {
        started = true;
        return Promise.resolve(jsonResponse(200, { authorizeUrl }));
      }
      return Promise.resolve(jsonResponse(200, started ? { ...signedOut, signIn: { state: 'pending', authorizeUrl, message: null } } : signedOut));
    });

    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    const link = await screen.findByRole('link', { name: 'Open overdeck.ai sign-in' });
    expect(link).toHaveAttribute('href', authorizeUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Waiting for sign-in…')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/account/sign-in', expect.objectContaining({ method: 'POST' }));
  });

  it('shows the error when the sign-in cannot start', async () => {
    const user = userEvent.setup();
    const signedOut = view({ signedIn: false, githubLogin: null, manageUrl: null, plan: null, relay: null });
    renderCard((url) =>
      Promise.resolve(url === '/api/account/sign-in' ? jsonResponse(409, { error: 'Run pan account login instead.' }) : jsonResponse(200, signedOut)),
    );
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Run pan account login instead.')).toBeInTheDocument();
  });

  it('shows a failed sign-in message and offers Sign in again (ac5)', async () => {
    renderView(view({
      signedIn: false,
      githubLogin: null,
      manageUrl: null,
      plan: null,
      relay: null,
      signIn: { state: 'failed', authorizeUrl: null, message: 'Sign-in was cancelled on GitHub.' },
    }));
    expect(await screen.findByTestId('account-sign-in-message')).toHaveTextContent('Sign-in was cancelled on GitHub.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('offers Sign in when overdeck.ai rejected the token', async () => {
    renderView(view({ tokenRejected: true, plan: null }));
    expect(await screen.findByText("overdeck.ai rejected this machine's sign-in.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows an unreadable account.json message', async () => {
    renderView(view({ signedIn: false, githubLogin: null, manageUrl: null, plan: null, relay: null, accountError: 'Cannot read /h/account.json' }));
    expect(await screen.findByText('Cannot read /h/account.json')).toBeInTheDocument();
  });
});

describe('accountApi helpers (PAN-4960)', () => {
  it('labels plans', () => {
    expect(planLabel('free')).toBe('Free account');
    expect(planLabel('tester')).toBe('Tester');
    expect(planLabel(null)).toBe('Shows when overdeck.ai is reachable');
  });

  it('computes the relay reset date across a year boundary', () => {
    expect(relayResetDate('2026-11')).toBe('2026-12-01');
    expect(relayResetDate('2026-12')).toBe('2027-01-01');
  });
});
