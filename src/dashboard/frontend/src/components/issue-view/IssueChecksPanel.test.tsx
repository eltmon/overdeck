import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IssueChecksPanel } from './IssueChecksPanel';

const useIssueCheckRunsQueryMock = vi.fn();

vi.mock('../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  useIssueCheckRunsQuery: (...args: unknown[]) => useIssueCheckRunsQueryMock(...args),
}));

describe('IssueChecksPanel', () => {
  it('says so when there is no pull request', () => {
    useIssueCheckRunsQueryMock.mockReturnValue({
      isLoading: false,
      data: { issueId: 'PAN-1', pr: null, checkRuns: [], summary: { total: 0, passed: 0, failed: 0, running: 0, skipped: 0, pending: 0, cancelled: 0 } },
    });

    render(<IssueChecksPanel issueId="PAN-1" />);

    expect(screen.getByText('No pull request yet')).toBeInTheDocument();
  });

  it('counts passed checks and links the pull request', () => {
    useIssueCheckRunsQueryMock.mockReturnValue({
      isLoading: false,
      data: {
        issueId: 'PAN-1',
        pr: { number: 1661, url: 'https://github.com/eltmon/overdeck/pull/1661' },
        checkRuns: [
          { id: 1, name: 'lint', status: 'completed', conclusion: 'success' },
          { id: 2, name: 'test', status: 'completed', conclusion: 'failure' },
        ],
        summary: { total: 2, passed: 1, failed: 1, running: 0, skipped: 0, pending: 0, cancelled: 0 },
      },
    });

    render(<IssueChecksPanel issueId="PAN-1" />);

    expect(screen.getByText(/1 of 2 checks passed on/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#1661' })).toHaveAttribute('href', 'https://github.com/eltmon/overdeck/pull/1661');
  });

  it('lists each check run with its state', () => {
    useIssueCheckRunsQueryMock.mockReturnValue({
      isLoading: false,
      data: {
        issueId: 'PAN-1',
        pr: { number: 1661, url: 'https://github.com/eltmon/overdeck/pull/1661' },
        checkRuns: [
          { id: 1, name: 'lint', status: 'completed', conclusion: 'success' },
          { id: 2, name: 'test', status: 'completed', conclusion: 'failure' },
        ],
        summary: { total: 2, passed: 1, failed: 1, running: 0, skipped: 0, pending: 0, cancelled: 0 },
      },
    });

    render(<IssueChecksPanel issueId="PAN-1" />);

    const lintRow = screen.getByText('lint').closest('[data-check-state]');
    const testRow = screen.getByText('test').closest('[data-check-state]');
    expect(lintRow).toHaveAttribute('data-check-state', 'pass');
    expect(testRow).toHaveAttribute('data-check-state', 'fail');
    expect(testRow).toHaveTextContent('failure');
  });

  it('a run with a URL is a link', () => {
    useIssueCheckRunsQueryMock.mockReturnValue({
      isLoading: false,
      data: {
        issueId: 'PAN-1',
        pr: { number: 1661, url: 'https://github.com/eltmon/overdeck/pull/1661' },
        checkRuns: [
          { id: 1, name: 'lint', status: 'completed', conclusion: 'success', htmlUrl: 'https://github.com/eltmon/overdeck/actions/runs/1' },
        ],
        summary: { total: 1, passed: 1, failed: 0, running: 0, skipped: 0, pending: 0, cancelled: 0 },
      },
    });

    render(<IssueChecksPanel issueId="PAN-1" />);

    expect(screen.getByText('lint').closest('a')).toHaveAttribute('href', 'https://github.com/eltmon/overdeck/actions/runs/1');
  });

  it('shows the query error', () => {
    useIssueCheckRunsQueryMock.mockReturnValue({
      isLoading: false,
      data: {
        issueId: 'PAN-1',
        pr: null,
        checkRuns: [],
        summary: { total: 0, passed: 0, failed: 0, running: 0, skipped: 0, pending: 0, cancelled: 0 },
        error: 'Failed to load checks',
      },
    });

    render(<IssueChecksPanel issueId="PAN-1" />);

    expect(screen.getByText('Failed to load checks')).toBeInTheDocument();
  });
});
