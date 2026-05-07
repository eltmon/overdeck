/**
 * ZoneCOverview tests — verify tab strip + per-tab dispatch (PAN-830, pan-ofa3).
 *
 * Mocks the shared query hooks so each tab can be exercised without a real
 * network. We assert:
 *   - Overview tab default renders billboard + quick links
 *   - PRD/STATE/INFERENCE tabs render the planning body via MarkdownTab
 *   - INFERENCE tab is hidden when planning has no inference content
 *   - Clicking a quick link switches the active tab
 *   - Costs tab renders byStage / byModel rows
 *   - PR/Diff tab renders via PrDiffTab (empty state)
 *   - Discussions tab renders via DiscussionsTab (empty state)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../DialogProvider', () => ({
  useConfirm: () => vi.fn(async () => true),
  useAlert: () => vi.fn(async () => undefined),
}));

import { ZoneCOverview } from '../ZoneCOverview';

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const planningResult = vi.hoisted(() => ({
  data: undefined as undefined | Record<string, unknown>,
  isLoading: false,
}));
const planningSummaryResult = vi.hoisted(() => ({
  data: undefined as undefined | Record<string, unknown>,
  isLoading: false,
}));
const activityResult = vi.hoisted(() => ({
  data: undefined as undefined | Record<string, unknown>,
  isLoading: false,
}));
const costsResult = vi.hoisted(() => ({
  data: undefined as undefined | Record<string, unknown>,
  isLoading: false,
  isError: false,
}));
const costStreamResult = vi.hoisted(() => ({
  issueCost: 0,
  issueEvents: [] as Array<Record<string, unknown>>,
  isLoading: false,
  error: null as Error | null,
}));
const prResult = vi.hoisted(() => ({
  data: undefined as undefined | Record<string, unknown>,
  isLoading: false,
  isError: false,
}));
const discussionsResult = vi.hoisted(() => ({
  data: undefined as undefined | Record<string, unknown>,
  isLoading: false,
  isError: false,
}));
const reviewStatusResult = vi.hoisted(() => ({
  data: undefined as undefined | Record<string, unknown>,
  isLoading: false,
  isError: false,
}));

vi.mock('../ZoneCOverviewTabs/queries', () => ({
  usePlanningQuery: () => planningResult,
  usePlanningSummaryQuery: () => planningSummaryResult,
  useActivityQuery: () => activityResult,
  useIssueCostsQuery: () => costsResult,
  usePrQuery: () => prResult,
  usePrDiffQuery: () => prResult,
  useDiscussionsQuery: () => discussionsResult,
  useReviewStatusQuery: () => reviewStatusResult,
  useWorkspaceQuery: () => ({ data: undefined, isLoading: false, isError: false }),
}));

vi.mock('../../../hooks/useCostStream', () => ({
  useIssueCostStream: () => costStreamResult,
}));

// Beads + ActivityTab + VBriefTab embed components that hit other code paths;
// stub them out so this test stays focused on tab routing.
vi.mock('../ZoneCOverviewTabs/BeadsTab', () => ({
  BeadsTab: ({ issueId }: { issueId: string }) => (
    <div data-testid="beads-tab-stub" data-issue={issueId} />
  ),
}));
vi.mock('../ZoneCOverviewTabs/VBriefTab', () => ({
  VBriefTab: ({ issueId }: { issueId: string }) => (
    <div data-testid="vbrief-tab-stub" data-issue={issueId} />
  ),
}));
vi.mock('../ZoneCOverviewTabs/ActivityTab', () => ({
  ActivityTab: ({ issueId }: { issueId: string }) => (
    <div
      data-testid="activity-tab-stub"
      data-issue={issueId}
    />
  ),
}));

const ISSUE = 'PAN-830';

describe('ZoneCOverview', () => {
  beforeEach(() => {
    planningResult.data = undefined;
    planningResult.isLoading = false;
    planningSummaryResult.data = undefined;
    planningSummaryResult.isLoading = false;
    activityResult.data = { issueId: ISSUE, sections: [], resolvedTotalCost: null };
    activityResult.isLoading = false;
    costsResult.data = undefined;
    costsResult.isLoading = false;
    costsResult.isError = false;
    prResult.data = { issueId: ISSUE, pr: null, diff: null };
    prResult.isLoading = false;
    prResult.isError = false;
    discussionsResult.data = { issueId: ISSUE, items: [], prNumber: null };
    discussionsResult.isLoading = false;
    discussionsResult.isError = false;
    reviewStatusResult.data = undefined;
    reviewStatusResult.isLoading = false;
    reviewStatusResult.isError = false;
    costStreamResult.issueCost = 0;
    costStreamResult.issueEvents = [];
    costStreamResult.isLoading = false;
    costStreamResult.error = null;
  });

  it('renders the Overview tab body by default', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    expect(screen.getByTestId('zone-c-overview')).toBeInTheDocument();
    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
    expect(screen.getByTestId('overview-billboard')).toBeInTheDocument();
    expect(screen.getByTestId('overview-quick-links')).toBeInTheDocument();
    expect(screen.getByTestId('overview-stage')).toHaveTextContent('idle');
  });

  it('hides the INFERENCE tab when planning summary reports no inference', () => {
    planningSummaryResult.data = { hasPrd: true, hasState: true, hasInference: false };
    render(<ZoneCOverview issueId={ISSUE} />);
    expect(screen.queryByTestId('zone-c-overview-tab-inference')).not.toBeInTheDocument();
  });

  it('shows INFERENCE tab when planning summary reports inference', () => {
    planningSummaryResult.data = { hasInference: true };
    render(<ZoneCOverview issueId={ISSUE} />);
    expect(screen.getByTestId('zone-c-overview-tab-inference')).toBeInTheDocument();
  });

  it('switches to PRD tab and renders the body via MarkdownTab', () => {
    planningResult.data = { prd: 'PRD body content' };
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('zone-c-overview-tab-prd'));
    expect(screen.getByTestId('markdown-tab')).toBeInTheDocument();
    expect(screen.getByTestId('markdown-tab').textContent).toContain('PRD body content');
  });

  it('shows the empty state with the Generate PRD hint when PRD body is missing', () => {
    planningResult.data = { state: 'state only' };
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('zone-c-overview-tab-prd'));
    expect(screen.getByTestId('markdown-tab-empty')).toHaveTextContent(
      'No PRD recorded for this issue. Generate PRD from planning to populate this tab.',
    );
  });

  it('switches to Costs tab and renders byStage rows', () => {
    costsResult.data = {
      issueId: ISSUE,
      totalCost: 1.23,
      resolvedTotalCost: 1.23,
      totalTokens: 4500,
      sessions: [],
      byModel: { 'claude-sonnet-4-6': { cost: 1.23, tokens: 4500 } },
      byStage: { planning: { cost: 0.5, tokens: 1500 }, work: { cost: 0.73, tokens: 3000 } },
    };
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('zone-c-overview-tab-costs'));
    expect(screen.getByTestId('costs-tab')).toBeInTheDocument();
    expect(screen.getByTestId('costs-by-stage-row-planning')).toBeInTheDocument();
    expect(screen.getByTestId('costs-by-stage-row-work')).toBeInTheDocument();
    expect(screen.getByTestId('costs-by-model-row-claude-sonnet-4-6')).toBeInTheDocument();
  });

  it('renders the PR/Diff tab via PrDiffTab', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('zone-c-overview-tab-prdiff'));
    // No PR yet → empty state body
    expect(screen.getByTestId('prdiff-tab-empty')).toBeInTheDocument();
    expect(screen.getByTestId('prdiff-tab-empty').textContent).toContain('feature/pan-830');
  });

  it('renders the Discussions tab via DiscussionsTab', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('zone-c-overview-tab-discussions'));
    expect(screen.getByTestId('discussions-tab')).toBeInTheDocument();
    expect(screen.getByTestId('discussions-tab-empty')).toBeInTheDocument();
  });

  it('passes the issue id to the Activity tab', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('zone-c-overview-tab-activity'));
    expect(screen.getByTestId('activity-tab-stub')).toHaveAttribute('data-issue', ISSUE);
  });

  it('quick-link buttons in Overview switch tabs', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('overview-link-beads'));
    expect(screen.getByTestId('beads-tab-stub')).toBeInTheDocument();
  });

  it('quick-link footer shows links for beads, costs, activity', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    expect(screen.getByTestId('overview-link-beads')).toBeInTheDocument();
    expect(screen.getByTestId('overview-link-costs')).toBeInTheDocument();
    expect(screen.getByTestId('overview-link-activity')).toBeInTheDocument();
  });

  it('keeps aggregate costs visible when the live stream reports a transient error', () => {
    costsResult.data = {
      issueId: ISSUE,
      totalCost: 1.23,
      resolvedTotalCost: 1.23,
      totalTokens: 4500,
      sessions: [],
      byModel: { 'claude-sonnet-4-6': { cost: 1.23, tokens: 4500 } },
      byStage: { work: { cost: 1.23, tokens: 4500 } },
    };
    costStreamResult.issueCost = 0.5;
    costStreamResult.issueEvents = [{ cost: 0.5 }];
    costStreamResult.error = new Error('stream hiccup');

    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('zone-c-overview-tab-costs'));

    expect(screen.getByTestId('costs-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('costs-tab-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('costs-total')).toHaveTextContent('$1.23');
    expect(screen.getByTestId('costs-stream-total')).toHaveTextContent('Live stream: $0.50');
  });

  it('prefers the resolved unified cost when issue costs and activity disagree', () => {
    costsResult.data = {
      issueId: ISSUE,
      totalCost: 4.32,
      resolvedTotalCost: 5.1,
      totalTokens: 4500,
      sessions: [],
      byModel: {},
      byStage: {},
    };
    activityResult.data = { issueId: ISSUE, sections: [], resolvedTotalCost: 3.25 };

    render(<ZoneCOverview issueId={ISSUE} />);

    expect(screen.getByTestId('overview-cost')).toHaveTextContent('$5.10');
  });

  it('shows no overview amount when neither aggregate nor live cost exists', () => {
    costsResult.data = {
      issueId: ISSUE,
      totalCost: 0,
      resolvedTotalCost: null,
      totalTokens: 0,
      sessions: [],
      byModel: {},
      byStage: {},
    };
    activityResult.data = { issueId: ISSUE, sections: [], resolvedTotalCost: null };

    render(<ZoneCOverview issueId={ISSUE} />);

    expect(screen.queryByTestId('overview-cost-loading')).not.toBeInTheDocument();
    expect(screen.getByTestId('overview-cost')).not.toHaveTextContent('$0.00');
  });

  it('falls back to the activity headline when the costs endpoint returns null', () => {
    costsResult.data = {
      issueId: ISSUE,
      totalCost: 0,
      resolvedTotalCost: null,
      totalTokens: 0,
      sessions: [],
      byModel: {},
      byStage: {},
    };
    activityResult.data = { issueId: ISSUE, sections: [], resolvedTotalCost: 2.75 };

    render(<ZoneCOverview issueId={ISSUE} />);

    expect(screen.getByTestId('overview-cost')).toHaveTextContent('$2.75');
  });
});
