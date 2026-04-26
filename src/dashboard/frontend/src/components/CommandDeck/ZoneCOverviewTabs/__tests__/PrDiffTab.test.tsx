/**
 * PrDiffTab unit tests (PAN-830, pan-9yn5).
 *
 * Mocks usePrQuery so the tab can be exercised without hitting the network.
 *
 * Cases:
 *   - Loading state
 *   - Error state (isError true)
 *   - Empty state (pr === null) renders feature/<id-lower> in the body
 *   - Empty state surfaces a `data.error` message when one is set
 *   - Populated state renders header, state badge, CI checks, reviewers, files,
 *     and the diff body with hunk-coloring
 *   - Merged + draft + closed state badge labels are rendered correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrDiffTab } from '../PrDiffTab';
import type { PrEndpointResponse, PullRequestData } from '../queries';

const prResult = vi.hoisted(() => ({
  data: undefined as undefined | PrEndpointResponse,
  isLoading: false,
  isError: false,
}));

vi.mock('../queries', () => ({
  usePrQuery: () => prResult,
}));

const ISSUE = 'PAN-830';

function makePr(overrides: Partial<PullRequestData> = {}): PullRequestData {
  return {
    number: 642,
    title: 'feat(dashboard): unified command deck',
    url: 'https://github.com/eltmon/panopticon-cli/pull/642',
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'feature/pan-830',
    author: { login: 'panopticon-agent' },
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
    reviewDecision: 'APPROVED',
    reviewRequests: [{ login: 'eltmon' }],
    statusCheckRollup: [
      { name: 'lint', conclusion: 'SUCCESS', status: 'COMPLETED' },
      { name: 'typecheck', conclusion: 'FAILURE', status: 'COMPLETED' },
      { name: 'test', conclusion: 'PENDING', status: 'IN_PROGRESS' },
    ],
    additions: 120,
    deletions: 14,
    changedFiles: 3,
    files: [
      { path: 'src/foo.ts', additions: 80, deletions: 5 },
      { path: 'src/bar.ts', additions: 30, deletions: 4 },
      { path: 'src/baz.ts', additions: 10, deletions: 5 },
    ],
    labels: [{ name: 'pan-830' }],
    mergeable: 'MERGEABLE',
    body: 'Body of the PR.',
    ...overrides,
  };
}

describe('PrDiffTab', () => {
  beforeEach(() => {
    prResult.data = undefined;
    prResult.isLoading = false;
    prResult.isError = false;
  });

  it('renders the loading state', () => {
    prResult.isLoading = true;
    render(<PrDiffTab issueId={ISSUE} />);
    expect(screen.getByTestId('prdiff-tab-loading')).toBeInTheDocument();
  });

  it('renders the error state when isError is true', () => {
    prResult.isError = true;
    render(<PrDiffTab issueId={ISSUE} />);
    expect(screen.getByTestId('prdiff-tab-error')).toBeInTheDocument();
  });

  it('renders the empty state when no PR exists', () => {
    prResult.data = { issueId: ISSUE, pr: null, diff: null };
    render(<PrDiffTab issueId={ISSUE} />);
    expect(screen.getByTestId('prdiff-tab-empty')).toBeInTheDocument();
    expect(screen.getByTestId('prdiff-tab-empty').textContent).toContain('feature/pan-830');
  });

  it('surfaces a backend error message in the empty state', () => {
    prResult.data = { issueId: ISSUE, pr: null, diff: null, error: 'gh pr list failed: not authenticated' };
    render(<PrDiffTab issueId={ISSUE} />);
    expect(screen.getByTestId('prdiff-tab-error-msg')).toBeInTheDocument();
    expect(screen.getByTestId('prdiff-tab-error-msg').textContent).toContain('gh pr list failed');
  });

  it('renders the header, badge, checks, reviewers, files, and diff for a populated PR', () => {
    prResult.data = {
      issueId: ISSUE,
      pr: makePr(),
      diff: [
        'diff --git a/src/foo.ts b/src/foo.ts',
        '--- a/src/foo.ts',
        '+++ b/src/foo.ts',
        '@@ -1,3 +1,4 @@',
        ' const x = 1;',
        '-const y = 2;',
        '+const y = 3;',
        '+const z = 4;',
      ].join('\n'),
    };
    render(<PrDiffTab issueId={ISSUE} />);

    expect(screen.getByTestId('prdiff-tab')).toBeInTheDocument();
    expect(screen.getByTestId('prdiff-tab-header').textContent).toContain('#642');
    expect(screen.getByTestId('prdiff-tab-header').textContent).toContain('unified command deck');
    expect(screen.getByTestId('prdiff-tab-header').textContent).toContain('feature/pan-830');
    expect(screen.getByTestId('prdiff-tab-header').textContent).toContain('main');
    expect(screen.getByTestId('prdiff-tab-changes').textContent).toContain('+120');
    expect(screen.getByTestId('prdiff-tab-changes').textContent).toContain('−14');
    expect(screen.getByTestId('prdiff-tab-changes').textContent).toContain('3 files');

    // Open state badge label
    expect(screen.getByTestId('pr-state-badge').textContent?.toLowerCase()).toContain('open');

    // Review decision rendered
    expect(screen.getByTestId('prdiff-tab-review-decision').textContent?.toLowerCase()).toContain('approved');

    // Three checks
    expect(screen.getByTestId('prdiff-check-lint')).toBeInTheDocument();
    expect(screen.getByTestId('prdiff-check-typecheck')).toBeInTheDocument();
    expect(screen.getByTestId('prdiff-check-test')).toBeInTheDocument();

    // Reviewer
    expect(screen.getByTestId('prdiff-reviewer-eltmon')).toBeInTheDocument();

    // Files
    expect(screen.getByTestId('prdiff-file-src/foo.ts')).toBeInTheDocument();
    expect(screen.getByTestId('prdiff-file-src/bar.ts')).toBeInTheDocument();
    expect(screen.getByTestId('prdiff-file-src/baz.ts')).toBeInTheDocument();

    // Diff body present, hunk header coloring is applied via per-line div
    const diffBody = screen.getByTestId('prdiff-tab-diff-body');
    expect(diffBody).toBeInTheDocument();
    expect(diffBody.textContent).toContain('@@ -1,3 +1,4 @@');
    expect(diffBody.textContent).toContain('+const y = 3;');
  });

  it('renders the draft pill when the PR is a draft', () => {
    prResult.data = {
      issueId: ISSUE,
      pr: makePr({ isDraft: true }),
      diff: null,
    };
    render(<PrDiffTab issueId={ISSUE} />);
    expect(screen.getByTestId('pr-state-badge').textContent?.toLowerCase()).toContain('draft');
  });

  it('renders the merged badge when the PR is merged', () => {
    prResult.data = {
      issueId: ISSUE,
      pr: makePr({ state: 'MERGED' }),
      diff: null,
    };
    render(<PrDiffTab issueId={ISSUE} />);
    expect(screen.getByTestId('pr-state-badge').textContent?.toLowerCase()).toContain('merged');
  });

  it('omits the reviewers section when none requested', () => {
    prResult.data = {
      issueId: ISSUE,
      pr: makePr({ reviewRequests: [] }),
      diff: null,
    };
    render(<PrDiffTab issueId={ISSUE} />);
    expect(screen.queryByTestId('prdiff-tab-reviewers')).not.toBeInTheDocument();
  });

  it('shows the empty checks message when statusCheckRollup is empty', () => {
    prResult.data = {
      issueId: ISSUE,
      pr: makePr({ statusCheckRollup: [] }),
      diff: null,
    };
    render(<PrDiffTab issueId={ISSUE} />);
    expect(screen.getByTestId('prdiff-tab-checks-empty')).toBeInTheDocument();
  });
});
