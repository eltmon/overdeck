/** PAN-4498 WI-6: the Bookmarks header toggle and the bookmarks drawer list. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ConversationBookmarksProvider, useConversationBookmarks } from '../ConversationBookmarks';
import { BookmarksToggle, BookmarksDrawer } from '../BookmarksDrawer';

/** Simulates MessagesTimeline reporting a jump target that isn't in the loaded rows (FR-13). */
function MissJumpFor({ messageId }: { messageId: string }) {
  const ctx = useConversationBookmarks();
  useEffect(() => {
    if (ctx?.jumpRequest && ctx.jumpRequest.messageId === messageId) {
      ctx.resolveJump(ctx.jumpRequest.nonce, false);
    }
  }, [ctx, ctx?.jumpRequest, messageId]);
  return <button onClick={() => ctx?.jumpTo(messageId)}>simulate-miss</button>;
}

const fetchMock = vi.fn();

interface StoredBookmark {
  messageId: string;
  label: string;
  messageCreatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function renderPanel(initial: StoredBookmark[] = []) {
  const stored = [...initial];
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET') return Promise.resolve(new Response(JSON.stringify({ bookmarks: [...stored] }), { status: 200 }));
    if (method === 'PUT') {
      const url = String(input);
      const messageId = decodeURIComponent(url.split('/bookmarks/')[1] ?? '');
      const body = JSON.parse(String(init?.body)) as { label: string };
      const idx = stored.findIndex((b) => b.messageId === messageId);
      if (idx >= 0) stored[idx] = { ...stored[idx]!, label: body.label };
      return Promise.resolve(new Response(JSON.stringify({ bookmark: stored[idx] }), { status: 200 }));
    }
    if (method === 'DELETE') {
      const url = String(input);
      const messageId = decodeURIComponent(url.split('/bookmarks/')[1] ?? '');
      const idx = stored.findIndex((b) => b.messageId === messageId);
      if (idx >= 0) stored.splice(idx, 1);
      return Promise.resolve(new Response(JSON.stringify({ removed: idx >= 0 }), { status: 200 }));
    }
    throw new Error(`unexpected ${method}`);
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConversationBookmarksProvider conversationName="conv-a">
        <BookmarksToggle />
        <MissJumpFor messageId="m1" />
        <BookmarksDrawer />
      </ConversationBookmarksProvider>
    </QueryClientProvider>,
  );
  return stored;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BookmarksToggle and BookmarksDrawer (PAN-4498 WI-6)', () => {
  it('the toggle shows the count and opens the drawer', async () => {
    renderPanel([
      { messageId: 'm1', label: 'First', messageCreatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { messageId: 'm2', label: 'Second', messageCreatedAt: '2026-01-02T00:00:00.000Z', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
    ]);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Show bookmarks' })).toHaveTextContent('Bookmarks 2'));
    expect(screen.queryByRole('list', { name: 'Bookmarks' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show bookmarks' }));
    expect(await screen.findByRole('list', { name: 'Bookmarks' })).toBeInTheDocument();
  });

  it('the drawer lists label and time per bookmark', async () => {
    renderPanel([
      { messageId: 'm1', label: 'A finding', messageCreatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show bookmarks' })).toHaveTextContent('Bookmarks 1'));
    fireEvent.click(screen.getByRole('button', { name: 'Show bookmarks' }));

    expect(await screen.findByRole('button', { name: 'A finding' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('rename via pencil + Enter PUTs the new label', async () => {
    renderPanel([
      { messageId: 'm1', label: 'Old label', messageCreatedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Show bookmarks' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rename bookmark' }));

    const input = screen.getByRole('textbox', { name: 'Rename bookmark' });
    fireEvent.change(input, { target: { value: 'New label' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
      expect(putCall).toBeDefined();
      expect(JSON.parse(String((putCall?.[1] as RequestInit).body))).toMatchObject({ label: 'New label' });
    });
    expect(await screen.findByRole('button', { name: 'New label' })).toBeInTheDocument();
  });

  it('remove via × DELETEs the bookmark', async () => {
    renderPanel([
      { messageId: 'm1', label: 'Gone soon', messageCreatedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Show bookmarks' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove bookmark' }));

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE');
      expect(deleteCall).toBeDefined();
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Gone soon' })).not.toBeInTheDocument());
  });

  it('the empty state text renders with no bookmarks', async () => {
    renderPanel([]);
    fireEvent.click(await screen.findByRole('button', { name: 'Show bookmarks' }));
    expect(await screen.findByText('No bookmarks yet. Click the icon beside a message to bookmark it.')).toBeInTheDocument();
  });

  it('a missing jump target shows "This message is not in the loaded transcript."', async () => {
    renderPanel([
      { messageId: 'm1', label: 'Not loaded', messageCreatedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Show bookmarks' }));
    expect(screen.queryByText('This message is not in the loaded transcript.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('simulate-miss'));

    expect(await screen.findByText('This message is not in the loaded transcript.')).toBeInTheDocument();
  });
});
