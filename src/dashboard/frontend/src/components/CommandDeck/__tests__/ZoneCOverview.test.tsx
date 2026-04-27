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
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoneCOverview } from '../ZoneCOverview';

const planningResult = vi.hoisted(() => ({
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
  useActivityQuery: () => activityResult,
  useIssueCostsQuery: () => costsResult,
  usePrQuery: () => prResult,
  useDiscussionsQuery: () => discussionsResult,
  useReviewStatusQuery: () => reviewStatusResult,
}));

vi.mock('../../../hooks/useCostStream', () => ({
  useIssueCostStream: () => ({
    issueCost: 0,
    issueEvents: [],
    isLoading: false,
    error: null,
  }),
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
  ActivityTab: ({ issueId, issues, featureData }: { issueId: string; issues?: unknown[]; featureData?: unknown }) => (
    <div
      data-testid="activity-tab-stub"
      data-issue={issueId}
      data-issues={issues ? issues.length : 0}
      data-feature={featureData ? 'present' : 'missing'}
    />
  ),
}));

const ISSUE = 'PAN-830';

describe('ZoneCOverview', () => {
  beforeEach(() => {
    planningResult.data = undefined;
    planningResult.isLoading = false;
    activityResult.data = { issueId: ISSUE, sections: [] };
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
  });

  it('renders the Overview tab body by default', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    expect(screen.getByTestId('zone-c-overview')).toBeInTheDocument();
    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
    expect(screen.getByTestId('overview-billboard')).toBeInTheDocument();
    expect(screen.getByTestId('overview-quick-links')).toBeInTheDocument();
    expect(screen.getByTestId('overview-stage')).toHaveTextContent('idle');
  });

  it('hides the INFERENCE tab when planning has no inference content', () => {
    planningResult.data = { prd: '# PRD', state: '# STATE' };
    render(<ZoneCOverview issueId={ISSUE} />);
    expect(screen.queryByTestId('zone-c-overview-tab-inference')).not.toBeInTheDocument();
  });

  it('shows INFERENCE tab when planning has inference content', () => {
    planningResult.data = { inference: '# Inference body' };
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

  it('shows the empty state when PRD body is missing', () => {
    planningResult.data = { state: 'state only' };
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('zone-c-overview-tab-prd'));
    expect(screen.getByTestId('markdown-tab-empty')).toHaveTextContent(
      'No PRD recorded',
    );
  });

  it('switches to Costs tab and renders byStage rows', () => {
    costsResult.data = {
      issueId: ISSUE,
      totalCost: 1.23,
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
    render(
      <ZoneCOverview
        issueId={ISSUE}
        issues={[{ id: '1' }, { id: '2' }] as any[]}
        featureData={{ issueId: ISSUE } as any}
      />,
    );
    fireEvent.click(screen.getByTestId('zone-c-overview-tab-activity'));
    expect(screen.getByTestId('activity-tab-stub')).toHaveAttribute('data-issue', ISSUE);
  });

  it('quick-link buttons in Overview switch tabs', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('overview-link-vbrief'));
    expect(screen.getByTestId('vbrief-tab-stub')).toBeInTheDocument();
  });

  it('quick-link footer shows links for prd, vbrief, beads, costs, activity', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    expect(screen.getByTestId('overview-link-prd')).toBeInTheDocument();
    expect(screen.getByTestId('overview-link-vbrief')).toBeInTheDocument();
    expect(screen.getByTestId('overview-link-beads')).toBeInTheDocument();
    expect(screen.getByTestId('overview-link-costs')).toBeInTheDocument();
    expect(screen.getByTestId('overview-link-activity')).toBeInTheDocument();
  });
});
