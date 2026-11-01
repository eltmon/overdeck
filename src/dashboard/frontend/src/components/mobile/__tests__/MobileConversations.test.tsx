import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MobileConversations } from '../MobileConversations';

vi.mock('../../chat/ConversationPanel', () => ({
  ConversationPanel: ({ conversation }: { conversation: { title: string } }) => (
    <div data-testid="conversation-panel">{conversation.title}</div>
  ),
}));

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function row(id: number, title: string, lastActivityAt: string, extra: Record<string, unknown> = {}) {
  return { id, name: `conv-${id}`, title, issueId: null, createdAt: '2026-10-01T00:00:00.000Z', lastAttachedAt: null, lastActivityAt, ...extra };
}

describe('MobileConversations', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists conversations newest first and hides archived rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      row(1, 'Oldest', '2026-10-30T00:00:00.000Z'),
      row(2, 'Newest', '2026-11-01T00:00:00.000Z', { issueId: 'PAN-2355' }),
      row(3, 'Archived', '2026-11-01T01:00:00.000Z', { archivedAt: '2026-11-01T02:00:00.000Z' }),
      row(4, 'Middle', '2026-10-31T00:00:00.000Z'),
    ]), { status: 200 })));
    renderWithQuery(<MobileConversations conversationId={null} onOpen={() => {}} onBack={() => {}} />);
    const list = await screen.findByRole('list', { name: 'Conversations' });
    const titles = Array.from(list.querySelectorAll('li')).map((li) => li.querySelector('span span')?.textContent);
    expect(titles).toEqual(['Newest', 'Middle', 'Oldest']);
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
    expect(screen.getByText('PAN-2355')).toBeInTheDocument();
  });

  it('opens a row by id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([row(7, 'Seven', '2026-11-01T00:00:00.000Z')]), { status: 200 })));
    const onOpen = vi.fn();
    renderWithQuery(<MobileConversations conversationId={null} onOpen={onOpen} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Seven/ }));
    expect(onOpen).toHaveBeenCalledWith('7');
  });

  it('fetches the conversation and renders the panel with a Back control', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(row(7, 'Seven', '2026-11-01T00:00:00.000Z')), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const onBack = vi.fn();
    renderWithQuery(<MobileConversations conversationId="7" onOpen={() => {}} onBack={onBack} />);
    expect(await screen.findByTestId('conversation-panel')).toHaveTextContent('Seven');
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/conversations/7');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
