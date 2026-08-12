import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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

  it('sends the resume message by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ...baseConversation, sessionAlive: true }));
    vi.stubGlobal('fetch', fetchMock);
    renderTerminal({ ...baseConversation, status: 'ended', sessionAlive: false });

    const checkbox = screen.getByRole('checkbox', { name: 'Send resume message' });
    expect(checkbox).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Resume Session' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const resumeCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/conversations/test-conv/resume');
    expect(JSON.parse(String((resumeCall?.[1] as RequestInit).body))).toEqual({ sendResumeContract: true });
  });

  it('omits the resume message when the checkbox is cleared', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ...baseConversation, sessionAlive: true }));
    vi.stubGlobal('fetch', fetchMock);
    renderTerminal({ ...baseConversation, status: 'ended', sessionAlive: false });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Send resume message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume Session' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const resumeCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/conversations/test-conv/resume');
    expect(JSON.parse(String((resumeCall?.[1] as RequestInit).body))).toEqual({ sendResumeContract: false });
  });
});
