import type { DirectoryEntry } from '@overdeck/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const conversationPanel = vi.fn();
vi.mock('../../chat/ConversationPanel', () => ({
  ConversationPanel: (props: Record<string, unknown>) => {
    conversationPanel(props);
    return <div data-testid="conversation-panel" />;
  },
}));
vi.mock('../../chat/SubagentTranscript', () => ({
  SubagentTranscript: ({ subagent }: { subagent: { agentId: string; agentType: string; description: string } }) => (
    <div data-testid="subagent-transcript">{subagent.agentId}|{subagent.agentType}|{subagent.description}</div>
  ),
}));
vi.mock('../../IssueActionMenu', () => ({
  IssueActionMenu: ({ issueId, mode }: { issueId: string; mode: string }) => <div data-testid="issue-action-menu">{issueId}:{mode}</div>,
}));
vi.mock('../../issue-view/TellComposer', () => ({
  TellComposer: ({ agentId }: { agentId: string }) => <div data-testid="tell-composer">{agentId}</div>,
}));

import { useDashboardStore } from '../../../lib/store';
import { DirectoryDetail } from './DirectoryDetail';

function entry(overrides: Partial<DirectoryEntry> & { id: string }): DirectoryEntry {
  return {
    kind: 'agent',
    label: overrides.id,
    location: 'local',
    projectKey: 'overdeck',
    issueId: null,
    issueTitle: null,
    parentId: null,
    role: 'work',
    harness: 'claude-code',
    model: 'claude-opus-5',
    state: 'working',
    startedAt: '2026-09-23T10:00:00.000Z',
    lastActivityAt: '2026-09-23T11:00:00.000Z',
    costUsd: null,
    source: 'overdeck',
    transcript: null,
    ...overrides,
  };
}

function renderDetail(selected: DirectoryEntry, all: DirectoryEntry[] = [selected], seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  seed?.(client);
  client.setQueryData(['conversations'], [{
    id: 7, name: 'orchestrator', tmuxSession: 'conv-orchestrator', status: 'active', cwd: '/w', issueId: null,
    createdAt: '2026-09-23T09:00:00.000Z', endedAt: null, lastAttachedAt: null, sessionAlive: true,
  }]);
  return render(
    <QueryClientProvider client={client}>
      <DirectoryDetail entry={selected} entriesById={new Map(all.map((item) => [item.id, item]))} onSelectEntry={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  conversationPanel.mockReset();
  useDashboardStore.setState({ derivedIssueStateByIssueId: {} } as Parameters<typeof useDashboardStore.setState>[0]);
});

describe('DirectoryDetail', () => {
  it('embeds ConversationPanel with agentId for an agent entry', () => {
    renderDetail(entry({ id: 'agent-pan-1', transcript: { route: 'agent', agentId: 'agent-pan-1' } }));
    expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    const props = conversationPanel.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(props).toMatchObject({ agentId: 'agent-pan-1', embedded: true, hideComposer: false, subagentRailCollapsed: true });
    expect(props.conversation).toMatchObject({ name: 'agent-pan-1', status: 'active', sessionAlive: true });
  });

  it('hides the composer for a worker and shows Message worker', () => {
    renderDetail(entry({ id: 'agent-pan-1-worker-1', role: 'worker', transcript: { route: 'agent', agentId: 'agent-pan-1-worker-1' } }));
    const props = conversationPanel.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(props.hideComposer).toBe(true);
    expect(screen.queryByTestId('tell-composer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Message worker' }));
    expect(screen.getByTestId('tell-composer')).toHaveTextContent('agent-pan-1-worker-1');
  });

  it('renders SubagentTranscript for a conversation subagent', () => {
    const parent = entry({ id: 'conv:orchestrator', kind: 'conversation', label: 'Orchestrator' });
    const sub = entry({
      id: 'sub:conv:orchestrator:a1',
      kind: 'subagent',
      label: 'Explore · find the route',
      parentId: 'conv:orchestrator',
      transcript: { route: 'conversation-subagent', conversationName: 'orchestrator', subagentId: 'a1' },
    });
    renderDetail(sub, [parent, sub]);
    expect(screen.getByTestId('subagent-transcript')).toHaveTextContent('a1|Explore|find the route');
    expect(screen.getByRole('button', { name: 'Spawned by Orchestrator' })).toBeInTheDocument();
  });

  it('shows PR number, checks and branch from the derived issue state', () => {
    useDashboardStore.setState({
      derivedIssueStateByIssueId: {
        'PAN-1': {
          issueId: 'PAN-1',
          state: 'in-review',
          pr: { url: 'https://github.com/o/r/pull/42', number: 42, reviewState: 'approved', checks: 'red', mergeable: null },
          branch: { name: 'feature/pan-1', aheadOfMain: 3, pushed: true },
        },
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);
    renderDetail(entry({ id: 'agent-pan-1', issueId: 'PAN-1' }));
    expect(screen.getByRole('link', { name: '#42' })).toHaveAttribute('href', 'https://github.com/o/r/pull/42');
    expect(screen.getByText('red')).toHaveClass('text-destructive');
    expect(screen.getByText('feature/pan-1')).toBeInTheDocument();
    expect(screen.getByText('not computed')).toBeInTheDocument();
    expect(screen.getByTestId('issue-action-menu')).toHaveTextContent('PAN-1:primary-strip');
  });

  it('omits the issue block for an issue-less conversation', () => {
    renderDetail(entry({ id: 'conv:orchestrator', kind: 'conversation', transcript: { route: 'conversation', conversationName: 'orchestrator' } }));
    expect(document.querySelector('[data-component="directory-issue-context"]')).toBeNull();
    expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    expect(conversationPanel.mock.calls.at(-1)?.[0]).toMatchObject({ conversation: { name: 'orchestrator' }, subagentRailCollapsed: true });
    expect((conversationPanel.mock.calls.at(-1)?.[0] as Record<string, unknown>).hideComposer).toBeUndefined();
  });

  it('shows the agent transcript cost from the cached transcript query', () => {
    renderDetail(
      entry({ id: 'agent-pan-1', transcript: { route: 'agent', agentId: 'agent-pan-1' } }),
      undefined,
      (client) => client.setQueryData(['conversation-messages', 'agent-pan-1'], { messages: [], totalCost: 2.5 }),
    );
    expect(screen.getByText('· $2.50')).toBeInTheDocument();
  });

  it('shows an agent subagent cost once its transcript query resolves', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ messages: [], workLog: [], streaming: false, totalCost: 0.42, byteOffset: 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    try {
      renderDetail(entry({
        id: 'agent-pan-1:sub-1', label: 'Explore · scan the repo', role: null, parentId: 'agent-pan-1', state: 'done',
        transcript: { route: 'agent-subagent', agentId: 'agent-pan-1', subagentId: 'sub-1' },
      }));
      expect(screen.queryByText(/\$0\.420/)).not.toBeInTheDocument();
      expect(await screen.findByText('· $0.420')).toBeInTheDocument();
      const subagentFetches = fetchMock.mock.calls
        .map((call) => String((call as unknown[])[0]))
        .filter((url) => url.startsWith('/api/agents/agent-pan-1/conversation'));
      expect(subagentFetches).toEqual(['/api/agents/agent-pan-1/conversation?subagentId=sub-1']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows an external agent read-only, with its Claude-session parent and no composer', () => {
    renderDetail(entry({
      id: 'ext-codex-plugin-task-1', kind: 'external', source: 'codex-plugin', role: null, label: 'Fix the flaky test',
      parentId: 'claude-session:b4e68a48-1e09', transcript: { route: 'agent', agentId: 'ext-codex-plugin-task-1' },
    }));
    const props = conversationPanel.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(props).toMatchObject({ agentId: 'ext-codex-plugin-task-1', hideComposer: true });
    expect(screen.getByText('Spawned by Claude session b4e68a48')).toBeInTheDocument();
    expect(screen.getByText(/Launched outside Overdeck as a Codex plugin job/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Message worker' })).not.toBeInTheDocument();
  });

  it('says so when an entry has no transcript', () => {
    renderDetail(entry({ id: 'pane:w1:p1' }));
    expect(screen.getByText('No transcript is recorded for this agent.')).toBeInTheDocument();
  });
});
