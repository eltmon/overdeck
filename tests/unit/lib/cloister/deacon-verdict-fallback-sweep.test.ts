/**
 * PAN-3092: the stranded-verdict-fallback sweep.
 *
 * The drain that folds `<workspace>/.overdeck/pipeline-verdict.json` back into
 * the record is scheduled on unref'd timers by the process that wrote it — and
 * `pan admin specialists done` exits in under a second, so those timers usually
 * never fire. This patrol is the external retry, plus the one-shot escalation
 * for a verdict the record lock has kept stuck for ten minutes (MIN-902).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadReviewStatuses: vi.fn(),
  readWorkspaceVerdictFallback: vi.fn(),
  drainWorkspaceVerdictFallback: vi.fn(),
  findWorkspaceVerdictConflicts: vi.fn(),
  recordRecoveryFailure: vi.fn(),
  findRecoveryTrip: vi.fn(),
  emitActivityEntryOnce: vi.fn(),
  readOwner: vi.fn(),
  findWorkspacePath: vi.fn(),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  loadReviewStatuses: mocks.loadReviewStatuses,
}));

vi.mock('../../../../src/lib/overdeck/review-status-record-sync.js', () => ({
  readWorkspaceVerdictFallback: mocks.readWorkspaceVerdictFallback,
  drainWorkspaceVerdictFallback: mocks.drainWorkspaceVerdictFallback,
  findWorkspaceVerdictConflicts: mocks.findWorkspaceVerdictConflicts,
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: (issueId: string) =>
    (issueId.startsWith('PAN-') ? { projectKey: 'overdeck', projectPath: '/project' } : null),
  getProjectSync: () => ({ key: 'overdeck', path: '/project', name: 'overdeck' }),
}));

vi.mock('../../../../src/lib/pan-dir/fs-lock.js', () => ({
  readOwner: mocks.readOwner,
  recordLockPath: () => '/locks/records/overdeck/PAN-9999.lock',
}));

vi.mock('../../../../src/lib/lifecycle/archive-planning.js', () => ({
  findWorkspacePath: mocks.findWorkspacePath,
}));

vi.mock('../../../../src/lib/cloister/recovery-trip.js', () => ({
  recordRecoveryFailure: mocks.recordRecoveryFailure,
  findRecoveryTrip: mocks.findRecoveryTrip,
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntryOnce: mocks.emitActivityEntryOnce,
}));

import { VERDICT_CONTENTION_SURFACE_MS } from '../../../../src/lib/cloister/deacon-verdict-fallback-sweep.js';

const SWEEP_MODULE = '../../../../src/lib/cloister/deacon-verdict-fallback-sweep.js';

/** A fresh module instance — i.e. what a dashboard restart produces. */
async function loadSweep(): Promise<(now?: number) => Promise<string[]>> {
  vi.resetModules();
  return (await import(SWEEP_MODULE)).sweepStrandedVerdictFallbacks;
}

const ISSUE = 'PAN-9999';
const NOW = Date.parse('2026-07-27T01:00:00.000Z');

function fallbackWrittenMsAgo(ms: number): { issueId: string; updatedAt: string; pipeline: Record<string, unknown> } {
  return {
    issueId: ISSUE,
    updatedAt: new Date(NOW - ms).toISOString(),
    pipeline: { reviewStatus: 'passed', reviewNotes: 'APPROVED' },
  };
}

describe('sweepStrandedVerdictFallbacks (PAN-3092)', () => {
  /**
   * The durable recovery trips, as they would exist in the per-issue record.
   * Modelling them statefully is what makes the restart simulation meaningful:
   * module-local state can be cleared while this survives, exactly as a
   * dashboard restart leaves the record on disk.
   */
  let durableTrips: Map<string, { open: boolean; tripCount: number }>;
  /**
   * The durable activity log, as the event store would hold it. Assertions run
   * against appended events rather than call counts, because a repeat call that
   * appends nothing is exactly the behaviour under test.
   */
  let activityEvents: Array<{ id: string; message?: string }>;
  // Each test gets its own module instance so the sweep's process-local dedupe
  // set cannot leak between cases — and so "restart" means exactly one thing.
  let sweepStrandedVerdictFallbacks: (now?: number) => Promise<string[]>;
  const tripKey = (issueId: string, path: string, generation: string) => `${issueId}|${path}|${generation}`;

  beforeEach(async () => {
    vi.clearAllMocks();
    durableTrips = new Map();
    activityEvents = [];
    sweepStrandedVerdictFallbacks = await loadSweep();
    // Mirrors emitActivityEntryOnce: append once per id, never twice.
    mocks.emitActivityEntryOnce.mockImplementation(async (opts: { id: string; message?: string }) => {
      if (activityEvents.some((e) => e.id === opts.id)) return 'duplicate';
      activityEvents.push(opts);
      return 'appended';
    });
    mocks.loadReviewStatuses.mockReturnValue({ [ISSUE]: { issueId: ISSUE, reviewStatus: 'reviewing' } });
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(null);
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(true);
    mocks.readOwner.mockResolvedValue({ description: 'pan-cli pid=4242 acquiredAt=2026-07-27T00:45:00.000Z' });
    mocks.findWorkspacePath.mockReturnValue('/project/workspaces/feature-pan-9999');
    mocks.findWorkspaceVerdictConflicts.mockResolvedValue([]);

    mocks.findRecoveryTrip.mockImplementation(
      async (issueId: string, path: string, generation: string) =>
        durableTrips.get(tripKey(issueId, path, generation)),
    );
    // Mirrors recordRecoveryFailure at threshold 1: the first call opens the
    // trip and emits, every later call for the same generation is a no-op.
    mocks.recordRecoveryFailure.mockImplementation(
      async (_ws: string, issueId: string, path: string, generation: string) => {
        const key = tripKey(issueId, path, generation);
        const prior = durableTrips.get(key);
        if (prior?.open) return { trip: prior, emitNeedsYou: false };
        const trip = { open: true, tripCount: (prior?.tripCount ?? 0) + 1 };
        durableTrips.set(key, trip);
        return { trip, emitNeedsYou: true };
      },
    );
  });

  it('folds a stranded fallback whose writing process is long gone', async () => {
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(fallbackWrittenMsAgo(30_000));

    const actions = await sweepStrandedVerdictFallbacks(NOW);

    expect(mocks.drainWorkspaceVerdictFallback).toHaveBeenCalledWith(ISSUE);
    expect(actions).toEqual([`Drained stranded verdict fallback for ${ISSUE}`]);
    expect(mocks.recordRecoveryFailure).not.toHaveBeenCalled();
  });

  it('does nothing at all for an issue with no fallback', async () => {
    const actions = await sweepStrandedVerdictFallbacks(NOW);

    expect(mocks.drainWorkspaceVerdictFallback).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('surfaces a verdict the lock has held past ten minutes exactly once', async () => {
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(
      fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS + 60_000),
    );
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);

    const first = await sweepStrandedVerdictFallbacks(NOW);
    const second = await sweepStrandedVerdictFallbacks(NOW + 60_000);
    const third = await sweepStrandedVerdictFallbacks(NOW + 120_000);

    const needsYou = first.find((a) => a.includes(`needs-you ${ISSUE}`));
    expect(needsYou).toBeDefined();
    expect(needsYou).toContain('11min');
    expect(needsYou).toContain('pid=4242');
    expect(second).toEqual([]);
    expect(third).toEqual([]);

    expect(mocks.emitActivityEntryOnce).toHaveBeenCalledTimes(1);
    const entry = mocks.emitActivityEntryOnce.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry.source).toBe('cloister');
    expect(entry.level).toBe('warn');
    expect(entry.issueId).toBe(ISSUE);
    expect(String(entry.message)).toContain('record lock is contended');

    // Every sweep still retried the drain — the escalation is on top, not instead.
    expect(mocks.drainWorkspaceVerdictFallback).toHaveBeenCalledTimes(3);
    const [, , recoveryPath, generation, threshold] =
      mocks.recordRecoveryFailure.mock.calls[0] as [string, string, string, string, number];
    expect(recoveryPath).toBe('verdict-fallback-contention');
    expect(generation).toBe(fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS + 60_000).updatedAt);
    expect(threshold).toBe(1);
  });

  it('still warns when the needs-you write itself loses to the contended lock (PAN-3092)', async () => {
    // The condition being reported IS record-lock contention, so the durable
    // trip write can fail for exactly the reason the drain failed. The immediate
    // operator signal must not be collateral damage.
    const OTHER = 'PAN-8888';
    mocks.loadReviewStatuses.mockReturnValue({ [OTHER]: { issueId: OTHER } });
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(
      fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS + 120_000),
    );
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);
    mocks.recordRecoveryFailure.mockRejectedValue(new Error('record lock is held'));

    const first = await sweepStrandedVerdictFallbacks(NOW);
    const second = await sweepStrandedVerdictFallbacks(NOW + 60_000);

    expect(mocks.emitActivityEntryOnce).toHaveBeenCalledTimes(1);
    expect(String((mocks.emitActivityEntryOnce.mock.calls[0]![0] as Record<string, unknown>).message))
      .toContain('record lock is contended');
    // The failed durable trip is reported, not swallowed, and retried next patrol.
    expect(first.some((a) => a.includes('needs-you trip could not be recorded'))).toBe(true);
    expect(mocks.recordRecoveryFailure).toHaveBeenCalledTimes(2);
    // ...but the warning itself does not repeat for the same episode.
    expect(second.some((a) => a.includes('verdict contended'))).toBe(false);
  });

  it.each([
    ['mergeStatus', 'merged', 'failed'],
    ['inspectStatus', 'passed', 'blocked'],
    ['verificationStatus', 'passed', 'failed'],
    ['reviewStatus', 'skipped', 'passed'],
  ])(
    'never prescribes a specialist command for a %s conflict it cannot resolve (PAN-3092)',
    async (gate, journalValue, fallbackValue) => {
      // `specialists done` is not a general resolver: merge maps passed->merged
      // so "merged" is rejected, inspect needs an --item this conflict cannot
      // name, verification has no specialist, and review rejects "skipped".
      // Prescribing it would send the operator to a command that errors.
      mocks.readWorkspaceVerdictFallback.mockResolvedValue(
        fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS + 60_000),
      );
      mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);
      mocks.findWorkspaceVerdictConflicts.mockResolvedValue([{ gate, journalValue, fallbackValue }]);

      await sweepStrandedVerdictFallbacks(NOW);

      const message = String(
        (mocks.emitActivityEntryOnce.mock.calls[0]![0] as Record<string, unknown>).message,
      );
      expect(message).toContain(gate);
      expect(message).toContain(`"${journalValue}"`);
      expect(message).toContain(`"${fallbackValue}"`);
      expect(message).not.toContain('pan admin specialists done');
      // The one instruction that is correct for every gate.
      expect(message).toContain('strictly newer review cycle');
    },
  );

  it('names every conflicting gate when a fallback conflicts on more than one (PAN-3092)', async () => {
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(
      fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS + 60_000),
    );
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);
    mocks.findWorkspaceVerdictConflicts.mockResolvedValue([
      { gate: 'reviewStatus', journalValue: 'blocked', fallbackValue: 'passed' },
      { gate: 'testStatus', journalValue: 'failed', fallbackValue: 'passed' },
    ]);

    const actions = await sweepStrandedVerdictFallbacks(NOW);

    const message = String(
      (mocks.emitActivityEntryOnce.mock.calls[0]![0] as Record<string, unknown>).message,
    );
    // A single-gate command could never settle both — both are named instead.
    expect(message).toContain('2 gates');
    expect(message).toContain('reviewStatus');
    expect(message).toContain('testStatus');
    expect(actions.some((a) => a.includes('reviewStatus, testStatus'))).toBe(true);
  });

  it('tells the operator a re-signal of an existing value will not clear it (PAN-3092)', async () => {
    // Choosing the value already in the journal writes no replacement fallback,
    // so the conflicting one survives and every later drain withholds it again.
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(
      fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS + 60_000),
    );
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);
    mocks.findWorkspaceVerdictConflicts.mockResolvedValue([
      { gate: 'reviewStatus', journalValue: 'blocked', fallbackValue: 'passed' },
    ]);

    await sweepStrandedVerdictFallbacks(NOW);

    const message = String(
      (mocks.emitActivityEntryOnce.mock.calls[0]![0] as Record<string, unknown>).message,
    );
    expect(message).toContain('do not expect a re-signal of an existing value to clear this');
  });

  it('names a verdict conflict as needing adjudication, never as transient contention (PAN-3092)', async () => {
    // A withheld fold and a lost lock race both surface as a failed drain, but
    // only contention clears on its own. Telling the operator to wait for an
    // automatic fold that is structurally forbidden is false remediation.
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(
      fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS + 60_000),
    );
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);
    mocks.findWorkspaceVerdictConflicts.mockResolvedValue([
      { gate: 'reviewStatus', journalValue: 'blocked', fallbackValue: 'passed' },
    ]);

    const actions = await sweepStrandedVerdictFallbacks(NOW);

    const message = String(
      (mocks.emitActivityEntryOnce.mock.calls[0]![0] as Record<string, unknown>).message,
    );
    // Names the gate and BOTH written values, so the operator can adjudicate.
    expect(message).toContain('reviewStatus');
    expect(message).toContain('"blocked"');
    expect(message).toContain('"passed"');
    // Says plainly that waiting will not help, and gives the one action that
    // reliably clears it for every gate.
    expect(message).toContain('will NOT');
    expect(message).toContain('strictly newer review cycle');
    // And never claims the lock will free itself.
    expect(message).not.toContain('folds automatically');
    expect(message).not.toContain('record lock is contended');

    // A distinct recovery path, so conflicts and contention dedupe separately.
    const [, , recoveryPath] = mocks.recordRecoveryFailure.mock.calls[0] as [string, string, string];
    expect(recoveryPath).toBe('verdict-fallback-conflict');
    expect(actions.some((a) => a.includes('needs operator adjudication'))).toBe(true);
  });

  it('does not repeat the warning after a restart when the trip write never landed (PAN-3092)', async () => {
    // The hard case: the trip write fails for exactly the reason being reported
    // (the record lock is contended), so the durable trip plane cannot dedupe.
    // The episode-derived activity id must carry it instead.
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(
      fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS + 60_000),
    );
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);
    mocks.recordRecoveryFailure.mockRejectedValue(new Error('record lock is held'));

    await sweepStrandedVerdictFallbacks(NOW);
    expect(activityEvents).toHaveLength(1);
    expect(activityEvents[0]!.id).toBe(
      `verdict-fallback:verdict-fallback-contention:${ISSUE}:${fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS + 60_000).updatedAt}`,
    );

    // Dashboard restart: in-process state is gone and no durable trip exists.
    const afterRestart = await loadSweep();
    expect(durableTrips.size).toBe(0);

    await afterRestart(NOW + 60_000);

    // Still ONE durable activity event for this episode. A reused id alone would
    // not have been enough — it replaces the projected row but still appends and
    // re-publishes a second event, which is the repeat warning FR-4 forbids.
    expect(activityEvents).toHaveLength(1);
  });

  it('treats an unconfirmed emit as not-yet-warned and retries it (PAN-3092)', async () => {
    // `unconfirmed` means the wired store offers no settled at-most-once path,
    // so delivery is unknown. Treating it as success would suppress the retry
    // on the strength of a guarantee nothing actually made.
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(
      fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS + 60_000),
    );
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);
    // The trip must also fail, or its durable open state short-circuits later
    // patrols before they reach the warning at all.
    mocks.recordRecoveryFailure.mockRejectedValue(new Error('record lock is held'));
    mocks.emitActivityEntryOnce.mockResolvedValueOnce('unconfirmed');

    const first = await sweepStrandedVerdictFallbacks(NOW);
    expect(first.some((a) => a.includes('could not be confirmed'))).toBe(true);

    // Not marked warned, so the next patrol tries again.
    const second = await sweepStrandedVerdictFallbacks(NOW + 60_000);
    expect(activityEvents).toHaveLength(1);
    expect(second.some((a) => a.includes('verdict contended'))).toBe(true);
  });

  it('retries the warning on the next patrol when the activity append fails (PAN-3092)', async () => {
    // The in-process set must not mark an episode warned before the write is
    // durable, or a transient store failure leaves the operator with nothing
    // until the next restart.
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(
      fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS + 60_000),
    );
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);
    mocks.recordRecoveryFailure.mockRejectedValue(new Error('record lock is held'));
    mocks.emitActivityEntryOnce.mockResolvedValueOnce('failed');

    const first = await sweepStrandedVerdictFallbacks(NOW);
    expect(activityEvents).toHaveLength(0);
    expect(first.some((a) => a.includes('could not be confirmed'))).toBe(true);

    // Same process, next patrol: the episode was never marked warned, so it retries.
    const second = await sweepStrandedVerdictFallbacks(NOW + 60_000);
    expect(activityEvents).toHaveLength(1);
    expect(second.some((a) => a.includes('verdict contended'))).toBe(true);
  });

  it('makes no record write once the episode is durably surfaced (PAN-3092)', async () => {
    // A retained verdict conflict is permanent by design, so a per-patrol no-op
    // record write would take the contended lock forever, for nothing.
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(
      fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS + 60_000),
    );
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);

    await sweepStrandedVerdictFallbacks(NOW);
    expect(mocks.recordRecoveryFailure).toHaveBeenCalledTimes(1);

    await sweepStrandedVerdictFallbacks(NOW + 60_000);
    await sweepStrandedVerdictFallbacks(NOW + 120_000);

    // Zero additional writes, while the drain is still retried every patrol.
    expect(mocks.recordRecoveryFailure).toHaveBeenCalledTimes(1);
    expect(mocks.drainWorkspaceVerdictFallback).toHaveBeenCalledTimes(3);
    expect(mocks.emitActivityEntryOnce).toHaveBeenCalledTimes(1);
  });

  it('clears its process-local key once the trip lands, so the durable plane owns dedupe (PAN-3092)', async () => {
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(
      fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS + 60_000),
    );
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);

    await sweepStrandedVerdictFallbacks(NOW);
    expect(mocks.emitActivityEntryOnce).toHaveBeenCalledTimes(1);

    // An operator acknowledges the trip, clearing the durable plane. If the
    // in-process key had been retained, this episode could never warn again.
    durableTrips.clear();
    await sweepStrandedVerdictFallbacks(NOW + 60_000);

    expect(mocks.emitActivityEntryOnce).toHaveBeenCalledTimes(2);
  });

  it('does not repeat the warning after a dashboard restart clears module state (PAN-3092)', async () => {
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(
      fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS + 60_000),
    );
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);

    await sweepStrandedVerdictFallbacks(NOW);
    expect(mocks.emitActivityEntryOnce).toHaveBeenCalledTimes(1);

    // Simulate a dashboard restart: module-local dedupe is gone, but the durable
    // recovery trip written above survives in the per-issue record.
    const afterRestart = await loadSweep();
    expect(durableTrips.size).toBe(1);

    const actions = await afterRestart(NOW + 60_000);

    // The durable trip is consulted before warning, so the episode stays quiet.
    expect(mocks.emitActivityEntryOnce).toHaveBeenCalledTimes(1);
    expect(actions.some((a) => a.includes('verdict contended'))).toBe(false);
  });

  it('stays quiet about a fallback younger than the contention threshold', async () => {
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(
      fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS - 1_000),
    );
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);

    const actions = await sweepStrandedVerdictFallbacks(NOW);

    expect(actions).toEqual([]);
    expect(mocks.recordRecoveryFailure).not.toHaveBeenCalled();
    expect(mocks.emitActivityEntryOnce).not.toHaveBeenCalled();
  });

  it('keeps draining stuck and deacon-ignored issues without adding a second voice', async () => {
    mocks.loadReviewStatuses.mockReturnValue({
      'PAN-1111': { issueId: 'PAN-1111', stuck: true },
      'PAN-2222': { issueId: 'PAN-2222', deaconIgnored: true },
    });
    mocks.readWorkspaceVerdictFallback.mockResolvedValue(
      fallbackWrittenMsAgo(VERDICT_CONTENTION_SURFACE_MS * 3),
    );
    mocks.drainWorkspaceVerdictFallback.mockResolvedValue(false);

    const actions = await sweepStrandedVerdictFallbacks(NOW);

    expect(mocks.drainWorkspaceVerdictFallback).toHaveBeenCalledTimes(2);
    expect(actions).toEqual([]);
    expect(mocks.recordRecoveryFailure).not.toHaveBeenCalled();
    expect(mocks.emitActivityEntryOnce).not.toHaveBeenCalled();
  });

  it('skips merged and closed-out issues entirely', async () => {
    mocks.loadReviewStatuses.mockReturnValue({
      'PAN-1111': { issueId: 'PAN-1111', mergeStatus: 'merged' },
      'PAN-2222': { issueId: 'PAN-2222', closedOut: true },
    });

    const actions = await sweepStrandedVerdictFallbacks(NOW);

    expect(mocks.readWorkspaceVerdictFallback).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('lets one unreadable workspace not stop the rest of the sweep', async () => {
    mocks.loadReviewStatuses.mockReturnValue({
      'PAN-1111': { issueId: 'PAN-1111' },
      'PAN-2222': { issueId: 'PAN-2222' },
    });
    mocks.readWorkspaceVerdictFallback
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValue(fallbackWrittenMsAgo(30_000));

    const actions = await sweepStrandedVerdictFallbacks(NOW);

    expect(actions).toEqual(['Drained stranded verdict fallback for PAN-2222']);
  });
});
