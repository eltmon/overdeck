import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliproxyPoolAccount, CliproxyPoolSnapshot } from '../../../../App/api';
import { CliproxyAccountsPanel } from '../CliproxyAccountsPanel';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');
const HOUR_MS = 3_600_000;

function account(overrides: Partial<CliproxyPoolAccount>): CliproxyPoolAccount {
  return {
    name: 'codex-a.json',
    authIndex: 'a1',
    provider: 'codex',
    email: 'a@example.test',
    plan: 'pro',
    disabled: false,
    priority: 20,
    windows: [{
      label: 'weekly',
      usedPercent: 9,
      resetsAt: new Date(NOW + (6 * 24 + 5) * HOUR_MS + 60_000).toISOString(),
      windowSeconds: 604800,
    }],
    weeklyResetsAt: null,
    exhausted: false,
    error: null,
    usageRead: true,
    ...overrides,
  };
}

function snapshot(accounts: CliproxyPoolAccount[], managementAvailable = true): CliproxyPoolSnapshot {
  return {
    checkedAt: new Date(NOW - 3 * 60_000).toISOString(),
    managementAvailable,
    accounts,
  };
}

function stubAccounts(body: CliproxyPoolSnapshot) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CliproxyAccountsPanel', () => {
  it('renders one row per account with window text', async () => {
    stubAccounts(snapshot([
      account({}),
      account({
        name: 'codex-b.json',
        authIndex: 'b1',
        email: 'b@example.test',
        priority: 0,
        exhausted: true,
        windows: [{ label: 'weekly', usedPercent: 100, resetsAt: new Date(NOW + 2 * HOUR_MS).toISOString(), windowSeconds: 604800 }],
      }),
    ]));

    render(<CliproxyAccountsPanel />);

    const rows = await screen.findAllByTestId('cliproxy-account-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('weekly 9% · resets in 6d 5h')).toBeInTheDocument();
    expect(screen.getByText('weekly 100% · resets in 2h 0m')).toBeInTheDocument();
    expect(screen.getByText('checked 3 min ago')).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('next');
    expect(rows[1]).toHaveTextContent('last resort');
    expect(rows[1]).toHaveTextContent('exhausted');
    // Emails start hidden inside SensitiveText.
    expect(screen.queryByText('a@example.test')).not.toBeInTheDocument();
  });

  it('shows management-off message', async () => {
    stubAccounts(snapshot([account({})], false));

    render(<CliproxyAccountsPanel />);

    expect(await screen.findByText('CLIProxy management API is off')).toBeInTheDocument();
    expect(screen.queryAllByTestId('cliproxy-account-row')).toHaveLength(0);
  });

  it('shows the add-a-second-account hint for single-account providers', async () => {
    stubAccounts(snapshot([
      account({ priority: null }),
      account({ name: 'gemini-primary.json', authIndex: 'g1', provider: 'gemini', email: null, plan: null, priority: null, windows: [], usageRead: false }),
    ]));

    render(<CliproxyAccountsPanel />);

    expect(await screen.findByText('Add a second account to use reset-first routing.')).toBeInTheDocument();
    expect(screen.getByText('usage not read')).toBeInTheDocument();
    expect(screen.queryByTestId('cliproxy-account-rank')).not.toBeInTheDocument();
  });

  it('refresh button requests refresh=1', async () => {
    const user = userEvent.setup();
    const fetchMock = stubAccounts(snapshot([account({})]));

    render(<CliproxyAccountsPanel />);
    await screen.findAllByTestId('cliproxy-account-row');
    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
      expect(urls.some((url) => url.endsWith('/api/cliproxy/accounts?refresh=1'))).toBe(true);
    });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/api\/cliproxy\/accounts$/);
  });
});
