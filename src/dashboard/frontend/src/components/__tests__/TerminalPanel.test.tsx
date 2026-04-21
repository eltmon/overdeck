import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Agent } from '../../types';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../XTerminal', () => ({
  XTerminal: ({ sessionName }: { sessionName: string }) => (
    <div data-testid="xterm">{sessionName}</div>
  ),
}));

vi.mock('../chat/MessagesTimeline', () => ({
  MessagesTimeline: ({ messages }: { messages: unknown[] }) => (
    <div data-testid="messages-timeline">{messages.length} messages</div>
  ),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    X: () => <span data-testid="icon-x" />,
    RefreshCw: () => <span data-testid="icon-refresh" />,
    ExternalLink: () => <span data-testid="icon-external" />,
  };
});

// ─── Import under test ────────────────────────────────────────────────────────

import { TerminalPanel } from '../TerminalPanel';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'test-agent-1',
    issueId: 'PAN-473',
    status: 'stopped',
    ...overrides,
  } as Agent;
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderPanel(agent: Agent, fetchImpl: typeof global.fetch) {
  global.fetch = fetchImpl;
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <TerminalPanel agent={agent} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

/** Build a fetch mock that answers route-by-route. */
function makeFetch(opts: {
  tmuxAlive: boolean;
  conversationMessages?: unknown[];
  output?: string;
}): typeof global.fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes('/tmux-alive')) {
      return new Response(JSON.stringify({ alive: opts.tmuxAlive }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/conversation')) {
      const messages = opts.conversationMessages ?? [];
      return new Response(
        JSON.stringify({ messages, workLog: [], streaming: false, totalCost: 0, byteOffset: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/output')) {
      return new Response(JSON.stringify({ output: opts.output ?? '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }) as typeof global.fetch;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TerminalPanel — stopped agent content rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the XTerminal when tmux session is alive', async () => {
    renderPanel(makeAgent(), makeFetch({ tmuxAlive: true }));

    // Optimistic: XTerminal is shown immediately, before probe resolves
    expect(screen.getByTestId('xterm')).toBeInTheDocument();
  });

  it('renders last output (pre element) when agent is stopped and conversation is empty', async () => {
    renderPanel(
      makeAgent(),
      makeFetch({ tmuxAlive: false, conversationMessages: [], output: 'last terminal output' }),
    );

    await waitFor(() => {
      expect(screen.getByText('last terminal output')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('messages-timeline')).not.toBeInTheDocument();
  });

  it('renders "No saved output available." when stopped with no output and no conversation', async () => {
    renderPanel(
      makeAgent(),
      makeFetch({ tmuxAlive: false, conversationMessages: [], output: '' }),
    );

    await waitFor(() => {
      expect(screen.getByText('No saved output available.')).toBeInTheDocument();
    });
  });

  it('renders pre element when agent is stopped even if conversation has messages', async () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'world' }] },
    ];

    renderPanel(
      makeAgent(),
      makeFetch({ tmuxAlive: false, conversationMessages: messages, output: 'last terminal output' }),
    );

    await waitFor(() => {
      expect(screen.getByText('last terminal output')).toBeInTheDocument();
    });
    // MessagesTimeline is not rendered — stopped agents show raw output only
    expect(screen.queryByTestId('messages-timeline')).not.toBeInTheDocument();
  });

  it('shows "Last output" header label when agent is stopped', async () => {
    renderPanel(
      makeAgent(),
      makeFetch({ tmuxAlive: false, conversationMessages: [], output: 'some output' }),
    );

    await waitFor(() => {
      expect(screen.getByText('Last output')).toBeInTheDocument();
    });
  });

  it('shows "Last output" header label when stopped with no messages', async () => {
    renderPanel(
      makeAgent(),
      makeFetch({ tmuxAlive: false, conversationMessages: [], output: 'some output' }),
    );

    await waitFor(() => {
      expect(screen.getByText('Last output')).toBeInTheDocument();
    });
  });
});

describe('TerminalPanel — specialist session (sessionName prop)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders XTerminal for a specialist session even when the work agent tmux session is dead', async () => {
    // Work agent is dead (tmuxAlive: false) but we are viewing a specialist tab
    const fetch = makeFetch({
      tmuxAlive: false,
      conversationMessages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    global.fetch = fetch;
    const client = makeQueryClient();
    render(
      <QueryClientProvider client={client}>
        <TerminalPanel
          agent={makeAgent({ status: 'stopped' })}
          onClose={() => {}}
          sessionName="specialist-panopticon-review-agent"
          title="Review"
        />
      </QueryClientProvider>,
    );

    // isViewingWorkAgent=false → isStopped=false → XTerminal shown, not fallback
    expect(screen.getByTestId('xterm')).toBeInTheDocument();
    expect(screen.queryByTestId('messages-timeline')).not.toBeInTheDocument();
    expect(screen.queryByText('No saved output available.')).not.toBeInTheDocument();

    // The tmux-alive probe must NOT fire for the work agent while viewing a specialist session
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/tmux-alive'),
      expect.anything(),
    );
  });
});
