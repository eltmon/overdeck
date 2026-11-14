import { describe, expect, it } from 'vitest';
import type { BackendPane } from '@overdeck/contracts';

import {
  JOURNAL_ACTIVITY_LABELS,
  activityFrom,
  deriveBlocker,
  deriveCardAgent,
  deriveOwner,
  deriveStage,
  deriveStageSince,
  describeGateWait,
  formatClock,
  gateLabel,
  mapWaiterToIssue,
  type BoardFacts,
} from '../../../../src/lib/flywheel/board.js';
import type { PipelineJournalEntry, PipelineJournalEntryType } from '../../../../src/lib/cloister/pipeline-journal.js';
import type { QualityGateQueueEntry, QualityGateQueueSnapshot } from '../../../../src/lib/cloister/quality-gate-admission.js';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');
const GIB = 1024 ** 3;

function facts(overrides: Partial<BoardFacts> = {}): BoardFacts {
  return {
    issueId: 'PAN-1',
    state: 'working',
    journal: [],
    panes: [],
    conversations: [],
    gateWaiters: [],
    gateOwners: [],
    gateQueue: null,
    gateMemory: null,
    autoMerge: null,
    generation: null,
    batchingPausedUntil: null,
    inTick: false,
    startedBy: null,
    nowMs: NOW,
    ...overrides,
  };
}

function entry(type: PipelineJournalEntryType, at: string, data?: Record<string, unknown>): PipelineJournalEntry {
  return { at, type, issueId: 'PAN-1', ...(data ? { data } : {}) };
}

function pane(role: BackendPane['role'], state: BackendPane['state'] = 'working', extra: Partial<BackendPane> = {}): BackendPane {
  return { id: `w1:${role}`, issue: 'PAN-1', role, harness: 'claude-code', model: 'claude-opus-5-5', state, ...extra };
}

function waiter(createdAt: number, extra: Partial<QualityGateQueueEntry> = {}): QualityGateQueueEntry {
  return { workspacePath: '/ws/feature-pan-1', gateName: 'tsc:tsconfig.json', createdAt, ...extra };
}

const liveWork = [pane('work')];

describe('activity labels (FR-5)', () => {
  it('JOURNAL_ACTIVITY_LABELS has a label for every journal type and none contains a dot', () => {
    const types: PipelineJournalEntryType[] = [
      'verification.started', 'verification.passed', 'verification.failed',
      'review.requested', 'review.dispatched', 'review.redispatched', 'review.halted', 'review.verdict',
      'review.verdict-refused', 'review.aborted', 'review.synthesis-gave-up',
      'review.verdict-deferred', 'review.verdict-replay-gave-up',
      'review.stalled', 'review.stall-escalated', 'review.dispatch-failed', 'review.resume-declined',
      'review.approval-carried', 'review.stale-approval-rerequested',
      'uat.verdict', 'feedback.delivered', 'feedback.skipped',
      'feedback.undelivered', 'feedback.followup_filed', 'feedback.followup_failed',
      'merge.attempted', 'merge.completed', 'merge.failed',
      'strike.landed',
      'conflict.repair-requested', 'conflict.repair-escalated',
      'blocked.declared', 'blocked.woken',
      'handoff.deferred', 'handoff.retried', 'handoff.started', 'handoff.abandoned',
      'workspace.adopted', 'workspace.adoption-failed', 'workspace.synced-to-pr-head',
      'operator.decision-requested', 'operator.decision-answered', 'operator.decision-withdrawn',
    ];
    expect(Object.keys(JOURNAL_ACTIVITY_LABELS).sort()).toEqual([...types].sort());
    for (const label of Object.values(JOURNAL_ACTIVITY_LABELS)) {
      expect(label).not.toContain('.');
      expect(label).toBe(label.toLowerCase().replace(/\bpr\b/g, 'PR'));
    }
  });

  it('activityFrom labels a known type and de-dots an unknown one', () => {
    expect(activityFrom(entry('verification.failed', '2026-11-14T11:00:00.000Z'))).toEqual({ at: '2026-11-14T11:00:00.000Z', label: 'checks failed' });
    expect(activityFrom({ at: 'x', type: 'future.thing-new' as PipelineJournalEntryType })?.label).toBe('future thing new');
    expect(activityFrom(null)).toBeNull();
  });
});

describe('gateLabel (D9)', () => {
  it('names gates in plain words', () => {
    expect(gateLabel('vitest')).toBe('tests');
    expect(gateLabel('tsc:tsconfig.json')).toBe('typecheck');
    expect(gateLabel('tsc:services/account/tsconfig.json')).toBe('typecheck (services/account/tsconfig.json)');
    expect(gateLabel('gate:lint:eslint')).toBe('lint');
    expect(gateLabel('build')).toBe('build');
  });
});

describe('describeGateWait (D9)', () => {
  const memory = { memAvailableBytes: 11.5 * GIB, softReserveBytes: 12 * GIB };

  it('names busy slots when every slot has an owner', () => {
    const snapshot: QualityGateQueueSnapshot = { slots: 2, owners: [waiter(0), waiter(0)], waiters: [waiter(NOW - 5 * 60_000)] };
    expect(describeGateWait(snapshot.waiters[0]!, snapshot, memory, NOW)).toBe('typecheck queued: 2/2 gate slots busy (5 min)');
  });

  it('names memory when the footprint would cut into the soft reserve', () => {
    const own = waiter(NOW - 20 * 60_000, { footprintBytes: 2.2 * GIB });
    const snapshot: QualityGateQueueSnapshot = { slots: 2, owners: [], waiters: [own] };
    expect(describeGateWait(own, snapshot, memory, NOW))
      .toBe('typecheck queued: 11.5 GB free, needs 2.2 GB, gates keep 12.0 GB (20 min)');
  });

  it('names the queue when an older waiter is ahead', () => {
    const older = waiter(NOW - 90 * 60_000, { workspacePath: '/ws/other' });
    const own = waiter(NOW - 30_000, { gateName: 'vitest' });
    const snapshot: QualityGateQueueSnapshot = { slots: 2, owners: [], waiters: [older, own] };
    expect(describeGateWait(own, snapshot, null, NOW)).toBe('tests queued behind 1 other gate (<1 min)');
  });

  it('names CPU when nothing else explains the wait', () => {
    const own = waiter(NOW - 75 * 60_000);
    const snapshot: QualityGateQueueSnapshot = { slots: 2, owners: [], waiters: [own] };
    expect(describeGateWait(own, snapshot, memory, NOW)).toBe('typecheck queued: waiting for CPU to settle (1 h 15 min)');
  });
});

describe('mapWaiterToIssue (D10)', () => {
  const candidates = [
    { issueId: 'PAN-1', paths: ['/ws/feature-pan-1'] },
    { issueId: 'PAN-5276', paths: ['/home/u/Projects/hoff-pan-5276', '/home/u/Projects'] },
  ];

  it('prefers the ticket issue id', () => {
    expect(mapWaiterToIssue({ issueId: 'pan-9', workspacePath: '/ws/feature-pan-1' }, candidates)).toBe('PAN-9');
  });

  it('maps through the longest containing candidate path, including a conversation cwd', () => {
    expect(mapWaiterToIssue({ workspacePath: '/home/u/Projects/hoff-pan-5276' }, candidates)).toBe('PAN-5276');
    expect(mapWaiterToIssue({ workspacePath: '/home/u/Projects/hoff-pan-5276/services/x' }, candidates)).toBe('PAN-5276');
    expect(mapWaiterToIssue({ workspacePath: '/ws/feature-pan-1' }, candidates)).toBe('PAN-1');
  });

  it('falls back to the issue id in a feature or hoff path segment', () => {
    expect(mapWaiterToIssue({ workspacePath: '/elsewhere/feature-pan-77-strike/pkg' }, [])).toBe('PAN-77');
    expect(mapWaiterToIssue({ workspacePath: '/elsewhere/random' }, [])).toBeNull();
  });
});

describe('deriveStage (D1)', () => {
  it('rule 1: an auto-merge row or a train generation is merge', () => {
    expect(deriveStage(facts({ autoMerge: { status: 'pending', scheduledMergeAt: 'x', scheduledAt: 'y' } }))).toBe('merge');
    expect(deriveStage(facts({ generation: { name: 'uat/pan-train-1', createdAt: 'x', memberCount: 2 } }))).toBe('merge');
  });

  it('rule 2: a ready row is merge', () => {
    expect(deriveStage(facts({ state: 'ready' }))).toBe('merge');
  });

  it('rule 3: verification in flight or a gate ticket is checks', () => {
    expect(deriveStage(facts({ journal: [entry('verification.started', '2026-11-14T11:00:00.000Z')] }))).toBe('checks');
    expect(deriveStage(facts({ gateWaiters: [waiter(NOW)] }))).toBe('checks');
    expect(deriveStage(facts({ gateOwners: [waiter(NOW)] }))).toBe('checks');
    expect(deriveStage(facts({
      journal: [entry('verification.started', '2026-11-14T11:00:00.000Z'), entry('verification.passed', '2026-11-14T11:05:00.000Z')],
    }))).toBe('build');
  });

  it('rule 4: in-review is review', () => {
    expect(deriveStage(facts({ state: 'in-review' }))).toBe('review');
  });

  it('rule 5: working and changes-requested are build', () => {
    expect(deriveStage(facts({ state: 'working' }))).toBe('build');
    expect(deriveStage(facts({ state: 'changes-requested' }))).toBe('build');
  });

  it('rule 6: anything else is plan', () => {
    expect(deriveStage(facts({ state: 'planned' }))).toBe('plan');
    expect(deriveStage(facts({ state: 'backlog' }))).toBe('plan');
    expect(deriveStage(facts({ state: 'parked' }))).toBe('plan');
  });
});

describe('deriveStageSince (D2)', () => {
  it('reads the entry that entered each stage', () => {
    const journal = [
      entry('handoff.started', '2026-11-14T09:00:00.000Z'),
      entry('verification.failed', '2026-11-14T10:00:00.000Z'),
      entry('review.requested', '2026-11-14T10:30:00.000Z'),
      entry('verification.started', '2026-11-14T11:00:00.000Z'),
    ];
    expect(deriveStageSince(facts({ journal }), 'build')).toBe('2026-11-14T10:00:00.000Z');
    expect(deriveStageSince(facts({ journal }), 'review')).toBe('2026-11-14T10:30:00.000Z');
    expect(deriveStageSince(facts({ journal }), 'checks')).toBe('2026-11-14T11:00:00.000Z');
    expect(deriveStageSince(facts({ journal, gateWaiters: [waiter(Date.parse('2026-11-14T11:30:00.000Z'))] }), 'checks'))
      .toBe('2026-11-14T11:30:00.000Z');
    expect(deriveStageSince(facts({ autoMerge: { status: 'pending', scheduledMergeAt: 'a', scheduledAt: '2026-11-14T11:40:00.000Z' } }), 'merge'))
      .toBe('2026-11-14T11:40:00.000Z');
    expect(deriveStageSince(facts({ panes: [pane('plan', 'working', { stateSince: NOW })] }), 'plan')).toBe(new Date(NOW).toISOString());
    expect(deriveStageSince(facts(), 'plan')).toBeNull();
  });
});

describe('deriveOwner (D3)', () => {
  const conv = { name: '20261114-d9c5', title: 'Handoff for PAN-1', model: 'opus', harness: 'claude-code', cwd: '/home/u/Projects/hoff-pan-1', status: 'active' as const };

  it('rule 1: the loop owns a tick id or a flywheel-started agent', () => {
    expect(deriveOwner(facts({ inTick: true, conversations: [conv] }))).toEqual({ kind: 'flywheel' });
    expect(deriveOwner(facts({ startedBy: 'flywheel:conv-flywheel' }))).toEqual({ kind: 'flywheel' });
  });

  it('rule 2: else the newest handoff conversation owns it', () => {
    expect(deriveOwner(facts({ conversations: [conv], startedBy: 'operator:cli' })))
      .toEqual({ kind: 'conversation', name: '20261114-d9c5', title: 'Handoff for PAN-1' });
  });

  it('rule 3: else the operator owns it', () => {
    expect(deriveOwner(facts({ startedBy: 'planning-auto-handoff' }))).toEqual({ kind: 'operator' });
  });
});

describe('deriveCardAgent (D4)', () => {
  it('prefers the work pane and maps done to idle', () => {
    expect(deriveCardAgent(facts({ panes: [pane('review'), pane('work', 'done', { agentId: 'agent-pan-1' })] })))
      .toEqual({ role: 'work', model: 'claude-opus-5-5', harness: 'claude-code', state: 'idle', agentId: 'agent-pan-1' });
  });

  it('a conversation pane is a handoff agent with its conversation name', () => {
    const conv = { name: '20261114-cc68', title: null, model: null, harness: null, cwd: '/x', status: 'active' as const, tmuxSession: 'conv-20261114-cc68' };
    expect(deriveCardAgent(facts({ panes: [pane('conversation', 'done', { agentId: 'conv-20261114-cc68' })], conversations: [conv] })))
      .toMatchObject({ role: 'handoff', state: 'idle', conversationName: '20261114-cc68' });
  });

  it('falls back to the newest active handoff conversation and shows a gate wait', () => {
    const conv = { name: '20261114-d9c5', title: null, model: 'opus', harness: 'claude-code', cwd: '/x', status: 'active' as const };
    expect(deriveCardAgent(facts({ conversations: [conv], gateWaiters: [waiter(NOW)] })))
      .toEqual({ role: 'handoff', model: 'opus', harness: 'claude-code', state: 'waiting', conversationName: '20261114-d9c5' });
    expect(deriveCardAgent(facts({ conversations: [{ ...conv, status: 'ended' }] }))).toBeNull();
  });

  it('a queued gate with no pane or conversation shows a waiting gate, never no agent', () => {
    expect(deriveCardAgent(facts({ gateWaiters: [waiter(NOW)] })))
      .toEqual({ role: 'gate', model: null, harness: null, state: 'waiting' });
  });
});

describe('deriveBlocker (D11)', () => {
  it('rule 1: a queued gate is a waiting gate-queue blocker with a count of the others', () => {
    const own = [waiter(NOW - 20 * 60_000), waiter(NOW - 60_000, { gateName: 'vitest' })];
    const blocker = deriveBlocker(facts({
      attention: 'needs-you',
      gateWaiters: own,
      gateQueue: { slots: 2, owners: [], waiters: own },
    }));
    expect(blocker).toEqual({ kind: 'gate-queue', severity: 'waiting', text: 'typecheck queued: waiting for CPU to settle (20 min) +1 more' });
  });

  it('rule 2: needs-you asks for an answer', () => {
    expect(deriveBlocker(facts({ attention: 'needs-you', panes: liveWork })))
      .toEqual({ kind: 'agent-question', severity: 'needs-you', text: 'agent is waiting for your answer', action: 'answer-agent' });
  });

  it('rule 3: api-error is a provider error', () => {
    expect(deriveBlocker(facts({ attention: 'api-error', panes: liveWork }))?.text).toBe('agent hit a provider error (rate limit or outage)');
  });

  it('rule 4: work-not-started names the error and the retry', () => {
    const at = new Date(2026, 10, 14, 13, 5).toISOString();
    const blocker = deriveBlocker(facts({ attention: 'work-not-started', workStart: { status: 'retrying', at, error: 'spawn timed out', nextRetryAt: at } }));
    expect(blocker).toEqual({ kind: 'start-failed', severity: 'needs-you', text: 'auto-start failed: spawn timed out, retrying at 13:05', action: 'start-issue' });
    expect(deriveBlocker(facts({ attention: 'work-not-started' }))?.text).toBe('auto-start failed: no work agent came up');
  });

  it('rule 5: pr-outside-pipeline shows the first sentence of the fix', () => {
    const blocker = deriveBlocker(facts({
      attention: 'pr-outside-pipeline',
      prOutsidePipeline: { prNumber: 5, fix: 'PR #5 was opened outside the pipeline. Run pan adopt PAN-1.' },
    }));
    expect(blocker).toEqual({ kind: 'pr-outside-pipeline', severity: 'needs-you', text: 'PR #5 was opened outside the pipeline.' });
  });

  it('rule 6: stuck is an idle agent with unpushed commits', () => {
    expect(deriveBlocker(facts({ attention: 'stuck', panes: liveWork }))).toEqual({ kind: 'agent-stuck', severity: 'stuck', text: 'agent idle with unpushed commits' });
  });

  it('rule 7: a failed verification names the check, CI, or the test-removal waiver', () => {
    const failed = (data: Record<string, unknown>) => [entry('verification.started', '2026-11-14T10:00:00.000Z'), entry('verification.failed', '2026-11-14T10:05:00.000Z', data)];
    expect(deriveBlocker(facts({ journal: failed({ failedCheck: 'test-skip' }) })))
      .toEqual({ kind: 'test-removal-waiver', severity: 'needs-you', text: 'test-skip gate failed: needs your test-removal waiver', action: 'waive-test-removal' });
    expect(deriveBlocker(facts({ journal: failed({ failedCheck: 'test', via: 'ci', prNumber: 5127 }), panes: liveWork }))?.text)
      .toBe('CI tests failed on PR #5127, agent fixing');
    expect(deriveBlocker(facts({ journal: failed({ failedCheck: 'typecheck', cycleCount: 2 }) }))?.text)
      .toBe('typecheck check failed (round 2), no agent running');
    expect(deriveBlocker(facts({
      journal: [...failed({ failedCheck: 'lint' }), entry('verification.passed', '2026-11-14T10:10:00.000Z')],
      panes: liveWork,
    }))).toBeNull();
  });

  it('rule 8: undelivered feedback, naming CodeRabbit', () => {
    expect(deriveBlocker(facts({ journal: [entry('feedback.undelivered', 'x')], panes: liveWork }))?.text).toBe('review feedback not delivered');
    expect(deriveBlocker(facts({ journal: [entry('feedback.undelivered', 'x', { kind: 'CodeRabbit-review' })], panes: liveWork }))?.text)
      .toBe('CodeRabbit feedback not delivered');
  });

  it('rule 9: a failed merge with its reason', () => {
    expect(deriveBlocker(facts({ journal: [entry('merge.failed', 'x', { reason: 'not mergeable' })], panes: liveWork }))?.text).toBe('merge failed: not mergeable');
    expect(deriveBlocker(facts({ journal: [entry('merge.failed', 'x')], panes: liveWork }))?.text).toBe('merge failed');
  });

  it('rule 10: a pending, merging, or blocked auto-merge row', () => {
    const at = new Date(2026, 10, 14, 14, 30).toISOString();
    expect(deriveBlocker(facts({ state: 'ready', autoMerge: { status: 'pending', scheduledMergeAt: at, scheduledAt: at } })))
      .toEqual({ kind: 'auto-merge-scheduled', severity: 'waiting', text: 'auto-merge at 14:30' });
    expect(deriveBlocker(facts({ state: 'ready', autoMerge: { status: 'merging', scheduledMergeAt: at, scheduledAt: at } }))?.text).toBe('merging now');
    expect(deriveBlocker(facts({ state: 'ready', autoMerge: { status: 'blocked', scheduledMergeAt: at, scheduledAt: at, failureReason: 'x'.repeat(200) } })))
      .toEqual({ kind: 'auto-merge-blocked', severity: 'stuck', text: `auto-merge blocked: ${'x'.repeat(120)}` });
  });

  it('rule 11: a train batch member, or batching paused for a ready row', () => {
    expect(deriveBlocker(facts({ state: 'ready', generation: { name: 'uat/pan-train-0614', createdAt: 'x', memberCount: 3 } })))
      .toEqual({ kind: 'train-batch', severity: 'waiting', text: 'in train batch pan-train-0614 (3 PRs), waiting for batch CI' });
    const until = new Date(2026, 10, 14, 15, 0).toISOString();
    expect(deriveBlocker(facts({ state: 'ready', batchingPausedUntil: until })))
      .toEqual({ kind: 'train-paused', severity: 'waiting', text: 'train batching paused until 15:00; merges one at a time' });
    expect(deriveBlocker(facts({ state: 'in-review', batchingPausedUntil: until, panes: liveWork }))).toBeNull();
  });

  it('rule 12: red CI on the PR', () => {
    const pr = { url: 'u', number: 5127, reviewState: 'none' as const, checks: 'red' as const, mergeable: true };
    expect(deriveBlocker(facts({ state: 'in-review', pr }))).toEqual({ kind: 'ci-red', severity: 'stuck', text: 'CI red on PR #5127, no agent running' });
  });

  it('rule 13: a merge conflict', () => {
    const pr = { url: 'u', number: 5, reviewState: 'none' as const, checks: 'green' as const, mergeable: false };
    expect(deriveBlocker(facts({ state: 'in-review', pr, panes: liveWork }))?.kind).toBe('merge-conflict');
  });

  it('rule 14: a declared blocker names what it waits on', () => {
    expect(deriveBlocker(facts({ journal: [entry('blocked.declared', 'x', { blockers: ['PAN-2', '#30'] })], panes: liveWork }))?.text)
      .toBe('blocked: waits on PAN-2, #30');
  });

  it('rule 15: a stalled review', () => {
    expect(deriveBlocker(facts({ state: 'in-review', journal: [entry('review.stall-escalated', 'x')], panes: liveWork }))?.text).toBe('review stalled');
  });

  it('rule 16: build, checks, or review with no agent is no agent running', () => {
    expect(deriveBlocker(facts({ state: 'working' }))).toEqual({ kind: 'no-agent', severity: 'stuck', text: 'no agent running' });
    expect(deriveBlocker(facts({ state: 'in-review' }))?.kind).toBe('no-agent');
    expect(deriveBlocker(facts({ state: 'planned' }))).toBeNull();
    expect(deriveBlocker(facts({ state: 'working', panes: liveWork }))).toBeNull();
  });
});

describe('formatClock', () => {
  it('prints local 24-hour time', () => {
    expect(formatClock(new Date(2026, 10, 14, 7, 4).toISOString())).toBe('07:04');
    expect(formatClock('not a time')).toBe('');
  });
});
