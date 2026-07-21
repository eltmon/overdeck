import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';

import { SessionTranscript } from '../SessionTranscript';

const componentMocks = vi.hoisted(() => ({
  conversationPanel: vi.fn(),
  messagesTimeline: vi.fn(),
}));

vi.mock('../../chat/ConversationPanel', () => ({
  ConversationPanel: (props: unknown) => {
    componentMocks.conversationPanel(props);
    return <div data-testid="conversation-panel" />;
  },
}));

vi.mock('../../chat/MessagesTimeline', () => ({
  MessagesTimeline: (props: unknown) => {
    componentMocks.messagesTimeline(props);
    return <div data-testid="messages-timeline" />;
  },
}));

vi.mock('../../../hooks/useTheme', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}));

type Session = ComponentProps<typeof SessionTranscript>['session'];

const BASE_SESSION: Session = {
  id: 42,
  source: 'discovered',
  harness: 'claude-code',
  jsonlPath: '/tmp/session.jsonl',
  workspacePath: '/workspace',
  primaryModel: 'claude-sonnet-4-6',
  messageCount: 2,
  firstTs: '2026-07-03T01:00:00.000Z',
  lastTs: '2026-07-03T01:01:00.000Z',
  estimatedCost: 0.01,
  tokenInput: 10,
  tokenOutput: 20,
  toolsUsed: [],
  filesTouched: [],
  tags: [],
  summary: null,
  enrichmentLevel: 0,
  enrichmentFailed: false,
  overdeckManaged: false,
  panIssueId: null,
};

function renderTranscript(session: Session) {
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
    vi.clearAllMocks();
  });

  it('renders ConversationPanel for managed rows with conversation identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: 7,
        name: 'managed-conv',
        tmuxSession: 'conv-managed',
        status: 'ended',
        cwd: '/workspace',
        issueId: null,
        createdAt: '2026-07-03T01:00:00.000Z',
        endedAt: null,
        lastAttachedAt: null,
        sessionAlive: false,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderTranscript({ ...BASE_SESSION, conversationId: '7', conversationName: 'managed-conv', overdeckManaged: true });

    await screen.findByTestId('conversation-panel');
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/managed-conv');
    expect(componentMocks.conversationPanel).toHaveBeenCalledWith(expect.objectContaining({
      embedded: true,
      viewMode: 'conversation',
      conversation: expect.objectContaining({ name: 'managed-conv' }),
    }));
  });

  it('renders MessagesTimeline for unmanaged rows from the discovered messages endpoint', async () => {
    const messages = [{ id: 'm1', role: 'user', text: 'hello', createdAt: '2026-07-03T01:00:00.000Z' }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages, workLog: [], streaming: false }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderTranscript(BASE_SESSION);

    await screen.findByTestId('messages-timeline');
    expect(fetchMock).toHaveBeenCalledWith('/api/discovered-sessions/42/messages');
    expect(componentMocks.messagesTimeline).toHaveBeenCalledWith(expect.objectContaining({
      messages,
      workLog: [],
      streaming: false,
      resolvedTheme: 'dark',
    }));
  });

  it('renders a missing transcript notice for 410 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 410 }));

    renderTranscript(BASE_SESSION);

    await waitFor(() => expect(screen.getByText('Transcript file no longer on disk.')).toBeInTheDocument());
    expect(screen.queryByTestId('messages-timeline')).not.toBeInTheDocument();
  });
});
