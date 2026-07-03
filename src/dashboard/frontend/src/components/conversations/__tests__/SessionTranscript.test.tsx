import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { SessionTranscript } from '../SessionTranscript';

vi.mock('../../chat/ConversationPanel', () => ({
  ConversationPanel: ({ conversation, embedded }: { conversation: { name: string }; embedded?: boolean }) => (
    <div data-testid="conversation-panel">
      {conversation.name} {embedded ? 'embedded' : 'not embedded'}
    </div>
  ),
}));

vi.mock('../../chat/MessagesTimeline', () => ({
  MessagesTimeline: ({ messages }: { messages: Array<{ text: string }> }) => (
    <div data-testid="messages-timeline">
      {messages.map((message) => (
        <p key={message.text}>{message.text}</p>
      ))}
    </div>
  ),
}));

function renderTranscript(session: ComponentProps<typeof SessionTranscript>['session']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SessionTranscript session={session} />
    </QueryClientProvider>,
  );
}

describe('SessionTranscript', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders ConversationPanel embedded for managed rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 123, name: 'managed-conv' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderTranscript({
      id: 42,
      conversationId: 123,
      conversationName: 'managed-conv',
      workspacePath: '/repo',
      panIssueId: 'PAN-1917',
    });

    await waitFor(() => expect(screen.getByTestId('conversation-panel')).toHaveTextContent('managed-conv embedded'));
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/managed-conv');
  });

  it('renders MessagesTimeline for unmanaged discovered rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        messages: [{ id: 'm1', role: 'user', text: 'hello from jsonl', createdAt: '2026-07-03T00:00:00Z' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderTranscript({
      id: 42,
      workspacePath: '/repo',
      panIssueId: null,
    });

    await waitFor(() => expect(screen.getByTestId('messages-timeline')).toHaveTextContent('hello from jsonl'));
    expect(fetchMock).toHaveBeenCalledWith('/api/discovered-sessions/42/messages');
  });

  it("renders a missing-file notice when the messages endpoint returns 410", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 410 }));

    renderTranscript({
      id: 42,
      workspacePath: '/repo',
      panIssueId: null,
    });

    await waitFor(() => expect(screen.getByText('transcript file no longer on disk')).toBeInTheDocument());
  });
});
