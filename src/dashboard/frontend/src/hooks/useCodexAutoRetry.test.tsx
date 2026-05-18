import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { useCodexAutoRetry } from './useCodexAutoRetry';
import {
  clearPendingCodexSpawn,
  getPendingCodexSpawn,
  setPendingCodexSpawn,
  setReauthSession,
} from '../lib/pending-codex-spawn';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../lib/refresh-dashboard-state', () => ({
  refreshDashboardState: vi.fn(async () => {}),
}));

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useCodexAutoRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearPendingCodexSpawn();
    sessionStorage.clear();
  });

  afterEach(() => {
    clearPendingCodexSpawn();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not launch concurrent spawn retries while the first retry is in flight', async () => {
    let resolveSpawn: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/settings/codex-auth') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'expired' }),
        } as Response);
      }
      if (url === '/api/settings/codex-reauth/status') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            completed: true,
            success: true,
            authStatus: { status: 'valid' },
          }),
        } as Response);
      }
      if (url === '/api/agents' && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveSpawn = resolve;
        });
      }
      return Promise.resolve({ ok: false, text: () => Promise.resolve('not found') } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    setPendingCodexSpawn({ issueId: 'PAN-913', role: 'work' });
    setReauthSession('reauth-PAN-913', 'status-token');

    renderHook(() => useCodexAutoRetry(), { wrapper: wrapper() });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchMock.mock.calls.filter(([url]) => url.toString() === '/api/agents')).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchMock.mock.calls.filter(([url]) => url.toString() === '/api/agents')).toHaveLength(1);
    expect(getPendingCodexSpawn()?.requestBody).toEqual({ issueId: 'PAN-913', role: 'work' });

    await act(async () => {
      resolveSpawn?.({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response);
    });

    expect(getPendingCodexSpawn()).toBeNull();
  });
});
