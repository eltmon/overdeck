/**
 * PAN-1990 dashboard-workspace-view: /workspace/:id renders terminals,
 * workspace-filtered conversations, and the memory surface.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../XTerminal', () => ({
  XTerminal: ({ sessionName }: { sessionName: string }) => <div data-testid="xterm" data-session={sessionName} />,
}));

vi.mock('../../CommandDeck/ConversationList', async () => {
  const actual = await vi.importActual<typeof import('../../CommandDeck/ConversationList')>('../../CommandDeck/ConversationList');
  return {
    ...actual,
    ConversationList: (props: { includeIds?: Set<number>; onSelectConversation: (name: string) => void }) => (
      <div data-testid="conversation-list" data-include-ids={props.includeIds ? [...props.includeIds].join(',') : 'all'}>
        <button type="button" onClick={() => props.onSelectConversation('conv-in-workspace')}>conv-in-workspace</button>
      </div>
    ),
  };
});

vi.mock('../../chat/ConversationPanel', () => ({
  ConversationPanel: ({ conversation }: { conversation: { name: string } }) => (
    <div data-testid="conversation-panel" data-conversation={conversation.name} />
  ),
}));

vi.mock('../../issue-view/VerificationGates', () => ({
  VerificationGates: ({ issueId }: { issueId: string }) => <div data-testid="verification-gates" data-issue={issueId} />,
}));

vi.mock('../../xbrief/XBriefViewer', () => ({
  XBriefViewer: ({ doc }: { doc: unknown }) => <div data-testid="xbrief-viewer" data-has-doc={String(doc !== null)} />,
}));

vi.mock('../../../lib/store', () => ({
  useDashboardStore: (selector: (state: { agentsById: Record<string, unknown> }) => unknown) =>
    selector({ agentsById: { 'agent-1': { id: 'agent-1', issueId: 'PAN-9001', status: 'running' } } }),
  selectAgents: (state: { agentsById: Record<string, unknown> }) => Object.values(state.agentsById),
}));

import { WorkspaceView } from '../WorkspaceView';
import { rememberRunSession } from '../WorkspaceActionBand';

const CONVERSATIONS = [
  { id: 1, name: 'conv-in-workspace', tmuxSession: 'conv-in-workspace', status: 'active', cwd: '/repo/workspaces/feature-pan-9001', issueId: null, createdAt: '', endedAt: null, lastAttachedAt: null, sessionAlive: true },
  { id: 2, name: 'conv-elsewhere', tmuxSession: 'conv-elsewhere', status: 'active', cwd: '/repo/other', issueId: null, createdAt: '', endedAt: null, lastAttachedAt: null, sessionAlive: true },
];

function renderWorkspaceView(options: {
  workspaceId?: string;
  workspace?: Record<string, unknown> | null;
  memory?: Record<string, unknown> | null;
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const workspaceId = options.workspaceId ?? 'ws-1';
  const workspace = options.workspace !== undefined ? options.workspace : {
    id: workspaceId,
    projectId: 'overdeck',
    kind: 'issue',
    name: 'feature-pan-9001',
    path: '/repo/workspaces/feature-pan-9001',
    issueId: 'PAN-9001',
    layoutConfig: null,
    title: null,
    pipeline: null,
  };
  const memory = options.memory !== undefined ? options.memory : {
    headline: 'Building the workspace view.',
    status: { headline: 'Building the workspace view.', summary: 'summary', phase: 'building', confidence: 0.9, nextSteps: ['Ship it'] },
    observations: [{ id: 'obs-1', timestamp: '2026-07-29T00:00:00.000Z', summary: 'did a thing', actionStatus: null }],
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `/api/workspace-registry/${workspaceId}`) return Response.json(workspace);
    if (url === `/api/workspace-registry/${workspaceId}/memory`) return Response.json(memory);
    if (url === '/api/conversations') return Response.json(CONVERSATIONS);
    if (url.startsWith('/api/workspaces/') && url.endsWith('/plan')) return Response.json(null);
    if (url === `/api/workspace-registry/${workspaceId}/layout` && init?.method === 'PUT') return Response.json({});
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetchMock);

  const onBack = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <WorkspaceView workspaceId={workspaceId} onBack={onBack} />
    </QueryClientProvider>,
  );
  return { onBack, fetchMock };
}

describe('WorkspaceView (ac1)', () => {
  it('renders the terminal, workspace-filtered conversations, and the memory surface', async () => {
    renderWorkspaceView();

    expect(await screen.findByTestId('xterm')).toHaveAttribute('data-session', 'agent-1');
    expect(await screen.findByTestId('conversation-list')).toHaveAttribute('data-include-ids', '1');
    expect(await screen.findByTestId('workspace-view-memory-status')).toHaveTextContent('Building the workspace view.');
    expect(await screen.findByTestId('workspace-view-observation-timeline')).toHaveTextContent('did a thing');
  });

  // PAN-3286 FR-12
  it('shows the memory phase and confidence in the Memory header', async () => {
    renderWorkspaceView();

    const header = await screen.findByTestId('workspace-view-memory-phase');
    expect(header).toHaveTextContent('building');
    expect(header).toHaveTextContent('confidence 0.9');
  });

  it('omits the phase header for a workspace with no memory status', async () => {
    renderWorkspaceView({ memory: { headline: '', status: null, observations: [] } });

    expect(await screen.findByTestId('xterm')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-view-memory-phase')).toBeNull();
  });
});

describe('WorkspaceView (ac2)', () => {
  it('renders the vBRIEF viewer and pipeline status components for an issue-kind workspace', async () => {
    renderWorkspaceView();

    expect(await screen.findByTestId('verification-gates')).toHaveAttribute('data-issue', 'PAN-9001');
    expect(await screen.findByTestId('xbrief-viewer')).toBeInTheDocument();
  });

  it('omits the vBRIEF viewer and pipeline gates for a scratch-kind workspace', async () => {
    renderWorkspaceView({
      workspace: {
        id: 'ws-scratch', projectId: 'overdeck', kind: 'scratch', name: 'scratch-notes',
        path: '/repo/scratch', issueId: null, layoutConfig: null, title: null, pipeline: null,
      },
    });

    await screen.findByTestId('conversation-list');
    expect(screen.queryByTestId('verification-gates')).not.toBeInTheDocument();
    expect(screen.queryByTestId('xbrief-viewer')).not.toBeInTheDocument();
    expect(await screen.findByTestId('workspace-view-no-terminal')).toBeInTheDocument();
  });
});

describe('WorkspaceView conversation filtering (FR-15/AC-11)', () => {
  it('filters by conversation.workspaceId when set, even when cwd would suggest otherwise', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const workspaceId = 'ws-1';
    const workspace = {
      id: workspaceId, projectId: 'overdeck', kind: 'issue', name: 'feature-pan-9001',
      path: '/repo/workspaces/feature-pan-9001', issueId: 'PAN-9001', layoutConfig: null, title: null, pipeline: null,
    };
    const conversations = [
      // cwd is under the workspace path, but workspaceId points elsewhere — must be excluded.
      { id: 10, name: 'cwd-under-but-other-workspace', tmuxSession: 't10', status: 'active', cwd: '/repo/workspaces/feature-pan-9001/sub', issueId: null, createdAt: '', endedAt: null, lastAttachedAt: null, sessionAlive: true, workspaceId: 'ws-other' },
      // cwd is NOT under the workspace path, but workspaceId matches — must be included.
      { id: 11, name: 'cwd-elsewhere-but-this-workspace', tmuxSession: 't11', status: 'active', cwd: '/repo/unrelated', issueId: null, createdAt: '', endedAt: null, lastAttachedAt: null, sessionAlive: true, workspaceId },
      // No workspaceId at all (pre-migration row) — falls back to cwd containment, matches.
      { id: 12, name: 'legacy-cwd-match', tmuxSession: 't12', status: 'active', cwd: '/repo/workspaces/feature-pan-9001', issueId: null, createdAt: '', endedAt: null, lastAttachedAt: null, sessionAlive: true },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/workspace-registry/${workspaceId}`) return Response.json(workspace);
      if (url === `/api/workspace-registry/${workspaceId}/memory`) return Response.json(null);
      if (url === '/api/conversations') return Response.json(conversations);
      if (url.startsWith('/api/workspaces/') && url.endsWith('/plan')) return Response.json(null);
      return Response.json({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={client}>
        <WorkspaceView workspaceId={workspaceId} />
      </QueryClientProvider>,
    );

    const list = await screen.findByTestId('conversation-list');
    await waitFor(() => {
      const ids = (list.getAttribute('data-include-ids') ?? '').split(',').map(Number).sort();
      expect(ids).toEqual([11, 12]);
    });
  });
});

describe('WorkspaceView (ac4)', () => {
  it('the conversations filter has an all-conversations escape hatch', async () => {
    renderWorkspaceView();

    expect(await screen.findByTestId('conversation-list')).toHaveAttribute('data-include-ids', '1');

    fireEvent.click(await screen.findByTestId('workspace-view-all-conversations-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('conversation-list')).toHaveAttribute('data-include-ids', 'all');
    });
  });

  it('selecting a conversation renders the ConversationPanel', async () => {
    renderWorkspaceView();

    fireEvent.click(await screen.findByText('conv-in-workspace'));

    expect(await screen.findByTestId('conversation-panel')).toHaveAttribute('data-conversation', 'conv-in-workspace');
  });
});

// PAN-3331 review finding: the run session used to be once-seeded local state.
// The router swaps `workspaceId` on the SAME component instance, so workspace
// A's run terminal appeared inside workspace B.
describe('WorkspaceView run terminal (PAN-3331)', () => {
  afterEach(() => {
    rememberRunSession('ws-a', null);
    rememberRunSession('ws-b', null);
  });

  function renderForWorkspace(workspaceId: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/workspace-registry/${workspaceId}`) {
        return Response.json({
          id: workspaceId, projectId: 'overdeck', kind: 'scratch', name: workspaceId,
          path: `/repo/${workspaceId}`, issueId: null, layoutConfig: null, title: null, pipeline: null,
        });
      }
      if (url.startsWith('/api/workspace-registry/')) return Response.json({ headline: null, status: null, observations: [] });
      if (url === '/api/conversations') return Response.json([]);
      return Response.json({});
    });
    vi.stubGlobal('fetch', fetchMock);
    return render(
      <QueryClientProvider client={client}>
        <WorkspaceView workspaceId={workspaceId} />
      </QueryClientProvider>,
    );
  }

  it('shows the run session belonging to the workspace currently on screen', async () => {
    rememberRunSession('ws-a', 'ws-run-aaaa');

    const { rerender } = renderForWorkspace('ws-a');
    const terminal = await screen.findByTestId('workspace-view-run-terminal');
    expect(terminal).toBeInTheDocument();
    expect(screen.getByTestId('xterm')).toHaveAttribute('data-session', 'ws-run-aaaa');

    // Same instance, different workspace — B has no run session.
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <WorkspaceView workspaceId="ws-b" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId('workspace-view-run-terminal')).toBeNull());
  });

  it('mounts a terminal for a run started elsewhere, such as from the palette', async () => {
    renderForWorkspace('ws-a');
    await screen.findByTestId('conversation-list');
    expect(screen.queryByTestId('workspace-view-run-terminal')).toBeNull();

    act(() => { rememberRunSession('ws-a', 'ws-run-aaaa'); });

    const terminal = await screen.findByTestId('workspace-view-run-terminal');
    expect(terminal).toBeInTheDocument();
  });
});

// PAN-3331 review cycle 2: the band holds workspace-scoped state (the
// first-fetch ref, expander, error text, and the run-command edit draft) and
// this view is NOT remounted when the route changes workspace id. With both
// workspaces' detail data cached there is no loading gap to reset it, so the
// band must be keyed by workspace id.
describe('WorkspaceView band state across cached navigation (PAN-3331)', () => {
  const WORKSPACES: Record<string, Record<string, unknown>> = {
    'ws-a': {
      id: 'ws-a', projectId: 'overdeck', kind: 'scratch', name: 'alpha', path: '/repo/alpha',
      issueId: null, layoutConfig: null, title: null, pipeline: null,
      isGitRepository: true, runCommand: 'alpha-command', runCommandDefault: null,
      runCommandOptions: [], openInEditorConfigured: false,
    },
    'ws-b': {
      id: 'ws-b', projectId: 'overdeck', kind: 'scratch', name: 'bravo', path: '/repo/bravo',
      issueId: null, layoutConfig: null, title: null, pipeline: null,
      isGitRepository: true, runCommand: 'bravo-command', runCommandDefault: null,
      runCommandOptions: [], openInEditorConfigured: false,
    },
  };

  function renderCachedPair() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    // Seed BOTH details so navigation never passes through a loading state —
    // the exact condition under which stale band state would survive.
    for (const [id, data] of Object.entries(WORKSPACES)) client.setQueryData(['workspace-registry', id], data);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/git')) {
        return Response.json({
          git: {
            branch: 'main', detached: false, dirtyFiles: 0, ahead: 0, behind: 0,
            hasUpstream: true, upstreamRef: 'origin/main', recentRemoteCommits: [], fetchedAt: 1,
          },
        });
      }
      if (url.endsWith('/memory')) return Response.json({ headline: null, status: null, observations: [] });
      if (url === '/api/conversations') return Response.json([]);
      const detail = Object.entries(WORKSPACES).find(([id]) => url === `/api/workspace-registry/${id}`);
      if (detail) return Response.json(detail[1]);
      return Response.json({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const view = render(
      <QueryClientProvider client={client}>
        <WorkspaceView workspaceId="ws-a" />
      </QueryClientProvider>,
    );
    const toBravo = () => view.rerender(
      <QueryClientProvider client={client}>
        <WorkspaceView workspaceId="ws-b" />
      </QueryClientProvider>,
    );
    return { fetchMock, toBravo };
  }

  it('drops an edit draft opened in one workspace instead of carrying it into the next', async () => {
    const { toBravo } = renderCachedPair();

    fireEvent.click(await screen.findByTestId('workspace-band-run-edit'));
    fireEvent.change(screen.getByTestId('workspace-band-run-input'), { target: { value: 'DRAFT-FROM-ALPHA' } });
    expect(screen.getByTestId('workspace-band-run-input')).toHaveValue('DRAFT-FROM-ALPHA');

    toBravo();

    // No open editor, and the command shown is bravo's own — a carried draft
    // would have been saved onto bravo's run_command.
    await waitFor(() => expect(screen.queryByTestId('workspace-band-run-input')).toBeNull());
    expect(screen.getByTestId('workspace-band-run-command')).toHaveTextContent('bravo-command');
  });

  it('performs the initial fetching read for the workspace navigated to', async () => {
    const { fetchMock, toBravo } = renderCachedPair();

    await waitFor(() =>
      expect(fetchMock.mock.calls.map(String)).toContainEqual(expect.stringContaining('/ws-a/git?fetch=1')));

    toBravo();

    await waitFor(() =>
      expect(fetchMock.mock.calls.map((call) => String(call[0])))
        .toContainEqual('/api/workspace-registry/ws-b/git?fetch=1'));
  });
});
