import { describe, expect, it } from 'vitest';

import type { Issue } from '../../../../src/lib/tracker/interface.js';
import { issueIdFromTrackerIssue } from '../../../../src/lib/tracker/issue-id.js';

function issueFixture(overrides: Partial<Issue>): Issue {
  return {
    id: 'issue-1',
    ref: '#1',
    title: 'issue',
    description: '',
    state: 'open',
    labels: [],
    url: 'https://example.com/issue/1',
    tracker: 'github',
    ...overrides,
  };
}

describe('issueIdFromTrackerIssue', () => {
  it('combines a bare GitHub ref with the project issue_prefix', () => {
    expect(issueIdFromTrackerIssue(issueFixture({ ref: '#3841' }), 'github', 'PAN')).toBe('PAN-3841');
  });

  it('upper-cases a lowercase issue_prefix for GitHub refs', () => {
    expect(issueIdFromTrackerIssue(issueFixture({ ref: '#7' }), 'github', 'pan')).toBe('PAN-7');
  });

  it('uses the Linear identifier as-is (already team-prefixed)', () => {
    expect(issueIdFromTrackerIssue(issueFixture({ ref: 'MIN-1039', tracker: 'linear' }), 'linear', 'MIN'))
      .toBe('MIN-1039');
  });

  it('upper-cases a lowercase GitLab identifier', () => {
    expect(issueIdFromTrackerIssue(issueFixture({ ref: 'min-5', tracker: 'gitlab' }), 'gitlab', 'MIN'))
      .toBe('MIN-5');
  });
});
