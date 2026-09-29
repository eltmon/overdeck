import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeCodeUpgradeBanner, claudeCodeBannerMessage, type ClaudeCodeStatus } from './ClaudeCodeUpgradeBanner';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { popoutTerminalMock } = vi.hoisted(() => ({ popoutTerminalMock: vi.fn() }));
vi.mock('./TerminalPanel', () => ({
  popoutTerminal: popoutTerminalMock,
}));

const OUTDATED_STATUS: ClaudeCodeStatus = {
  found: true,
  binaryPath: '/usr/local/bin/claude',
  version: '2.1.280',
  outdated: true,
  requirements: [
    {
      model: 'claude-sonnet-5-5',
      displayName: 'Claude Sonnet 5.5',
      minVersion: '2.1.284',
      sources: ['roles.work.model'],
      satisfied: false,
    },
  ],
  upgrade: {
    method: 'npm',
    argv: ['npm', 'install', '-g', '--prefix', '/usr/local', '@anthropic-ai/claude-code@latest'],
    display: 'npm install -g --prefix /usr/local @anthropic-ai/claude-code@latest',
    runnable: true,
  },
  checkedAt: '2026-09-29T00:00:00.000Z',
};

const NOT_RUNNABLE_STATUS: ClaudeCodeStatus = {
  ...OUTDATED_STATUS,
  upgrade: {
    method: 'npm',
    argv: null,
    display: 'sudo npm install -g --prefix /usr/local @anthropic-ai/claude-code@latest',
    runnable: false,
    reason: 'not-writable',
  },
};

const SATISFIED_STATUS: ClaudeCodeStatus = {
  ...OUTDATED_STATUS,
  outdated: false,
  requirements: [{ ...OUTDATED_STATUS.requirements[0], satisfied: true }],
};

describe('claudeCodeBannerMessage', () => {
  it('returns null when not outdated', () => {
    expect(claudeCodeBannerMessage(SATISFIED_STATUS)).toBeNull();
  });

  it('names both versions when outdated', () => {
    const message = claudeCodeBannerMessage(OUTDATED_STATUS);
    expect(message).toContain('2.1.280');
    expect(message).toContain('2.1.284');
    expect(message).toContain('Claude Sonnet 5.5');
  });
});

describe('ClaudeCodeUpgradeBanner', () => {
  beforeEach(() => {
    popoutTerminalMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderBanner(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
    return render(
      <QueryClientProvider client={queryClient}>
        <ClaudeCodeUpgradeBanner />
      </QueryClientProvider>,
    );
  }

  it('shows the Upgrade button for a runnable status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => OUTDATED_STATUS }));

    renderBanner();

    expect(await screen.findByRole('button', { name: 'Upgrade Claude Code' })).toBeInTheDocument();
  });

  it('shows a copyable command and no Upgrade button when not runnable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => NOT_RUNNABLE_STATUS }));

    renderBanner();

    await screen.findByText(/sudo npm install/);
    expect(screen.queryByRole('button', { name: 'Upgrade Claude Code' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-check' })).toBeInTheDocument();
  });

  it('unmounts after an Upgrade click once a refetch reports outdated: false', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => OUTDATED_STATUS })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sessionName: 'claude-code-upgrade' }) });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderBanner(queryClient);

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade Claude Code' }));

    await waitFor(() => expect(popoutTerminalMock).toHaveBeenCalledWith('claude-code-upgrade', 'Upgrade Claude Code'));

    // Simulate the next poll resolving outdated: false, without depending on
    // the real 5s refetch interval (fake-timers-for-retry-tests: a component
    // interval isn't the retry/backoff this rule targets, so we just drive
    // the query cache directly instead of ticking a clock).
    queryClient.setQueryData(['claude-code-status'], SATISFIED_STATUS);

    await waitFor(() => expect(screen.queryByText(/is older than/)).not.toBeInTheDocument());
  });
});
