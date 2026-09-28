import { act, cleanup, fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import type { MemoryObservation } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboardStore } from '../../../lib/store';
import { useAskUserQuestionUiStore } from '../../../lib/askUserQuestionUiStore';
import { installStrictFetchMock } from '../../../test-utils/strictFetchMock';
import { SESSION_FEED_TAB_STORAGE_KEY, SessionFeedSidebar, navigateToFeedEntry } from '../SessionFeedSidebar';
import type { ConversationSessionFeedEntry, GauntletRunSessionFeedEntry, GitSessionFeedEntry } from '../types';

// The sidebar's pending-input count now spans two domains: agents from the read
// model and conversations from the REST door, which it reads via react-query.
// Every call site renders through a provider so the union can be fetched.
let queryClients: QueryClient[] = [];
let fetchControl: ReturnType<typeof installStrictFetchMock>;

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(client);
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const hookSources = vi.hoisted(() => ({
  conversations: { entries: [] as ConversationSessionFeedEntry[], isLoading: false, error: null as Error | null },
  useConversationFeed: vi.fn(),
}));

vi.mock('../useConversationFeed', () => ({
  useConversationFeed: hookSources.useConversationFeed,
}));

const now = new Date('2026-05-23T01:05:00.000Z');

// The descriptive text is the observation `summary` (rendered as the headline);
// `actionStatus` holds the terse lifecycle token rendered as a chip (PAN-2040).
function observation(id: string, timestamp: string, summary: string, issueId = 'PAN-1389'): MemoryObservation {
  return {
    id,
    timestamp,
    projectId: 'overdeck',
    workspaceId: `feature-${issueId.toLowerCase()}`,
    issueId,
    runId: 'run-1',
    sessionId: 'session-1',
    agentRole: 'work',
    agentHarness: 'claude-code',
    gitBranch: `feature/${issueId.toLowerCase()}`,
    sourceTranscriptOffset: 1,
    actionStatus: 'in_progress',
    narrative: 'Narrative',
    summary,
    files: [],
    tags: [],
    tokens: { prompt: 1, completion: 1, total: 2 },
    model: 'stub-model',
  };
}

function gitEntry(overrides: Partial<GitSessionFeedEntry> = {}): GitSessionFeedEntry {
  return {
    kind: 'git',
    id: 'git-1',
    timestamp: '2026-05-23T01:04:00.000Z',
    workspaceId: null,
    issueId: 'PAN-1389',
    source: 'git-commit',
    level: 'info',
    message: 'Committed sidebar work',
    ...overrides,
  };
}

function conversationEntry(overrides: Partial<ConversationSessionFeedEntry> = {}): ConversationSessionFeedEntry {
  return {
    kind: 'conversation',
    id: 'conversation:conv-42',
    timestamp: '2026-05-23T01:04:00.000Z',
    workspaceId: '/workspace/a',
    issueId: 'PAN-1389',
    conversationId: 42,
    conversationName: '20260523-1234',
    agent: 'claude_code',
    lastMessageDate: '2026-05-23T01:04:00.000Z',
    lastMessageSnippet: 'Conversation destination',
    recencyAt: '2026-05-23T01:04:00.000Z',
    timestampLabel: 'started',
    sessionAlive: false,
    agentState: 'idle',
    projectKey: null,
    ...overrides,
  };
}

describe('SessionFeedSidebar', () => {
  beforeEach(() => {
    queryClients = [];
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/conversations/pending-input') {
        return Response.json([]);
      }
      return undefined;
    });
    window.history.pushState(null, '', '/');
    window.localStorage.clear();
    hookSources.conversations = { entries: [], isLoading: false, error: null };
    hookSources.useConversationFeed.mockImplementation(() => hookSources.conversations);
    hookSources.useConversationFeed.mockClear();
    useDashboardStore.setState({
      agentsById: {},
      channelPermissionRequestsById: {},
      issuesRaw: [],
      observationsByIssueId: {},
      recentActivity: [],
    });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(queryClients.map((client) => client.cancelQueries()));
    queryClients.forEach((client) => client.clear());
    await fetchControl.assertNoUnexpectedRequests();
    vi.unstubAllGlobals();
  });

  it('renders the All, Chats and Activity tabs only and calls onClose — PAN-4301 FR-16', () => {
    const onClose = vi.fn();
    render(<SessionFeedSidebar onClose={onClose} now={now} />);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'All',
      'Chats',
      'Activity',
    ]);

    fireEvent.click(screen.getByLabelText('Close activity feed'));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders per-tab empty states when every source is empty', () => {
    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);

    expect(screen.getByTestId('session-feed-empty-all')).toHaveTextContent('No session activity yet.');

    fireEvent.click(screen.getByRole('tab', { name: 'Chats' }));
    expect(screen.getByTestId('session-feed-empty-chats')).toHaveTextContent('No chats yet.');

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getByTestId('session-feed-empty-activity')).toHaveTextContent('No activity updates yet.');
  });

  it.each(['git', 'files', 'comments'])('falls back to All for a stored hidden tab %s', (stored) => {
    window.localStorage.setItem(SESSION_FEED_TAB_STORAGE_KEY, stored);

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);

    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    expect(window.localStorage.getItem(SESSION_FEED_TAB_STORAGE_KEY)).toBe('all');
  });

  it('shows the All empty state when every entry is outside the All window', () => {
    hookSources.conversations = {
      entries: [conversationEntry({ timestamp: '2026-05-21T01:00:00.000Z', recencyAt: '2026-05-23T01:04:00.000Z', sessionAlive: true })],
      isLoading: false,
      error: null,
    };

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);

    expect(screen.getByTestId('session-feed-empty-all')).toHaveTextContent('No session activity yet.');

    fireEvent.click(screen.getByRole('tab', { name: 'Chats' }));
    expect(screen.queryByTestId('session-feed-empty-chats')).toBeNull();
  });

  it('does not render the all-tab empty state when another wired source has entries', () => {
    useDashboardStore.setState({
      recentActivity: [
        {
          id: 'activity-entry-all',
          timestamp: '2026-05-23T01:04:00.000Z',
          source: 'work',
          level: 'info',
          message: 'Committed sidebar work',
          details: null,
          issueId: 'PAN-1389',
        },
      ],
    });

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);

    expect(screen.queryByTestId('session-feed-empty-all')).toBeNull();
    expect(screen.getByText('Committed sidebar work')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Chats' }));
    expect(screen.getByTestId('session-feed-empty-chats')).toHaveTextContent('No chats yet.');
  });

  it('renders contiguous group labels with entries newest-first within each group', () => {
    useDashboardStore.setState({
      observationsByIssueId: {
        'PAN-1389': [
          observation('older', '2026-05-23T01:02:00.000Z', 'Older activity'),
          observation('newer', '2026-05-23T01:04:00.000Z', 'Newer activity'),
        ],
      },
    });

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));

    const section = screen.getByText('Just Now').closest('section');
    expect(section).not.toBeNull();
    const entries = within(section as HTMLElement).getAllByTestId('activity-feed-card');
    expect(entries.map((entryEl) => entryEl.textContent)).toEqual([
      'Newer activityin_progressfeature-pan-1389 · PAN-1389·1m agoMemory',
      'Older activityin_progressfeature-pan-1389 · PAN-1389·3m agoMemory',
    ]);
    const badgeRow = within(entries[0]).getByTestId('notification-class-memory').parentElement;
    expect(badgeRow).toHaveTextContent('feature-pan-1389 · PAN-1389');
    expect(badgeRow).toHaveTextContent('1m ago');
  });

  it('renders activity entries from recentActivity even when memory observations are empty (PAN-1507)', () => {
    useDashboardStore.setState({
      observationsByIssueId: {},
      recentActivity: [
        {
          id: 'activity-entry-1',
          timestamp: '2026-05-23T01:04:00.000Z',
          source: 'work',
          level: 'info',
          message: 'Work agent committed task-3',
          details: null,
          issueId: 'PAN-1507',
        },
      ],
    });

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));

    expect(screen.queryByTestId('session-feed-empty-activity')).toBeNull();
    expect(screen.getByText('Work agent committed task-3')).toBeTruthy();
  });

  it('updates the Activity tab when observations change without remounting', () => {
    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));

    expect(screen.getByTestId('session-feed-empty-activity')).toBeTruthy();

    act(() => {
      useDashboardStore.setState({
        observationsByIssueId: {
          'PAN-1389': [observation('live', '2026-05-23T01:04:00.000Z', 'Live activity update')],
        },
      });
    });

    expect(screen.getByText('Live activity update')).toBeTruthy();
  });

  it('persists the active tab in localStorage and restores it on mount', () => {
    window.localStorage.setItem(SESSION_FEED_TAB_STORAGE_KEY, 'chats');

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);

    expect(screen.getByRole('tab', { name: 'Chats' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));

    expect(window.localStorage.getItem(SESSION_FEED_TAB_STORAGE_KEY)).toBe('activity');
  });

  it('navigates conversation entries to their conversation route and dispatches popstate', () => {
    const onPopState = vi.fn();
    window.addEventListener('popstate', onPopState);
    hookSources.conversations = { entries: [conversationEntry()], isLoading: false, error: null };

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);
    fireEvent.click(screen.getByText('Claude Code').closest('button') as HTMLButtonElement);

    expect(window.location.pathname).toBe('/conv/20260523-1234');
    expect(onPopState).toHaveBeenCalledOnce();
    window.removeEventListener('popstate', onPopState);
  });

  it('navigates activity entries to the command deck activity route for their issue', () => {
    const onPopState = vi.fn();
    window.addEventListener('popstate', onPopState);
    useDashboardStore.setState({
      observationsByIssueId: {
        'PAN-1389': [observation('activity-nav', '2026-05-23T01:04:00.000Z', 'Navigate to activity')],
      },
    });

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);
    fireEvent.click(screen.getByText('Navigate to activity').closest('button') as HTMLButtonElement);

    expect(window.location.pathname).toBe('/command-deck');
    expect(window.location.search).toBe('?issue=PAN-1389&tab=activity');
    expect(onPopState).toHaveBeenCalledOnce();
    window.removeEventListener('popstate', onPopState);
  });

  it('leaves git entry clicks as a no-op destination', () => {
    // PAN-4301 D11: the merged feed no longer carries git entries, so drive the
    // navigation seam directly.
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    navigateToFeedEntry(gitEntry());

    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('');
    expect(debug).toHaveBeenCalledOnce();
    debug.mockRestore();
  });

  it('shows system-wide activity (dashboard restarts) in project scope even when its issueId is outside the project', () => {
    useDashboardStore.setState({
      observationsByIssueId: {},
      recentActivity: [
        {
          id: 'restart-entry-1',
          timestamp: '2026-05-23T01:04:00.000Z',
          source: 'dashboard',
          level: 'info',
          message: 'Dashboard restarted via pan reload by conversation 2762 ("Some title") (31.0s)',
          details: null,
          issueId: 'RUN-23',
          link: '/conv/2762',
        },
        {
          id: 'project-entry-1',
          timestamp: '2026-05-23T01:03:00.000Z',
          source: 'work',
          level: 'info',
          message: 'Work agent committed task-3',
          details: null,
          issueId: 'OTHER-99',
        },
      ],
    });

    // Project scope limited to PAN-1389 — neither entry's issueId matches.
    render(<SessionFeedSidebar onClose={vi.fn()} now={now} issueIds={['PAN-1389']} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));

    // The restart (system-wide) survives the scope filter; the work entry does not.
    expect(screen.getByText(/Dashboard restarted via pan reload/)).toBeTruthy();
    expect(screen.queryByText('Work agent committed task-3')).toBeNull();
  });

  it('navigates restart entries to their initiator conversation via the link field', () => {
    const onPopState = vi.fn();
    window.addEventListener('popstate', onPopState);
    useDashboardStore.setState({
      observationsByIssueId: {},
      recentActivity: [
        {
          id: 'restart-entry-2',
          timestamp: '2026-05-23T01:04:00.000Z',
          source: 'dashboard',
          level: 'info',
          message: 'Dashboard restarted via pan reload by conversation 2762 ("Some title") (31.0s)',
          details: null,
          issueId: 'RUN-23',
          link: '/conv/2762',
        },
      ],
    });

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);
    fireEvent.click(
      screen.getByText(/Dashboard restarted via pan reload/).closest('button') as HTMLButtonElement,
    );

    expect(window.location.pathname).toBe('/conv/2762');
    expect(onPopState).toHaveBeenCalledOnce();
    window.removeEventListener('popstate', onPopState);
  });

  it('shows the issue identifier and title while preserving question deduplication', () => {
    const pendingAskUserQuestion = {
      toolUseId: 'toolu-shared',
      askedAt: '2026-05-23T01:04:00.000Z',
      questions: [{ question: 'Which option should I use?', options: [{ label: 'A' }] }],
    };
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-3097-a': {
          id: 'agent-pan-3097-a',
          issueId: 'PAN-3097',
          pendingInputKinds: ['askUserQuestion'],
          pendingAskUserQuestion,
        },
        'agent-pan-3097-b': {
          id: 'agent-pan-3097-b',
          issueId: 'PAN-3097',
          pendingInputKinds: ['askUserQuestion'],
          pendingAskUserQuestion,
        },
      },
      issuesRaw: [{ id: 'PAN-3097', title: 'Add question context' }],
    } as Parameters<typeof useDashboardStore.setState>[0]);

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);

    expect(screen.getByText('PAN-3097 — Add question context')).toBeTruthy();
    expect(screen.getAllByText('Which option should I use?')).toHaveLength(1);
  });

  // PAN-3276 — a "Needs you" row used to only call requestReopen, which is a
  // no-op for kinds carrying no dialog payload (a question typed into the
  // terminal, a permission prompt). Clicking those rows appeared to do nothing.
  it('navigates to the issue when an agent needs-you row is clicked', async () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-1837': {
          id: 'agent-pan-1837',
          issueId: 'PAN-1837',
          // paneQuestion carries no answerable payload — the navigation IS the fix.
          pendingInputKinds: ['paneQuestion'],
        },
      },
      issuesRaw: [{ id: 'PAN-1837', title: 'Stop stranding review rework' }],
    } as Parameters<typeof useDashboardStore.setState>[0]);

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('needs-you-row-agent-pan-1837'));
    });

    expect(window.location.pathname).toBe('/issues/PAN-1837');
  });

  it('navigates to the conversation when a conversation needs-you row is clicked', async () => {
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/conversations/pending-input') {
        return Response.json([
          {
            name: 'conv-20260728-5277',
            title: 'Web app deployment fixed and live',
            pendingInputKinds: ['permissionRequest'],
          },
        ]);
      }
      return undefined;
    });

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);

    const row = await screen.findByTestId('needs-you-row-conv-20260728-5277');
    await act(async () => {
      fireEvent.click(row);
    });

    // A conversation is not a row in the agents table, so it must route to
    // /conv/<name> rather than an issue.
    expect(window.location.pathname).toBe('/conv/conv-20260728-5277');
  });

  it('Needs you shows waiting <elapsed> and puts the oldest permission first', async () => {
    const permission = (agentLabel: string, since: string) => ({
      signature: `sig-${since}`, answerable: true, agentLabel, agentKey: null, toolName: 'Bash', header: 'Bash command',
      detailLines: [], reason: null, options: [], since,
    });
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/conversations/pending-input') {
        return Response.json([
          { name: 'conv-newer', title: 'Newer', pendingPermission: permission('Main agent', '2026-05-23T01:00:00.000Z') },
          { name: 'conv-older', title: 'Older', pendingPermission: permission('Subagent: Orca study', '2026-05-22T18:05:00.000Z') },
        ]);
      }
      return undefined;
    });

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);

    const older = await screen.findByTestId('needs-you-row-conv-older');
    expect(within(older).getByText('Subagent: Orca study · Bash')).toBeInTheDocument();
    expect(within(older).getByText('waiting 7h ago')).toBeInTheDocument();
    expect(within(screen.getByTestId('needs-you-row-conv-newer')).getByText('waiting 5m ago')).toBeInTheDocument();
    const rows = screen.getAllByTestId(/^needs-you-row-/).map((el) => el.getAttribute('data-testid'));
    expect(rows).toEqual(['needs-you-row-conv-older', 'needs-you-row-conv-newer']);
  });

  it('still requests the dialog reopen so a payload-carrying question keeps answering in place', async () => {
    const askedAt = '2026-05-23T01:04:00.000Z';
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-3231': {
          id: 'agent-pan-3231',
          issueId: 'PAN-3231',
          pendingInputKinds: ['askUserQuestion'],
          pendingAskUserQuestion: {
            toolUseId: 'toolu-reopen',
            askedAt,
            questions: [{ question: 'Which option should I use?', options: [{ label: 'A' }] }],
          },
        },
      },
      issuesRaw: [{ id: 'PAN-3231', title: 'A question with a payload' }],
    } as Parameters<typeof useDashboardStore.setState>[0]);

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('needs-you-row-agent-pan-3231'));
    });

    expect(useAskUserQuestionUiStore.getState().reopenId).toBe('agent-pan-3231');
    expect(window.location.pathname).toBe('/issues/PAN-3231');
  });

  it('falls back to the agent id for an unbound pending-input subject', () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-unbound': {
          id: 'agent-unbound',
          pendingInputKinds: ['rateLimit'],
        },
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);

    expect(screen.getByText('agent-unbound')).toBeTruthy();
  });
});

describe('navigateToFeedEntry', () => {
  function gauntletRunEntry(overrides: Partial<GauntletRunSessionFeedEntry> = {}): GauntletRunSessionFeedEntry {
    return {
      kind: 'gauntlet_run',
      id: 'gauntlet-run:lexerra:india',
      timestamp: '2026-09-28T10:00:00.000Z',
      workspaceId: null,
      issueId: null,
      run: 'india',
      projectKey: 'lexerra',
      orchestratorName: 'conv-2884',
      orchestratorTitle: 'Lexerra gauntlet',
      countsLine: '1 builder · 1 working',
      state: 'working',
      latest: { text: 'alpha builder launched', at: '2026-09-28T10:00:00.000Z' },
      lanes: [{
        id: 7,
        name: 'conv-lane-alpha',
        key: 'alpha',
        role: 'builder',
        iteration: 1,
        activity: 'working',
        report: null,
        criticOfConversationId: null,
        createdAt: '2026-09-28T10:00:00.000Z',
      }],
      laneConversationIds: [7],
      anyAlive: true,
      ...overrides,
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes a gauntlet run card to its orchestrator conversation', () => {
    const pushState = vi.spyOn(window.history, 'pushState');

    navigateToFeedEntry(gauntletRunEntry());

    expect(pushState).toHaveBeenCalledWith(null, '', '/conv/conv-2884');
  });

  it('routes a gauntlet run card without an orchestrator to its first lane', () => {
    const pushState = vi.spyOn(window.history, 'pushState');

    navigateToFeedEntry(gauntletRunEntry({ orchestratorName: null }));

    expect(pushState).toHaveBeenCalledWith(null, '', '/conv/conv-lane-alpha');
  });
});
