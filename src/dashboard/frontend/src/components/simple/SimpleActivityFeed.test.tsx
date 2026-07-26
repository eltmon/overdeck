/**
 * PAN-3090 WI-2 — narrative feed component tests.
 * Proves the feed renders narrative entries (never the raw kickoff wall),
 * the live row tracks blocked vs working state, and the multi-agent switcher
 * appears only when there's more than one agent.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSnapshot } from '@overdeck/contracts';
import type { Issue } from '../../types';
import { SimpleActivityFeed } from './SimpleActivityFeed';

// The WS stream needs a live transport; tests run the HTTP-poll path only.
vi.mock('../chat/useConversationMessagesStream', () => ({
  conversationMessagesQueryKey: (name: string) => ['conversation-messages', name] as const,
  useConversationMessagesStream: () => false,
  shouldStreamConversationMessages: () => false,
}));

const KICKOFF = '# Working on Issue: PAN-1\n\n## Per-Issue Record\n\n```json\n{ "decisions": [] }\n```';

function transcriptPayload() {
  return {
    streaming: false,
    messages: [
      { id: 'u1', role: 'user', text: KICKOFF, createdAt: '2026-07-25T10:00:00Z' },
      { id: 'a1', role: 'assistant', text: `I will read the code first. ${'More detail here. '.repeat(30)}`, createdAt: '2026-07-25T10:02:00Z' },
    ],
    workLog: [
      { id: 'w1', createdAt: '2026-07-25T10:01:00Z', label: 'Edited', tone: 'tool', changedFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'] },
      { id: 'w2', createdAt: '2026-07-25T10:03:00Z', label: 'Ran', tone: 'error', command: 'npm test' },
    ],
  };
}

function makeAgent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return { id: 'agent-pan-1', issueId: 'PAN-1', status: 'running', role: 'work', ...overrides } as AgentSnapshot;
}

const ISSUE = { identifier: 'PAN-1', title: 'Set up PostHog product analytics' } as Issue;

function renderFeed(props: Partial<Parameters<typeof SimpleActivityFeed>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSelectAgent = props.onSelectAgent ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <SimpleActivityFeed
        issue={ISSUE}
        agents={[makeAgent()]}
        agent={makeAgent()}
        onSelectAgent={onSelectAgent}
        state="working"
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onSelectAgent };
}

describe('SimpleActivityFeed (PAN-3090)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/messages')) return Response.json(transcriptPayload());
      return Response.json({});
    }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders narrative entries instead of raw message bubbles', async () => {
    renderFeed();
    // The kickoff prompt never renders as a wall — one-line system entry, and
    // the raw text sits behind a CLOSED disclosure (jsdom renders details
    // content regardless of open state, so assert the disclosure is shut).
    expect(await screen.findByText('Task started · told to set up posthog product analytics')).toBeInTheDocument();
    expect(screen.getByText('See the full instructions it was given')).toBeInTheDocument();
    const raw = screen.getByText(/Per-Issue Record/);
    expect(raw.closest('details')).not.toHaveAttribute('open');
    // Assistant prose clamps with a Read more toggle.
    expect(screen.getByText(/I will read the code first/)).toBeInTheDocument();
    expect(screen.getByText('Read more')).toBeInTheDocument();
    // Tool calls are one-line actions; the failure carries the only color signal.
    expect(screen.getByText('Edited src/a.ts, src/b.ts (+1 more)')).toBeInTheDocument();
    const failed = screen.getByText('Ran npm test');
    expect(failed.className).toMatch(/destructive/);
  });

  it('live row shows paused copy when needs-you and working copy when running', async () => {
    const { rerender } = renderFeed({ state: 'needs-you' });
    expect(await screen.findByText('Paused — waiting for your answer')).toBeInTheDocument();
    expect(screen.getByText('waiting on you')).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SimpleActivityFeed issue={ISSUE} agents={[makeAgent()]} agent={makeAgent()} onSelectAgent={vi.fn()} state="working" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryByText('Paused — waiting for your answer')).not.toBeInTheDocument());
    expect(screen.getByText('live')).toBeInTheDocument();
    expect(screen.getByText('Thinking')).toBeInTheDocument();
  });

  it('multi-agent issues get a text switcher; single agent gets none', async () => {
    const review = makeAgent({ id: 'agent-pan-1-review', role: 'review' });
    const { onSelectAgent } = renderFeed({ agents: [makeAgent(), review] });
    await screen.findByText(/Task started/);
    const switcher = screen.getByRole('button', { name: 'Review' });
    fireEvent.click(switcher);
    expect(onSelectAgent).toHaveBeenCalledWith('agent-pan-1-review');

    cleanup();
    renderFeed();
    await screen.findByText(/Task started/);
    expect(screen.queryByRole('button', { name: 'Work' })).not.toBeInTheDocument();
    // …and the quiet provenance caption is still there.
    expect(screen.getByText(/Work agent ·/)).toBeInTheDocument();
    expect(screen.getByText('pan-1')).toBeInTheDocument();
  });
});
