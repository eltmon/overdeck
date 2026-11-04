import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DialogProvider } from '../../components/DialogProvider';
import { useSimpleActions } from './useSimpleActions';
import { dashboardMutationJsonHeaders } from '../wsTransport';
import { refreshDashboardState } from '../refresh-dashboard-state';

vi.mock('../wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    'x-overdeck-csrf-token': 'test-csrf',
  })),
}));

vi.mock('../refresh-dashboard-state', () => ({
  refreshDashboardState: vi.fn(async () => {}),
}));

// useAlert's real implementation returns a promise that only resolves once
// the user dismisses the dialog; react-query's mutation only flips to the
// error state after awaiting onError, so a non-resolving alert would hang
// mutateAsync forever. Resolve immediately here so tests can observe isError.
vi.mock('../../components/DialogProvider', async () => {
  const actual = await vi.importActual<typeof import('../../components/DialogProvider')>('../../components/DialogProvider');
  return { ...actual, useAlert: () => vi.fn(async () => {}) };
});

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, createElement(DialogProvider, null, children));
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useSimpleActions exact-agent mutations', () => {
  it.each([
    ['unpause', 'unpause'],
  ] as const)('posts %s to the supplied non-primary agent id', async (actionKey, endpoint) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true })));
    const { result } = renderHook(() => useSimpleActions(), { wrapper: createWrapper() });
    const agentId = 'agent-pan-3356-review-security';

    act(() => result.current[actionKey].mutate({ agentId }));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      `/api/agents/${agentId}/${endpoint}`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
      }),
    ));
  });
});

describe('useSimpleActions CSRF (PAN-4670)', () => {
  it.each([
    ['tell', { agentId: 'agent-pan-1', message: 'hi' }, '/api/agents/agent-pan-1/tell'],
    ['answer', { agentId: 'agent-pan-1', text: 'yes' }, '/api/agents/agent-pan-1/answer-question'],
    ['recover', { agentId: 'agent-pan-1' }, '/api/agents/agent-pan-1/recover'],
    ['unpause', { agentId: 'agent-pan-1' }, '/api/agents/agent-pan-1/unpause'],
    ['merge', { issueId: 'PAN-1' }, '/api/issues/PAN-1/merge'],
    ['startWork', { issueId: 'PAN-1' }, '/api/agents'],
    ['startPlanning', { issueId: 'PAN-1' }, '/api/issues/PAN-1/start-planning'],
  ] as const)('sends CSRF header and credentials for %s', async (actionKey, input, url) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true })));
    const { result } = renderHook(() => useSimpleActions(), { wrapper: createWrapper() });

    act(() => result.current[actionKey].mutate(input as never));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({ 'x-overdeck-csrf-token': 'test-csrf' }),
      }),
    ));

    await waitFor(() => expect(result.current[actionKey].isSuccess).toBe(true));
    expect(vi.mocked(refreshDashboardState)).toHaveBeenCalled();
  });

  it('surfaces a CSRF-unavailable error without calling fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true })));
    vi.mocked(dashboardMutationJsonHeaders).mockRejectedValueOnce(new Error('Dashboard CSRF token unavailable'));
    const { result } = renderHook(() => useSimpleActions(), { wrapper: createWrapper() });

    act(() => result.current.startWork.mutate({ issueId: 'PAN-1' }));

    await waitFor(() => expect(result.current.startWork.isError).toBe(true));
    expect(result.current.startWork.error?.message).toBe('Dashboard CSRF token unavailable');
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith('/api/agents', expect.anything());
  });
});
