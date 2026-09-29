/**
 * PAN-4384: the conflict-repair tick sends one sync-main repair per PR head,
 * escalates once when the head still conflicts after the grace, and counts
 * both from the real pipeline journal so a restart never re-sends.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../pipeline-notifier.js', () => ({ notifyPipeline: () => undefined }));

import {
  __resetConflictRepairStateForTests,
  buildConflictRepairPrompt,
  CONFLICT_REPAIR_GRACE_MS,
  CONFLICT_REPAIR_REVIEW_BACKSTOP_MS,
  isConflictRepairCandidate,
  tickConflictRepair,
  type ConflictRepairDeps,
} from '../conflict-repair.js';
import type { ConflictRepairGateResult } from '../merge-gate.js';
import type { GuardedReviewRequestOutcome } from '../request-review-pipeline.js';
import { appendPipelineEntry, readPipelineJournal, type PipelineJournalEntry } from '../pipeline-journal.js';
import { emptyPrFacts } from '../pr-facts.js';

const ISSUE = 'PAN-1166';
const HEAD_A = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
const HEAD_B = 'ffff6666000077778888999900001111aaaa2222';

let workspace: string;

function gate(conflicting: boolean, headSha = HEAD_A): ConflictRepairGateResult {
  return {
    conflicting,
    facts: {
      ...emptyPrFacts(ISSUE),
      forge: 'github',
      exists: true,
      open: true,
      number: 4317,
      url: 'https://github.com/eltmon/overdeck/pull/4317',
      headSha,
      mergeable: !conflicting,
    },
  };
}

function approve(): void {
  appendPipelineEntry(workspace, { type: 'review.verdict', issueId: ISSUE, data: { verdict: 'APPROVED' } });
}

function conflictEntries(): PipelineJournalEntry[] {
  return readPipelineJournal(workspace).filter((entry) => entry.type.startsWith('conflict.'));
}

function makeDeps(overrides: ConflictRepairDeps = {}) {
  const deliver = vi.fn(async () => ({ delivered: true, queuedToMail: false }));
  const surfaceNeedsYou = vi.fn(async () => undefined);
  const evaluateGate = vi.fn(async () => gate(true));
  const resolveTarget = vi.fn(async () => ({ agentId: 'agent-pan-1166' }) as const);
  const deps: ConflictRepairDeps = {
    listWorkspaces: () => [{ issueId: ISSUE, path: workspace }],
    getIssuePause: () => ({ status: 'unpaused' }),
    evaluateGate,
    resolveTarget,
    deliver,
    surfaceNeedsYou,
    probeConflictPaths: async () => ['scripts/file-size-allowlist.txt'],
    log: () => undefined,
    ...overrides,
  };
  return { deps, deliver, surfaceNeedsYou, evaluateGate, resolveTarget };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
  __resetConflictRepairStateForTests();
  workspace = mkdtempSync(join(tmpdir(), 'conflict-repair-'));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(workspace, { recursive: true, force: true });
});

describe('isConflictRepairCandidate', () => {
  const at = '2026-09-29T00:00:00Z';
  it('is true when the last verdict approved and no merge followed', () => {
    expect(isConflictRepairCandidate([
      { at, type: 'review.verdict', issueId: ISSUE, data: { verdict: 'CHANGES_REQUESTED' } },
      { at, type: 'review.verdict', issueId: ISSUE, data: { verdict: 'APPROVED' } },
      { at, type: 'review.requested', issueId: ISSUE },
    ])).toBe(true);
  });

  it('is false when the last verdict requested changes', () => {
    expect(isConflictRepairCandidate([
      { at, type: 'review.verdict', issueId: ISSUE, data: { verdict: 'APPROVED' } },
      { at, type: 'review.verdict', issueId: ISSUE, data: { verdict: 'CHANGES_REQUESTED' } },
    ])).toBe(false);
  });

  it('is false when a merge completed after the approval', () => {
    expect(isConflictRepairCandidate([
      { at, type: 'review.verdict', issueId: ISSUE, data: { verdict: 'APPROVED' } },
      { at, type: 'merge.completed', issueId: ISSUE },
    ])).toBe(false);
  });

  it('is false with no verdict', () => {
    expect(isConflictRepairCandidate([])).toBe(false);
  });
});

describe('buildConflictRepairPrompt', () => {
  it('names the sync-main, push, and review-request steps and the conflicting paths', () => {
    const prompt = buildConflictRepairPrompt({ issueId: ISSUE, head: 'aaaa1111', conflictPaths: ['a.txt', 'b.md'] });
    expect(prompt).toContain('CONFLICT REPAIR: the PR for PAN-1166 (head aaaa1111) is approved and green');
    expect(prompt).toContain('Conflicting paths: a.txt, b.md');
    expect(prompt).toContain('1. Run `pan sync-main PAN-1166` to merge origin/main into this branch (it does not push).');
    expect(prompt).toContain('5. Commit, push the branch, then run `pan review request PAN-1166`.');
    expect(prompt).toContain('never raise a cap');
  });

  it('points at git merge-tree when the paths are unknown', () => {
    expect(buildConflictRepairPrompt({ issueId: ISSUE, head: 'aaaa1111', conflictPaths: [] }))
      .toContain('Conflicting paths: run git merge-tree to list them');
  });
});

describe('tickConflictRepair', () => {
  it('sends one repair and journals it with the head for a merge-ready but conflicting PR', async () => {
    approve();
    const { deps, deliver, surfaceNeedsYou } = makeDeps();

    const actions = await tickConflictRepair(deps);

    expect(actions).toEqual(['PAN-1166: repair-requested']);
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith(
      'agent-pan-1166',
      expect.stringContaining('pan sync-main PAN-1166'),
      'conflict-repair:pan-1166:aaaa1111',
    );
    expect(surfaceNeedsYou).not.toHaveBeenCalled();
    const entries = conflictEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'conflict.repair-requested',
      source: 'conflict-repair',
      data: { head: 'aaaa1111', agentId: 'agent-pan-1166', conflictPaths: ['scripts/file-size-allowlist.txt'] },
    });
  });

  it('counts a mail-queued delivery as sent', async () => {
    approve();
    const { deps } = makeDeps({ deliver: async () => ({ delivered: false, queuedToMail: true }) });
    expect(await tickConflictRepair(deps)).toEqual(['PAN-1166: repair-requested']);
  });

  it('sends no second repair within the grace', async () => {
    approve();
    const { deps, deliver } = makeDeps();
    await tickConflictRepair(deps);

    vi.advanceTimersByTime(10 * 60_000);
    expect(await tickConflictRepair(deps)).toEqual([]);

    expect(deliver).toHaveBeenCalledOnce();
    expect(conflictEntries()).toHaveLength(1);
  });

  it('sends no second repair after a state reset (journal-derived)', async () => {
    approve();
    const { deps, deliver } = makeDeps();
    await tickConflictRepair(deps);

    __resetConflictRepairStateForTests();
    vi.advanceTimersByTime(60_000);
    await tickConflictRepair(deps);

    expect(deliver).toHaveBeenCalledOnce();
  });

  it('escalates once when the same head still conflicts past the grace', async () => {
    approve();
    const { deps, deliver, surfaceNeedsYou } = makeDeps();
    await tickConflictRepair(deps);

    vi.advanceTimersByTime(CONFLICT_REPAIR_GRACE_MS);
    expect(await tickConflictRepair(deps)).toEqual(['PAN-1166: escalated']);
    vi.advanceTimersByTime(60_000);
    expect(await tickConflictRepair(deps)).toEqual([]);

    expect(deliver).toHaveBeenCalledOnce();
    expect(surfaceNeedsYou).toHaveBeenCalledOnce();
    expect(surfaceNeedsYou).toHaveBeenCalledWith(
      ISSUE,
      expect.stringContaining('PR #4317 still conflicts with main'),
      expect.objectContaining({ head: 'aaaa1111', prUrl: 'https://github.com/eltmon/overdeck/pull/4317' }),
    );
    expect(conflictEntries().map((entry) => entry.type)).toEqual([
      'conflict.repair-requested',
      'conflict.repair-escalated',
    ]);
    expect(conflictEntries()[1].data).toEqual({ head: 'aaaa1111', reason: 'conflict survived one repair attempt' });
  });

  it('journals the escalation even when Needs-you cannot be raised', async () => {
    approve();
    const { deps } = makeDeps({
      resolveTarget: async () => ({ needsYou: true, reason: 'no agent' }),
      surfaceNeedsYou: async () => { throw new Error('activity log down'); },
    });
    await tickConflictRepair(deps);
    expect(conflictEntries().map((entry) => entry.type)).toEqual(['conflict.repair-escalated']);
  });

  it('escalates at once when the work agent cannot be reached', async () => {
    approve();
    const { deps, deliver, surfaceNeedsYou } = makeDeps({
      resolveTarget: async () => ({ needsYou: true, reason: 'agent paused by operator' }),
    });

    expect(await tickConflictRepair(deps)).toEqual(['PAN-1166: escalated']);

    expect(deliver).not.toHaveBeenCalled();
    expect(surfaceNeedsYou).toHaveBeenCalledOnce();
    expect(conflictEntries()).toEqual([
      expect.objectContaining({ type: 'conflict.repair-escalated', data: { head: 'aaaa1111', reason: 'unreachable' } }),
    ]);
  });

  it.each([
    ['throws', async () => { throw new Error('socket closed'); }],
    ['is not accepted', async () => ({ delivered: false, queuedToMail: false, reason: 'no turn' })],
  ])('escalates as unreachable when delivery %s', async (_label, deliver) => {
    approve();
    const { deps } = makeDeps({ deliver });
    await tickConflictRepair(deps);
    expect(conflictEntries()).toEqual([
      expect.objectContaining({ type: 'conflict.repair-escalated', data: { head: 'aaaa1111', reason: 'unreachable' } }),
    ]);
  });

  it('skips a paused issue without reading the forge', async () => {
    approve();
    const { deps, evaluateGate, deliver } = makeDeps({
      getIssuePause: () => ({ status: 'paused', agentId: 'agent-pan-1166' }),
    });
    expect(await tickConflictRepair(deps)).toEqual([]);
    expect(evaluateGate).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('skips a workspace whose last verdict requested changes', async () => {
    approve();
    appendPipelineEntry(workspace, { type: 'review.verdict', issueId: ISSUE, data: { verdict: 'CHANGES_REQUESTED' } });
    const { deps, evaluateGate } = makeDeps();
    await tickConflictRepair(deps);
    expect(evaluateGate).not.toHaveBeenCalled();
  });

  it('skips a workspace whose approval was followed by a merge', async () => {
    approve();
    appendPipelineEntry(workspace, { type: 'merge.completed', issueId: ISSUE });
    const { deps, evaluateGate } = makeDeps();
    await tickConflictRepair(deps);
    expect(evaluateGate).not.toHaveBeenCalled();
  });

  it('does nothing when the gate says the PR is not conflicting', async () => {
    approve();
    const { deps, deliver } = makeDeps({ evaluateGate: async () => gate(false) });
    expect(await tickConflictRepair(deps)).toEqual([]);
    expect(deliver).not.toHaveBeenCalled();
    expect(conflictEntries()).toEqual([]);
  });

  it('starts a new episode for a new head that again conflicts', async () => {
    approve();
    let head = HEAD_A;
    const { deps, deliver } = makeDeps({ evaluateGate: async () => gate(true, head) });
    await tickConflictRepair(deps);

    head = HEAD_B;
    vi.advanceTimersByTime(60_000);
    expect(await tickConflictRepair(deps)).toEqual(['PAN-1166: repair-requested']);

    expect(deliver).toHaveBeenCalledTimes(2);
    expect(conflictEntries().map((entry) => entry.data?.head)).toEqual(['aaaa1111', 'ffff6666']);
  });

  it('keeps going when one issue throws', async () => {
    const other = mkdtempSync(join(tmpdir(), 'conflict-repair-other-'));
    try {
      approve();
      appendPipelineEntry(other, { type: 'review.verdict', issueId: 'PAN-4311', data: { verdict: 'APPROVED' } });
      const { deps } = makeDeps({
        listWorkspaces: () => [{ issueId: 'PAN-4311', path: other }, { issueId: ISSUE, path: workspace }],
        evaluateGate: async (issueId) => {
          if (issueId === 'PAN-4311') throw new Error('gh exploded');
          return gate(true);
        },
      });
      expect(await tickConflictRepair(deps)).toEqual(['PAN-1166: repair-requested']);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe('tickConflictRepair — review backstop after a repair', () => {
  /** A repair sent for head A, then the forge reports head B as mergeable. */
  async function repairThenMove(overrides: ConflictRepairDeps = {}) {
    approve();
    let current = gate(true, HEAD_A);
    const requestReview = vi.fn(async (): Promise<GuardedReviewRequestOutcome | null> => ({ kind: 'started', autoRequeueCount: 0 }));
    const { deps } = makeDeps({ evaluateGate: async () => current, requestReview, ...overrides });
    await tickConflictRepair(deps);
    current = gate(false, HEAD_B);
    return { deps, requestReview, setGate: (next: ConflictRepairGateResult) => { current = next; } };
  }

  it('requests review once for a moved, mergeable head with no review request after the repair', async () => {
    const { deps, requestReview } = await repairThenMove();

    vi.advanceTimersByTime(CONFLICT_REPAIR_REVIEW_BACKSTOP_MS);
    expect(await tickConflictRepair(deps)).toEqual(['PAN-1166: review-requested (started)']);
    vi.advanceTimersByTime(60_000);
    await tickConflictRepair(deps);

    expect(requestReview).toHaveBeenCalledOnce();
    expect(requestReview).toHaveBeenCalledWith(ISSUE);
  });

  it('asks a refusing door again only after another backstop window', async () => {
    const { deps, requestReview } = await repairThenMove();

    vi.advanceTimersByTime(CONFLICT_REPAIR_REVIEW_BACKSTOP_MS);
    await tickConflictRepair(deps);
    vi.advanceTimersByTime(CONFLICT_REPAIR_REVIEW_BACKSTOP_MS);
    await tickConflictRepair(deps);

    expect(requestReview).toHaveBeenCalledTimes(2);
  });

  it('raises Needs-you once per head when the door refuses for a reason the operator must fix', async () => {
    const surfaceNeedsYou = vi.fn(async () => undefined);
    const { deps, requestReview } = await repairThenMove({ surfaceNeedsYou });
    requestReview.mockResolvedValue({ kind: 'circuit-breaker', autoRequeueCount: 3 });

    vi.advanceTimersByTime(CONFLICT_REPAIR_REVIEW_BACKSTOP_MS);
    expect(await tickConflictRepair(deps)).toEqual(['PAN-1166: review-requested (circuit-breaker)']);
    vi.advanceTimersByTime(CONFLICT_REPAIR_REVIEW_BACKSTOP_MS);
    await tickConflictRepair(deps);

    expect(requestReview).toHaveBeenCalledTimes(2);
    expect(surfaceNeedsYou).toHaveBeenCalledOnce();
    expect(surfaceNeedsYou).toHaveBeenCalledWith(
      ISSUE,
      expect.stringContaining('review request was refused (circuit-breaker)'),
      expect.objectContaining({ head: 'ffff6666', reason: 'circuit-breaker' }),
    );
  });

  it('does not raise Needs-you when the door answers already-passed', async () => {
    const surfaceNeedsYou = vi.fn(async () => undefined);
    const { deps, requestReview } = await repairThenMove({ surfaceNeedsYou });
    requestReview.mockResolvedValue({ kind: 'already-passed' });

    vi.advanceTimersByTime(CONFLICT_REPAIR_REVIEW_BACKSTOP_MS);
    expect(await tickConflictRepair(deps)).toEqual(['PAN-1166: review-requested (already-passed)']);
    expect(surfaceNeedsYou).not.toHaveBeenCalled();
  });

  it('does not request review when a review request followed the repair', async () => {
    const { deps, requestReview } = await repairThenMove();
    appendPipelineEntry(workspace, { type: 'review.requested', issueId: ISSUE, source: 'pan-review-request' });

    vi.advanceTimersByTime(CONFLICT_REPAIR_REVIEW_BACKSTOP_MS);
    await tickConflictRepair(deps);

    expect(requestReview).not.toHaveBeenCalled();
  });

  it('does not request review while the head is still the repaired one', async () => {
    const { deps, requestReview, setGate } = await repairThenMove();
    setGate(gate(false, HEAD_A));

    vi.advanceTimersByTime(CONFLICT_REPAIR_REVIEW_BACKSTOP_MS);
    await tickConflictRepair(deps);

    expect(requestReview).not.toHaveBeenCalled();
  });

  it('does not request review within the backstop window', async () => {
    const { deps, requestReview } = await repairThenMove();

    vi.advanceTimersByTime(CONFLICT_REPAIR_REVIEW_BACKSTOP_MS - 60_000);
    await tickConflictRepair(deps);

    expect(requestReview).not.toHaveBeenCalled();
  });

  it('does not request review while the forge has not computed mergeability', async () => {
    const { deps, requestReview, setGate } = await repairThenMove();
    setGate({ ...gate(false, HEAD_B), facts: { ...gate(false, HEAD_B).facts, mergeable: null } });

    vi.advanceTimersByTime(CONFLICT_REPAIR_REVIEW_BACKSTOP_MS);
    await tickConflictRepair(deps);

    expect(requestReview).not.toHaveBeenCalled();
  });

  it('does not request review for a paused issue', async () => {
    let paused = false;
    const { deps, requestReview } = await repairThenMove({
      getIssuePause: () => (paused ? { status: 'paused', agentId: 'agent-pan-1166' } : { status: 'unpaused' }),
    });
    paused = true;

    vi.advanceTimersByTime(CONFLICT_REPAIR_REVIEW_BACKSTOP_MS);
    await tickConflictRepair(deps);

    expect(requestReview).not.toHaveBeenCalled();
  });

  it('does nothing without a prior repair', async () => {
    approve();
    const requestReview = vi.fn(async () => undefined);
    const { deps } = makeDeps({ evaluateGate: async () => gate(false, HEAD_B), requestReview });

    vi.advanceTimersByTime(CONFLICT_REPAIR_REVIEW_BACKSTOP_MS);
    await tickConflictRepair(deps);

    expect(requestReview).not.toHaveBeenCalled();
  });
});
