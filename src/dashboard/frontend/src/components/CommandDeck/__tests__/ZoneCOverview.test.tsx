/**
 * ZoneCOverview tests — verify tab strip + scoped PAN-865 body behavior.
 *
 * PAN-865 ships the Overview body only. The other nine tabs must remain present
 * in the tab strip but render a shared "Coming soon" placeholder until PAN-866.
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
  usePlanningSummaryQuery: () => planningResult,
  useActivityQuery: () => activityResult,
  useIssueCostsQuery: () => costsResult,
  usePrQuery: () => prResult,
  useDiscussionsQuery: () => discussionsResult,
  useReviewStatusQuery: () => reviewStatusResult,
  useWorkspaceQuery: () => workspaceResult,
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

  it('renders a shared placeholder body for INFERENCE', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('zone-c-overview-tab-inference'));
    expect(screen.getByTestId('zone-c-overview-placeholder')).toHaveTextContent('Coming soon');
  });

  it('renders a shared placeholder body for PRD', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('zone-c-overview-tab-prd'));
    expect(screen.getByTestId('zone-c-overview-placeholder')).toHaveTextContent('Coming soon');
  });

  it('renders a shared placeholder body for Costs', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('zone-c-overview-tab-costs'));
    expect(screen.getByTestId('zone-c-overview-placeholder')).toHaveTextContent('Coming soon');
  });

  it('renders a shared placeholder body for PR/Diff', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('zone-c-overview-tab-prdiff'));
    expect(screen.getByTestId('zone-c-overview-placeholder')).toHaveTextContent('Coming soon');
  });

  it('renders a shared placeholder body for Discussions', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('zone-c-overview-tab-discussions'));
    expect(screen.getByTestId('zone-c-overview-placeholder')).toHaveTextContent('Coming soon');
  });

  it('quick-link buttons in Overview switch tabs to placeholders', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    fireEvent.click(screen.getByTestId('overview-link-vbrief'));
    expect(screen.getByTestId('zone-c-overview-placeholder')).toHaveTextContent('Coming soon');
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

  it('filters out services without urls before rendering links', () => {
    workspaceResult.data = {
      exists: true,
      issueId: ISSUE,
      services: [
        { name: 'Frontend', url: 'http://localhost:4173' },
        { name: 'API', url: undefined },
      ],
    };

    render(<ZoneCOverview issueId={ISSUE} />);
    expect(screen.getByRole('link', { name: 'Frontend ↗' })).toHaveAttribute('href', 'http://localhost:4173');
    expect(screen.queryByRole('link', { name: 'API ↗' })).not.toBeInTheDocument();
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

  it('does not push url state in controlled mode when the parent keeps the same tab', () => {
    render(
      <ZoneCOverview
        issueId={ISSUE}
        activeTab="overview"
        onTabChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId('zone-c-overview-tab-costs'));
    expect(new URLSearchParams(window.location.search).get('tab')).toBeNull();
    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
  });

  it('initializes the active tab from the URL query string', () => {
    window.history.replaceState({}, '', '/command-deck?tab=costs');

    render(<ZoneCOverview issueId={ISSUE} />);
    expect(screen.getByTestId('zone-c-overview-placeholder')).toHaveTextContent('Coming soon');
    expect(screen.getByTestId('zone-c-overview-tab-costs')).toHaveAttribute('aria-selected', 'true');
  });

  it('supports arrow-key tab navigation', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(screen.getByTestId('zone-c-overview-placeholder')).toHaveTextContent('Coming soon');
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
    expect(screen.getByTestId('zone-c-overview-placeholder')).toHaveTextContent('Coming soon');
  });

  it('leaves Tab and Shift-Tab for standard focus navigation', () => {
    render(<ZoneCOverview issueId={ISSUE} />);
    const tablist = screen.getByRole('tablist');

    fireEvent.keyDown(tablist, { key: 'Tab' });
    expect(screen.getByTestId('zone-c-overview-tab-overview')).toHaveAttribute('aria-selected', 'true');
    expect(window.location.search).toBe('');

    fireEvent.keyDown(tablist, { key: 'Tab', shiftKey: true });
    expect(screen.getByTestId('zone-c-overview-tab-overview')).toHaveAttribute('aria-selected', 'true');
    expect(window.location.search).toBe('');
  });
});
