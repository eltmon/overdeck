import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../lib/store';
import { installStrictFetchMock } from '../test-utils/strictFetchMock';
import type { Agent, Issue } from '../types';
import { CommandPalette, PALETTE_CONVERSATIONS_NEWEST_FIRST_KEY } from './CommandPalette';

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: overrides.identifier ?? 'PAN-0',
    identifier: overrides.identifier ?? 'PAN-0',
    title: overrides.title ?? 'Issue title',
    status: overrides.status ?? 'Todo',
    priority: overrides.priority ?? 3,
    labels: overrides.labels ?? [],
    url: `https://example.com/${overrides.identifier ?? 'PAN-0'}`,
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
    ...overrides,
  };
}

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: overrides.id ?? 'agent-pan-42',
    issueId: overrides.issueId ?? 'PAN-42',
    role: 'work',
    status: 'running',
    model: 'opus',
    runtime: 'claude-code',
    startedAt: '2026-05-18T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

function renderCommandPalette() {
  return render(<CommandPalette isOpen onClose={vi.fn()} onNavigate={vi.fn()} />);
}

function renderPalette() {
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  render(<CommandPalette isOpen onClose={onClose} onNavigate={onNavigate} />);
  return { onClose, onNavigate };
}

function selectPaletteResult(result: HTMLElement) {
  fireEvent.click(result);
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

// Cmdk renders each row with `data-value` = the item's stable id. Using it
// avoids the accessible-name flakiness introduced by the <Highlighted>
// component, which splits text across multiple spans.
function getOptionByValue(value: string): HTMLElement {
  const el = document.querySelector(`[role="option"][data-value="${value}"]`);
  if (!el) throw new Error(`No palette option with data-value="${value}"`);
  return el as HTMLElement;
}

let fetchControl: ReturnType<typeof installStrictFetchMock>;

beforeEach(() => {
  localStorage.removeItem(PALETTE_CONVERSATIONS_NEWEST_FIRST_KEY);
  fetchControl = installStrictFetchMock(({ method, url }) => {
    if (method === 'GET' && url === '/api/palette/commands') {
      return Response.json({ commands: [] });
    }
    if (method === 'GET' && url === '/api/workspace-registry') {
      return Response.json({ workspaces: [] });
    }
    if (method === 'GET' && url.startsWith('/api/palette/search')) {
      return Response.json({ observations: [], conversations: [], memory: [], summaries: [] });
    }
    return undefined;
  });
});

afterEach(async () => {
  await fetchControl.assertNoUnexpectedRequests();
  vi.unstubAllGlobals();
});

describe('CommandPalette issue results', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', '/');
    useDashboardStore.setState({
      drawer: { issueId: null, tab: 'overview' },
      issuesRaw: [issue({ identifier: 'PAN-42', title: 'Alpha command issue' })],
      agentsById: {
        'agent-pan-42': agent({
          id: 'agent-pan-42',
          issueId: 'PAN-42',
          git: { branch: 'feature/pan-42-command', uncommittedFiles: 0, latestCommit: 'init' },
        }),
      },
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the drawer from an issue ID search result', () => {
    renderCommandPalette();

    fireEvent.change(screen.getByPlaceholderText('Search commands, issues, conversations, memory…'), { target: { value: 'PAN-42' } });
    selectPaletteResult(screen.getAllByText('PAN-42')[0]);

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-42', tab: 'conversation' });
    expect(window.location.search).toBe('?issue=PAN-42&tab=conversation');
  });

  it('opens the drawer from a branch search result for the owning issue', () => {
    renderCommandPalette();

    fireEvent.change(screen.getByPlaceholderText('Search commands, issues, conversations, memory…'), { target: { value: 'feature/pan-42-command' } });
    selectPaletteResult(getOptionByValue('issue-PAN-42'));

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-42', tab: 'conversation' });
    expect(window.location.search).toBe('?issue=PAN-42&tab=conversation');
  });

  it('opens the drawer from a title fragment search result', () => {
    renderCommandPalette();

    fireEvent.change(screen.getByPlaceholderText('Search commands, issues, conversations, memory…'), { target: { value: 'Alpha command' } });
    selectPaletteResult(getOptionByValue('issue-PAN-42'));

    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-42', tab: 'conversation' });
    expect(window.location.search).toBe('?issue=PAN-42&tab=conversation');
  });
});

describe('CommandPalette conversation results', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useDashboardStore.setState({ issuesRaw: [], agentsById: {} } as Parameters<typeof useDashboardStore.setState>[0]);
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/palette/commands') {
        return Response.json({ commands: [] });
      }
      if (method === 'GET' && url === '/api/workspace-registry') {
        return Response.json({ workspaces: [] });
      }
      if (method === 'GET' && url.startsWith('/api/palette/search')) {
        return Response.json({
          observations: [],
          conversations: [{
            sessionId: 'session-a',
            conversationId: 'session-a',
            projectId: '-home-eltmon-Projects-overdeck-workspaces-feature-pan-1896',
            projectKey: 'overdeck',
            role: 'assistant',
            ts: '2026-06-02T01:00:00.000Z',
            byteOffset: 42,
            displayContent: 'semantic transcript hit',
            excerpt: 'before ⦇needle⦈ after',
            excerptSegments: [
              { text: 'before ', match: false },
              { text: 'needle', match: true },
              { text: ' after', match: false },
            ],
            rank: 1,
          }],
          memory: [{
            kind: 'memory',
            id: 'mem-a',
            projectId: 'overdeck',
            workspaceId: '',
            issueId: '',
            timestamp: '2026-06-02T01:00:00.000Z',
            displayContent: 'memory hit',
            excerpt: 'memory excerpt',
            excerptSegments: [{ kind: 'text', value: 'memory excerpt' }],
            tags: [],
            docType: 'memory',
            rank: 1,
          }],
          summaries: [],
        });
      }
      return undefined;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders conversations above memory with excerpt highlights', async () => {
    renderCommandPalette();

    fireEvent.change(screen.getByPlaceholderText('Search commands, issues, conversations, memory…'), { target: { value: 'needle' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    // 'Conversations'/'Memory' also appear as filter pill buttons — scope the
    // assertions to the cmdk group headings.
    const groupHeading = (label: string) => {
      const heading = screen
        .getAllByText(label)
        .find((el) => el.hasAttribute('cmdk-group-heading'));
      expect(heading).toBeTruthy();
      return heading!;
    };

    const conversationsHeading = groupHeading('Conversations');
    expect(screen.getByText('semantic transcript hit')).toBeInTheDocument();
    expect(screen.getByText('needle')).toBeInTheDocument();
    expect(screen.getByText('overdeck · feature-pan-1896')).toBeInTheDocument();
    expect(screen.getByText('PAN-1896')).toBeInTheDocument();
    expect(screen.getByText('Claude session session-')).toBeInTheDocument();

    const memoryHeading = groupHeading('Memory');
    expect(conversationsHeading.compareDocumentPosition(memoryHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens a selected conversation hit with its byte offset', async () => {
    const onOpenConversationHit = vi.fn();
    render(
      <CommandPalette
        isOpen
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        onOpenConversationHit={onOpenConversationHit}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Search commands, issues, conversations, memory…'), { target: { value: 'needle' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    fireEvent.click(getOptionByValue('conv-session-a-42'));
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(onOpenConversationHit).toHaveBeenCalledWith({
      sessionId: 'session-a',
      conversationId: 'session-a',
      projectId: '-home-eltmon-Projects-overdeck-workspaces-feature-pan-1896',
      projectKey: 'overdeck',
      byteOffset: 42,
      label: 'semantic transcript hit',
      sourceLabel: 'Claude session session-',
    });
  });
});

describe('CommandPalette newest-first conversation toggle (PAN-3704)', () => {
  const conversation = (id: string, rank: number, ts: string | null) => ({
    sessionId: id,
    conversationId: id,
    projectId: 'overdeck',
    projectKey: 'overdeck',
    role: 'assistant',
    ts,
    byteOffset: rank,
    displayContent: id,
    excerpt: id,
    excerptSegments: [{ text: id, match: true }],
    rank,
  });

  const installConversationResults = (conversations: ReturnType<typeof conversation>[]) => {
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/palette/commands') return Response.json({ commands: [] });
      if (method === 'GET' && url === '/api/workspace-registry') return Response.json({ workspaces: [] });
      if (method === 'GET' && url.startsWith('/api/palette/search')) {
        return Response.json({ observations: [], conversations, memory: [], summaries: [] });
      }
      return undefined;
    });
  };

  const search = async () => {
    fireEvent.change(screen.getByPlaceholderText('Search commands, issues, conversations, memory…'), { target: { value: 'conversation' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
  };

  const optionLabels = () => Array.from(document.querySelectorAll('[role="option"][data-value^="conv-"]'))
    .map((option) => option.getAttribute('data-value'));

  beforeEach(() => {
    vi.useFakeTimers();
    useDashboardStore.setState({ issuesRaw: [], agentsById: {} } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders conversation hits newest-first by default', async () => {
    installConversationResults([
      conversation('oldest', 1, '2026-01-01T00:00:00Z'),
      conversation('newest', 3, '2026-03-01T00:00:00Z'),
      conversation('middle', 2, '2026-02-01T00:00:00Z'),
    ]);
    renderCommandPalette();
    await search();
    expect(optionLabels()).toEqual(['conv-newest-3', 'conv-middle-2', 'conv-oldest-1']);
  });

  it('restores rank order and persists false when toggled off', async () => {
    installConversationResults([
      conversation('older', 1, '2026-01-01T00:00:00Z'),
      conversation('newer', 2, '2026-02-01T00:00:00Z'),
    ]);
    renderCommandPalette();
    await search();
    fireEvent.click(screen.getByRole('button', { name: 'Newest first' }));
    expect(optionLabels()).toEqual(['conv-older-1', 'conv-newer-2']);
    expect(localStorage.getItem(PALETTE_CONVERSATIONS_NEWEST_FIRST_KEY)).toBe('false');
  });

  it('honors a stored false preference on mount', async () => {
    localStorage.setItem(PALETTE_CONVERSATIONS_NEWEST_FIRST_KEY, 'false');
    installConversationResults([
      conversation('older', 1, '2026-01-01T00:00:00Z'),
      conversation('newer', 2, '2026-02-01T00:00:00Z'),
    ]);
    renderCommandPalette();
    await search();
    expect(optionLabels()).toEqual(['conv-older-1', 'conv-newer-2']);
  });

  it('uses rank for equal timestamps and places missing timestamps last', async () => {
    installConversationResults([
      conversation('equal-high-rank', 3, '2026-02-01T00:00:00Z'),
      conversation('missing', 1, null),
      conversation('equal-low-rank', 2, '2026-02-01T00:00:00Z'),
    ]);
    renderCommandPalette();
    await search();
    expect(optionLabels()).toEqual(['conv-equal-low-rank-2', 'conv-equal-high-rank-3', 'conv-missing-1']);
  });

  it('exposes and updates its pressed state accessibly', () => {
    renderCommandPalette();
    const toggle = screen.getByRole('button', { name: 'Newest first' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('preserves non-conversation action ordering in both states', () => {
    renderCommandPalette();
    const actionValues = () => Array.from(document.querySelectorAll('[role="option"]'))
      .map((option) => option.getAttribute('data-value'))
      .filter((value) => value === 'pan-flywheel' || value === 'start-cloister');
    expect(actionValues()).toEqual(['pan-flywheel', 'start-cloister']);
    fireEvent.click(screen.getByRole('button', { name: 'Newest first' }));
    expect(actionValues()).toEqual(['pan-flywheel', 'start-cloister']);
  });
});

describe('CommandPalette navigation actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows /pan-flywheel action when searching for flywheel and navigates to the Flywheel page', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderPalette();

    await user.type(screen.getByPlaceholderText('Search commands, issues, conversations, memory…'), 'flywheel');

    expect(screen.getByText('Actions')).toBeInTheDocument();
    const flywheelOption = getOptionByValue('pan-flywheel');
    expect(flywheelOption).toBeInTheDocument();

    await user.click(flywheelOption);

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('flywheel');
    });
  });

  it('shows Context navigation and opens the Context page', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderPalette();

    await user.type(screen.getByPlaceholderText('Search commands, issues, conversations, memory…'), 'context');

    expect(screen.getByText('Navigation')).toBeInTheDocument();
    const contextOption = getOptionByValue('open-context');
    expect(contextOption).toBeInTheDocument();

    await user.click(contextOption);

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('context');
    });
  });
});

describe('CommandPalette workspaces switcher (PAN-1990)', () => {
  // `ws-issue` is favorited because PAN-3286 FR-13 keeps NON-favorited pipeline
  // worktrees out of this switcher; favoriting it preserves what these three
  // cases actually test (ordering, query matching, selection) with an issue-kind
  // row still present. The hiding behavior itself is covered in
  // workspace-rail-filter.test.tsx.
  const WORKSPACES = [
    { id: 'ws-old', projectId: 'overdeck', kind: 'scratch', name: 'old-scratch', issueId: null, isFavorite: false, isArchived: false, title: null, lastAccessedAt: 100 },
    { id: 'ws-fav', projectId: 'overdeck', kind: 'scratch', name: 'fav-scratch', issueId: null, isFavorite: true, isArchived: false, title: null, lastAccessedAt: 50 },
    { id: 'ws-issue', projectId: 'overdeck', kind: 'issue', name: 'feature-pan-9001', issueId: 'PAN-9001', isFavorite: true, isArchived: false, title: null, lastAccessedAt: 200 },
  ];

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    useDashboardStore.setState({ issuesRaw: [], agentsById: {} } as Parameters<typeof useDashboardStore.setState>[0]);
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/palette/commands') return Response.json({ commands: [] });
      if (method === 'GET' && url === '/api/workspace-registry') return Response.json({ workspaces: WORKSPACES });
      if (method === 'POST' && url === '/api/workspace-registry/ws-issue/activate') return Response.json({});
      if (method === 'POST' && url === '/api/workspace-registry/ws-issue/run') {
        return Response.json({ sessionName: 'ws-run-wsissue', command: 'npm run dev' });
      }
      return undefined;
    });
  });

  function renderPaletteWithWorkspace() {
    const onSelectWorkspace = vi.fn();
    render(<CommandPalette isOpen onClose={vi.fn()} onNavigate={vi.fn()} onSelectWorkspace={onSelectWorkspace} />);
    return { onSelectWorkspace };
  }

  it('ac1: lists workspaces favorites-first then most-recent-first on open', async () => {
    renderPaletteWithWorkspace();

    await waitFor(() => expect(getOptionByValue('workspace-ws-fav')).toBeInTheDocument());
    const options = [
      getOptionByValue('workspace-ws-issue'),
      getOptionByValue('workspace-ws-fav'),
      getOptionByValue('workspace-ws-old'),
    ];
    const order = options.map((o) => o.getAttribute('data-value'));
    // Both favorites first, most-recent among them leading, then non-favorites.
    expect(order).toEqual(['workspace-ws-issue', 'workspace-ws-fav', 'workspace-ws-old']);
  });

  it('ac2: typed input shows only matching workspaces', async () => {
    const user = userEvent.setup();
    renderPaletteWithWorkspace();
    await waitFor(() => expect(getOptionByValue('workspace-ws-fav')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('Search commands, issues, conversations, memory…'), 'feature-pan-9001');

    await waitFor(() => expect(getOptionByValue('workspace-ws-issue')).toBeInTheDocument());
    expect(document.querySelector('[data-value="workspace-ws-old"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-value="workspace-ws-fav"]')).not.toBeInTheDocument();
  });

  it('ac3: selecting a workspace activates it and opens its view', async () => {
    const { onSelectWorkspace } = renderPaletteWithWorkspace();
    await waitFor(() => expect(getOptionByValue('workspace-ws-issue')).toBeInTheDocument());

    fireEvent.click(getOptionByValue('workspace-ws-issue'));

    await waitFor(() => {
      expect(onSelectWorkspace).toHaveBeenCalledWith('ws-issue');
    });
    expect(fetchControl.fetchMock).toHaveBeenCalledWith(
      '/api/workspace-registry/ws-issue/activate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  // PAN-3331 D-10 / FR-8. Review cycle 3: it used to emit BOTH group rows
  // unconditionally, so the default `all` view listed the action twice.
  it('offers exactly one run-workspace-command row in the default scope', async () => {
    renderPaletteWithWorkspace();

    await waitFor(() => expect(getOptionByValue('run-workspace-command-actions')).toBeInTheDocument());
    expect(document.querySelectorAll('[role="option"][data-value^="run-workspace-command"]')).toHaveLength(1);
    // Names the workspace it would act on, so the target is never a guess.
    expect(getOptionByValue('run-workspace-command-actions')).toHaveTextContent('feature-pan-9001');
  });

  it('moves the action under Workspaces when the operator filters to that scope, still as one row', async () => {
    renderPaletteWithWorkspace();
    await waitFor(() => expect(getOptionByValue('run-workspace-command-actions')).toBeInTheDocument());

    // The scope chips are buttons labelled with the scope name.
    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));

    await waitFor(() => expect(getOptionByValue('run-workspace-command-workspaces')).toBeInTheDocument());
    expect(document.querySelectorAll('[role="option"][data-value^="run-workspace-command"]')).toHaveLength(1);
  });

  // Review finding: the target used to be visibleWorkspaceRows[0], which sorts
  // favorites first and hides collapsed issue worktrees.
  it('targets the newest workspace even when an older one is favorited', async () => {
    renderPaletteWithWorkspace();

    // ws-issue (lastAccessedAt 200) is newer than the favorited ws-fav (50).
    await waitFor(() =>
      expect(getOptionByValue('run-workspace-command-actions')).toHaveTextContent('feature-pan-9001'));
  });

  it('still offers the action when every row is a collapsed pipeline worktree', async () => {
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/palette/commands') return Response.json({ commands: [] });
      if (method === 'GET' && url === '/api/workspace-registry') {
        return Response.json({
          workspaces: [
            { id: 'ws-hidden', projectId: 'overdeck', kind: 'issue', name: 'feature-pan-9002', issueId: 'PAN-9002', isFavorite: false, isArchived: false, title: null, lastAccessedAt: 300 },
          ],
        });
      }
      if (method === 'POST' && url === '/api/workspace-registry/ws-hidden/run') {
        return Response.json({ sessionName: 'ws-run-wshidden', command: 'npm run dev' });
      }
      return undefined;
    });
    renderPaletteWithWorkspace();

    await waitFor(() =>
      expect(getOptionByValue('run-workspace-command-actions')).toHaveTextContent('feature-pan-9002'));
  });

  it('ignores archived workspaces when picking the target', async () => {
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/palette/commands') return Response.json({ commands: [] });
      if (method === 'GET' && url === '/api/workspace-registry') {
        return Response.json({
          workspaces: [
            { id: 'ws-archived', projectId: 'overdeck', kind: 'scratch', name: 'archived-scratch', issueId: null, isFavorite: false, isArchived: true, title: null, lastAccessedAt: 900 },
            { id: 'ws-live', projectId: 'overdeck', kind: 'scratch', name: 'live-scratch', issueId: null, isFavorite: false, isArchived: false, title: null, lastAccessedAt: 100 },
          ],
        });
      }
      return undefined;
    });
    renderPaletteWithWorkspace();

    await waitFor(() =>
      expect(getOptionByValue('run-workspace-command-actions')).toHaveTextContent('live-scratch'));
  });

  it('starts the run command for the most recently used workspace and opens its view', async () => {
    const { onSelectWorkspace } = renderPaletteWithWorkspace();
    await waitFor(() => expect(getOptionByValue('run-workspace-command-actions')).toBeInTheDocument());

    fireEvent.click(getOptionByValue('run-workspace-command-actions'));

    await waitFor(() => {
      expect(fetchControl.fetchMock).toHaveBeenCalledWith(
        '/api/workspace-registry/ws-issue/run',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    await waitFor(() => expect(onSelectWorkspace).toHaveBeenCalledWith('ws-issue'));
  });
});

describe('CommandPalette new-workspace action (PAN-3330 FR-6b)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useDashboardStore.setState({ issuesRaw: [], agentsById: {} } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  it('opens the dialog through the callback rather than calling an API', () => {
    const onNewWorkspace = vi.fn();
    render(<CommandPalette isOpen onClose={vi.fn()} onNavigate={vi.fn()} onNewWorkspace={onNewWorkspace} />);

    selectPaletteResult(getOptionByValue('new-workspace'));

    expect(onNewWorkspace).toHaveBeenCalledTimes(1);
  });

  it('keeps the action visible under both the Actions and Workspaces scope chips', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} onNavigate={vi.fn()} onNewWorkspace={vi.fn()} />);

    for (const scope of ['Actions', 'Workspaces']) {
      fireEvent.click(screen.getByRole('button', { name: scope }));
      expect(getOptionByValue('new-workspace')).toBeDefined();
    }
  });

  it('omits the action entirely when no handler is supplied', () => {
    render(<CommandPalette isOpen onClose={vi.fn()} onNavigate={vi.fn()} />);

    expect(getOptionByValue('pan-flywheel')).toBeDefined();
    expect(document.querySelector('[role="option"][data-value="new-workspace"]')).toBeNull();
  });
});
