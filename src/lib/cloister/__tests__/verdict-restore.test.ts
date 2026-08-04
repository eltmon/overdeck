/**
 * PAN-3511 — the verdict-of-record restore door.
 *
 * These fixtures lock the read-side contract every recovery path adopts: a
 * fresh artifact wins over the row's history, an absent artifact never invents
 * approval, and a restore that would be rejected for disagreeing with the row's
 * anchor is reported rather than silently dropped.
 *
 * NFR-2 / hazard H5: every artifact-shape fixture exercises BOTH filenames —
 * `synthesis.md` (convoy) and `review.md` (quick self-review, the fleet
 * default). A suite that only exercised synthesis.md would be blind to the
 * default mode, which is the exact blindness 0bc2b444e23 fixed in the reader.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attemptArtifactVerdictRestore,
  type ArtifactVerdictRestoreDeps,
} from '../verdict-restore.js';
import { restoreWouldTripHeadGuard } from '../verdict-head-guard.js';
import type { SynthesisArtifactVerdict } from '../synthesis-verdict.js';
import { VERDICT_REPORT_FILENAMES, type VerdictReportFilename } from '../review-verdict-report.js';
import { installTestReviewAttestationKey, writeAttestedReviewArtifact } from './review-artifact-test-helpers.js';

const ISSUE = 'PAN-3511';
const REVIEW_RUN_ID = 'agent-pan-3511-review-run-1-att1';

interface Harness {
  deps: Partial<ArtifactVerdictRestoreDeps>;
  setStatus: ReturnType<typeof vi.fn>;
  emitEvent: ReturnType<typeof vi.fn>;
  emitActivity: ReturnType<typeof vi.fn>;
}

function harness(options: {
  artifact: SynthesisArtifactVerdict | null;
  status: Record<string, unknown> | null;
}): Harness {
  const setStatus = vi.fn();
  const emitEvent = vi.fn();
  const emitActivity = vi.fn(async () => 'appended' as const);
  return {
    setStatus,
    emitEvent,
    emitActivity,
    deps: {
      readArtifact: () => options.artifact,
      getStatus: () => options.status as never,
      setStatus,
      emitEvent,
      emitActivity,
      now: () => 1_000_000,
    },
  };
}

function passedArtifact(overrides: Partial<SynthesisArtifactVerdict> = {}): SynthesisArtifactVerdict {
  return { verdict: 'passed', notes: 'All four lenses approved.', runId: REVIEW_RUN_ID, mtimeMs: 999_000, ...overrides };
}

describe('restoreWouldTripHeadGuard', () => {
  it('does not trip when the artifact carries no head evidence', () => {
    // The common quick-self-review shape: review.md with no context.json.
    expect(restoreWouldTripHeadGuard({ rowHead: 'abc1234' })).toBe(false);
    expect(restoreWouldTripHeadGuard({ artifactHead: '', rowHead: 'abc1234' })).toBe(false);
  });

  it('does not trip when the row has never recorded a verified commit', () => {
    expect(restoreWouldTripHeadGuard({ artifactHead: 'abc1234' })).toBe(false);
    expect(restoreWouldTripHeadGuard({ artifactHead: 'abc1234', rowHead: '' })).toBe(false);
  });

  it('does not trip when both heads agree', () => {
    expect(restoreWouldTripHeadGuard({ artifactHead: 'abc1234', rowHead: 'abc1234' })).toBe(false);
  });

  it('trips only when both heads are present and differ', () => {
    expect(restoreWouldTripHeadGuard({ artifactHead: 'abc1234', rowHead: 'def5678' })).toBe(true);
  });
});

describe('attemptArtifactVerdictRestore', () => {
  it('restores a fresh passed artifact with no head evidence onto a reviewing row (ac1)', async () => {
    const h = harness({
      artifact: passedArtifact(),
      status: { reviewStatus: 'reviewing' },
    });

    const result = await attemptArtifactVerdictRestore(ISSUE, { deps: h.deps });

    expect(result.outcome).toBe('restored');
    expect(h.setStatus).toHaveBeenCalledTimes(1);
    const [issueId, update] = h.setStatus.mock.calls[0]!;
    expect(issueId).toBe(ISSUE);
    expect(update).toMatchObject({
      reviewStatus: 'passed',
      reviewNotes: 'All four lenses approved.',
      reviewRetryCount: 0,
      recoveryStartedAt: undefined,
    });
    // No head evidence means no anchor is asserted — never fabricate one.
    expect(update).not.toHaveProperty('reviewedAtCommit');
    expect(h.emitEvent).not.toHaveBeenCalled();
  });

  it('anchors the restore to the artifact head when the row agrees', async () => {
    const h = harness({
      artifact: passedArtifact({ headSha: 'abc1234' }),
      status: { reviewStatus: 'reviewing', lastVerifiedCommit: 'abc1234' },
    });

    const result = await attemptArtifactVerdictRestore(ISSUE, { deps: h.deps });

    expect(result.outcome).toBe('restored');
    expect(h.setStatus.mock.calls[0]![1]).toMatchObject({
      reviewStatus: 'passed',
      reviewedAtCommit: 'abc1234',
    });
  });

  it('blocks the restore and reports it when the artifact head disagrees with the row anchor (ac2)', async () => {
    const h = harness({
      artifact: passedArtifact({ headSha: 'aaaaaaa1' }),
      status: { reviewStatus: 'reviewing', lastVerifiedCommit: 'bbbbbbb2' },
    });

    const result = await attemptArtifactVerdictRestore(ISSUE, { deps: h.deps, caller: 'orphan-reset' });

    expect(result.outcome).toBe('blocked-by-head-guard');
    expect(h.setStatus).not.toHaveBeenCalled();

    expect(h.emitEvent).toHaveBeenCalledTimes(1);
    const [type, payload] = h.emitEvent.mock.calls[0]!;
    expect(type).toBe('review.verdict_restore_blocked');
    expect(payload).toMatchObject({
      issueId: ISSUE,
      caller: 'orphan-reset',
      verdict: 'passed',
      artifactHead: 'aaaaaaa1',
      rowHead: 'bbbbbbb2',
    });
  });

  it('never sneaks past the guard by dropping or re-anchoring the head', async () => {
    // The two loopholes the guard exists to close: an unanchored terminal
    // verdict, and a verdict re-anchored to the row's own commit (which lies
    // about what the reviewer actually read).
    const h = harness({
      artifact: passedArtifact({ headSha: 'aaaaaaa1' }),
      status: { reviewStatus: 'reviewing', lastVerifiedCommit: 'bbbbbbb2' },
    });

    await attemptArtifactVerdictRestore(ISSUE, { deps: h.deps });

    expect(h.setStatus).not.toHaveBeenCalled();
  });

  it('reports a persistently blocked restore once, not once per patrol (ac3)', async () => {
    const h = harness({
      artifact: passedArtifact({ headSha: 'aaaaaaa1' }),
      status: { reviewStatus: 'reviewing', lastVerifiedCommit: 'bbbbbbb2' },
    });

    await attemptArtifactVerdictRestore(ISSUE, { deps: h.deps });
    await attemptArtifactVerdictRestore(ISSUE, { deps: h.deps });

    // Dedup is delegated to emitActivityEntryOnce, so the contract this fixture
    // locks is that the helper routes through the once-path with a STABLE id
    // keyed on the condition — the same id both times.
    expect(h.emitActivity).toHaveBeenCalledTimes(2);
    const [first, second] = h.emitActivity.mock.calls.map((call) => call[0] as { id: string });
    expect(first!.id).toBe(second!.id);
    expect(first!.id).toContain(ISSUE);
    expect(first!.id).toContain('aaaaaaa1');
    expect(first!.id).toContain('bbbbbbb2');
  });

  it('re-reports when the condition changes — a moved row anchor is new information', async () => {
    const first = harness({
      artifact: passedArtifact({ headSha: 'aaaaaaa1' }),
      status: { reviewStatus: 'reviewing', lastVerifiedCommit: 'bbbbbbb2' },
    });
    const second = harness({
      artifact: passedArtifact({ headSha: 'aaaaaaa1' }),
      status: { reviewStatus: 'reviewing', lastVerifiedCommit: 'ccccccc3' },
    });

    await attemptArtifactVerdictRestore(ISSUE, { deps: first.deps });
    await attemptArtifactVerdictRestore(ISSUE, { deps: second.deps });

    const idA = (first.emitActivity.mock.calls[0]![0] as { id: string }).id;
    const idB = (second.emitActivity.mock.calls[0]![0] as { id: string }).id;
    expect(idA).not.toBe(idB);
  });

  it('writes nothing and emits nothing when no artifact exists (ac4)', async () => {
    const h = harness({ artifact: null, status: { reviewStatus: 'reviewing' } });

    const result = await attemptArtifactVerdictRestore(ISSUE, { deps: h.deps });

    expect(result).toEqual({ outcome: 'no-artifact' });
    expect(h.setStatus).not.toHaveBeenCalled();
    expect(h.emitEvent).not.toHaveBeenCalled();
    expect(h.emitActivity).not.toHaveBeenCalled();
  });

  it('clears the stuck gate it owns when restoring (ac5)', async () => {
    const h = harness({
      artifact: passedArtifact(),
      status: { reviewStatus: 'reviewing', stuck: true, stuckReason: 'review_infrastructure_failure' },
    });

    const result = await attemptArtifactVerdictRestore(ISSUE, {
      deps: h.deps,
      clearStuckReason: 'review_infrastructure_failure',
    });

    expect(result.outcome).toBe('restored');
    expect(h.setStatus.mock.calls[0]![1]).toMatchObject({
      reviewStatus: 'passed',
      stuck: false,
      stuckReason: undefined,
      stuckAt: undefined,
      stuckDetails: undefined,
    });
  });

  it('leaves a stuck gate it does not own alone', async () => {
    const h = harness({
      artifact: passedArtifact(),
      status: { reviewStatus: 'reviewing', stuck: true, stuckReason: 'verification_stuck' },
    });

    await attemptArtifactVerdictRestore(ISSUE, {
      deps: h.deps,
      clearStuckReason: 'review_infrastructure_failure',
    });

    const update = h.setStatus.mock.calls[0]![1] as Record<string, unknown>;
    expect(update).not.toHaveProperty('stuck');
    expect(update).not.toHaveProperty('stuckReason');
  });

  it('restores a blocked verdict too — the artifact is the verdict of record, not just for approvals', async () => {
    const h = harness({
      artifact: { verdict: 'blocked', notes: 'Unhandled null in the parser.', mtimeMs: 999_000 },
      status: { reviewStatus: 'reviewing' },
    });

    const result = await attemptArtifactVerdictRestore(ISSUE, { deps: h.deps });

    expect(result.outcome).toBe('restored');
    expect(h.setStatus.mock.calls[0]![1]).toMatchObject({
      reviewStatus: 'blocked',
      reviewNotes: 'Unhandled null in the parser.',
    });
  });
});

describe('orphan-reset call site (PAN-3511 retrofit)', () => {
  // The orphan patrol installs a passed-only reader so that ONLY an approved
  // artifact short-circuits the reset — exactly the behavior the inline block
  // had before the retrofit. These cases pin that composition.
  //
  // Scope note: `reconcileReviewStatusOrphan` is not exported and needs the
  // whole patrol surface (agents, tmux, status) to drive end-to-end, so this
  // exercises the decision the call site delegates, not the patrol itself.
  function orphanDeps(artifact: SynthesisArtifactVerdict | null, status: Record<string, unknown>) {
    const h = harness({ artifact: null, status });
    return {
      ...h,
      deps: {
        ...h.deps,
        readArtifact: () => (artifact?.verdict === 'passed' ? artifact : null),
      },
    };
  }

  it('restores and clears the infra-failure gate on an approved artifact (ac1)', async () => {
    const h = orphanDeps(passedArtifact(), {
      reviewStatus: 'reviewing',
      stuck: true,
      stuckReason: 'review_infrastructure_failure',
    });

    const result = await attemptArtifactVerdictRestore(ISSUE, {
      deps: h.deps,
      caller: 'orphan-reset',
      clearStuckReason: 'review_infrastructure_failure',
    });

    expect(result.outcome).toBe('restored');
    expect(h.setStatus.mock.calls[0]![1]).toMatchObject({
      reviewStatus: 'passed',
      reviewRetryCount: 0,
      stuck: false,
      stuckReason: undefined,
    });
  });

  it('reports and writes nothing when the approved artifact head disagrees (ac2)', async () => {
    const h = orphanDeps(passedArtifact({ headSha: 'aaaaaaa1' }), {
      reviewStatus: 'reviewing',
      lastVerifiedCommit: 'bbbbbbb2',
    });

    const result = await attemptArtifactVerdictRestore(ISSUE, {
      deps: h.deps,
      caller: 'orphan-reset',
      clearStuckReason: 'review_infrastructure_failure',
    });

    // The call site returns on this outcome rather than falling through to the
    // pending reset — the artifact proves a review finished.
    expect(result.outcome).toBe('blocked-by-head-guard');
    expect(h.setStatus).not.toHaveBeenCalled();
    expect(h.emitEvent.mock.calls[0]![0]).toBe('review.verdict_restore_blocked');
    expect(h.emitEvent.mock.calls[0]![1]).toMatchObject({ caller: 'orphan-reset' });
  });

  it.each(['blocked', 'failed'] as const)(
    'falls through to the retry reset on a %s artifact, as before the retrofit (ac3)',
    async (verdict) => {
      const h = orphanDeps({ verdict, mtimeMs: 999_000 }, { reviewStatus: 'reviewing' });

      const result = await attemptArtifactVerdictRestore(ISSUE, {
        deps: h.deps,
        caller: 'orphan-reset',
        clearStuckReason: 'review_infrastructure_failure',
      });

      // 'no-artifact' is what lets the call site run its unchanged pending
      // reset — a non-approved artifact must not short-circuit the patrol.
      expect(result).toEqual({ outcome: 'no-artifact' });
      expect(h.setStatus).not.toHaveBeenCalled();
      expect(h.emitEvent).not.toHaveBeenCalled();
    },
  );

  it('falls through to the retry reset when no artifact exists at all (ac3)', async () => {
    const h = orphanDeps(null, { reviewStatus: 'reviewing' });

    const result = await attemptArtifactVerdictRestore(ISSUE, {
      deps: h.deps,
      caller: 'orphan-reset',
    });

    expect(result).toEqual({ outcome: 'no-artifact' });
    expect(h.setStatus).not.toHaveBeenCalled();
  });
});

describe('attemptArtifactVerdictRestore — real reader, both artifact shapes (H5/NFR-2)', () => {
  let workspacePath: string;

  beforeEach(() => {
    installTestReviewAttestationKey();
    workspacePath = mkdtempSync(join(tmpdir(), 'pan3511-verdict-restore-'));
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
    vi.useRealTimers();
  });

  function writeArtifact(filename: VerdictReportFilename, body: string, headSha?: string): void {
    writeAttestedReviewArtifact({
      workspacePath,
      issueId: ISSUE,
      runId: REVIEW_RUN_ID,
      filename,
      body,
      ...(headSha ? { headSha } : {}),
    });
  }

  // Both supported shapes, driven through the DEFAULT reader (no readArtifact
  // injection) so the module's real disk path is exercised for each filename.
  it.each(VERDICT_REPORT_FILENAMES)('restores an approved %s written by the reviewer', async (filename) => {
    writeArtifact(
      filename,
      '## Verdict: APPROVED\n\n## Summary\nEverything checks out cleanly here.\n',
      'a'.repeat(40),
    );

    const setStatus = vi.fn();
    const result = await attemptArtifactVerdictRestore(ISSUE, {
      workspacePath,
      reviewRunId: REVIEW_RUN_ID,
      deps: {
        getStatus: () => ({ reviewStatus: 'reviewing' }) as never,
        setStatus,
        emitEvent: vi.fn(),
        emitActivity: vi.fn(async () => 'appended' as const),
      },
    });

    expect(result.outcome).toBe('restored');
    expect(setStatus.mock.calls[0]![1]).toMatchObject({ reviewStatus: 'passed' });
  });

  it.each(VERDICT_REPORT_FILENAMES)('restores a CHANGES REQUESTED %s as blocked', async (filename) => {
    // Quick mode's blocked vocabulary is CHANGES REQUESTED — a reader that only
    // understood APPROVED/BLOCKED would be blind to it.
    writeArtifact(filename, '## Verdict: CHANGES REQUESTED — null deref in the parser\n');

    const setStatus = vi.fn();
    const result = await attemptArtifactVerdictRestore(ISSUE, {
      workspacePath,
      reviewRunId: REVIEW_RUN_ID,
      deps: {
        getStatus: () => ({ reviewStatus: 'reviewing' }) as never,
        setStatus,
        emitEvent: vi.fn(),
        emitActivity: vi.fn(async () => 'appended' as const),
      },
    });

    expect(result.outcome).toBe('restored');
    expect(setStatus.mock.calls[0]![1]).toMatchObject({
      reviewStatus: 'blocked',
      reviewNotes: 'null deref in the parser',
    });
  });

  it.each(VERDICT_REPORT_FILENAMES)('ignores a stale %s from an older review cycle', async (filename) => {
    // Freshness is bounded at 30 minutes so an artifact from a previous cycle
    // can never resurrect over a newly spawned review. Fake timers rather than
    // real clock drift (repo rule: fake timers for any delay-based test).
    vi.useFakeTimers();
    writeArtifact(filename, '## Verdict: APPROVED\n');
    vi.advanceTimersByTime(31 * 60_000);

    const setStatus = vi.fn();
    const result = await attemptArtifactVerdictRestore(ISSUE, {
      workspacePath,
      reviewRunId: REVIEW_RUN_ID,
      deps: {
        getStatus: () => ({ reviewStatus: 'reviewing' }) as never,
        setStatus,
        emitEvent: vi.fn(),
        emitActivity: vi.fn(async () => 'appended' as const),
      },
    });

    expect(result).toEqual({ outcome: 'no-artifact' });
    expect(setStatus).not.toHaveBeenCalled();
  });
});
