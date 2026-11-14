import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const wsTransportMock = vi.hoisted(() => ({
  subscribe: vi.fn(() => vi.fn()),
  request: vi.fn(),
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json' })),
}));

vi.mock('../../lib/wsTransport', () => ({
  getTransport: () => wsTransportMock,
  dashboardMutationJsonHeaders: wsTransportMock.dashboardMutationJsonHeaders,
}));
vi.mock('../issue-view/VerificationGates', () => ({ VerificationGates: () => <div data-testid="mock-gates" /> }));
vi.mock('../issue-view/ActiveAgentPanel', () => ({ ActiveAgentPanel: () => <div data-testid="mock-active-agent" /> }));
vi.mock('../backlog/PickupGateControls', () => ({ PickupGateControls: () => <div data-testid="mock-pickup" /> }));
vi.mock('../CommandDeck/UatEnvironmentPanel', () => ({ UatEnvironmentPanel: () => <div data-testid="mock-uat" /> }));
vi.mock('../PanOpenInPicker', () => ({ PanOpenInPicker: () => <div /> }));

import type { Agent } from '../../types';
import { useDashboardStore } from '../../lib/store';
import { resetDrawerIssueSubscriptionForTest } from '../drawer/useDrawerData';
import { IssueDrawerDetails, type IssueDrawerDetailsProps } from './IssueDrawerDetails';

function agent(overrides: Partial<Agent> & { id: string }): Agent {
  return {
    issueId: 'PAN-1',
    runtime: 'claude-code',
    model: 'claude-sonnet-4-6',
    status: 'running',
    startedAt: '2026-05-22T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

function stubWorkspace(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body }) as Response));
}

function renderDetails(props: Partial<IssueDrawerDetailsProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenAgentConversation = vi.fn();
  const onOpenTab = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <IssueDrawerDetails
        issueId="PAN-1"
        agents={[]}
        effectiveAgentId={null}
        onOpenAgentConversation={onOpenAgentConversation}
        onOpenTab={onOpenTab}
        skillsAvailable
        skillsCount={null}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onOpenAgentConversation, onOpenTab };
}

beforeEach(() => {
  stubWorkspace({ exists: true, path: '/tmp/pan-1', containers: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetDrawerIssueSubscriptionForTest();
  useDashboardStore.setState({
    recentActivity: [],
    detailedActivity: [],
    agentsById: {},
    derivedIssueStateByIssueId: {},
  } as Parameters<typeof useDashboardStore.setState>[0]);
});

describe('IssueDrawerDetails', () => {
  it('renders the six pipeline rows in order', () => {
    renderDetails();
    const rows = screen.getByTestId('drawer-details-pipeline').querySelectorAll('tr[data-phase]');
    expect(Array.from(rows).map((row) => row.getAttribute('data-phase'))).toEqual(['plan', 'work', 'review', 'test', 'ship', 'done']);
  });

  it('a phase with an agent shows its id and opens its conversation', () => {
    const { onOpenAgentConversation } = renderDetails({ agents: [agent({ id: 'agent-pan-1', role: 'work' })] });
    const row = screen.getByTestId('drawer-details-pipeline').querySelector('tr[data-phase="work"]') as HTMLElement;
    expect(row).toHaveTextContent('agent-pan-1');
    expect(row).toHaveTextContent('Running now');
    fireEvent.click(screen.getByTestId('drawer-details-open-work'));
    expect(onOpenAgentConversation).toHaveBeenCalledWith('agent-pan-1');
  });

  it('a phase without an agent shows no Open conversation button', () => {
    renderDetails({ agents: [agent({ id: 'agent-pan-1', role: 'work' })] });
    const row = screen.getByTestId('drawer-details-pipeline').querySelector('tr[data-phase="test"]') as HTMLElement;
    expect(row).toHaveTextContent('none');
    expect(screen.queryByTestId('drawer-details-open-test')).toBeNull();
    expect(screen.queryByTestId('drawer-details-open-done')).toBeNull();
  });

  it('says review has not started while every reviewer is queued', () => {
    renderDetails();
    expect(screen.getByTestId('drawer-details-review')).toHaveTextContent('Review has not started.');
  });

  it('lists the four reviewers once review has started', () => {
    const { onOpenAgentConversation } = renderDetails({
      agents: [agent({ id: 'agent-pan-1-review-security', role: 'review', status: 'running' })],
    });
    const review = screen.getByTestId('drawer-details-review');
    const rows = review.querySelectorAll('[data-reviewer]');
    expect(Array.from(rows).map((row) => row.getAttribute('data-reviewer'))).toEqual(['security', 'correctness', 'performance', 'requirements']);
    expect(review).not.toHaveTextContent('Review has not started.');
    fireEvent.click(within(review).getByTestId('drawer-details-open-reviewer-security'));
    expect(onOpenAgentConversation).toHaveBeenCalledWith('agent-pan-1-review-security');
  });

  it('renders live activity with a link to the Activity tab', () => {
    useDashboardStore.setState({
      recentActivity: [
        { id: 'a1', timestamp: '2026-05-18T00:05:00.000Z', source: 'work', level: 'info', message: 'Work started', issueId: 'PAN-1' },
      ],
    } as Parameters<typeof useDashboardStore.setState>[0]);
    const { onOpenTab } = renderDetails();
    expect(screen.getByTestId('drawer-details-activity')).toHaveTextContent('Work started');
    fireEvent.click(screen.getByTestId('drawer-details-all-activity'));
    expect(onOpenTab).toHaveBeenCalledWith('activity');
  });

  it('renders the Skills link with the cached count, and hides it when skills are unavailable', () => {
    const { onOpenTab } = renderDetails({ skillsCount: 2 });
    const link = screen.getByTestId('drawer-details-skills-link');
    expect(link).toHaveTextContent('Skills: 2 changed for this issue');
    fireEvent.click(link);
    expect(onOpenTab).toHaveBeenCalledWith('skills');
  });

  it('hides the Skills link when skills are unavailable', () => {
    renderDetails({ skillsAvailable: false });
    expect(screen.queryByTestId('drawer-details-skills-link')).toBeNull();
  });

  it('renders no tasks panel and no skills disclosure', () => {
    renderDetails();
    expect(screen.queryByRole('button', { name: 'Skills for this issue', expanded: false })).toBeNull();
    expect(document.querySelector('[data-section="DrawerTasksList"]')).toBeNull();
  });

  it('shows the no-workspace line when the workspace does not exist', async () => {
    stubWorkspace(null, false);
    renderDetails();
    expect(await screen.findByTestId('drawer-details-no-workspace')).toHaveTextContent('No workspace yet.');
  });

  it('hides the no-workspace line when the workspace exists', async () => {
    renderDetails();
    await waitFor(() => expect(screen.queryByTestId('drawer-details-no-workspace')).toBeNull());
  });
});
