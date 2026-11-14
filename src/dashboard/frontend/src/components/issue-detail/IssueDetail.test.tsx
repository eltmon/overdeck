/**
 * PAN-2908 · C-DETAIL — the ONE issue-detail component.
 *
 * Proves the density contract: drawer density (PAN-5244) is the pipeline
 * strip + tab strip + a full-width tab body and switches tabs under host
 * control; page density keeps the shell + status rail; rail density is the
 * compact anatomy (shell + active conversation + one action strip, no tab
 * strip). End-to-end strip conversation switching is covered through the
 * drawer in IssueDrawer.test.tsx.
 */
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../DialogProvider';
import type { Agent, DerivedIssueState } from '../../types';
import { IssueDetail } from './IssueDetail';

// Heavy children mocked: the transcript chain (xterm/ConversationPanel),
// the activity rail, and the action menu (store-coupled actions).
vi.mock('../drawer/DrawerAgentSession', () => ({
  DrawerAgentSession: (props: {
    agentId: string | null;
    view: 'conversation' | 'terminal';
    onSelectAgent: (agentId: string) => void;
    onChangeView?: (view: 'conversation' | 'terminal') => void;
    layout?: 'toolbar' | 'conversation-header';
    belowHeader?: React.ReactNode;
  }) => (
    <div data-testid={`mock-agent-session-${props.view}`} data-agent-id={props.agentId ?? ''} data-layout={props.layout ?? 'toolbar'}>
      {props.belowHeader}
      <button type="button" onClick={() => props.onSelectAgent('agent-review-1')}>Select specialist</button>
      {props.onChangeView && (
        <>
          <button type="button" onClick={() => props.onChangeView?.('conversation')}>Conversation mode</button>
          <button type="button" onClick={() => props.onChangeView?.('terminal')}>Terminal mode</button>
        </>
      )}
    </div>
  ),
  pickDefaultDrawerAgent: (agents: readonly Agent[]) =>
    agents.find((a) => a.role === 'work' && a.status === 'running') ?? agents[0] ?? null,
}));
vi.mock('../drawer/DrawerActivityRail', () => ({ default: () => <div data-testid="mock-activity-rail" /> }));
vi.mock('../IssueActionMenu', () => ({
  IssueActionMenu: () => <div data-testid="mock-action-menu" />,
}));
vi.mock('./IssueDetailShell', () => ({
  IssueDetailShell: (props: { onOpenAgentConversation: (agentId: string) => void }) => (
    <div data-testid="mock-detail-shell">
      <button data-testid="shell-open-review-conversation" onClick={() => props.onOpenAgentConversation('agent-review-1')} />
    </div>
  ),
}));
vi.mock('../issue-view/IssuePipelineStrip', () => ({
  IssuePipelineStrip: (props: { activeAgentId?: string | null; onOpenAgentConversation: (agentId: string) => void; children?: React.ReactNode }) => (
    <div data-testid="mock-pipeline-strip" data-active-agent={props.activeAgentId ?? ''}>
      <button data-testid="open-review-conversation" onClick={() => props.onOpenAgentConversation('agent-review-1')} />
      {props.children}
    </div>
  ),
}));
vi.mock('../issue-view/IssueChecksChip', () => ({ IssueChecksChip: () => null }));
vi.mock('../backlog/PickupGateControls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../backlog/PickupGateControls')>()),
  PickupGateControls: (props: { variant?: string; stage?: string }) => (
    <div data-testid={`mock-pickup-${props.variant ?? 'full'}`} data-stage={props.stage ?? 'open'} />
  ),
}));
vi.mock('./IssueDrawerDetails', () => ({ IssueDrawerDetails: () => <div data-testid="drawer-tab-panel-overview" /> }));
vi.mock('../skills/SkillOverridesSections', () => ({
  IssueSkillsSection: () => <div data-testid="mock-issue-skills-section" />,
  IssueSkillsTabPanel: (props: { onUnavailable: () => void }) => (
    <div data-testid="drawer-tab-panel-skills"><button onClick={props.onUnavailable}>report unavailable</button></div>
  ),
}));
vi.mock('../TasksPanel', () => ({ TasksPanel: () => <div data-testid="tasks-panel" /> }));
const useDeftIssueSummaryMock = vi.hoisted(() => vi.fn(() => ({ isDeft: false, summary: null, isLoading: false })));
vi.mock('../deft/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../deft/queries')>()),
  useDeftIssueSummary: (...args: unknown[]) => useDeftIssueSummaryMock(...args),
}));
vi.mock('../deft/DeftDecisionsTab', () => ({ DeftDecisionsTab: () => <div data-testid="deft-decisions" /> }));
vi.mock('../issue-view/IssueBannerSlot', () => ({ IssueBannerSlot: () => <div data-testid="mock-banner-slot" /> }));

beforeEach(() => {
  useDeftIssueSummaryMock.mockReturnValue({ isDeft: false, summary: null, isLoading: false });
  // Overview-tab panels query their domains; answer everything benignly.
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
});

function agent(overrides: Partial<Agent> & { id: string }): Agent {
  return {
    runtime: 'claude-code',
    model: 'claude-sonnet-4-6',
    status: 'running',
    startedAt: '2026-05-22T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

const AGENTS: Agent[] = [
  agent({ id: 'agent-work-1', role: 'work', issueId: 'PAN-1' }),
  agent({ id: 'agent-review-1', role: 'review', issueId: 'PAN-1' }),
];

function renderDetail(ui: React.ReactElement, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(<QueryClientProvider client={qc}><DialogProvider>{ui}</DialogProvider></QueryClientProvider>);
}

function ControlledTabDetail({ initialTab, onTab }: { initialTab: string; onTab?: (tab: string) => void }) {
  const [tab, setTab] = useState(initialTab);
  return (
    <IssueDetail
      issueId="PAN-1"
      density="drawer"
      agents={AGENTS}
      tab={tab}
      onSelectTab={(next) => {
        setTab(next);
        onTab?.(next);
      }}
    />
  );
}

function ControlledSessionDetail() {
  const [tab, setTab] = useState<'conversation' | 'terminal'>('conversation');
  return (
    <IssueDetail
      issueId="PAN-1"
      density="drawer"
      agents={AGENTS}
      tab={tab}
      onSelectTab={(next) => {
        if (next === 'conversation' || next === 'terminal') setTab(next);
      }}
    />
  );
}

describe('IssueDetail (C-DETAIL one component)', () => {
  it('drawer density renders the pipeline strip, the tabs and a full-width conversation', () => {
    const { container } = renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="conversation" onSelectTab={() => {}} tasksBadge="3/13" />,
    );
    expect(screen.getByTestId('mock-pipeline-strip')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-detail-shell')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-activity-rail')).not.toBeInTheDocument();
    expect(screen.getByTestId('drawer-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('drawer-tab-session')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('drawer-tab-conversation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('drawer-tab-terminal')).not.toBeInTheDocument();
    expect(screen.getByTestId('drawer-tab-tasks-count')).toHaveTextContent('3/13');
    // The conversation pane shows the default (running work) agent.
    const session = screen.getByTestId('mock-agent-session-conversation');
    expect(session).toHaveAttribute('data-agent-id', 'agent-work-1');
    expect(session).toHaveAttribute('data-layout', 'conversation-header');
    expect(container.querySelector('.grid-cols-\\[minmax\\(0\\,1fr\\)_320px\\]')).toBeNull();
  });

  it('the Session tab is host-controlled and preserves terminal mode', () => {
    const onSelectTab = vi.fn();
    const { rerender } = renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="overview" onSelectTab={onSelectTab} />,
    );
    fireEvent.click(screen.getByTestId('drawer-tab-session'));
    expect(onSelectTab).toHaveBeenCalledWith('conversation');

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DialogProvider>
          <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="terminal" onSelectTab={onSelectTab} />
        </DialogProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('drawer-tab-session'));
    expect(onSelectTab).toHaveBeenLastCalledWith('terminal');
  });

  it('the shell conversation switcher selects the agent and asks for the conversation tab', () => {
    const onSelectTab = vi.fn();
    renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="conversation" onSelectTab={onSelectTab} />,
    );
    fireEvent.click(screen.getByTestId('open-review-conversation'));
    expect(onSelectTab).toHaveBeenCalledWith('conversation');
    expect(screen.getByTestId('mock-agent-session-conversation')).toHaveAttribute('data-agent-id', 'agent-review-1');
  });

  it('legacy terminal and conversation tab values open the matching session mode', () => {
    const onSelectTab = vi.fn();
    const { rerender } = renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="terminal" onSelectTab={onSelectTab} />,
    );

    expect(screen.getByTestId('drawer-tab-session')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('mock-agent-session-terminal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Conversation mode' }));
    expect(onSelectTab).toHaveBeenCalledWith('conversation');

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DialogProvider>
          <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="session" onSelectTab={onSelectTab} />
        </DialogProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('mock-agent-session-conversation')).toBeInTheDocument();
  });

  it('focusAgentId opens the terminal of a non-default agent (blocked-agent deep link)', () => {
    renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="terminal" focusAgentId="agent-review-1" onSelectTab={vi.fn()} />,
    );
    expect(screen.getByTestId('mock-agent-session-terminal')).toHaveAttribute('data-agent-id', 'agent-review-1');
  });

  it('preserves a selected specialist across both selector switch directions', () => {
    renderDetail(<ControlledSessionDetail />);

    fireEvent.click(screen.getByRole('button', { name: 'Select specialist' }));
    expect(screen.getByTestId('mock-agent-session-conversation')).toHaveAttribute('data-agent-id', 'agent-review-1');

    fireEvent.click(screen.getByRole('button', { name: 'Terminal mode' }));
    expect(screen.getByTestId('mock-agent-session-terminal')).toHaveAttribute('data-agent-id', 'agent-review-1');

    fireEvent.click(screen.getByRole('button', { name: 'Conversation mode' }));
    expect(screen.getByTestId('mock-agent-session-conversation')).toHaveAttribute('data-agent-id', 'agent-review-1');
  });

  it('rail density is the compact anatomy: shell + conversation + action strip, no tab strip', () => {
    renderDetail(
      <IssueDetail issueId="PAN-1" density="rail" agents={AGENTS} tab="conversation" onSelectTab={() => {}} />,
    );
    expect(screen.queryByTestId('drawer-tabs')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-detail-shell')).toBeInTheDocument();
    expect(screen.getByTestId('mock-agent-session-conversation')).toHaveAttribute('data-agent-id', 'agent-work-1');
    expect(screen.getByTestId('mock-action-menu')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-activity-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-pipeline-strip')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-agent-session-conversation')).toHaveAttribute('data-layout', 'toolbar');
  });

  it('page density renders the full composition at route width with the wider status rail', () => {
    const { container } = renderDetail(
      <IssueDetail issueId="PAN-1" density="page" agents={AGENTS} tab="conversation" onSelectTab={() => {}} />,
    );
    expect(container.querySelector('[data-component="issue-detail"]')).toHaveAttribute('data-density', 'page');
    expect(screen.getByTestId('drawer-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('mock-detail-shell')).toBeInTheDocument();
    expect(screen.getByTestId('mock-activity-rail')).toBeInTheDocument();
    expect(container.querySelector('.grid-cols-\\[minmax\\(0\\,1fr\\)_360px\\]')).not.toBeNull();
    expect(screen.getByTestId('mock-agent-session-conversation')).toHaveAttribute('data-agent-id', 'agent-work-1');
    expect(screen.queryByTestId('mock-pipeline-strip')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-agent-session-conversation')).toHaveAttribute('data-layout', 'toolbar');
    expect(screen.queryByTestId('drawer-tab-skills')).not.toBeInTheDocument();
    expect(screen.queryByTestId('drawer-tab-discussion')).not.toBeInTheDocument();
  });

  it('page density keeps its own DrawerPausedBanner wrapper and never the banner slot', () => {
    renderDetail(
      <IssueDetail issueId="PAN-1" density="page" agents={AGENTS} tab="conversation" onSelectTab={() => {}} />,
    );
    expect(document.querySelector('[data-section="DrawerPausedBanner"]')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-banner-slot')).not.toBeInTheDocument();
    expect(screen.queryByTestId('issue-banner-slot')).not.toBeInTheDocument();
  });

  it('page density keeps the Overview body with the skills disclosure and the tasks panel', () => {
    renderDetail(
      <IssueDetail issueId="PAN-1" density="page" agents={AGENTS} tab="overview" onSelectTab={() => {}} />,
    );
    expect(screen.getByTestId('mock-issue-skills-section')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-panel')).toBeInTheDocument();
    expect(screen.getByTestId('mock-pickup-full')).toBeInTheDocument();
  });

  it('the strip marks the selected agent only on a session tab', () => {
    const { rerender } = renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="conversation" onSelectTab={() => {}} />,
    );
    expect(screen.getByTestId('mock-pipeline-strip')).toHaveAttribute('data-active-agent', 'agent-work-1');

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DialogProvider>
          <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="tasks" onSelectTab={() => {}} />
        </DialogProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('mock-pipeline-strip')).toHaveAttribute('data-active-agent', '');
  });

  it.each([
    ['merged', 'finished'],
    ['working', 'picked-up'],
    [undefined, 'open'],
  ] as const)('the pickup strip stage follows the derived state (%s -> %s)', (state, stage) => {
    const derived = state ? ({ issueId: 'PAN-1', state } as DerivedIssueState) : undefined;
    renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} derived={derived} tab="conversation" onSelectTab={() => {}} />,
    );
    expect(screen.getByTestId('mock-pickup-strip')).toHaveAttribute('data-stage', stage);
  });

  it('the Skills tab hides itself and falls back to Conversation when the panel reports the issue has no project', () => {
    const onTab = vi.fn();
    renderDetail(<ControlledTabDetail initialTab="conversation" onTab={onTab} />);
    fireEvent.click(screen.getByTestId('drawer-tab-skills'));
    expect(screen.getByTestId('drawer-tab-panel-skills')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'report unavailable' }));

    expect(onTab).toHaveBeenLastCalledWith('conversation');
    expect(screen.queryByTestId('drawer-tab-skills')).not.toBeInTheDocument();
    expect(screen.getByTestId('drawer-tab-session')).toHaveAttribute('aria-selected', 'true');
  });

  it('the Skills tab badge shows the cached count and issues no skills request', () => {
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    const seeded = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seeded.setQueryData(['skill-overrides', 'issue', null, 'PAN-1'], {
      project: null,
      issue: 'PAN-1',
      skills: [{ core: false, issue: true }, { core: false, issue: null }],
    });
    const { unmount } = renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="conversation" onSelectTab={() => {}} />,
      seeded,
    );
    expect(screen.getByTestId('drawer-tab-skills-count')).toHaveTextContent('1');
    unmount();

    renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="conversation" onSelectTab={() => {}} />,
    );
    expect(screen.queryByTestId('drawer-tab-skills-count')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/skills/overrides'))).toBe(false);
  });

  it('the reviewers row renders only while a review agent is selected', () => {
    renderDetail(<ControlledTabDetail initialTab="conversation" />);
    expect(document.querySelector('[data-section="SpecialistStrip"]')).toBeNull();

    fireEvent.click(screen.getByTestId('open-review-conversation'));

    expect(screen.getByTestId('mock-agent-session-conversation')).toHaveAttribute('data-agent-id', 'agent-review-1');
    expect(document.querySelectorAll('[data-section="SpecialistStrip"]')).toHaveLength(1);
  });

  it('adds a Decisions tab before Discussion for a Deft issue', () => {
    useDeftIssueSummaryMock.mockReturnValue({ isDeft: true, summary: null, isLoading: false });
    renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="conversation" onSelectTab={() => {}} />,
    );
    const ids = screen.getAllByRole('tab').map((button) => button.getAttribute('data-testid'));
    expect(ids.indexOf('drawer-tab-decisions')).toBe(ids.indexOf('drawer-tab-discussion') - 1);
  });

  it('hides the Decisions tab for a non-Deft issue', () => {
    useDeftIssueSummaryMock.mockReturnValue({ isDeft: false, summary: null, isLoading: false });
    renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="conversation" onSelectTab={() => {}} />,
    );
    expect(screen.queryByTestId('drawer-tab-decisions')).not.toBeInTheDocument();
  });

  it('opens Decisions from tab="decisions"', () => {
    useDeftIssueSummaryMock.mockReturnValue({ isDeft: true, summary: null, isLoading: false });
    renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="decisions" onSelectTab={() => {}} />,
    );
    expect(screen.getByTestId('deft-decisions')).toBeInTheDocument();
  });

  it('renders the banner slot between the strip and the tabs', () => {
    renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="conversation" onSelectTab={() => {}} />,
    );
    const strip = screen.getByTestId('mock-pipeline-strip');
    const banner = screen.getByTestId('mock-banner-slot');
    const tabs = screen.getByTestId('drawer-tabs');
    expect(strip.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('an unknown tab value renders the placeholder', () => {
    renderDetail(
      <IssueDetail issueId="PAN-1" density="drawer" agents={AGENTS} tab="no-such-tab" onSelectTab={() => {}} />,
    );
    expect(screen.getByTestId('drawer-tab-panel-no-such-tab')).toHaveTextContent('This drawer section will appear here as data streams in.');
    expect(screen.getAllByRole('tab').every((button) => button.getAttribute('aria-selected') === 'false')).toBe(true);
  });
});
