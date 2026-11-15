import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useConversationReferences } from '../useConversationReferences';
import type { Conversation } from '../../CommandDeck/ConversationList';

function makeConversation(overrides: Partial<Conversation> & { id: number; name: string }): Conversation {
  return {
    tmuxSession: `conv-${overrides.name}`,
    status: 'active',
    cwd: '/x',
    issueId: null,
    createdAt: '2026-11-13T00:00:00.000Z',
    endedAt: null,
    lastAttachedAt: null,
    sessionAlive: false,
    title: null,
    ...overrides,
  };
}

const LISTED = makeConversation({ id: 3904, name: '20261113-6031', title: 'Refactor the deck' });
const CURRENT = makeConversation({ id: 3905, name: '20261115-0001', title: 'Current' });
const ARCHIVED = makeConversation({ id: 3906, name: '20260824-343d', title: 'Archived one', status: 'ended' });

let client: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/conversations') {
      return { ok: true, status: 200, json: async () => [LISTED, CURRENT] } as Response;
    }
    if (url === `/api/conversations/${encodeURIComponent(ARCHIVED.name)}`) {
      return { ok: true, status: 200, json: async () => ARCHIVED } as Response;
    }
    if (url === '/api/conversations/20990101-1234') {
      return { ok: false, status: 404, json: async () => ({ error: 'not found' }) } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useConversationReferences (PAN-5339 resolution-hook.ac1)', () => {
  it('returns EMPTY_CONVERSATION_REFS and issues no fetch for text with no candidates', async () => {
    const { result } = renderHook(() => useConversationReferences('nothing here', null), { wrapper });
    expect(result.current.size).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useConversationReferences (PAN-5339 resolution-hook.ac2)', () => {
  it('resolves a listed key from the conversations list without a per-key request', async () => {
    const { result } = renderHook(() => useConversationReferences('Tell 20261113-6031 now', null), { wrapper });

    await waitFor(() => expect(result.current.get('20261113-6031')).toBeDefined());

    expect(result.current.get('20261113-6031')).toMatchObject({ routeKey: '3904', name: '20261113-6031', title: 'Refactor the deck', isCurrent: false });
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain('/api/conversations');
    expect(urls.some((url) => url.startsWith('/api/conversations/'))).toBe(false);
  });
});

describe('useConversationReferences (PAN-5339 resolution-hook.ac3)', () => {
  it('requests an unlisted key exactly once and resolves it', async () => {
    const { result } = renderHook(() => useConversationReferences('conv 20260824-343d', null), { wrapper });

    await waitFor(() => expect(result.current.get('20260824-343d')).toBeDefined());

    expect(result.current.get('20260824-343d')).toMatchObject({ routeKey: '3906', isCurrent: false });
    const perKeyCalls = fetchMock.mock.calls.filter(([url]) => String(url) === `/api/conversations/${encodeURIComponent(ARCHIVED.name)}`);
    expect(perKeyCalls).toHaveLength(1);
  });

  it('leaves no entry for a key whose request 404s', async () => {
    const { result } = renderHook(() => useConversationReferences('conv 20990101-1234', null), { wrapper });

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(urls).toContain('/api/conversations/20990101-1234');
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.current.size).toBe(0);
  });
});

describe('useConversationReferences (PAN-5339 resolution-hook.ac4)', () => {
  it('marks a resolved entry isCurrent when it matches currentConversationName', async () => {
    const { result } = renderHook(() => useConversationReferences('conv 3905', '20261115-0001'), { wrapper });

    await waitFor(() => expect(result.current.get('3905')).toBeDefined());

    expect(result.current.get('3905')).toMatchObject({ isCurrent: true });
  });

  it('returns EMPTY_CONVERSATION_REFS and issues no fetch for a linked currentConversationName', async () => {
    const { result } = renderHook(() => useConversationReferences('conv 3904', '@env-1/20261115-0001'), { wrapper });
    expect(result.current.size).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
