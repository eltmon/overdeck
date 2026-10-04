/** PAN-4498 WI-4: the role icon as a bookmark button and timeline marker. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChatMessage } from '../../chat-types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ConversationBookmarksProvider } from '../ConversationBookmarks';
import { MessageRoleIcon } from '../MessageRoleIcon';

const fetchMock = vi.fn();

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    text: 'First line of the message\nmore text',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderIcon(message: ChatMessage, opts: {
  bookmarkable?: boolean;
  withProvider?: boolean;
  role?: 'assistant' | 'user';
  client?: QueryClient;
} = {}) {
  const { bookmarkable = true, withProvider = true, role = 'assistant', client = new QueryClient({ defaultOptions: { queries: { retry: false } } }) } = opts;
  const content = <MessageRoleIcon message={message} role={role} bookmarkable={bookmarkable} />;
  if (!withProvider) {
    return render(<QueryClientProvider client={client}>{content}</QueryClientProvider>);
  }
  return render(
    <QueryClientProvider client={client}>
      <ConversationBookmarksProvider conversationName="conv-a">{content}</ConversationBookmarksProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MessageRoleIcon (PAN-4498 WI-4)', () => {
  it('clicking an assistant icon PUTs a bookmark with the first-line label', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') return Promise.resolve(new Response(JSON.stringify({ bookmarks: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({
        bookmark: { messageId: 'm1', label: 'First line of the message', messageCreatedAt: null, createdAt: 'a', updatedAt: 'a' },
      }), { status: 200 }));
    });
    renderIcon(makeMessage());
    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
      expect(putCall).toBeDefined();
      expect(String(putCall?.[0])).toBe('/api/conversations/conv-a/bookmarks/m1');
      expect(JSON.parse(String((putCall?.[1] as RequestInit).body))).toEqual({
        label: 'First line of the message',
        messageCreatedAt: '2026-01-01T00:00:00.000Z',
      });
    });
  });

  it('clicking a user icon bookmarks the user message the same way', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') return Promise.resolve(new Response(JSON.stringify({ bookmarks: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({
        bookmark: { messageId: 'u1', label: 'A user message', messageCreatedAt: null, createdAt: 'a', updatedAt: 'a' },
      }), { status: 200 }));
    });
    renderIcon(makeMessage({ id: 'u1', role: 'user', text: 'A user message' }), { role: 'user' });
    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
      expect(putCall).toBeDefined();
      expect(String(putCall?.[0])).toBe('/api/conversations/conv-a/bookmarks/u1');
    });
  });

  it('a bookmarked message renders aria-pressed=true and a Bookmark icon', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      bookmarks: [{ messageId: 'm1', label: 'Saved label', messageCreatedAt: null, createdAt: 'a', updatedAt: 'a' }],
    }), { status: 200 }));
    renderIcon(makeMessage());

    await waitFor(() => expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Bookmarked: Saved label');
  });

  it('bookmarkable=false renders a non-button icon', () => {
    renderIcon(makeMessage(), { bookmarkable: false });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('outside a provider the icon is not a button', () => {
    renderIcon(makeMessage(), { withProvider: false });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('an optimistic message is not a button', () => {
    renderIcon(makeMessage({ id: 'optimistic-1' }), { bookmarkable: false });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('after the bookmark list refetches and new messages are appended, the marker stays on the same message', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      bookmarks: [{ messageId: 'm1', label: 'Still here', messageCreatedAt: null, createdAt: 'a', updatedAt: 'a' }],
    }), { status: 200 })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { rerender } = render(
      <QueryClientProvider client={client}>
        <ConversationBookmarksProvider conversationName="conv-a">
          <MessageRoleIcon message={makeMessage()} role="assistant" bookmarkable />
          <MessageRoleIcon message={makeMessage({ id: 'm2', text: 'second' })} role="assistant" bookmarkable />
        </ConversationBookmarksProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
      expect(buttons[1]).toHaveAttribute('aria-pressed', 'false');
    });

    await client.invalidateQueries({ queryKey: ['conversation-bookmarks', 'conv-a'] });

    rerender(
      <QueryClientProvider client={client}>
        <ConversationBookmarksProvider conversationName="conv-a">
          <MessageRoleIcon message={makeMessage()} role="assistant" bookmarkable />
          <MessageRoleIcon message={makeMessage({ id: 'm2', text: 'second' })} role="assistant" bookmarkable />
          <MessageRoleIcon message={makeMessage({ id: 'm3', text: 'third' })} role="assistant" bookmarkable />
        </ConversationBookmarksProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(3);
      expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
      expect(buttons[1]).toHaveAttribute('aria-pressed', 'false');
      expect(buttons[2]).toHaveAttribute('aria-pressed', 'false');
    });
  });
});
