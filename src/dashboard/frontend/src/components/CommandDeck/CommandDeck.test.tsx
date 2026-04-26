import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommandDeck } from './index';

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

vi.mock('./SessionView/SessionPanel', () => ({
  SessionPanel: (props: any) => (
    <div data-testid="session-panel" data-session={props.session.sessionId} data-issue={props.issueId} />
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
      if (url === '/api/command-deck/projects') {
        return {
          ok: true,
          json: async () => [
            {
              name: 'test-project',
              path: '/test',
              features: [
                {
                  issueId: 'PAN-821',
                  title: 'Test Feature',
                  state: 'In Progress',
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
        };
      }
      if (url === '/api/conversations') {
        return { ok: true, json: async () => [] };
      }
      if (url === '/api/costs/by-issue') {
        return { ok: true, json: async () => ({ issues: [] }) };
      }
      if (url === '/api/version') {
        return { ok: true, json: async () => ({ version: '0.7.2' }) };
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
    localStorage.clear();
  });

  it('renders IssueHeader + SessionPanel when a session is selected', async () => {
    renderCommandDeck();

    // Switch to Projects tab
    const projectsTab = screen.getByText('Projects');
    fireEvent.click(projectsTab);

    // Wait for projects to load and project node to render
    await screen.findByTestId('project-node');

    // Click the session
    fireEvent.click(screen.getByTestId('session-agent-pan-821'));

    // Verify IssueHeader and SessionPanel are rendered
    expect(screen.getByTestId('issue-header')).toBeInTheDocument();
    expect(screen.getByTestId('issue-header')).toHaveAttribute('data-issue', 'PAN-821');
    expect(screen.getByTestId('session-panel')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel')).toHaveAttribute('data-session', 'agent-pan-821');

    // Verify DetailPanelLayout is NOT rendered
    expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument();
  });

  it('renders IssueWorkbench in issue-selected mode when feature is selected without a session', async () => {
    renderCommandDeck();

    // Switch to Projects tab
    const projectsTab = screen.getByText('Projects');
    fireEvent.click(projectsTab);

    await screen.findByTestId('project-node');

    // Click feature row (not session)
    fireEvent.click(screen.getByTestId('feature-PAN-821'));

    // Verify IssueWorkbench renders in issue-selected mode with the tab strip
    const workbench = screen.getByTestId('issue-workbench');
    expect(workbench).toBeInTheDocument();
    expect(workbench).toHaveAttribute('data-mode', 'issue-selected');
    expect(screen.getByTestId('zone-c-overview')).toBeInTheDocument();
    // ZoneA still renders IssueHeader, but the agent-selected SessionPanel is NOT rendered
    expect(screen.getByTestId('issue-header')).toBeInTheDocument();
    expect(screen.queryByTestId('session-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('zone-b')).not.toBeInTheDocument();
  });

  it('clears session view when switching to a conversation', async () => {
    renderCommandDeck();

    // Switch to Projects tab and select a session
    fireEvent.click(screen.getByText('Projects'));
    await screen.findByTestId('project-node');
    fireEvent.click(screen.getByTestId('session-agent-pan-821'));

    // Verify session view is shown
    expect(screen.getByTestId('session-panel')).toBeInTheDocument();

    // Switch to Conversations tab and click a conversation
    fireEvent.click(screen.getByText('Conversations'));
    fireEvent.click(screen.getByTestId('conv-test'));

    // Session view should be gone
    expect(screen.queryByTestId('session-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('issue-header')).not.toBeInTheDocument();
  });
});
