/** PAN-4498 WI-3: the bookmarks context — fetch, mutations, and the jump channel. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';
import {
  ConversationBookmarksProvider,
  useConversationBookmarks,
  defaultBookmarkLabel,
} from '../ConversationBookmarks';

const fetchMock = vi.fn();

function setup(conversationName = 'conv-a') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ConversationBookmarksProvider conversationName={conversationName}>
        {children}
      </ConversationBookmarksProvider>
    </QueryClientProvider>
  );
  return renderHook(() => useConversationBookmarks(), { wrapper });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(toast.error).mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('defaultBookmarkLabel (D3)', () => {
  it('strips markdown prefixes, backticks and **, and truncates to 80 chars with …', () => {
    expect(defaultBookmarkLabel('## **Heading** with `code`')).toBe('Heading with code');
    const long = 'x'.repeat(90);
    expect(defaultBookmarkLabel(long)).toBe(`${'x'.repeat(80)}…`);
    expect(defaultBookmarkLabel('\n\n  - first real line\nsecond line')).toBe('first real line');
  });

  it('falls back to "Bookmarked message" for blank text', () => {
    expect(defaultBookmarkLabel('')).toBe('Bookmarked message');
    expect(defaultBookmarkLabel('   \n  \n')).toBe('Bookmarked message');
    expect(defaultBookmarkLabel('**`**`**')).toBe('Bookmarked message');
  });
});

describe('ConversationBookmarksProvider', () => {
  it('useConversationBookmarks returns null outside a provider', () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useConversationBookmarks(), { wrapper });
    expect(result.current).toBeNull();
  });

  it('provider loads bookmarks and builds byMessageId', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      bookmarks: [
        { messageId: 'm1', label: 'First', messageCreatedAt: null, createdAt: 'a', updatedAt: 'a' },
        { messageId: 'm2', label: 'Second', messageCreatedAt: null, createdAt: 'b', updatedAt: 'b' },
      ],
    }), { status: 200 }));

    const { result } = setup();
    await waitFor(() => expect(result.current?.bookmarks).toHaveLength(2));
    expect(result.current?.byMessageId.get('m1')?.label).toBe('First');
    expect(result.current?.byMessageId.get('m2')?.label).toBe('Second');
  });

  it('a failed GET yields an empty list and no toast', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    const { result } = setup('conv-b');
    await waitFor(() => expect(result.current?.bookmarks).toEqual([]));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a rejected fetch yields an empty list and no toast', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { result } = setup('conv-c');
    await waitFor(() => expect(result.current?.bookmarks).toEqual([]));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('add PUTs the encoded message id and updates the list', async () => {
    const stored: Array<{ messageId: string; label: string; messageCreatedAt: string | null; createdAt: string; updatedAt: string }> = [];
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') return Promise.resolve(new Response(JSON.stringify({ bookmarks: stored }), { status: 200 }));
      if (method === 'PUT') {
        const bookmark = { messageId: 'msg a/b', label: 'Label', messageCreatedAt: null, createdAt: 'a', updatedAt: 'a' };
        stored.push(bookmark);
        return Promise.resolve(new Response(JSON.stringify({ bookmark }), { status: 200 }));
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    const { result } = setup('conv-d');
    await waitFor(() => expect(result.current?.bookmarks).toEqual([]));

    await act(async () => {
      await result.current?.add('msg a/b', 'Label', null);
    });

    await waitFor(() => expect(result.current?.bookmarks).toHaveLength(1));
    expect(result.current?.byMessageId.get('msg a/b')?.label).toBe('Label');
    expect(toast.error).not.toHaveBeenCalled();
    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
    expect(String(putCall?.[0])).toBe('/api/conversations/conv-d/bookmarks/msg%20a%2Fb');
  });

  it('jumpTo increments the nonce and resolveJump(false) sets missingMessageId', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ bookmarks: [] }), { status: 200 }));
    const { result } = setup('conv-e');
    await waitFor(() => expect(result.current?.bookmarks).toEqual([]));

    act(() => { result.current?.jumpTo('m1'); });
    expect(result.current?.jumpRequest?.messageId).toBe('m1');
    const nonce = result.current?.jumpRequest?.nonce;
    expect(nonce).toBeGreaterThan(0);

    act(() => { result.current?.jumpTo('m2'); });
    expect(result.current?.jumpRequest?.nonce).toBe((nonce ?? 0) + 1);

    act(() => { result.current?.resolveJump(result.current!.jumpRequest!.nonce, false); });
    expect(result.current?.missingMessageId).toBe('m2');
  });
});
