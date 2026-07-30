/**
 * PAN-1990 dashboard-workspace-view: /workspace/:id renders terminals,
 * workspace-filtered conversations, and the memory surface.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

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

vi.mock('../../CommandDeck/FolderPicker', () => ({
  FolderPicker: ({ onSelect }: { onSelect: (path: string) => void }) => (
    <button type="button" data-testid="mock-folder-picker" onClick={() => onSelect('/picked/dir')}>Pick</button>
  ),
}));

vi.mock('../../../lib/apiFetch', () => ({
  fetchWithTimeout: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
}));

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: async () => ({ 'Content-Type': 'application/json' }),
}));

vi.mock('../../xbrief/XBriefViewer', () => ({
  XBriefViewer: ({ doc }: { doc: unknown }) => <div data-testid="xbrief-viewer" data-has-doc={String(doc !== null)} />,
}));

vi.mock('../../../lib/store', () => ({
  useDashboardStore: (selector: (state: { agentsById: Record<string, unknown> }) => unknown) =>
    selector({ agentsById: { 'agent-1': { id: 'agent-1', issueId: 'PAN-9001', status: 'running' } } }),
  selectAgents: (state: { agentsById: Record<string, unknown> }) => Object.values(state.agentsById),
}));

import { DialogProvider } from '../../DialogProvider';
import { WorkspaceView } from '../WorkspaceView';

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
  // WorkspaceView's management actions confirm through useConfirm(), which
  // requires the provider main.tsx already wraps the app in.
  render(
    <QueryClientProvider client={client}>
      <DialogProvider>
        <WorkspaceView workspaceId={workspaceId} onBack={onBack} />
      </DialogProvider>
    </QueryClientProvider>,
  );
  return { onBack, fetchMock, client };
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
        <DialogProvider>
          <WorkspaceView workspaceId={workspaceId} />
        </DialogProvider>
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

describe('WorkspaceView management actions (PAN-3330 WI-5)', () => {
  function scratch(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ws-1',
      projectId: 'overdeck',
      kind: 'scratch',
      name: 'lens',
      path: '/repo/lens',
      issueId: null,
      layoutConfig: null,
      title: null,
      isFavorite: false,
      pipeline: null,
      ...overrides,
    };
  }

  /** The confirm dialog, scoped so its buttons never collide with the header
   *  triggers that share their labels ("Archive", "Relocate"). */
  async function dialogButton(name: string) {
    const dialog = await screen.findByRole('alertdialog');
    return within(dialog).getByRole('button', { name });
  }

  /** The POST bodies sent to a workspace-registry action, in call order. */
  function actionCalls(fetchMock: ReturnType<typeof vi.fn>, suffix: string) {
    return fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith(suffix) && (init as RequestInit | undefined)?.method === 'POST')
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
  }

  it('renders Favorite, Relocate and Archive for a scratch workspace', async () => {
    renderWorkspaceView({ workspace: scratch() });

    expect(await screen.findByTestId('workspace-view-actions')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-view-favorite')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-view-relocate')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-view-archive')).toBeInTheDocument();
  });

  it('renders the same actions for a main workspace', async () => {
    renderWorkspaceView({ workspace: scratch({ kind: 'main', name: 'main' }) });

    expect(await screen.findByTestId('workspace-view-actions')).toBeInTheDocument();
  });

  it('renders none of them for an issue workspace, which the pipeline owns', async () => {
    renderWorkspaceView();

    expect(await screen.findByTestId('xterm')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-view-actions')).toBeNull();
    expect(screen.queryByTestId('workspace-view-archive')).toBeNull();
  });

  it('archives only after the confirmation is accepted', async () => {
    const { fetchMock } = renderWorkspaceView({ workspace: scratch() });

    fireEvent.click(await screen.findByTestId('workspace-view-archive'));
    fireEvent.click(await dialogButton('Archive'));

    await waitFor(() => expect(actionCalls(fetchMock, '/archive')).toEqual([{ archived: true }]));
  });

  it('sends no archive request when the confirmation is cancelled', async () => {
    const { fetchMock } = renderWorkspaceView({ workspace: scratch() });

    fireEvent.click(await screen.findByTestId('workspace-view-archive'));
    fireEvent.click(await dialogButton('Cancel'));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(actionCalls(fetchMock, '/archive')).toEqual([]);
  });

  it('relocates a scratch workspace with the path alone', async () => {
    const { fetchMock } = renderWorkspaceView({ workspace: scratch() });

    fireEvent.click(await screen.findByTestId('workspace-view-relocate'));
    fireEvent.click(await screen.findByTestId('mock-folder-picker'));
    fireEvent.click(await dialogButton('Relocate'));

    await waitFor(() => expect(actionCalls(fetchMock, '/relocate')).toEqual([{ path: '/picked/dir' }]));
  });

  it('requires the typed confirmation before relocating main, then forces it', async () => {
    const { fetchMock } = renderWorkspaceView({ workspace: scratch({ kind: 'main', name: 'main' }) });

    fireEvent.click(await screen.findByTestId('workspace-view-relocate'));
    fireEvent.click(await screen.findByTestId('mock-folder-picker'));

    // The confirm button stays disabled until the workspace name is typed.
    expect(await dialogButton('Relocate')).toBeDisabled();
    expect(actionCalls(fetchMock, '/relocate')).toEqual([]);

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'main' } });
    fireEvent.click(await dialogButton('Relocate'));

    await waitFor(() => expect(actionCalls(fetchMock, '/relocate')).toEqual([{ path: '/picked/dir', force: true }]));
  });

  it('toggles favorite through the existing favorite route', async () => {
    const { fetchMock } = renderWorkspaceView({ workspace: scratch({ isFavorite: true }) });

    fireEvent.click(await screen.findByTestId('workspace-view-favorite'));

    await waitFor(() => expect(actionCalls(fetchMock, '/favorite')).toEqual([{ favorite: false }]));
  });

  it('surfaces a writer refusal instead of silently doing nothing', async () => {
    const { fetchMock } = renderWorkspaceView({ workspace: scratch() });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/relocate')) {
        return new Response(JSON.stringify({ error: 'Cannot relocate archived workspace' }), { status: 409 });
      }
      if (url === '/api/workspace-registry/ws-1') return Response.json(scratch());
      if (url === '/api/workspace-registry/ws-1/memory') return Response.json({ headline: null, status: null, observations: [] });
      if (url === '/api/conversations') return Response.json([]);
      return Response.json({});
    });

    fireEvent.click(await screen.findByTestId('workspace-view-relocate'));
    fireEvent.click(await screen.findByTestId('mock-folder-picker'));
    fireEvent.click(await dialogButton('Relocate'));

    expect(await screen.findByTestId('workspace-view-action-error')).toHaveTextContent('Cannot relocate archived workspace');
  });
});

describe('WorkspaceView main-workspace and cache invariants (PAN-3330 review)', () => {
  function main(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ws-1',
      projectId: 'overdeck',
      kind: 'main',
      name: 'main',
      path: '/repo',
      issueId: null,
      layoutConfig: null,
      title: null,
      isFavorite: false,
      pipeline: null,
      ...overrides,
    };
  }

  // FR-7 / WI-5 AC-1: all three actions for every non-issue kind, main included.
  it('offers Favorite, Relocate and Archive for the main workspace', async () => {
    renderWorkspaceView({ workspace: main() });

    expect(await screen.findByTestId('workspace-view-actions')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-view-favorite')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-view-relocate')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-view-archive')).toBeInTheDocument();
  });

  it('invalidates both the registry list and this workspace detail after a relocate', async () => {
    const { client } = renderWorkspaceView({
      workspace: { ...main({ kind: 'scratch', name: 'lens' }) },
    });
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');

    fireEvent.click(await screen.findByTestId('workspace-view-relocate'));
    fireEvent.click(await screen.findByTestId('mock-folder-picker'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Relocate' }));

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['workspace-registry'] }));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['workspace-registry', 'ws-1'] });
  });

  it('invalidates both keys after an archive', async () => {
    const { client } = renderWorkspaceView({
      workspace: { ...main({ kind: 'scratch', name: 'lens' }) },
    });
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');

    fireEvent.click(await screen.findByTestId('workspace-view-archive'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['workspace-registry'] }));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['workspace-registry', 'ws-1'] });
  });
});
