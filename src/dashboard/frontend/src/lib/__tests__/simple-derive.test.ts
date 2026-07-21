/**
 * PAN-2908 · C-SIMPLE — derive.ts unit tests (joins + bucketing).
 */
import { describe, expect, it } from 'vitest';
import type { AgentSnapshot, ReviewStatusSnapshot } from '@overdeck/contracts';
import { bucketSimpleHome, deriveExpectation, deriveSimpleIssue } from '../simple/derive';
import type { Issue } from '../../types';

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'PAN-1',
    identifier: 'PAN-1',
    title: 'Do the thing',
    status: 'In Progress',
    priority: 2,
    labels: [],
    url: '',
    state: 'in_progress',
    ...overrides,
  } as Issue;
}

const agent = (overrides: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  id: 'agent-1',
  issueId: 'PAN-1',
  status: 'running',
  role: 'work',
  ...overrides,
});

describe('deriveSimpleIssue', () => {
  it('working issue with a running work agent → working / Writing code', () => {
    const d = deriveSimpleIssue(makeIssue(), [agent()]);
    expect(d.display.state).toBe('working');
    expect(d.display.title).toBe('Writing code');
    expect(d.primaryAgent?.id).toBe('agent-1');
  });

  it('pending question wins over everything → needs-you / question', () => {
    const d = deriveSimpleIssue(makeIssue(), [
      agent({ pendingAskUserQuestion: { toolUseId: 't', askedAt: '', questions: [] } }),
    ]);
    expect(d.display.state).toBe('needs-you');
    expect(d.display.title).toBe('Question for you');
    expect(d.display.primaryAction).toBe('Answer');
  });

  it('troubled agent → needs-you / stuck', () => {
    const d = deriveSimpleIssue(makeIssue(), [agent({ troubled: true })]);
    expect(d.display.state).toBe('needs-you');
    expect(d.display.title).toBe('Stuck');
  });

  it('readyForMerge → ready with Merge primary action and PR url', () => {
    const review = { issueId: 'PAN-1', readyForMerge: true, prUrl: 'https://github.com/x/y/pull/1' } as ReviewStatusSnapshot;
    const d = deriveSimpleIssue(makeIssue({ state: 'in_review' }), [], review);
    expect(d.display.state).toBe('ready');
    expect(d.display.primaryAction).toBe('Merge to main');
    expect(d.prUrl).toBe('https://github.com/x/y/pull/1');
  });

  it('review failed → needs-you with fix-them action', () => {
    const review = { issueId: 'PAN-1', reviewStatus: 'failed' } as ReviewStatusSnapshot;
    const d = deriveSimpleIssue(makeIssue({ state: 'in_review' }), [], review);
    expect(d.display.state).toBe('needs-you');
    expect(d.display.primaryAction).toBe('Tell the agent to fix them');
  });

  it('rail reflects the phase (review running → review current)', () => {
    const review = { issueId: 'PAN-1', reviewStatus: 'reviewing' } as ReviewStatusSnapshot;
    const d = deriveSimpleIssue(makeIssue({ state: 'in_review' }), [], review);
    expect(d.rail.plan).toBe('done');
    expect(d.rail.work).toBe('done');
    expect(d.rail.review).toBe('current');
    expect(d.rail.ship).toBe('pending');
  });
});

describe('bucketSimpleHome', () => {
  it('buckets by user-facing state; backlog and stale-done excluded', () => {
    const now = Date.now();
    const fresh = new Date(now - 60_000).toISOString();
    const stale = new Date(now - 30 * 24 * 3600 * 1000).toISOString();
    const items = [
      deriveSimpleIssue(makeIssue({ identifier: 'PAN-1' }), [agent()]), // working
      deriveSimpleIssue(makeIssue({ identifier: 'PAN-2', state: 'in_review' }), [], { issueId: 'PAN-2', readyForMerge: true, updatedAt: fresh } as ReviewStatusSnapshot), // ready
      deriveSimpleIssue(makeIssue({ identifier: 'PAN-3', state: 'backlog' }), []), // backlog → excluded
      deriveSimpleIssue(makeIssue({ identifier: 'PAN-4', state: 'done' }), [], { issueId: 'PAN-4', mergeStatus: 'merged', updatedAt: fresh } as ReviewStatusSnapshot), // finished
      deriveSimpleIssue(makeIssue({ identifier: 'PAN-5', state: 'done' }), [], { issueId: 'PAN-5', mergeStatus: 'merged', updatedAt: stale } as ReviewStatusSnapshot), // old → excluded
    ];
    const b = bucketSimpleHome(items, now);
    expect(b.working.map((d) => d.issue.identifier)).toEqual(['PAN-1']);
    expect(b.ready.map((d) => d.issue.identifier)).toEqual(['PAN-2']);
    expect(b.finished.map((d) => d.issue.identifier)).toEqual(['PAN-4']);
    expect(b.needsYou).toEqual([]);
  });
});

describe('deriveExpectation (C-SIMPLE expectations)', () => {
  it('is null without an agent start time', () => {
    expect(deriveExpectation(undefined, null)).toBeNull();
    expect(deriveExpectation({ id: 'a', issueId: 'PAN-1' } as never, null)).toBeNull();
  });
  it('elapsed only when there is no task basis', () => {
    const agent = { id: 'a', issueId: 'PAN-1', startedAt: new Date(Date.now() - 45 * 60_000).toISOString() } as never;
    expect(deriveExpectation(agent, null)).toBe('started 45m ago');
  });
  it('extrapolates time-to-go from task progress', () => {
    const agent = { id: 'a', issueId: 'PAN-1', startedAt: new Date(Date.now() - 60 * 60_000).toISOString() } as never;
    const out = deriveExpectation(agent, { completed: 3, total: 6 });
    expect(out).toBe('started 1h ago · about 1h to go');
  });
});
