import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommandDeck } from './index';
import { useCommandDeckSelection } from '../../lib/commandDeckSelection';
import { usePanesStore } from '../../lib/panesStore';

vi.mock('./styles/command-deck.module.css', () => ({
  default: {
    missionControl: 'missionControl',
    layout: 'layout',
    sidebar: 'sidebar',
    sidebarHeader: 'sidebarHeader',
    sidebarHeaderRow: 'sidebarHeaderRow',
    sidebarTitle: 'sidebarTitle',
    sidebarHeaderGroup: 'sidebarHeaderGroup',
    segmentControl: 'segmentControl',
    segmentButton: 'segmentButton',
    segmentButtonActive: 'segmentButtonActive',
    segmentCount: 'segmentCount',
    projectTree: 'projectTree',
    resizeHandle: 'resizeHandle',
    content: 'content',
    contentEmpty: 'contentEmpty',
    featureHeader: 'featureHeader',
    featureTitle: 'featureTitle',
    featureId: 'featureId',
    badge: 'badge',
    conversationAddBtn: 'conversationAddBtn',
    skeletonList: 'skeletonList',
    skeletonItem: 'skeletonItem',
    emptyProject: 'emptyProject',
    sidebarFooter: 'sidebarFooter',
    versionLabel: 'versionLabel',
  },
}));

vi.mock('../DetailPanelLayout', () => ({
  DetailPanelLayout: (props: any) => (
    <div data-testid="detail-panel" data-issue={props.issueId} />
  ),
}));

vi.mock('./SessionView/IssueHeader', () => ({
  IssueHeader: (props: any) => (
    <div data-testid="issue-header" data-issue={props.issueId} data-title={props.title} />
  ),
}));

vi.mock('../Stage', () => ({
  Stage: (props: any) => <div data-testid="stage" data-deck={props.deckKey} />,
}));

// CommandDeck calls useConfirm() at render; the test doesn't mount a DialogProvider,
// so stub the hook to a no-op confirm (returns true) to keep the deck renderable.
vi.mock('../DialogProvider', () => ({
  useConfirm: () => async () => true,
}));

vi.mock('../sessionFeed/SessionFeedSidebar', () => ({
  // PAN-1591: the merged Awareness rail passes the project's issues via
  // `projectIssueIds` (scopeSwitcher mode); keep `issueIds` as a fallback.
  SessionFeedSidebar: (props: any) => (
    <div data-testid="activity-feed" data-issues={(props.projectIssueIds ?? props.issueIds ?? []).join(',')} />
  ),
}));

vi.mock('./ZoneBActionStrip', () => ({
  ZoneBActionStrip: () => <div data-testid="zone-b-action-strip" />,
}));

vi.mock('./SessionView/SessionPanel', () => ({
  SessionPanel: (props: any) => (
    <div data-testid="session-panel" data-session={props.session.sessionId} data-issue={props.issueId} />
  ),
}));

vi.mock('./ProjectTree/ProjectNode', () => ({
  ProjectNode: (props: any) => {
    // Simulate tab switch to projects when rendered
    return (
      <div data-testid="project-node" data-selected={props.selectedProject === props.name ? 'true' : 'false'}>
        <button data-testid={`project-${props.name}`} onClick={() => props.onSelectProject?.(props.name)}>
          {props.name}
        </button>
        {props.features.map((f: any) => (
          <div key={f.issueId}>
            <button
              data-testid={`feature-${f.issueId}`}
              onClick={() => props.onSelectFeature?.(f.issueId)}
            >
              {f.issueId}
            </button>
            {f.sessions?.map((s: any) => (
              <button
                key={s.sessionId}
                data-testid={`session-${s.sessionId}`}
                onClick={() => props.onSelectSession?.(f.issueId, s.sessionId)}
              >
                {s.sessionId}
              </button>
            ))}
          </div>
        ))}
      </div>
    );
  },
  ProjectFeature: {},
}));

vi.mock('./ConversationList', () => ({
  ConversationList: (props: any) => (
    <div data-testid="conversation-list">
      <button data-testid="conv-test" onClick={() => props.onSelectConversation?.('test-conv')}>
        test-conv
      </button>
      <button data-testid="conv-unscoped" onClick={() => props.onSelectConversation?.('unscoped-conv')}>
        unscoped-conv
      </button>
    </div>
  ),
}));

vi.mock('./ProjectOverview', () => ({
  ProjectOverview: (props: any) => (
    <div
      data-testid="project-overview"
      data-project={props.projectName}
      data-features={props.features.map((feature: any) => feature.issueId).join(',')}
      data-cost={props.issueCosts['PAN-821']}
      data-model-cost={props.issueCostDetails['PAN-821']?.byModel?.['claude-sonnet-4-6']?.cost}
      data-stage-cost={props.issueCostDetails['PAN-821']?.byStage?.implementation?.cost}
    />
  ),
}));

vi.mock('./FeatureMetadata/BadgeBar', () => ({
  BadgeBar: (props: any) => <div data-testid="badge-bar" data-issue={props.issueId} />,
}));

vi.mock('./DeaconStatus', () => ({
  DeaconStatus: () => <div data-testid="deacon-status" />,
}));

vi.mock('../chat/ConversationPanel', () => ({
  ConversationPanel: () => <div data-testid="conversation-panel" />,
}));

vi.mock('../chat/ModelPicker', () => ({
  ModelPicker: ({ value, onChange }: any) => (
    <select data-testid="model-picker" value={value} onChange={(e) => onChange?.(e.target.value)}>
      <option value="claude-sonnet">claude-sonnet</option>
    </select>
  ),
  loadStoredModel: () => 'claude-sonnet',
  saveStoredModel: () => {},
  loadStoredHarness: () => 'claude-code',
  saveStoredHarness: () => {},
}));

vi.mock('../../lib/store', () => ({
  useDashboardStore: vi.fn(() => []),
  selectAgents: vi.fn(() => []),
  selectIssues: vi.fn(() => []),
  selectDashboardLifecycle: vi.fn(() => ({ active: false })),
}));

vi.mock('../../lib/wsTransport', () => ({
  getTransport: () => ({
    subscribe: () => () => {},
  }),
}));

vi.mock('../BeadsDialog', () => ({
  BeadsDialog: () => <div data-testid="beads-dialog" />,
}));

// Mock lucide-react icons
vi.mock('lucide-react', async () => {
  const actual = await vi.importActual('lucide-react');
  return {
    ...actual,
    Compass: () => <svg data-testid="compass-icon" />,
    Plus: () => <svg data-testid="plus-icon" />,
  };
});

function renderCommandDeck(props?: Partial<React.ComponentProps<typeof CommandDeck>>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  // Provide minimal fetch mocks for the hooks
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/issues/resource-allocated') {
        return {
          ok: true,
          json: async () => [
            {
              issueId: 'PAN-821',
              title: 'Test Feature',
              projectName: 'test-project',
              branch: 'feature/pan-821',
              status: 'running',
              stateLabel: 'In Progress',
              agentStatus: 'active',
              hasPlanning: true,
              hasPrd: true,
              hasState: true,
              isShadow: false,
              readyForMerge: false,
              resourceSources: [],
              resourceDetails: {
                hasWorkspace: false,
                localBranchCount: 0,
                remoteBranchCount: 0,
                tmuxSessionCount: 0,
                prs: [],
                hasVbrief: false,
                hasBeads: false,
                dockerContainerCount: 0,
              },
            },
          ],
        };
      }
      if (url === '/api/registered-projects') {
        return {
          ok: true,
          json: async () => [
            { key: 'test-project', name: 'test-project', path: '/path/to/test-project' },
            { key: 'other-project', name: 'other-project', path: '/path/to/other-project' },
          ],
        };
      }
      if (url === '/api/conversations') {
        return {
          ok: true,
          json: async () => [
            {
              id: 1,
              name: 'test-conv',
              cwd: '/path/to/test-project',
            },
            {
              // Unscoped: cwd is not under any registered project path.
              id: 2,
              name: 'unscoped-conv',
              cwd: '/tmp/scratch',
            },
          ],
        };
      }
      if (url === '/api/costs/by-issue') {
        return {
          ok: true,
          json: async () => ({
            issues: [
              {
                issueId: 'PAN-821',
                totalCost: 12.34,
                byModel: { 'claude-sonnet-4-6': { cost: 7.89, tokens: 1234 } },
                byStage: { implementation: { cost: 4.45, tokens: 567 } },
              },
            ],
          }),
        };
      }
      if (url === '/api/version') {
        return { ok: true, json: async () => ({ version: '0.8.0' }) };
      }
      if (url.startsWith('/api/session-trees')) {
        return {
          ok: true,
          json: async () => ({
            trees: [
              {
                projectKey: 'test-project',
                features: [
                  {
                    issueId: 'PAN-821',
                    sessions: [
                      {
                        type: 'work',
                        sessionId: 'agent-pan-821',
                        tmuxSession: 'agent-pan-821',
                        model: 'claude-sonnet-4-6',
                        startedAt: new Date().toISOString(),
                        duration: 120,
                        status: 'running',
                        presence: 'active',
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        };
      }
      if (url.startsWith('/api/command-deck/activity/')) {
        return {
          ok: true,
          json: async () => ({
            issueId: 'PAN-821',
            sections: [],
            resolvedTotalCost: 5.1,
          }),
        };
      }
      if (url.startsWith('/api/command-deck/planning/')) {
        return {
          ok: true,
          json: async () => ({
            transcripts: [],
            discussions: [],
            notes: [],
          }),
        };
      }
      if (url.startsWith('/api/review/')) {
        return {
          ok: true,
          json: async () => ({
            reviewStatus: 'pending',
            testStatus: 'pending',
            verificationStatus: 'pending',
          }),
        };
      }
      if (url.startsWith('/api/projects/')) {
        return {
          ok: true,
          json: async () => ({
            projectKey: 'test-project',
            features: [
              {
                issueId: 'PAN-821',
                sessions: [
                  {
                    type: 'work',
                    sessionId: 'agent-pan-821',
                    tmuxSession: 'agent-pan-821',
                    model: 'claude-sonnet-4-6',
                    startedAt: new Date().toISOString(),
                    duration: 120,
                    status: 'running',
                    presence: 'active',
                  },
                ],
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );

  return render(
    <QueryClientProvider client={queryClient}>
      <CommandDeck issues={[]} {...props} />
    </QueryClientProvider>,
  );
}

describe('CommandDeck — project-scoped deck (PAN-1561)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCommandDeckSelection.getState().clearAll();
    usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} });
    localStorage.clear();
  });

  const panes = (deck: string) => usePanesStore.getState().panesByWorkspace[deck] ?? [];

  it('shows an empty state until a project is selected', async () => {
    renderCommandDeck();
    // With no project selected there is no tree to render — the deck shows its
    // empty state and column 2 prompts for a project.
    expect(await screen.findByText(/select a project to open its deck/i)).toBeInTheDocument();
    expect(screen.queryByTestId('stage')).not.toBeInTheDocument();
    expect(screen.queryByTestId('project-node')).not.toBeInTheDocument();
  });

  it('mounts the project deck and activity feed for the selected project', async () => {
    renderCommandDeck({ selectedProject: 'test-project' });
    await screen.findAllByTestId('project-node');

    const stage = screen.getByTestId('stage');
    expect(stage).toHaveAttribute('data-deck', 'test-project');
    expect(screen.getByTestId('activity-feed')).toHaveAttribute('data-issues', 'PAN-821');
  });

  it('opens an issue tab in the deck when a tree issue is selected', async () => {
    renderCommandDeck({ selectedProject: 'test-project' });
    await screen.findAllByTestId('project-node');

    fireEvent.click(screen.getByTestId('feature-PAN-821'));
    expect(panes('test-project').some(p => p.paneType === 'issue' && p.issueId === 'PAN-821')).toBe(true);
  });

  it('opens an issue tab when a session is selected', async () => {
    renderCommandDeck({ selectedProject: 'test-project' });
    await screen.findAllByTestId('project-node');

    fireEvent.click(await screen.findByTestId('session-agent-pan-821'));
    expect(panes('test-project').some(p => p.paneType === 'issue' && p.issueId === 'PAN-821')).toBe(true);
  });

  it('opens an agent tab in the deck when a conversation is selected', async () => {
    renderCommandDeck({ selectedProject: 'test-project' });
    await screen.findAllByTestId('project-node');

    fireEvent.click(screen.getByTestId('conv-test'));
    expect(panes('test-project').some(p => p.paneType === 'agent' && p.conversationId === 'test-conv')).toBe(true);
  });

  it('re-syncs the /conv URL when an already-selected conversation is clicked again', async () => {
    // Repro: open a conversation (URL → /conv/1), navigate to another page so the
    // URL leaves /conv (convId prop is null) while the deck keeps the conversation
    // selected, then click that same row again. Because `selectedConversation`
    // does not change value, the state→URL sync effect never re-runs — so the
    // click handler itself must drive onConvIdChange or the URL stays on
    // /command-deck/<project>.
    const onConvIdChange = vi.fn();
    renderCommandDeck({ selectedProject: 'test-project', convId: null, onConvIdChange });
    await screen.findAllByTestId('project-node');

    // First click selects + opens the conversation and writes /conv/1. Retry
    // until the conversations query has settled so the id lookup resolves.
    await waitFor(() => {
      fireEvent.click(screen.getByTestId('conv-test'));
      expect(onConvIdChange).toHaveBeenCalledWith('1');
    });

    // The conversation is now selected but convId is still null (URL moved away).
    // Re-clicking the same row must restore /conv/1 even though state is unchanged.
    onConvIdChange.mockClear();
    fireEvent.click(screen.getByTestId('conv-test'));
    await waitFor(() => expect(onConvIdChange).toHaveBeenCalledWith('1'));
  });
});
