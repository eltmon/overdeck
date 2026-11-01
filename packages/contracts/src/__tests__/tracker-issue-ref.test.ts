import { describe, expect, it } from 'vitest';

import { parseTrackerIssueUrl, resolveTrackerIssueId, type TrackerIssueProject } from '../tracker-issue-ref';

describe('parseTrackerIssueUrl', () => {
  it('parses a GitHub issue URL with and without a comment anchor', () => {
    for (const input of [
      'https://github.com/Eltmon/Overdeck/issues/4645',
      'https://github.com/Eltmon/Overdeck/issues/4645#issuecomment-9',
    ]) {
      expect(parseTrackerIssueUrl(input), input).toEqual({ tracker: 'github', repository: 'eltmon/overdeck', number: 4645 });
    }
  });

  it('parses a Linear issue URL with a slug', () => {
    expect(parseTrackerIssueUrl('https://linear.app/mindyournow/issue/min-663/some-title')).toEqual({
      tracker: 'linear',
      identifier: 'MIN-663',
    });
  });

  it('rejects PR URLs, issue lists, new-issue pages and other hosts', () => {
    for (const input of [
      'https://github.com/eltmon/overdeck/pull/42',
      'https://github.com/eltmon/overdeck/issues',
      'https://github.com/eltmon/overdeck/issues/new',
      'https://github.com/eltmon/overdeck/issues/0',
      'https://gitlab.com/a/b/-/issues/3',
    ]) {
      expect(parseTrackerIssueUrl(input), input).toBeNull();
    }
  });
});

describe('resolveTrackerIssueId', () => {
  it('resolves a GitHub URL through a github-tracked project prefix', () => {
    const ref = parseTrackerIssueUrl('https://github.com/eltmon/overdeck/issues/4645')!;
    const projects: TrackerIssueProject[] = [{ linearTeam: 'PAN', githubRepo: 'eltmon/overdeck', tracker: 'github' }];
    expect(resolveTrackerIssueId(ref, projects)).toBe('PAN-4645');
  });

  it('does not map a GitHub URL for a linear-tracked project', () => {
    const ref = parseTrackerIssueUrl('https://github.com/eltmon/lexerra/issues/1')!;
    const projects: TrackerIssueProject[] = [{ linearTeam: 'LEX', githubRepo: 'eltmon/lexerra', tracker: 'linear' }];
    expect(resolveTrackerIssueId(ref, projects)).toBeNull();
  });

  it('resolves a Linear URL only through a linear-tracked project with that prefix', () => {
    const ref = parseTrackerIssueUrl('https://linear.app/mindyournow/issue/min-663')!;
    const projects: TrackerIssueProject[] = [{ linearTeam: 'MIN', tracker: 'linear' }];
    expect(resolveTrackerIssueId(ref, projects)).toBe('MIN-663');
    expect(resolveTrackerIssueId({ tracker: 'linear', identifier: 'XYZ-1' }, projects)).toBeNull();
  });

  it('ignores projects without an issue prefix and tolerates junk rows', () => {
    const ref = parseTrackerIssueUrl('https://github.com/eltmon/papers-please/issues/1')!;
    const projects = [
      { linearTeam: null, githubRepo: 'eltmon/papers-please', tracker: 'github' },
      null as never,
    ] as TrackerIssueProject[];
    expect(resolveTrackerIssueId(ref, projects)).toBeNull();
  });
});
