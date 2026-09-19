/**
 * PAN-3917 w1-plan-home: `pan admin migrate-plan-home`'s open-issue filter
 * and id mapping. Pure — fixtures shaped like each tracker's normalized
 * `Issue` output, no network access.
 *
 * Regression coverage for the bug reported against the first version: the
 * GitHub tracker's `ref` is a bare `#<number>` with no team/prefix (unlike
 * Linear's `MIN-902`-shaped identifier), so a `ref.startsWith(prefix + '-')`
 * filter silently matched zero GitHub issues.
 */
import { describe, expect, it } from 'vitest';

import type { Issue } from '../../../src/lib/tracker/interface.js';
import {
  filterOpenIssueIds,
  issueIdFromTrackerIssue,
} from '../../../src/cli/commands/admin/migrate-plan-home.js';

function githubIssue(overrides: Partial<Issue>): Issue {
  return {
    id: 'gh-1',
    ref: '#1',
    title: 'issue',
    description: '',
    state: 'open',
    labels: [],
    url: 'https://github.com/eltmon/overdeck/issues/1',
    tracker: 'github',
    ...overrides,
  };
}

function linearIssue(overrides: Partial<Issue>): Issue {
  return {
    id: 'lin-1',
    ref: 'MIN-1',
    title: 'issue',
    description: '',
    state: 'open',
    labels: [],
    url: 'https://linear.app/x/issue/MIN-1',
    tracker: 'linear',
    ...overrides,
  };
}

describe('issueIdFromTrackerIssue', () => {
  it('combines the bare GitHub ref with the project issue_prefix', () => {
    expect(issueIdFromTrackerIssue(githubIssue({ ref: '#3841' }), 'github', 'PAN')).toBe('PAN-3841');
  });

  it('uses the Linear identifier as-is (already team-prefixed)', () => {
    expect(issueIdFromTrackerIssue(linearIssue({ ref: 'MIN-1039' }), 'linear', 'MIN')).toBe('MIN-1039');
  });
});

describe('filterOpenIssueIds', () => {
  it('keeps GitHub issues open in the tracker and drops closed ones', () => {
    const issues: Issue[] = [
      githubIssue({ ref: '#3841', state: 'open' }),
      githubIssue({ ref: '#3842', state: 'closed' }),
      githubIssue({ ref: '#3843', state: 'in_progress' }),
      githubIssue({ ref: '#3844', state: 'in_review' }),
    ];
    expect(filterOpenIssueIds(issues, 'github', 'PAN')).toEqual(['PAN-3841', 'PAN-3843', 'PAN-3844']);
  });

  it('keeps Linear issues open in the tracker and drops closed ones', () => {
    const issues: Issue[] = [
      linearIssue({ ref: 'MIN-1030', state: 'open' }),
      linearIssue({ ref: 'MIN-1031', state: 'closed' }),
      linearIssue({ ref: 'MIN-1032', state: 'in_progress' }),
    ];
    expect(filterOpenIssueIds(issues, 'linear', 'MIN')).toEqual(['MIN-1030', 'MIN-1032']);
  });

  it('drops issues from another team even when they slip through the tracker filter', () => {
    const issues: Issue[] = [
      linearIssue({ ref: 'MIN-1', state: 'open' }),
      linearIssue({ ref: 'TIN-1', state: 'open' }),
    ];
    expect(filterOpenIssueIds(issues, 'linear', 'MIN')).toEqual(['MIN-1']);
  });

  it('returns every open GitHub issue, not just the first page (large repo shape)', () => {
    const issues: Issue[] = Array.from({ length: 907 }, (_, i) => githubIssue({ ref: `#${i + 1}`, state: 'open' }));
    const result = filterOpenIssueIds(issues, 'github', 'PAN');
    expect(result).toHaveLength(907);
    expect(result[0]).toBe('PAN-1');
    expect(result[906]).toBe('PAN-907');
  });
});
