import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useCreateConversation } from '../useCreateConversation';
import { useNewConversationDefaults } from '../newConversationDefaults';
import { TestDeckNavigationProvider, type DeckNavigationCall } from '../deckNavigation';
import { usePanesStore } from '../../../../lib/panesStore';
import { useCommandDeckSelection } from '../../../../lib/commandDeckSelection';
import { NO_PROJECT_KEY } from '../../../CommandDeck/projectsData';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

let client: QueryClient;
let calls: DeckNavigationCall[];
let response: { ok: boolean; status: number; body: unknown };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  calls = [];
  response = { ok: true, status: 200, body: { id: 42, name: 'new-conv', title: 'Agent' } };
  fetchMock = vi.fn(async () => ({ ok: response.ok, status: response.status, json: async () => response.body }));
  vi.stubGlobal('fetch', fetchMock);
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} });
  useCommandDeckSelection.setState({ selectedConversation: null, selectedFeature: null });
  useNewConversationDefaults.setState({ model: 'claude-sonnet-4-6', harness: 'claude-code', effort: 'high' });
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <TestDeckNavigationProvider calls={calls}>{children}</TestDeckNavigationProvider>
    </QueryClientProvider>
  );
}

const postBody = () => {
  const post = fetchMock.mock.calls.find(([url, init]) => url === '/api/conversations' && init?.method === 'POST');
  return JSON.parse(String(post?.[1]?.body));
};

describe('useCreateConversation (PAN-5293 WI-5)', () => {
  it('POSTs model, harness and projectKey without context opt-outs, opens the pane and calls openInDeck (PAN-4486)', async () => {
    localStorage.setItem('overdeck.commandDeck.newConversationContext', '{"bareContext":true,"skipClaudeMd":true}');
    const onCreated = vi.fn();
    const { result } = renderHook(() => useCreateConversation('proj', onCreated), { wrapper });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.create('proj');
    });

    expect(outcome).toEqual({ name: 'new-conv' });
    const body = postBody();
    expect(body).toMatchObject({ model: 'claude-sonnet-4-6', harness: 'claude-code', projectKey: 'proj' });
    expect(body).not.toHaveProperty('bareContext');
    expect(body).not.toHaveProperty('skipClaudeMd');
    expect(calls).toEqual([{ method: 'openInDeck', target: { projectKey: 'proj', conversationRouteKey: '42' } }]);
    expect(useCommandDeckSelection.getState().selectedConversation).toBe('new-conv');
    expect(usePanesStore.getState().panesByWorkspace.proj).toEqual(expect.arrayContaining([
      expect.objectContaining({ paneType: 'agent', conversationId: 'new-conv' }),
    ]));
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 42, name: 'new-conv' }));
    localStorage.removeItem('overdeck.commandDeck.newConversationContext');
  });

  it('resolves to the server error and toasts it', async () => {
    response = { ok: false, status: 500, body: { error: 'boom' } };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useCreateConversation('proj'), { wrapper });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.create('proj');
    });

    expect(outcome).toEqual({ error: 'boom' });
    expect(toast.error).toHaveBeenCalledWith('boom');
    expect(calls).toEqual([]);
    consoleError.mockRestore();
  });

  it('createForAgent in the No-project bucket creates an unscoped conversation there', async () => {
    const { result } = renderHook(() => useCreateConversation(NO_PROJECT_KEY), { wrapper });
    await act(async () => {
      await result.current.createForAgent('codex');
    });

    const body = postBody();
    expect(body).not.toHaveProperty('projectKey');
    expect(body.harness).toBe('codex');
    expect(calls).toEqual([{ method: 'openInDeck', target: { projectKey: NO_PROJECT_KEY, conversationRouteKey: '42' } }]);
  });
});
