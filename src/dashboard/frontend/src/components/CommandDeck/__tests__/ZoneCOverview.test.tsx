/**
 * ZoneCOverview tests — verify tab strip + per-tab dispatch (PAN-830, pan-ofa3).
 *
 * Mocks the shared query hooks so each tab can be exercised without a real
 * network. We assert:
 *   - Overview tab default renders billboard + quick links
 *   - PRD/STATE/INFERENCE tabs render the planning body via MarkdownTab
 *   - All 10 tabs are always visible, including INFERENCE
 *   - Clicking a quick link switches the active tab
 *   - Costs tab renders byStage / byModel rows
 *   - PR/Diff tab renders via PrDiffTab (empty state)
 *   - Discussions tab renders via DiscussionsTab (empty state)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoneCOverview } from '../ZoneCOverview';

vi.mock('../../DialogProvider', () => ({
  useConfirm: () => vi.fn(async () => true),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

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
  data: undefined as undefined | {
    issueId: string;
    reviewStatus: string;
    testStatus: string;
    mergeStatus?: string;
    verificationStatus?: string;
    readyForMerge: boolean;
    updatedAt: string;
  },
  isLoading: false,
  isError: false,
}));
const workspaceResult = vi.hoisted(() => ({
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
  useWorkspaceQuery: () => workspaceResult,
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
    <div data-testid="activity-tab-stub" data-issue={issueId} />
  ),
}));

const ISSUE = 'PAN-830';

describe('ZoneCOverview', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/command-deck');
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
    workspaceResult.data = { exists: false, issueId: ISSUE };
    workspaceResult.isLoading = false;
    workspaceResult.isError = false;
  });

  it('renders the Overview tab body by default', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    expect(screen.getByTestId('zone-c-overview')).toBeInTheDocument();
    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
    expect(screen.getByTestId('overview-billboard')).toBeInTheDocument();
    expect(screen.getByTestId('overview-quick-links')).toBeInTheDocument();
    expect(screen.getByTestId('overview-stage')).toHaveTextContent('idle');
  });

  it('always renders all 10 tabs, including INFERENCE without planning content', () => {
    planningResult.data = { prd: '# PRD', state: '# STATE' };
    render(<ZoneCOverview issueId={ISSUE} />);
    expect(screen.getByTestId('zone-c-overview-tab-inference')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(10);
  });

  it('shows INFERENCE empty state when no inference content exists', () => {
    planningResult.data = { prd: '# PRD', state: '# STATE' };
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('zone-c-overview-tab-inference'));
    expect(screen.getByTestId('markdown-tab-empty')).toHaveTextContent(
      'No INFERENCE.md recorded',
    );
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

  it('shows Recover in the Actions tile when the review pipeline is stuck', () => {
    reviewStatusResult.data = {
      issueId: ISSUE,
      reviewStatus: 'failed',
      testStatus: 'failed',
      mergeStatus: 'failed',
      verificationStatus: 'failed',
      readyForMerge: false,
      updatedAt: new Date().toISOString(),
    };

    render(<ZoneCOverview issueId={ISSUE} />);
    expect(screen.getByTestId('overview-action-recover')).toBeInTheDocument();
  });

  it('caps recent activity at 10 events', () => {
    activityResult.data = {
      issueId: ISSUE,
      sections: Array.from({ length: 12 }, (_, index) => ({
        type: 'work',
        sessionId: `session-${index}`,
        model: `model-${index}`,
        startedAt: new Date(Date.now() + index * 1000).toISOString(),
        duration: null,
        status: 'running',
      })),
    };

    render(<ZoneCOverview issueId={ISSUE} />);
    expect(screen.getByTestId('overview-activity-list').querySelectorAll('li')).toHaveLength(10);
    expect(screen.queryByText('model-1')).not.toBeInTheDocument();
    expect(screen.getByText('model-11')).toBeInTheDocument();
  });

  it('falls back to frontend/api links when services is an empty array', () => {
    workspaceResult.data = {
      exists: true,
      issueId: ISSUE,
      services: [],
      frontendUrl: 'http://localhost:4173',
      apiUrl: 'http://localhost:3011',
    };

    render(<ZoneCOverview issueId={ISSUE} />);
    expect(screen.getByRole('link', { name: 'Frontend ↗' })).toHaveAttribute('href', 'http://localhost:4173');
    expect(screen.getByRole('link', { name: 'API ↗' })).toHaveAttribute('href', 'http://localhost:3011');
  });

  it('renders Open VS Code as a vscode:// workspace link', () => {
    workspaceResult.data = {
      exists: true,
      issueId: ISSUE,
      path: '/tmp/pan-865',
    };

    render(<ZoneCOverview issueId={ISSUE} />);
    expect(screen.getByRole('link', { name: 'Open VS Code' })).toHaveAttribute(
      'href',
      'vscode://file//tmp/pan-865',
    );
  });

  it('labels linear issue links as Linear', () => {
    render(
      <ZoneCOverview
        issueId={ISSUE}
        issue={{
          identifier: ISSUE,
          title: 'Zone C overview',
          status: 'in_progress',
          source: 'linear',
          url: 'https://linear.app/example/issue/PAN-865',
        }}
      />,
    );

    expect(screen.getByRole('link', { name: 'Linear ↗' })).toHaveAttribute(
      'href',
      'https://linear.app/example/issue/PAN-865',
    );
    expect(screen.queryByRole('link', { name: 'GitHub Issue ↗' })).not.toBeInTheDocument();
  });

  it('syncs active tab to the URL query string', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('zone-c-overview-tab-costs'));
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('costs');
  });

  it('initializes the active tab from the URL query string', () => {
    window.history.replaceState({}, '', '/command-deck?tab=costs');
    costsResult.data = {
      issueId: ISSUE,
      totalCost: 1.23,
      totalTokens: 4500,
      sessions: [],
      byModel: { 'claude-sonnet-4-6': { cost: 1.23, tokens: 4500 } },
      byStage: { planning: { cost: 0.5, tokens: 1500 } },
    };

    render(<ZoneCOverview issueId={ISSUE} />);
    expect(screen.getByTestId('costs-tab')).toBeInTheDocument();
    expect(screen.getByTestId('zone-c-overview-tab-costs')).toHaveAttribute('aria-selected', 'true');
  });

  it('supports arrow-key tab navigation', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(screen.getByTestId('activity-tab-stub')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('activity');

    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('overview');
  });

  it('supports Home and End navigation inside the tab strip', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    const tablist = screen.getByRole('tablist');

    fireEvent.click(screen.getByTestId('zone-c-overview-tab-costs'));
    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();

    fireEvent.keyDown(tablist, { key: 'End' });
    expect(screen.getByTestId('discussions-tab')).toBeInTheDocument();
  });

  it('does not trap focus on Tab and Shift-Tab', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'Tab' });
    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();

    fireEvent.keyDown(tablist, { key: 'Tab', shiftKey: true });
    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
  });
});
