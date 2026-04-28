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

vi.mock('./IssueWorkbench', () => ({
  IssueWorkbench: (props: any) => (
    <div data-testid="issue-workbench" data-issue={props.issueId} data-mode={props.sessions?.length > 0 && props.sessions[0]?.presence === 'active' ? 'agent-selected' : 'feature-selected'}>
      <div data-testid="issue-header" data-issue={props.issueId} data-title={props.title} />
      {props.sessions?.map((s: any) => (
        <div key={s.sessionId} data-testid="session-panel" data-session={s.sessionId} data-issue={props.issueId} />
      ))}
    </div>
  ),
}));

vi.mock('./ProjectTree/ProjectNode', () => ({
  ProjectNode: (props: any) => {
    // Simulate tab switch to projects when rendered
    return (
      <div data-testid="project-node">
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

vi.mock('./FeatureMetadata/BadgeBar', () => ({
  BadgeBar: (props: any) => <div data-testid="badge-bar" data-issue={props.issueId} />,
}));

vi.mock('./DeaconStatus', () => ({
  DeaconStatus: () => <div data-testid="deacon-status" />,
}));

vi.mock('../chat/ConversationPanel', () => ({
  ConversationPanel: () => <div data-testid="conversation-panel" />,
}));

vi.mock('../chat/DraftConversationPanel', () => ({
  DraftConversationPanel: () => <div data-testid="draft-panel" />,
}));

vi.mock('../chat/ModelPicker', () => ({
  ModelPicker: ({ value, onChange }: any) => (
    <select data-testid="model-picker" value={value} onChange={(e) => onChange?.(e.target.value)}>
      <option value="claude-sonnet">claude-sonnet</option>
    </select>
  ),
  loadStoredModel: () => 'claude-sonnet',
  saveStoredModel: () => {},
}));

vi.mock('../../lib/store', () => ({
  useDashboardStore: vi.fn(() => []),
  selectAgentList: vi.fn(() => []),
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
      if (url === '/api/conversations') {
        return {
          ok: true,
          json: async () => [
            {
              id: 1,
              name: 'test-conv',
            },
          ],
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

  it('renders IssueHeader + SessionPanel when a session is selected', async () => {
    renderCommandDeck();

    // Projects are visible by default — wait for project node to render
    await screen.findByTestId('project-node');

    // Wait for session tree hydration, then click the session
    fireEvent.click(await screen.findByTestId('session-agent-pan-821'));

    // Verify IssueHeader and SessionPanel are rendered
    expect(screen.getByTestId('issue-header')).toBeInTheDocument();
    expect(screen.getByTestId('issue-header')).toHaveAttribute('data-issue', 'PAN-821');
    expect(screen.getByTestId('session-panel')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel')).toHaveAttribute('data-session', 'agent-pan-821');

    // Verify DetailPanelLayout is NOT rendered
    expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument();
  });

  it('opens the session pane on the first session click when no feature is already selected', async () => {
    renderCommandDeck();

    await screen.findByTestId('project-node');
    expect(screen.queryByTestId('issue-workbench')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByTestId('session-agent-pan-821'));

    const workbench = screen.getByTestId('issue-workbench');
    expect(workbench).toBeInTheDocument();
    expect(workbench).toHaveAttribute('data-issue', 'PAN-821');
    expect(screen.getByTestId('session-panel')).toHaveAttribute('data-session', 'agent-pan-821');
  });

  it('keeps the same session pane on a second click of the same session row', async () => {
    renderCommandDeck();

    await screen.findByTestId('project-node');

    const sessionButton = await screen.findByTestId('session-agent-pan-821');
    fireEvent.click(sessionButton);

    const firstWorkbench = screen.getByTestId('issue-workbench');
    const firstSessionPanel = screen.getByTestId('session-panel');

    fireEvent.click(sessionButton);

    expect(screen.getByTestId('issue-workbench')).toBe(firstWorkbench);
    expect(screen.getByTestId('session-panel')).toBe(firstSessionPanel);
    expect(screen.getByTestId('session-panel')).toHaveAttribute('data-session', 'agent-pan-821');
  });

  it('uses issue-local unified cost data for the issue header instead of global costs-by-issue', async () => {
    renderCommandDeck();

    await screen.findByTestId('project-node');
    fireEvent.click(await screen.findByTestId('session-agent-pan-821'));

    expect(screen.getByTestId('issue-header')).toHaveAttribute('data-issue', 'PAN-821');
  });

  it('auto-selects best session when feature is clicked (B5)', async () => {
    renderCommandDeck();

    // Projects are visible by default
    await screen.findByTestId('project-node');

    // Click feature row — should auto-select the active session
    fireEvent.click(screen.getByTestId('feature-PAN-821'));

    // Verify IssueWorkbench renders in agent-selected mode (best session auto-selected)
    const workbench = screen.getByTestId('issue-workbench');
    expect(workbench).toBeInTheDocument();
    expect(workbench).toHaveAttribute('data-mode', 'agent-selected');
    expect(screen.getByTestId('session-panel')).toBeInTheDocument();
    expect(screen.getByTestId('issue-header')).toBeInTheDocument();
    expect(screen.queryByTestId('zone-c-overview')).not.toBeInTheDocument();
  });


  it('clears session view when switching to a conversation', async () => {
    renderCommandDeck();

    // Select a session (projects are visible by default)
    await screen.findByTestId('project-node');
    fireEvent.click(await screen.findByTestId('session-agent-pan-821'));

    // Verify session view is shown
    expect(screen.getByTestId('session-panel')).toBeInTheDocument();

    // Switch sidebar to conversations mode, then click a conversation
    fireEvent.click(screen.getByText('Conversations'));
    fireEvent.click(screen.getByTestId('conv-test'));

    // Session view should be gone and conversation view should render
    expect(screen.queryByTestId('session-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('issue-header')).not.toBeInTheDocument();
    expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
  });
});
