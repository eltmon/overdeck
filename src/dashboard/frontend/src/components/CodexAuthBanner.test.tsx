import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodexAuthBanner } from './CodexAuthBanner';
import { CODEX_AUTH_REFETCH_MS, CODEX_AUTH_STALE_MS, useCodexAuthStatus } from '../hooks/useCodexAuthStatus';
import { popoutTerminal } from './TerminalPanel';

vi.mock('../hooks/useCodexAuthStatus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useCodexAuthStatus')>()),
  useCodexAuthStatus: vi.fn(),
}));

vi.mock('./TerminalPanel', () => ({
  popoutTerminal: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockAuthStatus = vi.mocked(useCodexAuthStatus);
const mockPopout = vi.mocked(popoutTerminal);

describe('CodexAuthBanner', () => {
  beforeEach(() => {
    mockAuthStatus.mockReturnValue({
      data: { status: 'expired' },
    } as ReturnType<typeof useCodexAuthStatus>);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionName: 'reauth-a10', statusToken: 'tok' }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('PAN-2973: opens the re-auth terminal in a popup instead of navigating this tab', async () => {
    const hrefBefore = window.location.href;
    render(<CodexAuthBanner />);

    fireEvent.click(screen.getByRole('button', { name: /re-authenticate/i }));

    await waitFor(() => {
      expect(mockPopout).toHaveBeenCalledWith('reauth-a10', 'Codex re-authentication');
    });
    // The dashboard tab must stay put — a full-document navigation tears down
    // the SPA and unmounts the useCodexAutoRetry completion poller.
    expect(window.location.href).toBe(hrefBefore);
  });

  it('names the CLIProxy copy when the bad status came from the bridged store', () => {
    mockAuthStatus.mockReturnValue({
      data: { status: 'expired', source: 'cliproxy' },
    } as ReturnType<typeof useCodexAuthStatus>);

    render(<CodexAuthBanner />);

    expect(screen.getByText('(CLIProxy copy)')).toBeTruthy();
  });

  it('names ~/.codex when the bad status came from the native store', () => {
    mockAuthStatus.mockReturnValue({
      data: { status: 'burned', source: 'native' },
    } as ReturnType<typeof useCodexAuthStatus>);

    render(<CodexAuthBanner />);

    expect(screen.getByText('(~/.codex)')).toBeTruthy();
  });

  it('PAN-5633: renders the failing-session count for a burned status', () => {
    mockAuthStatus.mockReturnValue({
      data: { status: 'burned', source: 'native', affectedAgents: ['conv-a', 'conv-b'] },
    } as ReturnType<typeof useCodexAuthStatus>);
    const { container, unmount } = render(<CodexAuthBanner />);
    expect(container.textContent).toContain('2 Codex sessions failing on a revoked sign-in');
    unmount();

    mockAuthStatus.mockReturnValue({
      data: { status: 'burned', source: 'native', affectedAgents: ['conv-a'] },
    } as ReturnType<typeof useCodexAuthStatus>);
    const single = render(<CodexAuthBanner />);
    expect(single.container.textContent).toContain('1 Codex session failing on a revoked sign-in');
  });

  it('PAN-5633: polls the auth status every 30 seconds', () => {
    expect(CODEX_AUTH_REFETCH_MS).toBe(30_000);
    expect(CODEX_AUTH_STALE_MS).toBe(15_000);
  });

  it('PAN-5633: shows Re-authenticate for expired and burned, and renders nothing for valid', () => {
    for (const status of ['expired', 'burned'] as const) {
      mockAuthStatus.mockReturnValue({ data: { status } } as ReturnType<typeof useCodexAuthStatus>);
      const { unmount } = render(<CodexAuthBanner />);
      expect(screen.getByRole('button', { name: /re-authenticate/i })).toBeTruthy();
      unmount();
    }

    mockAuthStatus.mockReturnValue({ data: { status: 'valid' } } as ReturnType<typeof useCodexAuthStatus>);
    const { container } = render(<CodexAuthBanner />);
    expect(container.textContent).toBe('');
  });
});
