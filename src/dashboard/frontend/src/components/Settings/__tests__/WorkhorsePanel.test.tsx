import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkhorsePanel } from '../WorkhorsePanel';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

type ClaudeAuthOverride = { loggedIn?: boolean; hasAnthropicApiKey?: boolean };
type SettingsOverride = { providers?: Partial<Record<string, boolean>> };

function installFetchMock(opts: { settings?: SettingsOverride; claudeAuth?: ClaudeAuthOverride } = {}) {
  const providers = opts.settings?.providers ?? { anthropic: true, kimi: true };
  const claudeAuth = opts.claudeAuth ?? { loggedIn: true, hasAnthropicApiKey: false };

  global.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url === '/api/settings' && init?.method === 'PUT') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) } as Response);
    }
    if (url === '/api/settings') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          workhorses: {
            expensive: 'claude-opus-4-7',
            mid: 'claude-sonnet-4-6',
            cheap: 'claude-haiku-4-5',
          },
          models: { providers },
        }),
      } as Response);
    }
    if (url === '/api/settings/available-models') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          anthropic: [
            { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', costPer1MTokens: 45 },
            { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', costPer1MTokens: 15 },
          ],
          kimi: [
            { id: 'kimi-k2.6-flash', name: 'Kimi K2.6 Flash', costPer1MTokens: 1 },
          ],
        }),
      } as Response);
    }
    if (url === '/api/settings/claude-auth') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(claudeAuth),
      } as Response);
    }
    return Promise.resolve({ ok: false, text: () => Promise.resolve('not found') } as Response);
  }) as unknown as typeof fetch;
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkhorsePanel />
    </QueryClientProvider>,
  );
}

describe('WorkhorsePanel', () => {
  beforeEach(() => {
    installFetchMock({ settings: { providers: { anthropic: false, kimi: true } } });
  });

  it('renders three workhorse dropdowns with descriptions and provider-grouped model labels', async () => {
    renderPanel();

    expect(await screen.findByLabelText('Expensive')).toBeInTheDocument();
    expect(screen.getByLabelText('Mid')).toBeInTheDocument();
    expect(screen.getByLabelText('Cheap')).toBeInTheDocument();
    expect(screen.getByText('Strongest, costly — plan/review default')).toBeInTheDocument();
    expect(screen.getByText('Balanced default')).toBeInTheDocument();
    expect(screen.getByText('Fast & cheap — universal inspect')).toBeInTheDocument();
    expect(screen.getAllByText('Anthropic > Claude Opus 4.7').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Kimi > Kimi K2.6 Flash').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Anthropic is not configured');
  });

  it('round-trips workhorse edits through PUT /api/settings', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.selectOptions(await screen.findByLabelText('Cheap'), 'kimi-k2.6-flash');

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'PUT' }));
    });

    const putCall = vi.mocked(global.fetch).mock.calls.find(([url, init]) => (
      url.toString() === '/api/settings' && init?.method === 'PUT'
    ));
    expect(JSON.parse(putCall?.[1]?.body as string).workhorses).toMatchObject({
      expensive: 'claude-opus-4-7',
      mid: 'claude-sonnet-4-6',
      cheap: 'kimi-k2.6-flash',
    });
  });
});

describe('WorkhorsePanel — Anthropic spend warning (regression PAN-1093 follow-up)', () => {
  it('does NOT warn about spend when user is on Claude subscription (no ANTHROPIC_API_KEY)', async () => {
    installFetchMock({
      settings: { providers: { anthropic: true, kimi: true } },
      claudeAuth: { loggedIn: true, hasAnthropicApiKey: false },
    });
    renderPanel();

    expect(await screen.findByLabelText('Expensive')).toBeInTheDocument();
    // Wait for claude-auth query to resolve.
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/settings/claude-auth');
    });
    // Give React Query a tick to apply the resolved data.
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(/will bill the Anthropic API/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/may incur Anthropic spend/i)).not.toBeInTheDocument();
  });

  it('DOES warn about spend when ANTHROPIC_API_KEY is set (api-key auth)', async () => {
    installFetchMock({
      settings: { providers: { anthropic: true, kimi: true } },
      claudeAuth: { loggedIn: true, hasAnthropicApiKey: true },
    });
    renderPanel();

    expect(await screen.findByLabelText('Expensive')).toBeInTheDocument();
    expect(
      await screen.findAllByText(/Anthropic API key in use; roles using this workhorse will bill the Anthropic API\./i),
    ).not.toHaveLength(0);
  });

  it('warns about not-configured (independent of auth mode) when provider is disabled', async () => {
    installFetchMock({
      settings: { providers: { anthropic: false, kimi: true } },
      claudeAuth: { loggedIn: true, hasAnthropicApiKey: true },
    });
    renderPanel();

    expect(await screen.findByLabelText('Expensive')).toBeInTheDocument();
    expect(
      await screen.findAllByText(/Anthropic is not configured/i),
    ).not.toHaveLength(0);
    // The "not configured" branch wins over the api-key spend branch.
    expect(screen.queryByText(/will bill the Anthropic API/i)).not.toBeInTheDocument();
  });
});
