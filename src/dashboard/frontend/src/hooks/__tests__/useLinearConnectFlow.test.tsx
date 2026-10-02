import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

import { useLinearMcpAuthStatus, type LinearMcpAuthStatus } from '../useLinearMcpAuthStatus';
import { isLoopbackHost } from '../../lib/loopbackHost';
import {
  LINEAR_CONNECT_REFRESH_TIMEOUT_COPY,
  LINEAR_CONNECT_REFRESH_TIMEOUT_MS,
  LINEAR_CONNECT_VERIFY_TIMEOUT_COPY,
  LINEAR_CONNECT_VERIFY_TIMEOUT_MS,
  useLinearConnectFlow,
} from '../useLinearConnectFlow';

vi.mock('../useLinearMcpAuthStatus', () => ({
  useLinearMcpAuthStatus: vi.fn(),
}));

vi.mock('../../lib/loopbackHost', () => ({
  isLoopbackHost: vi.fn(() => true),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockStatus = vi.mocked(useLinearMcpAuthStatus);
const mockLoopback = vi.mocked(isLoopbackHost);

const OLD_URL = 'https://linear.app/oauth/authorize?state=old';
const FRESH_URL = 'https://linear.app/oauth/authorize?state=fresh';

function status(overrides: Partial<LinearMcpAuthStatus> = {}): LinearMcpAuthStatus {
  return {
    status: 'active',
    authUrl: OLD_URL,
    authUrlAgentId: 'conv-20261001-eba1',
    authUrlExpiresAt: '2026-10-01T12:30:00Z',
    declaredAt: '2026-10-01T12:00:00Z',
    blockedAgents: [
      { agentId: 'conv-20261001-eba1', issueId: null, declaredAt: '2026-10-01T12:00:00Z', expiresAt: '2026-10-01T12:30:00Z', notifiedAt: null },
      { agentId: 'agent-pan-2997', issueId: 'PAN-2997', declaredAt: '2026-10-01T12:05:00Z', expiresAt: '2026-10-01T12:35:00Z', notifiedAt: null },
    ],
    ...overrides,
  };
}

const NONE: LinearMcpAuthStatus = {
  status: 'none', authUrl: null, authUrlAgentId: null, authUrlExpiresAt: null, declaredAt: null, blockedAgents: [],
};

let current: LinearMcpAuthStatus = status();

function setStatus(value: LinearMcpAuthStatus) {
  current = value;
}

interface FakeTab {
  location: { href: string };
  opener: unknown;
  close: ReturnType<typeof vi.fn>;
}

function fakeTab(): FakeTab {
  return { location: { href: '' }, opener: {}, close: vi.fn() };
}

function jsonResponse(statusCode: number, body: Record<string, unknown>) {
  return { ok: statusCode >= 200 && statusCode < 300, status: statusCode, json: async () => body };
}

/** Let the in-flight fetch chain and React state updates settle. */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useLinearConnectFlow', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let openMock: ReturnType<typeof vi.fn>;
  let tab: FakeTab;

  beforeEach(() => {
    vi.useFakeTimers();
    setStatus(status());
    mockStatus.mockImplementation(() => ({ data: current }) as ReturnType<typeof useLinearMcpAuthStatus>);
    mockLoopback.mockReturnValue(true);
    tab = fakeTab();
    openMock = vi.fn(() => tab);
    vi.stubGlobal('open', openMock);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('polls slowly while idle and fast once a flow starts', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { action: 'open', authUrl: OLD_URL, authUrlAgentId: 'conv-20261001-eba1' }));
    const { result } = renderHook(() => useLinearConnectFlow());

    expect(mockStatus).toHaveBeenLastCalledWith({ fast: false });
    act(() => result.current.connect());
    await flush();

    expect(mockStatus).toHaveBeenLastCalledWith({ fast: true });
  });

  it('navigates the blank tab to a valid link and drops its opener', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { action: 'open', authUrl: OLD_URL, authUrlAgentId: 'conv-20261001-eba1' }));
    const { result } = renderHook(() => useLinearConnectFlow());

    act(() => result.current.connect());
    expect(openMock).toHaveBeenCalledWith('about:blank', '_blank');
    expect(result.current.phase).toBe('opening');
    await flush();

    expect(fetchMock).toHaveBeenCalledWith('/api/linear-mcp-auth/connect', { method: 'POST' });
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe(OLD_URL);
    expect(result.current.phase).toBe('awaiting-approval');
  });

  it('waits for a fresh link during a refresh, then navigates to it', async () => {
    setStatus(status({ status: 'expired' }));
    fetchMock.mockResolvedValue(jsonResponse(202, { action: 'refreshing', requestedFrom: 'conv-20261001-eba1', previousAuthUrl: OLD_URL }));
    const { result, rerender } = renderHook(() => useLinearConnectFlow());

    act(() => result.current.connect());
    await flush();
    expect(result.current.phase).toBe('refreshing');

    // The same URL turning active again (dead owner) is not a fresh link.
    setStatus(status());
    rerender();
    expect(result.current.phase).toBe('refreshing');
    expect(tab.location.href).toBe('');

    setStatus(status({ authUrl: FRESH_URL }));
    rerender();

    expect(tab.location.href).toBe(FRESH_URL);
    expect(tab.opener).toBeNull();
    expect(result.current.phase).toBe('awaiting-approval');
  });

  it('closes the tab and toasts when no fresh link arrives within 90 s', async () => {
    setStatus(status({ status: 'expired' }));
    fetchMock.mockResolvedValue(jsonResponse(202, { action: 'refreshing', requestedFrom: 'conv-20261001-eba1', previousAuthUrl: OLD_URL }));
    const { result } = renderHook(() => useLinearConnectFlow());

    act(() => result.current.connect());
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINEAR_CONNECT_REFRESH_TIMEOUT_MS);
    });

    expect(tab.close).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(LINEAR_CONNECT_REFRESH_TIMEOUT_COPY);
    expect(result.current.phase).toBe('idle');
  });

  it('closes the tab and toasts the server error when connect is refused', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { success: false, error: 'No Linear authorization is pending' }));
    const { result } = renderHook(() => useLinearConnectFlow());

    act(() => result.current.connect());
    await flush();

    expect(tab.close).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('No Linear authorization is pending');
    expect(result.current.phase).toBe('idle');
  });

  it('exposes the link as fallbackUrl when the popup is blocked', async () => {
    openMock.mockReturnValue(null);
    fetchMock.mockResolvedValue(jsonResponse(200, { action: 'open', authUrl: OLD_URL, authUrlAgentId: 'conv-20261001-eba1' }));
    const { result } = renderHook(() => useLinearConnectFlow());

    act(() => result.current.connect());
    await flush();

    expect(result.current.fallbackUrl).toBe(OLD_URL);
    expect(result.current.phase).toBe('awaiting-approval');
  });

  it('asks the owner to verify once on the first return to a loopback dashboard', async () => {
    fetchMock.mockImplementation(async (path: string) => (path.endsWith('/verify')
      ? jsonResponse(202, { requestedFrom: 'conv-20261001-eba1' })
      : jsonResponse(200, { action: 'open', authUrl: OLD_URL, authUrlAgentId: 'conv-20261001-eba1' })));
    const { result } = renderHook(() => useLinearConnectFlow());

    act(() => result.current.connect());
    await flush();

    // A focus inside the grace period (the tab just opened) is ignored.
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();

    const verifyCalls = fetchMock.mock.calls.filter(([path]) => path === '/api/linear-mcp-auth/verify');
    expect(verifyCalls).toHaveLength(1);
    expect(result.current.phase).toBe('checking');
  });

  it('does not auto-verify on a non-loopback dashboard', async () => {
    mockLoopback.mockReturnValue(false);
    fetchMock.mockResolvedValue(jsonResponse(200, { action: 'open', authUrl: OLD_URL, authUrlAgentId: 'conv-20261001-eba1' }));
    const { result } = renderHook(() => useLinearConnectFlow());

    act(() => result.current.connect());
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    act(() => { window.dispatchEvent(new Event('focus')); });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('awaiting-approval');
  });

  it('returns to awaiting approval with a notice when verify does not connect within 60 s', async () => {
    fetchMock.mockImplementation(async (path: string) => (path.endsWith('/verify')
      ? jsonResponse(202, { requestedFrom: 'conv-20261001-eba1' })
      : jsonResponse(200, { action: 'open', authUrl: OLD_URL, authUrlAgentId: 'conv-20261001-eba1' })));
    const { result } = renderHook(() => useLinearConnectFlow());

    act(() => result.current.connect());
    await flush();
    act(() => result.current.checkNow());
    await flush();
    expect(result.current.phase).toBe('checking');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINEAR_CONNECT_VERIFY_TIMEOUT_MS);
    });

    expect(result.current.phase).toBe('awaiting-approval');
    expect(result.current.notice).toBe(LINEAR_CONNECT_VERIFY_TIMEOUT_COPY);
  });

  it('toasts success with the blocked count when the lifecycle closes during a flow', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { action: 'open', authUrl: OLD_URL, authUrlAgentId: 'conv-20261001-eba1' }));
    const { result, rerender } = renderHook(() => useLinearConnectFlow());

    act(() => result.current.connect());
    await flush();
    setStatus(NONE);
    rerender();

    expect(toast.success).toHaveBeenCalledWith('Linear connected — 2 agents resumed');
    expect(result.current.phase).toBe('idle');
  });

  it('shows no success toast when the lifecycle closes while idle', () => {
    const { rerender } = renderHook(() => useLinearConnectFlow());

    setStatus(NONE);
    rerender();

    expect(toast.success).not.toHaveBeenCalled();
  });
});
