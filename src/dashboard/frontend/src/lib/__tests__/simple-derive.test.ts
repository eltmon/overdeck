/**
 * PAN-2908 · C-SIMPLE — derive.ts unit tests (joins + bucketing).
 */
import { describe, expect, it } from 'vitest';
import type { AgentSnapshot, ReviewStatusSnapshot } from '@overdeck/contracts';
import { bucketSimpleHome, deriveExpectation, deriveSimpleIssue } from '../simple/derive';
import { simpleStepIndex } from '../simple/phases';
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

  /**
   * PAN-3070 — an agent parked on a tool-permission prompt used to read as
   * "The agent is writing the code." It is not writing anything and cannot
   * advance a tool call until a human answers. The enrichment now folds the
   * detected prompt into `pendingInputKinds` server-side, which is the evidence
   * this projection reads.
   */
  it('permission prompt → needs-you, never "writing the code"', () => {
    const d = deriveSimpleIssue(makeIssue(), [
      agent({
        hasPendingQuestion: true,
        pendingQuestionReason: 'tool_permission',
        pendingInputKinds: ['permissionRequest'],
        pendingInputCount: 1,
      }),
    ]);
    expect(d.display.state).toBe('needs-you');
    expect(d.display.title).toBe('Question for you');
    expect(d.display.sentence).not.toBe('The agent is writing the code.');
  });

  /**
   * PAN-3330 shape — planning finished, the plan agent went idle and stopped.
   * `computeAgentEnrichment` flags an idle interactive role with the
   * `agentTurnEnded` kind, which used to render as "Question for you" with an
   * answer box pointed at a dead session. Nothing was asked: what this needs
   * is the start button, and the four-step track must not claim "Writing code"
   * before a single line has been written.
   */
  it('finished plan + bare turn-end → the plan is ready, not a question', () => {
    const d = deriveSimpleIssue(
      makeIssue({ state: 'todo', hasPlan: true, hasTasks: true }),
      [agent({ role: 'plan', status: 'stopped', pendingInputKinds: ['agentTurnEnded'], pendingInputCount: 1 })],
    );
    expect(d.pipelineState).toBe('planning_done_awaiting_work');
    expect(d.display.state).toBe('needs-you');
    expect(d.display.needsYouReason).toBe('start-work');
    expect(d.display.title).toBe('The plan is ready');
    expect(d.display.primaryAction).toBe('Start work');
    expect(simpleStepIndex(d.pipelineState)).toBe(0);
  });

  it('finished plan + a real question still shows the question', () => {
    const d = deriveSimpleIssue(
      makeIssue({ state: 'todo', hasPlan: true, hasTasks: true }),
      [agent({
        role: 'plan',
        status: 'stopped',
        pendingAskUserQuestion: { toolUseId: 't', askedAt: '', questions: [] },
        pendingInputKinds: ['askUserQuestion'],
        pendingInputCount: 1,
      })],
    );
    expect(d.display.needsYouReason).toBe('question');
    expect(d.display.primaryAction).toBe('Answer');
  });

  it('mid-planning turn-end (no plan yet) is still a real question', () => {
    const d = deriveSimpleIssue(
      makeIssue({ state: 'todo', hasPlan: false }),
      [agent({ role: 'plan', status: 'running', pendingInputKinds: ['agentTurnEnded'], pendingInputCount: 1 })],
    );
    expect(d.pipelineState).toBe('planning_active');
    expect(d.display.needsYouReason).toBe('question');
  });

  /**
   * The observed PAN-3330 render: the plan agent finished hours ago but its
   * tmux session is still alive, so the machine reports `planning_active` and
   * the page claimed "The agent is breaking this down into tasks" — with a
   * question card over it. Process liveness answers "is it alive", never "is it
   * still planning"; the written plan is the honest signal.
   */
  it('live-but-finished plan agent reads as ready to start, not still planning', () => {
    const d = deriveSimpleIssue(
      makeIssue({ state: 'todo', hasPlan: true, hasTasks: true }),
      [agent({ role: 'plan', status: 'running', pendingInputKinds: ['agentTurnEnded'], pendingInputCount: 1 })],
    );
    expect(d.pipelineState).toBe('planning_active');
    expect(d.display.needsYouReason).toBe('start-work');
    expect(d.display.title).toBe('The plan is ready');
    expect(d.display.sentence).not.toContain('breaking this down');
    expect(simpleStepIndex(d.pipelineState)).toBe(0);
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
