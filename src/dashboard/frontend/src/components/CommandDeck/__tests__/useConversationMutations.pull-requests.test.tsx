/**
 * PAN-3822: link/unlink pull-request mutations call the conversation routes,
 * surface the API error text, and refresh the list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/panesStore', () => ({
  closeConversationPanes: vi.fn(),
}));

import { toast } from 'sonner';
import { useConversationMutations } from '../useConversationMutations';

const fetchMock = vi.fn();

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(() => useConversationMutations(null, vi.fn()), { wrapper });
  return { view, invalidate };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useConversationMutations — pull requests (PAN-3822)', () => {
  it('links via POST and refreshes the conversation list', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ repository: 'eltmon/overdeck', number: 42 }), { status: 201 }));
    const { view, invalidate } = setup();

    act(() => { view.result.current.linkPullRequest({ name: 'conv-a', ref: '#42' }); });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Linked eltmon/overdeck#42', expect.anything()));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/conversations/conv-a/pull-requests');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ ref: '#42' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['conversations'] });
  });

  it('shows the API error (for example a foreign repository)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'someone/else is not a repository of this project', code: 'foreign_repository' }), { status: 400 }));
    const { view } = setup();

    act(() => { view.result.current.linkPullRequest({ name: 'conv-a', ref: 'someone/else#1' }); });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('someone/else is not a repository of this project', expect.anything()));
  });

  it('unlinks via DELETE with the ref in the query string', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ unlinked: true }), { status: 200 }));
    const { view } = setup();

    act(() => { view.result.current.unlinkPullRequest({ name: 'conv-a', ref: 'https://github.com/eltmon/overdeck/pull/42' }); });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Pull request unlinked', expect.anything()));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/conversations/conv-a/pull-requests?ref=https%3A%2F%2Fgithub.com%2Feltmon%2Foverdeck%2Fpull%2F42');
    expect(init.method).toBe('DELETE');
  });
});
