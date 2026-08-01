import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DialogProvider } from '../../components/DialogProvider';
import { useSimpleActions } from './useSimpleActions';

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
    ['untroubled', 'untroubled'],
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
