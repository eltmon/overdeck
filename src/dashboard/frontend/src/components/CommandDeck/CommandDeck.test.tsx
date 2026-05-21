import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommandDeck } from './index';
import { useCommandDeckSelection } from '../../lib/commandDeckSelection';

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

vi.mock('./ZoneActionStrip', () => ({
  ZoneActionStrip: () => <div data-testid="zone-action-strip" />,
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

describe('CommandDeck — project-selected session view (PAN-821)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCommandDeckSelection.getState().clearAll();
    localStorage.clear();
  });

  it('renders the lens when a session is selected', async () => {
    renderCommandDeck();

    // Projects are visible by default — wait for project node to render
    await screen.findAllByTestId('project-node').then(nodes => nodes[0]);

    // Wait for session tree hydration, then click the session
    fireEvent.click(await screen.findByTestId('session-agent-pan-821'));

    // Verify the lens is rendered as the top-level right pane
    expect(screen.getByTestId('command-deck-right-pane-tabs')).toBeInTheDocument();

    // Verify legacy IssueWorkbench is NOT rendered at the top level
    expect(screen.queryByTestId('issue-workbench')).not.toBeInTheDocument();

    // Verify DetailPanelLayout is NOT rendered
    expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument();
  });

  it('opens the lens on the first session click when no feature is already selected', async () => {
    renderCommandDeck();

    await screen.findAllByTestId('project-node').then(nodes => nodes[0]);
    expect(screen.queryByTestId('command-deck-right-pane-tabs')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByTestId('session-agent-pan-821'));

    const lens = screen.getByTestId('command-deck-right-pane-tabs');
    expect(lens).toBeInTheDocument();
    expect(screen.queryByTestId('issue-workbench')).not.toBeInTheDocument();
  });

  it('keeps the same lens on a second click of the same session row', async () => {
    renderCommandDeck();

    await screen.findAllByTestId('project-node').then(nodes => nodes[0]);

    const sessionButton = await screen.findByTestId('session-agent-pan-821');
    fireEvent.click(sessionButton);

    const firstLens = screen.getByTestId('command-deck-right-pane-tabs');

    fireEvent.click(sessionButton);

    expect(screen.getByTestId('command-deck-right-pane-tabs')).toBe(firstLens);
    expect(screen.queryByTestId('issue-workbench')).not.toBeInTheDocument();
  });

  it('uses issue-local unified cost data for the issue header instead of global costs-by-issue', async () => {
    renderCommandDeck();

    await screen.findAllByTestId('project-node').then(nodes => nodes[0]);
    fireEvent.click(await screen.findByTestId('session-agent-pan-821'));

    // Lens is rendered with the selected issue context
    expect(screen.getByTestId('command-deck-right-pane-tabs')).toBeInTheDocument();
    expect(screen.queryByTestId('issue-workbench')).not.toBeInTheDocument();
  });

  it('auto-selects best session when feature is clicked (B5)', async () => {
    renderCommandDeck();

    // Projects are visible by default
    await screen.findAllByTestId('project-node').then(nodes => nodes[0]);

    // Click feature row — should auto-select the active session
    fireEvent.click(screen.getByTestId('feature-PAN-821'));

    // Verify lens is rendered instead of legacy IssueWorkbench
    const lens = screen.getByTestId('command-deck-right-pane-tabs');
    expect(lens).toBeInTheDocument();
    expect(screen.queryByTestId('issue-workbench')).not.toBeInTheDocument();
    // Pipeline tab is active by default when a feature is selected
    expect(screen.getByTestId('project-overview')).toBeInTheDocument();
  });

  it('renders the project overview when a project row is selected', async () => {
    renderCommandDeck();

    await screen.findAllByTestId('project-node');
    fireEvent.click(screen.getByTestId('project-test-project'));

    const overview = screen.getByTestId('project-overview');
    expect(overview).toHaveAttribute('data-project', 'test-project');
    expect(overview).toHaveAttribute('data-features', 'PAN-821');
    expect(overview).toHaveAttribute('data-cost', '12.34');
    expect(overview).toHaveAttribute('data-model-cost', '7.89');
    expect(overview).toHaveAttribute('data-stage-cost', '4.45');
    expect(screen.queryByTestId('conversation-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('issue-workbench')).not.toBeInTheDocument();
  });

  it('renders ConversationPanel inside the Conversations tab when a conversation is selected', async () => {
    renderCommandDeck();

    // Select a project
    await screen.findAllByTestId('project-node');
    fireEvent.click(screen.getByTestId('project-test-project'));

    const lens = screen.getByTestId('command-deck-right-pane-tabs');

    // Click a conversation in the sidebar
    fireEvent.click(screen.getByTestId('conv-test'));

    // Conversations tab should be active
    const conversationsTab = screen.getByRole('tab', { name: /Conversations/i });
    expect(conversationsTab).toHaveAttribute('aria-selected', 'true');

    // ConversationPanel renders inside the lens (not at the top level)
    expect(lens.querySelector('[data-testid="conversation-panel"]')).toBeInTheDocument();
  });

  it('tab strip is exactly 48px tall', async () => {
    renderCommandDeck();

    await screen.findAllByTestId('project-node');
    fireEvent.click(screen.getByTestId('project-test-project'));

    const lens = screen.getByTestId('command-deck-right-pane-tabs');
    const tablist = lens.querySelector('[role="tablist"]') as HTMLElement;
    expect(tablist).toBeTruthy();
    expect(tablist.classList.contains('h-[48px]')).toBe(true);
  });

  it('selecting a conversation auto-switches to Conversations tab and renders ConversationPanel inside the lens', async () => {
    renderCommandDeck();

    await screen.findAllByTestId('project-node');
    fireEvent.click(screen.getByTestId('project-test-project'));

    const lens = screen.getByTestId('command-deck-right-pane-tabs');

    // Click a conversation in the sidebar
    fireEvent.click(screen.getByTestId('conv-test'));

    // Conversations tab should be active
    const conversationsTab = screen.getByRole('tab', { name: /Conversations/i });
    expect(conversationsTab).toHaveAttribute('aria-selected', 'true');

    // ConversationPanel should render inside the lens
    expect(lens.querySelector('[data-testid="conversation-panel"]')).toBeInTheDocument();
  });

  it('renders ZoneA action strip inside the lens when a feature is selected', async () => {
    renderCommandDeck();

    await screen.findAllByTestId('project-node');
    fireEvent.click(screen.getByTestId('feature-PAN-821'));

    const lens = screen.getByTestId('command-deck-right-pane-tabs');
    expect(lens.querySelector('[data-testid="zone-a"]')).toBeInTheDocument();
    expect(lens.querySelector('[data-testid="zone-action-strip"]')).toBeInTheDocument();
  });
});
