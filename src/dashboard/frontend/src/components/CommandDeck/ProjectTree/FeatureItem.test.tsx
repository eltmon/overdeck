import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import type { SessionNode as SessionNodeType } from '@overdeck/contracts';
import { DialogProvider } from '../../DialogProvider';
import { FeatureItem, pickBestSession } from './FeatureItem';
import type { ProjectFeature, ProjectFeatureResourceIdentifiers } from './ProjectNode';
import { resolveUatActions } from '../uat-actions';

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    ChevronRight: (props: Record<string, unknown>) => <svg data-testid="chevron-right" {...props} />,
    ChevronDown: (props: Record<string, unknown>) => <svg data-testid="chevron-down" {...props} />,
    Loader2: () => <svg data-testid="loader" />,
    AlertTriangle: () => <svg data-testid="alert" />,
    CheckCircle2: () => <svg data-testid="check" />,
    Circle: () => <svg data-testid="circle" />,
    Eye: () => <svg data-testid="eye" />,
    Layers: () => <svg data-testid="layers" />,
    GitMerge: () => <svg data-testid="merge" />,
    GitBranch: () => <svg data-testid="git-branch" />,
    BookText: () => <svg data-testid="book-text" />,
    Bug: () => <svg data-testid="bug" />,
    Container: () => <svg data-testid="container" />,
    Radio: () => <svg data-testid="radio" />,
    Workflow: () => <svg data-testid="workflow" />,
  };
});

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn(), refetchQueries: vi.fn() }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock('../../shared/ModelPicker/ModelPicker', () => ({
  useAvailableModels: () => ({ groups: [] }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../../../lib/refresh-dashboard-state', () => ({
  refreshDashboardState: vi.fn(),
}));

vi.mock('./SessionNode', () => ({
  SessionNode: ({ session, isSelected, onClick }: {
    session: SessionNodeType;
    isSelected?: boolean;
    onClick?: () => void;
  }) => (
    <button
      data-testid={`session-${session.sessionId}`}
      data-selected={isSelected ? 'true' : 'false'}
      onClick={onClick}
    >
      {session.sessionId}
    </button>
  ),
}));

vi.mock('../styles/command-deck.module.css', () => ({
  default: {
    spinning: 'spinning',
    featureItemWrapper: 'featureItemWrapper',
    featureItemWrapperSelected: 'featureItemWrapperSelected',
    featureItemWrapperPaused: 'featureItemWrapperPaused',
    featureBadge_paused: 'featureBadge_paused',
    unpauseBtn: 'unpauseBtn',
    featureItemRow: 'featureItemRow',
    featureItemCaret: 'featureItemCaret',
    featureItemCaretPlaceholder: 'featureItemCaretPlaceholder',
    featureItem: 'featureItem',
    featureItemSelected: 'featureItemSelected',
    featureStatus: 'featureStatus',
    featureId_sidebar: 'featureId_sidebar',
    featureLabel: 'featureLabel',
    featureLabelUntitled: 'featureLabelUntitled',
    featureBadgeGroup: 'featureBadgeGroup',
    featureBadge: 'featureBadge',
    featureBadge_running: 'featureBadge_running',
    featureBadge_stopped: 'featureBadge_stopped',
    featureBadge_error: 'featureBadge_error',
    featureActivityError: 'featureActivityError',
    featureState: 'featureState',
    featureState_done: 'featureState_done',
    featureState_progress: 'featureState_progress',
    featureState_review: 'featureState_review',
    featureState_context: 'featureState_context',
    featureState_planning: 'featureState_planning',
    featureState_todo: 'featureState_todo',
    featureCost: 'featureCost',
    featureResourceStrip: 'featureResourceStrip',
    featureResourceIcon: 'featureResourceIcon',
    featureResourcePopover: 'featureResourcePopover',
    featureResourcePopoverOpenUpward: 'featureResourcePopoverOpenUpward',
    featureResourceRow: 'featureResourceRow',
    featureResourceCleanupButton: 'featureResourceCleanupButton',
    sessionList: 'sessionList',
    sessionNode: 'sessionNode',
    sessionNodeSelected: 'sessionNodeSelected',
  },
}));

function makeFeature(overrides?: Partial<ProjectFeature>): ProjectFeature {
  return {
    issueId: 'PAN-821',
    title: 'Test Feature',
    projectName: 'test-project',
    branch: 'feature/pan-821',
    status: 'has_state',
    stateLabel: 'In Progress',
    agentStatus: null,
    hasPlanning: true,
    hasPrd: true,
    hasState: true,
    isShadow: false,
    isRally: false,
    resourceSources: [],
    resourceDetails: {
      hasWorkspace: false,
      workspacePaths: [],
      localBranchCount: 0,
      localBranchNames: [],
      remoteBranchCount: 0,
      remoteBranchNames: [],
      tmuxSessionCount: 0,
      tmuxSessionNames: [],
      prs: [],
      hasVbrief: false,
      hasBeads: false,
      dockerContainerCount: 0,
      dockerContainerNames: [],
    },
    ...overrides,
  };
}

function makeSession(overrides?: Partial<SessionNodeType>): SessionNodeType {
  return {
    type: 'work',
    sessionId: 'agent-pan-821',
    model: 'claude-sonnet-4-6',
    startedAt: new Date().toISOString(),
    duration: 120,
    status: 'running',
    presence: 'active',
    ...overrides,
  };
}

function renderFeature(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DialogProvider>{ui}</DialogProvider>
    </QueryClientProvider>,
  );
}

function stubWorkspace(workspace: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/workspaces/PAN-821') {
      return {
        ok: true,
        json: async () => workspace,
      };
    }
    return {
      ok: true,
      json: async () => ({
        workspacePaths: [],
        localBranchNames: [],
        remoteBranchNames: [],
        tmuxSessionNames: [],
        prs: [],
        dockerContainerNames: [],
      } satisfies ProjectFeatureResourceIdentifiers),
    };
  }));
}

function renderReadyForMergeFeature() {
  return renderFeature(
    <FeatureItem
      feature={makeFeature({
        stateLabel: 'In Review',
        readyForMerge: true,
        resourceSources: ['workspace'],
        resourceDetails: {
          hasWorkspace: true,
          localBranchCount: 0,
          remoteBranchCount: 0,
          tmuxSessionCount: 0,
          prs: [],
          hasVbrief: false,
          hasBeads: false,
          dockerContainerCount: 2,
        },
      })}
      isSelected={false}
      onSelect={() => {}}
    />,
  );
}

// ─── pickBestSession ──────────────────────────────────────────────────────────

describe('pickBestSession', () => {
  it('returns null for empty sessions', () => {
    expect(pickBestSession([])).toBeNull();
  });

  it('prefers active over idle', () => {
    const sessions = [
      makeSession({ sessionId: 'idle-1', presence: 'idle' }),
      makeSession({ sessionId: 'active-1', presence: 'active' }),
    ];
    expect(pickBestSession(sessions)).toBe('active-1');
  });

  it('prefers idle over ended', () => {
    const sessions = [
      makeSession({ sessionId: 'ended-1', presence: 'ended' }),
      makeSession({ sessionId: 'idle-1', presence: 'idle' }),
    ];
    expect(pickBestSession(sessions)).toBe('idle-1');
  });

  it('among active prefers work > review > test', () => {
    const sessions = [
      makeSession({ sessionId: 'test-1', type: 'test', presence: 'active' }),
      makeSession({ sessionId: 'review-1', type: 'review', presence: 'active' }),
      makeSession({ sessionId: 'work-1', type: 'work', presence: 'active' }),
    ];
    expect(pickBestSession(sessions)).toBe('work-1');
  });

  it('falls back to most recent when presence and type are equal', () => {
    const sessions = [
      makeSession({ sessionId: 'older', startedAt: '2024-01-01T00:00:00Z' }),
      makeSession({ sessionId: 'newer', startedAt: '2024-06-01T00:00:00Z' }),
    ];
    expect(pickBestSession(sessions)).toBe('newer');
  });
});

// ─── FeatureItem rendering ────────────────────────────────────────────────────

describe('FeatureItem', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        workspacePaths: [],
        localBranchNames: [],
        remoteBranchNames: [],
        tmuxSessionNames: [],
        prs: [],
        dockerContainerNames: [],
      } satisfies ProjectFeatureResourceIdentifiers),
    })));
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('shows paused badge with age + reason and fires unpause (PAN-1779)', () => {
    const onUnpauseSession = vi.fn();
    const view = renderFeature(
      <FeatureItem
        feature={makeFeature({
          sessions: [makeSession({
            sessionId: 'agent-pan-821',
            status: 'stopped',
            presence: 'ended',
            paused: true,
            pausedReason: 'Operator drain 2026-06-10',
            pausedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
          })],
        })}
        isSelected={false}
        onSelect={() => {}}
        onUnpauseSession={onUnpauseSession}
      />,
    );
    const badgeGroup = screen.getByTestId('feature-paused');
    expect(badgeGroup.textContent).toContain('Paused 2h');
    screen.getByTestId('feature-unpause').click();
    expect(onUnpauseSession).toHaveBeenCalledWith('agent-pan-821');
  });

  it('does not show paused badge for unpaused sessions', () => {
    const view = renderFeature(
      <FeatureItem
        feature={makeFeature({ sessions: [makeSession()] })}
        isSelected={false}
        onSelect={() => {}}
        onUnpauseSession={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('feature-paused')).toBeNull();
  });

  it('renders feature info without caret when no sessions', () => {
    const view = renderFeature(
      <FeatureItem
        feature={makeFeature()}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getAllByText('PAN-821')[0]).toBeInTheDocument();
    expect(screen.queryByTestId('chevron-right')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chevron-down')).not.toBeInTheDocument();
  });

  it('renders a muted untitled placeholder when title is empty', () => {
    renderFeature(
      <FeatureItem
        feature={makeFeature()}
        title="   "
        isSelected={false}
        onSelect={() => {}}
      />,
    );

    const placeholder = screen.getByText('(untitled)');
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveClass('featureLabelUntitled');
    expect(screen.getByText('PAN-821')).toBeInTheDocument();
  });

  it('does not duplicate the issue id when title is missing', () => {
    renderFeature(
      <FeatureItem
        feature={makeFeature()}
        title=""
        isSelected={false}
        onSelect={() => {}}
      />,
    );

    expect(screen.getAllByText('PAN-821')).toHaveLength(1);
    expect(screen.getByText('(untitled)')).toBeInTheDocument();
  });

  it('shows caret when sessions are present', () => {
    renderFeature(
      <FeatureItem
        feature={makeFeature({ sessions: [makeSession()], stateLabel: 'Done' })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId('chevron-right')).toBeInTheDocument();
  });

  it('shows an activity tooltip for aggregate session state', () => {
    renderFeature(
      <FeatureItem
        feature={makeFeature({
          sessions: [
            makeSession({ sessionId: 'work-1', type: 'work', duration: 2280, status: 'running', presence: 'active' }),
            makeSession({ sessionId: 'review-1', type: 'reviewer', status: 'error', presence: 'ended' }),
            makeSession({ sessionId: 'review-2', type: 'reviewer', status: 'stopped', presence: 'ended' }),
          ],
        })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    // Redesign (PAN-1779): the aggregate activity tooltip lives on the issue
    // id — the row status dot was replaced by the wrapper edge bar.
    expect(screen.getByTitle('1 work agent running 38m, 1 review error, 1 reviewer stopped')).toBeInTheDocument();
  });

  it('shows work and review badges on the parent row', () => {
    renderFeature(
      <FeatureItem
        feature={makeFeature({
          sessions: [
            makeSession({ sessionId: 'work-1', type: 'work', duration: 0, status: 'running', presence: 'active' }),
            makeSession({ sessionId: 'review-1', type: 'reviewer', role: 'correctness', status: 'running', presence: 'active' }),
            makeSession({ sessionId: 'review-2', type: 'reviewer', role: 'security', status: 'stopped', presence: 'ended' }),
          ],
        })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('▸ work')).toHaveAttribute('title', 'Work agent sessions for this issue: 1 total. 1 running.');
    expect(screen.getByText('●●● 2')).toHaveAttribute('title', 'Review pipeline sessions for this issue: 2 total. 1 active, 0 queued or starting, 1 stopped. Roles present: correctness and security.');
  });

  it('shows a review error badge when a review session failed', () => {
    renderFeature(
      <FeatureItem
        feature={makeFeature({
          sessions: [makeSession({ sessionId: 'review-1', type: 'reviewer', role: 'security', status: 'error', presence: 'ended' })],
        })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('✕ review')).toHaveAttribute('title', 'Review pipeline has 1 failing session. Affected roles: security.');
  });

  it('applies the colored kanban state pill class', () => {
    renderFeature(
      <FeatureItem
        feature={makeFeature({ stateLabel: 'Planning' })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('Planning')).toHaveClass('featureState_planning');
  });

  it('adds contextual tooltip text to the feature state pill', () => {
    renderFeature(
      <FeatureItem
        feature={makeFeature({ stateLabel: 'In Review', readyForMerge: true })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('In Review')).toHaveAttribute('title', 'Implementation has moved into review/test/merge flow and is ready for human merge approval.');
  });

  it('adds richer progress tooltip text for rally progress pills', () => {
    renderFeature(
      <FeatureItem
        feature={makeFeature({
          isRally: true,
          childCount: 6,
          completedCount: 4,
          inProgressCount: 1,
        })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('4/6')).toHaveAttribute('title', '4/6 stories done, 1 active (67% complete)');
  });

  it('toggles expansion when caret is clicked', () => {
    renderFeature(
      <FeatureItem
        feature={makeFeature({ sessions: [makeSession()], stateLabel: 'Done' })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    const caret = screen.getByTestId('chevron-right');
    fireEvent.click(caret);
    expect(screen.getByTestId('chevron-down')).toBeInTheDocument();
    expect(screen.getByTestId('session-agent-pan-821')).toBeInTheDocument();
  });

  it('collapses when caret is clicked again', () => {
    renderFeature(
      <FeatureItem
        feature={makeFeature({ sessions: [makeSession()], stateLabel: 'Done' })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('chevron-right'));
    fireEvent.click(screen.getByTestId('chevron-down'));
    expect(screen.queryByTestId('session-agent-pan-821')).not.toBeInTheDocument();
  });

  it('calls onSelect when row is clicked', () => {
    const onSelect = vi.fn();
    renderFeature(
      <FeatureItem
        feature={makeFeature()}
        isSelected={false}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getAllByText('PAN-821')[0]!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('does not auto-select a session when the issue row is clicked', () => {
    const onSelect = vi.fn();
    const onSelectSession = vi.fn();
    const sessions = [
      makeSession({ sessionId: 'idle-1', presence: 'idle' }),
      makeSession({ sessionId: 'active-1', presence: 'active' }),
    ];
    renderFeature(
      <FeatureItem
        feature={makeFeature({ sessions })}
        isSelected={false}
        onSelect={onSelect}
        onSelectSession={onSelectSession}
      />,
    );
    fireEvent.click(screen.getAllByText('PAN-821')[0]!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it('does not call onSelectSession when row is clicked and no sessions exist', () => {
    const onSelect = vi.fn();
    const onSelectSession = vi.fn();
    renderFeature(
      <FeatureItem
        feature={makeFeature()}
        isSelected={false}
        onSelect={onSelect}
        onSelectSession={onSelectSession}
      />,
    );
    fireEvent.click(screen.getAllByText('PAN-821')[0]!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it('calls onSelectSession when a session node is clicked', () => {
    const onSelectSession = vi.fn();
    const sessions = [
      makeSession({ sessionId: 'sess-a' }),
      makeSession({ sessionId: 'sess-b' }),
    ];
    renderFeature(
      <FeatureItem
        feature={makeFeature({ sessions, stateLabel: 'Done' })}
        isSelected={false}
        onSelect={() => {}}
        onSelectSession={onSelectSession}
      />,
    );
    fireEvent.click(screen.getByTestId('chevron-right'));
    fireEvent.click(screen.getByTestId('session-sess-b'));
    expect(onSelectSession).toHaveBeenCalledWith('PAN-821', 'sess-b');
  });

  it('persists expansion state to localStorage', () => {
    renderFeature(
      <FeatureItem
        feature={makeFeature({ sessions: [makeSession()], stateLabel: 'Done' })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('chevron-right'));
    expect(localStorage.getItem('mc-feature-expanded:PAN-821')).toBe('true');
    fireEvent.click(screen.getByTestId('chevron-down'));
    expect(localStorage.getItem('mc-feature-expanded:PAN-821')).toBeNull();
  });

  it('restores expansion state from localStorage on mount', () => {
    localStorage.setItem('mc-feature-expanded:PAN-821', 'true');
    renderFeature(
      <FeatureItem
        feature={makeFeature({ sessions: [makeSession()], stateLabel: 'Done' })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId('chevron-down')).toBeInTheDocument();
    expect(screen.getByTestId('session-agent-pan-821')).toBeInTheDocument();
  });

  it('does not auto-expand on mount when localStorage has no entry for terminal states', () => {
    renderFeature(
      <FeatureItem
        feature={makeFeature({ sessions: [makeSession()], stateLabel: 'Done' })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId('chevron-right')).toBeInTheDocument();
    expect(screen.queryByTestId('session-agent-pan-821')).not.toBeInTheDocument();
  });

  it('highlights selected session', () => {
    const sessions = [
      makeSession({ sessionId: 'sess-a' }),
      makeSession({ sessionId: 'sess-b' }),
    ];
    renderFeature(
      <FeatureItem
        feature={makeFeature({ sessions, stateLabel: 'Done' })}
        isSelected={false}
        onSelect={() => {}}
        selectedSessionId="sess-b"
      />,
    );
    fireEvent.click(screen.getByTestId('chevron-right'));
    expect(screen.getByTestId('session-sess-a')).toHaveAttribute('data-selected', 'false');
    expect(screen.getByTestId('session-sess-b')).toHaveAttribute('data-selected', 'true');
  });

  it('renders concrete resource strip details when the popover detail fetch returns identifiers', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        workspacePaths: ['/tmp/workspaces/feature-pan-821'],
        localBranchNames: ['feature/pan-821'],
        remoteBranchNames: ['origin/feature/pan-821'],
        tmuxSessionNames: ['agent-pan-821'],
        prs: [
          {
            number: 123,
            title: 'Test PR',
            state: 'OPEN',
            isDraft: false,
          },
        ],
        dockerContainerNames: ['pan-821-db', 'pan-821-cache'],
      } satisfies ProjectFeatureResourceIdentifiers),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const view = renderFeature(
      <FeatureItem
        feature={makeFeature({
          resourceSources: ['workspace', 'branch', 'tmux', 'pr', 'docker', 'vbrief', 'beads'],
          resourceDetails: {
            hasWorkspace: true,
            localBranchCount: 1,
            remoteBranchCount: 1,
            tmuxSessionCount: 1,
            prs: [
              {
                number: 123,
                title: 'Test PR',
                state: 'OPEN',
                isDraft: false,
              },
            ],
            hasVbrief: true,
            hasBeads: true,
            dockerContainerCount: 2,
          },
        })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );

    fireEvent.mouseEnter(screen.getByTitle('workspace: allocated').parentElement!);

    expect(screen.getByTitle('workspace: allocated')).toBeInTheDocument();
    expect(screen.getByTitle('branch: local 1 · remote 1')).toBeInTheDocument();
    expect(screen.getByTitle('tmux: 1 session')).toBeInTheDocument();
    expect(screen.getByTitle('PR: #123 (open)')).toBeInTheDocument();
    expect(await screen.findByText('workspace: /tmp/workspaces/feature-pan-821')).toBeInTheDocument();
    expect(screen.getByText('branch (local): feature/pan-821')).toBeInTheDocument();
    expect(screen.getByText('branch (remote): origin/feature/pan-821')).toBeInTheDocument();
    expect(screen.getByText('tmux: agent-pan-821')).toBeInTheDocument();
    expect(screen.getByText('vBRIEF present')).toBeInTheDocument();
    expect(screen.getByText('beads present')).toBeInTheDocument();
    expect(screen.getByText('PR: #123 Test PR (open)')).toBeInTheDocument();
    expect(screen.getByText('docker: pan-821-db')).toBeInTheDocument();
    expect(screen.getByText('docker: pan-821-cache')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/issues/PAN-821/resource-details');
  });

  it('collapses UAT environment panel by default and expands on header click for ready-for-merge issues', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/workspaces/PAN-821') {
        return {
          ok: true,
          json: async () => ({
            exists: true,
            issueId: 'PAN-821',
            frontendUrl: 'https://feature-pan-821.pan.localhost',
            stackHealth: {
              healthy: false,
              reasons: ['api unhealthy: connection refused'],
              lastObserved: '2026-06-14T19:02:00.000Z',
            },
            pendingOperation: {
              type: 'rebuild-stack',
              status: 'running',
              startedAt: '2026-06-14T19:01:00.000Z',
            },
            containers: {
              postgres: { running: true, uptime: '2m', status: 'running', health: 'healthy', ports: [5432] },
              api: { running: true, uptime: '42s', status: 'running', health: 'starting', ports: [8080] },
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          workspacePaths: [],
          localBranchNames: [],
          remoteBranchNames: [],
          tmuxSessionNames: [],
          prs: [],
          dockerContainerNames: [],
        } satisfies ProjectFeatureResourceIdentifiers),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const view = renderFeature(
      <FeatureItem
        feature={makeFeature({
          stateLabel: 'In Review',
          readyForMerge: true,
          resourceSources: ['workspace'],
          resourceDetails: {
            hasWorkspace: true,
            localBranchCount: 0,
            remoteBranchCount: 0,
            tmuxSessionCount: 0,
            prs: [],
            hasVbrief: false,
            hasBeads: false,
            dockerContainerCount: 2,
          },
          sessions: [
            makeSession({ sessionId: 'agent-pan-821', type: 'work', status: 'stopped', presence: 'inactive' }),
          ],
        })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );

    // Collapsed by default: header, summary count and badge are visible; the
    // per-service body (full label + service rows) is not rendered.
    expect(await screen.findByText('UAT environment')).toBeTruthy();
    expect(screen.getByTestId('feature-uat-stack')).toBeTruthy();
    expect(screen.queryByText('UAT stack 1/2 healthy')).toBeNull();
    expect(screen.queryByText('postgres')).toBeNull();
    expect(screen.queryByText('api')).toBeNull();
    let toggle = screen.getByRole('button', { name: 'Toggle UAT environment details' });
    expect(within(toggle).getByTestId('chevron-right')).toBeTruthy();
    expect(localStorage.getItem('mc-feature-expanded:PAN-821')).toBeNull();
    expect(localStorage.getItem('mc-feature-expanded:PAN-821:uat')).toBeNull();

    // Clicking the header expands and renders the per-service tree rows.
    fireEvent.click(toggle);
    expect(await screen.findByText('postgres')).toBeTruthy();
    expect(screen.getByText('api')).toBeTruthy();
    expect(screen.getByText('Up 2m')).toBeTruthy();
    expect(screen.getByText('Up 42s')).toBeTruthy();
    const logsAction = screen.getByTestId('uat-inline-action-logs');
    expect(logsAction).toBeTruthy();
    expect(logsAction.className).not.toMatch(/opacity|hover/);
    toggle = screen.getByRole('button', { name: 'Toggle UAT environment details' });
    expect(within(toggle).getByTestId('chevron-down')).toBeTruthy();
    expect(localStorage.getItem('mc-feature-expanded:PAN-821')).toBeNull();
    expect(localStorage.getItem('mc-feature-expanded:PAN-821:uat')).toBe('true');

    view.unmount();
    renderFeature(
      <FeatureItem
        feature={makeFeature({
          stateLabel: 'In Review',
          readyForMerge: true,
          resourceSources: ['workspace'],
          resourceDetails: {
            hasWorkspace: true,
            localBranchCount: 0,
            remoteBranchCount: 0,
            tmuxSessionCount: 0,
            prs: [],
            hasVbrief: false,
            hasBeads: false,
            dockerContainerCount: 2,
          },
          sessions: [
            makeSession({ sessionId: 'agent-pan-821', type: 'work', status: 'stopped', presence: 'inactive' }),
          ],
        })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(await screen.findByText('postgres')).toBeTruthy();

    // Clicking again collapses and removes the service rows.
    fireEvent.click(screen.getByRole('button', { name: 'Toggle UAT environment details' }));
    expect(screen.queryByText('postgres')).toBeNull();
    expect(screen.queryByText('api')).toBeNull();
    expect(localStorage.getItem('mc-feature-expanded:PAN-821:uat')).toBeNull();
  });

  it('opens the UAT context menu with resolver actions for an unhealthy stack', async () => {
    stubWorkspace({
      exists: true,
      issueId: 'PAN-821',
      frontendUrl: 'https://feature-pan-821.pan.localhost',
      stackHealth: {
        healthy: false,
        reasons: ['api unhealthy: connection refused'],
        lastObserved: '2026-06-14T19:02:00.000Z',
      },
      containers: {
        postgres: { running: true, uptime: '2m', status: 'running', health: 'healthy', ports: [5432] },
        api: { running: true, uptime: '42s', status: 'running', health: 'unhealthy', ports: [8080] },
      },
    });

    renderReadyForMergeFeature();

    fireEvent.contextMenu(await screen.findByTestId('uat-stack-tree-header'));
    const items = await screen.findAllByRole('menuitem');
    const labels = items.map(item => item.textContent);
    const expected = resolveUatActions('unhealthy').menu.map(action => action.label);

    expect(labels).toEqual(expected);
    expect(labels.at(-1)).toBe('Reap');
    expect(items.at(-1)?.className).toContain('text-destructive');
  });

  it('opens the UAT context menu with resolver actions for a stopped stack', async () => {
    stubWorkspace({
      exists: true,
      issueId: 'PAN-821',
      stackHealth: {
        healthy: false,
        reasons: ['api exited', 'postgres exited'],
        lastObserved: '2026-06-14T19:02:00.000Z',
      },
      containers: {
        postgres: { running: false, uptime: '', status: 'exited', health: 'none', ports: [5432] },
        api: { running: false, uptime: '', status: 'exited', health: 'none', ports: [8080] },
      },
    });

    renderReadyForMergeFeature();

    fireEvent.contextMenu(await screen.findByTestId('uat-stack-tree-header'));
    const items = await screen.findAllByRole('menuitem');
    const labels = items.map(item => item.textContent);
    const expected = resolveUatActions('stopped').menu.map(action => action.label);

    expect(labels).toEqual(expected);
    expect(labels.at(-1)).toBe('Reap');
    expect(items.at(-1)?.className).toContain('text-destructive');
  });

  it('confirms UAT reap through the workspace reap route and never calls deep-wipe', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/workspaces/PAN-821') {
        return {
          ok: true,
          json: async () => ({
            exists: true,
            issueId: 'PAN-821',
            stackHealth: {
              healthy: false,
              reasons: ['api exited', 'postgres exited'],
              lastObserved: '2026-06-14T19:02:00.000Z',
            },
            containers: {
              postgres: { running: false, uptime: '', status: 'exited', health: 'none', ports: [5432] },
              api: { running: false, uptime: '', status: 'exited', health: 'none', ports: [8080] },
            },
          }),
        };
      }
      if (url === '/api/workspaces/PAN-821/reap' && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ success: true, activityId: 'activity-1' }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          workspacePaths: [],
          localBranchNames: [],
          remoteBranchNames: [],
          tmuxSessionNames: [],
          prs: [],
          dockerContainerNames: [],
        } satisfies ProjectFeatureResourceIdentifiers),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderReadyForMergeFeature();

    fireEvent.click(await screen.findByTestId('uat-inline-action-reap'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/PAN-821/reap', { method: 'POST' });
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const calledUrls = fetchMock.mock.calls.map(call => String(call[0]));
    expect(calledUrls.some(url => url.includes('deep-wipe'))).toBe(false);
  });

  it('shows cleanup affordances for orphaned resources', () => {
    const onCleanupOrphanedResources = vi.fn();
    renderFeature(
      <FeatureItem
        feature={makeFeature({
          issueId: 'PAN-777',
          stateLabel: 'Closed',
          rawTrackerState: 'closed',
          resourceSources: ['workspace'],
          resourceDetails: {
            hasWorkspace: true,
            localBranchCount: 0,
            remoteBranchCount: 0,
            tmuxSessionCount: 0,
            prs: [],
            hasVbrief: false,
            hasBeads: false,
            dockerContainerCount: 0,
          },
        })}
        isSelected={false}
        onSelect={() => {}}
        onCleanupOrphanedResources={onCleanupOrphanedResources}
      />,
    );

    fireEvent.mouseEnter(screen.getByTitle('workspace: allocated').parentElement!);
    fireEvent.click(screen.getByRole('button', { name: 'Cleanup' }));
    expect(onCleanupOrphanedResources).toHaveBeenCalledWith('PAN-777');
  });
});
