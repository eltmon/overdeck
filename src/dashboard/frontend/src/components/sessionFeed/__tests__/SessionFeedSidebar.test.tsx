import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { MemoryObservation } from '@panctl/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboardStore } from '../../../lib/store';
import { SESSION_FEED_TAB_STORAGE_KEY, SessionFeedSidebar } from '../SessionFeedSidebar';
import type { ConversationSessionFeedEntry, GitSessionFeedEntry } from '../types';

const hookSources = vi.hoisted(() => ({
  conversations: { entries: [] as ConversationSessionFeedEntry[], isLoading: false, error: null as Error | null },
  git: { entries: [] as GitSessionFeedEntry[], isLoading: false, error: null as Error | null },
}));

vi.mock('../useConversationFeed', () => ({
  useConversationFeed: () => hookSources.conversations,
}));

vi.mock('../useGitFeed', () => ({
  useGitFeed: () => hookSources.git,
}));

const now = new Date('2026-05-23T01:05:00.000Z');

function observation(id: string, timestamp: string, actionStatus: string | null, issueId = 'PAN-1389'): MemoryObservation {
  return {
    id,
    timestamp,
    projectId: 'panopticon-cli',
    workspaceId: `feature-${issueId.toLowerCase()}`,
    issueId,
    runId: 'run-1',
    sessionId: 'session-1',
    agentRole: 'work',
    agentHarness: 'claude-code',
    gitBranch: `feature/${issueId.toLowerCase()}`,
    sourceTranscriptOffset: 1,
    actionStatus,
    narrative: 'Narrative',
    summary: 'Summary',
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
    conversationName: '42',
    agent: 'claude_code',
    lastMessageDate: '2026-05-23T01:04:00.000Z',
    lastMessageSnippet: 'Conversation destination',
    ...overrides,
  };
}

describe('SessionFeedSidebar', () => {
  beforeEach(() => {
    window.history.pushState(null, '', '/');
    window.localStorage.clear();
    hookSources.conversations = { entries: [], isLoading: false, error: null };
    hookSources.git = { entries: [], isLoading: false, error: null };
    useDashboardStore.setState({ observationsByIssueId: {} });
  });

  it('renders the six tabs in reference order and calls onClose', () => {
    const onClose = vi.fn();
    render(<SessionFeedSidebar onClose={onClose} now={now} />);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'All',
      'Chats',
      'Files',
      'Git',
      'Comments',
      'Activity',
    ]);

    fireEvent.click(screen.getByLabelText('Close activity feed'));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders per-tab empty states and only shows the all-tab empty state when every wired source is empty', () => {
    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);

    expect(screen.getByTestId('session-feed-empty-all')).toHaveTextContent('No session activity yet.');

    fireEvent.click(screen.getByRole('tab', { name: 'Chats' }));
    expect(screen.getByTestId('session-feed-empty-chats')).toHaveTextContent('No chats yet.');

    fireEvent.click(screen.getByRole('tab', { name: 'Git' }));
    expect(screen.getByTestId('session-feed-empty-git')).toHaveTextContent('No git activity yet.');

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getByTestId('session-feed-empty-activity')).toHaveTextContent('No activity updates yet.');

    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(screen.getByTestId('session-feed-empty-files')).toHaveTextContent('Files feed coming soon.');

    fireEvent.click(screen.getByRole('tab', { name: 'Comments' }));
    expect(screen.getByTestId('session-feed-empty-comments')).toHaveTextContent('Comments feed coming soon.');
  });

  it('does not render the all-tab empty state when another wired source has entries', () => {
    hookSources.git = { entries: [gitEntry()], isLoading: false, error: null };

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
    expect(within(section as HTMLElement).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Newer activityfeature-pan-1389 · PAN-1389·1m ago',
      'Older activityfeature-pan-1389 · PAN-1389·3m ago',
    ]);
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
    window.localStorage.setItem(SESSION_FEED_TAB_STORAGE_KEY, 'git');

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);

    expect(screen.getByRole('tab', { name: 'Git' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));

    expect(window.localStorage.getItem(SESSION_FEED_TAB_STORAGE_KEY)).toBe('activity');
  });

  it('navigates conversation entries to their conversation route and dispatches popstate', () => {
    const onPopState = vi.fn();
    window.addEventListener('popstate', onPopState);
    hookSources.conversations = { entries: [conversationEntry()], isLoading: false, error: null };

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);
    fireEvent.click(screen.getByText('Claude Code').closest('button') as HTMLButtonElement);

    expect(window.location.pathname).toBe('/conv/42');
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
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    hookSources.git = { entries: [gitEntry()], isLoading: false, error: null };

    render(<SessionFeedSidebar onClose={vi.fn()} now={now} />);
    fireEvent.click(screen.getByText('Committed sidebar work').closest('button') as HTMLButtonElement);

    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('');
    expect(debug).toHaveBeenCalledOnce();
    debug.mockRestore();
  });
});
