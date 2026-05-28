import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationTerminal } from '../ConversationTerminal';
import type { Conversation } from '../ConversationList';

vi.mock('../../XTerminal', () => ({ XTerminal: () => <div data-testid="x-terminal" /> }));

const baseConversation: Conversation = {
  id: 1,
  name: 'test-conv',
  tmuxSession: 'test-session',
  status: 'active',
  cwd: '/home/user',
  issueId: null,
  createdAt: '2024-01-01T00:00:00Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: true,
};

function renderTerminal(conversation: Conversation) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={client}>
      <ConversationTerminal conversation={conversation} />
    </QueryClientProvider>,
  );
}

describe('ConversationTerminal', () => {
  it('renders context usage in the header', () => {
    renderTerminal({
      ...baseConversation,
      contextUsage: {
        activeBytes: 132_164,
        estimatedTokens: 33_041,
        contextWindow: 200_000,
        percentUsed: 16.52,
      },
    });

    expect(screen.getByText('test-conv')).toBeInTheDocument();
    // ContextWindowMeter shows the rounded percentage in its ring label and the
    // full token breakdown in the hover title.
    expect(screen.getByTestId('context-window-meter-label')).toHaveTextContent('17');
    expect(screen.getByTestId('context-window-meter')).toHaveAttribute(
      'title',
      expect.stringContaining('33k/200k'),
    );
  });

  it('omits context usage when no usage is available', () => {
    renderTerminal({
      ...baseConversation,
      contextUsage: null,
    });

    expect(screen.queryByTestId('context-window-meter')).toBeNull();
  });
});
