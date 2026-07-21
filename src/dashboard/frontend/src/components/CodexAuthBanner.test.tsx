import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodexAuthBanner } from './CodexAuthBanner';
import { useCodexAuthStatus } from '../hooks/useCodexAuthStatus';
import { popoutTerminal } from './TerminalPanel';

vi.mock('../hooks/useCodexAuthStatus', () => ({
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
});
