/**
 * PAN-3917 W6: `/api/flywheel/config` and `/api/flywheel/auto-merge/*` moved
 * to `/api/merge-train/*` (D3). The gate moved with them: scheduling an
 * auto-merge no longer asks a flywheel run or a review-status record, it asks
 * the merge gate (#4040, #3983) — approvals (a forge review or a trusted
 * verdict marker) plus green checks plus mergeability.
 */

import { describe, expect, it, vi } from 'vitest';
import type { MergeGateResult } from '../../../../lib/cloister/merge-gate.js';
import type { PrFacts } from '../../../../lib/cloister/pr-facts.js';

vi.mock('../../../../lib/activity-logger.js', () => ({ emitActivityTts: vi.fn() }));
// W5 owns these; they still reach the record plane in this tree, so the route
// test stubs them rather than loading half of cloister.
vi.mock('../../../../lib/cloister/merge-eligibility.js', () => ({
  gatherMergeEligibility: vi.fn(async () => []),
  isMergeEligible: vi.fn(() => false),
}));
vi.mock('../../../../lib/cloister/auto-merge-eligibility.js', async (importOriginal) => ({
  autoMergeFromLabels: (await importOriginal<typeof import('../../../../lib/cloister/auto-merge-eligibility.js')>()).autoMergeFromLabels,
  isAutoMergeEligible: vi.fn(async () => ({ eligible: true })),
}));
vi.mock('../../../../lib/cloister/merge-blockers.js', () => ({ getMergeBlockersPayload: vi.fn(() => []) }));
vi.mock('../../../../lib/overdeck/merge-sync.js', () => ({
  cancelPending: vi.fn(() => true),
  countActionableAutoMerges: vi.fn(() => 0),
  getActionableAutoMerge: vi.fn(() => null),
  listActiveAutoMerges: vi.fn(() => []),
  listProblemAutoMerges: vi.fn(() => []),
  scheduleAutoMergeWithResult: vi.fn(() => ({ created: true, entry: {} })),
  isMergeTrainEnabledForProject: vi.fn(() => true),
  getUatGeneration: vi.fn(() => null),
}));
// PAN-4753: a stateful stand-in for app_settings, so a POST then a GET shows
// what the route persisted. The bounds and parser are the real ones.
const settings = vi.hoisted(() => ({ mergeTrainEnabled: true, batchSize: 3, batchWaitMinutes: 30 }));
vi.mock('../../../../lib/overdeck/control-settings.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../lib/overdeck/control-settings.js')>();
  return {
    isFlywheelAutoPickupBacklog: vi.fn(() => false),
    isFlywheelRequireUatBeforeMerge: vi.fn(() => false),
    isMergeTrainEnabled: vi.fn(() => settings.mergeTrainEnabled),
    setFlywheelAutoPickupBacklog: vi.fn(),
    setFlywheelRequireUatBeforeMerge: vi.fn(),
    setMergeTrainEnabled: vi.fn((enabled: boolean) => { settings.mergeTrainEnabled = enabled; }),
    getMergeTrainBatchSize: vi.fn(() => settings.batchSize),
    getMergeTrainBatchWaitMinutes: vi.fn(() => settings.batchWaitMinutes),
    setMergeTrainBatchSize: vi.fn((n: number) => { settings.batchSize = n; }),
    setMergeTrainBatchWaitMinutes: vi.fn((n: number) => { settings.batchWaitMinutes = n; }),
    parseBoundedInteger: real.parseBoundedInteger,
    MERGE_TRAIN_BATCH_SIZE_BOUNDS: real.MERGE_TRAIN_BATCH_SIZE_BOUNDS,
    MERGE_TRAIN_BATCH_WAIT_MINUTES_BOUNDS: real.MERGE_TRAIN_BATCH_WAIT_MINUTES_BOUNDS,
  };
});

const {
  deleteAutoMergePayload,
  getPendingAutoMergePayload,
  getMergeTrainConfigPayload,
  postAutoMergeSchedulePayload,
  postMergeTrainConfigPayload,
} = await import('../merge-train.js');
const controlSettings = await import('../../../../lib/overdeck/control-settings.js');
const skipReasons = await import('../../services/auto-merge-skip-reasons.js');

const READY_FACTS: PrFacts = {
  issueId: 'PAN-3917',
  forge: 'github',
  url: 'https://github.com/eltmon/overdeck/pull/42',
  number: 42,
  exists: true,
  open: true,
  merged: false,
  closed: false,
  draft: false,
  headSha: 'abc123',
  headBranch: 'feature/pan-3917',
  reviewDecision: 'APPROVED',
  approved: true,
  approvedAtHead: true,
  changesRequested: false,
  mergeable: true,
  mergeableState: 'mergeable',
  checks: 'green',
  testChecks: 'green',
  testJobSucceeded: true,
  uatVerdict: null,
};

/** What the merge gate answers: ready on READY_FACTS unless told otherwise. */
function gate(facts: Partial<PrFacts> = {}, readiness: { ready: boolean; reason?: string } = { ready: true }): MergeGateResult {
  return { ...readiness, facts: { ...READY_FACTS, ...facts } };
}

const baseDeps = {
  now: () => new Date('2026-09-18T12:00:00Z'),
  isRequireUatBeforeMerge: () => false,
  // PAN-4753 D4: train off is the per-PR path these schedule tests exercise.
  isTrainOn: () => false,
  droppedFromBatch: () => false,
  isEligible: async () => ({ eligible: true }) as const,
  getProjectAutoMergeDefault: () => null,
  getIssueLabels: () => [],
  isIssueClosed: () => false,
  resolveProject: () => ({ projectKey: 'overdeck', projectName: 'Overdeck', projectPath: '/repos/overdeck' }),
  announce: vi.fn(),
  deftHold: async () => null,
};

describe('POST /api/merge-train/auto-merge/schedule', () => {
  it("schedules a ready issue from the merge gate's PR facts", async () => {
    const schedule = vi.fn(() => ({ created: true, entry: { id: 1, issueId: 'PAN-3917', status: 'pending' } }));
    const result = await postAutoMergeSchedulePayload({ issueId: 'pan-3917' }, {
      ...baseDeps,
      mergeGate: async () => gate(),
      schedule: schedule as never,
    });
    expect(result.status).toBe(200);
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-3917',
      prNumber: 42,
      prUrl: 'https://github.com/eltmon/overdeck/pull/42',
      headSha: 'abc123',
      forge: 'github',
      projectKey: 'overdeck',
    }));
  });

  it('refuses an issue the merge gate says is not ready', async () => {
    const result = await postAutoMergeSchedulePayload({ issueId: 'PAN-3917' }, {
      ...baseDeps,
      mergeGate: async () => gate({ changesRequested: true, approved: false }, { ready: false, reason: 'latest review requested changes' }),
      schedule: vi.fn() as never,
    });
    expect(result.status).toBe(422);
    expect(result.body).toEqual({ error: 'PAN-3917 is not ready to merge: latest review requested changes' });
  });

  it('refuses a Deft issue that requires a human merge with 412 (PAN-4820)', async () => {
    const schedule = vi.fn();
    const result = await postAutoMergeSchedulePayload({ issueId: 'PAN-3917' }, {
      ...baseDeps,
      deftHold: async (issueId: string) => `${issueId} runs on Deft and requires a human merge`,
      mergeGate: async () => gate(),
      schedule: schedule as never,
    });
    expect(result).toEqual({ status: 412, body: { error: 'PAN-3917 runs on Deft and requires a human merge' } });
    expect(schedule).not.toHaveBeenCalled();
  });

  it('refuses while UAT is still required', async () => {
    const result = await postAutoMergeSchedulePayload({ issueId: 'PAN-3917' }, {
      ...baseDeps,
      isRequireUatBeforeMerge: () => true,
      mergeGate: async () => gate(),
      schedule: vi.fn() as never,
    });
    expect(result.status).toBe(412);
  });

  it('schedules an issue labeled auto-merge even while its project holds for UAT (PAN-3932)', async () => {
    const schedule = vi.fn(() => ({ created: true, entry: { id: 1, issueId: 'PAN-3917', status: 'pending' } }));
    const result = await postAutoMergeSchedulePayload({ issueId: 'PAN-3917' }, {
      ...baseDeps,
      isRequireUatBeforeMerge: () => true,
      getProjectAutoMergeDefault: () => 'hold',
      getIssueLabels: () => ['auto-merge'],
      mergeGate: async () => gate(),
      schedule: schedule as never,
    });
    expect(result.status).toBe(200);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('refuses an issue labeled hold-for-uat even when nothing else holds it (PAN-3932)', async () => {
    const result = await postAutoMergeSchedulePayload({ issueId: 'PAN-3917' }, {
      ...baseDeps,
      isRequireUatBeforeMerge: () => false,
      getProjectAutoMergeDefault: () => 'auto',
      getIssueLabels: () => ['hold-for-uat'],
      mergeGate: async () => gate(),
      schedule: vi.fn() as never,
    });
    expect(result.status).toBe(412);
    expect(result.body).toEqual({ error: 'UAT is still required before merge' });
  });

  it('refuses an issue the tracker has closed (#3983)', async () => {
    const schedule = vi.fn();
    const result = await postAutoMergeSchedulePayload({ issueId: 'PAN-3917' }, {
      ...baseDeps,
      isIssueClosed: () => true,
      mergeGate: async () => gate(),
      schedule: schedule as never,
    });
    expect(result).toEqual({ status: 422, body: { error: 'PAN-3917 is closed in the tracker' } });
    expect(schedule).not.toHaveBeenCalled();
  });

  it('schedules while the merge train is off: off means per-PR merges (PAN-4753 D4)', async () => {
    const schedule = vi.fn(() => ({ created: true, entry: { id: 1 } }));
    const result = await postAutoMergeSchedulePayload({ issueId: 'PAN-3917' }, {
      ...baseDeps,
      isTrainOn: () => false,
      mergeGate: async () => gate(),
      schedule: schedule as never,
    });
    expect(result.status).toBe(200);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('refuses a normal-priority PR while the merge train is on: it waits for the batch (PAN-4753 D4)', async () => {
    const schedule = vi.fn();
    const result = await postAutoMergeSchedulePayload({ issueId: 'PAN-3917' }, {
      ...baseDeps,
      isTrainOn: () => true,
      mergeGate: async () => gate(),
      schedule: schedule as never,
    });
    expect(result).toEqual({ status: 412, body: { error: 'the merge train batches this PR; it merges with the next batch' } });
    expect(schedule).not.toHaveBeenCalled();
  });

  it('schedules a critical PR at once while the merge train is on (PAN-4753 D4)', async () => {
    const schedule = vi.fn(() => ({ created: true, entry: { id: 1 } }));
    const result = await postAutoMergeSchedulePayload({ issueId: 'PAN-3917' }, {
      ...baseDeps,
      isTrainOn: () => true,
      getIssueLabels: () => ['critical'],
      mergeGate: async () => gate(),
      schedule: schedule as never,
    });
    expect(result.status).toBe(200);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('surfaces the eligibility reason', async () => {
    const result = await postAutoMergeSchedulePayload({ issueId: 'PAN-3917' }, {
      ...baseDeps,
      isEligible: async () => ({ eligible: false, reason: 'do-not-merge label' }) as const,
      mergeGate: async () => gate(),
      schedule: vi.fn() as never,
    });
    expect(result.status).toBe(422);
    expect(result.body).toEqual({ error: 'do-not-merge label' });
  });

  it('rejects a PR URL that is not a recognized forge artifact', async () => {
    const result = await postAutoMergeSchedulePayload({ issueId: 'PAN-3917' }, {
      ...baseDeps,
      mergeGate: async () => gate({ url: 'https://example.com/nope' }),
      schedule: vi.fn() as never,
    });
    expect(result.status).toBe(422);
  });

  it('requires a non-empty issueId', async () => {
    const result = await postAutoMergeSchedulePayload({ issueId: '  ' }, baseDeps);
    expect(result.status).toBe(400);
  });
});

describe('DELETE /api/merge-train/auto-merge/:id', () => {
  const entry = { id: 7, issueId: 'PAN-3917', status: 'pending' as const };

  it('cancels a pending auto-merge and reports the remaining count', () => {
    const removeQueued = vi.fn(() => 1);
    const result = deleteAutoMergePayload('pan-3917', {
      now: () => new Date('2026-09-18T12:00:00Z'),
      getPending: () => entry as never,
      cancel: () => true,
      countRemaining: () => 0,
      announce: vi.fn(),
      removeQueued,
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'cancelled', cancelledBy: 'operator', remainingActionable: 0 });
    // #4066 review: the cancel also drops the issue's waiting queue entry.
    expect(removeQueued).toHaveBeenCalledWith('PAN-3917');
  });

  it('returns 409 once the entry is merging', () => {
    const removeQueued = vi.fn(() => 0);
    const result = deleteAutoMergePayload('PAN-3917', {
      getPending: () => ({ ...entry, status: 'merging' }) as never,
      cancel: () => false,
      announce: vi.fn(),
      removeQueued,
    });
    expect(result.status).toBe(409);
    expect(removeQueued).not.toHaveBeenCalled();
  });

  it('returns 404 when nothing is pending', () => {
    const result = deleteAutoMergePayload('PAN-3917', { getPending: () => null, announce: vi.fn() });
    expect(result.status).toBe(404);
  });
});

describe('GET/POST /api/merge-train/config', () => {
  it('returns the merge-train settings, including the batch window (PAN-4753)', () => {
    expect(getMergeTrainConfigPayload()).toEqual({
      auto_pickup_backlog: false,
      require_uat_before_merge: false,
      merge_train_enabled: true,
      batch_size: 3,
      batch_wait_minutes: 30,
    });
  });

  it('persists the merge train switch: POST off, then GET reads off (PAN-4753 WI-11)', async () => {
    const off = await postMergeTrainConfigPayload({ merge_train_enabled: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ merge_train_enabled: false });
    expect(getMergeTrainConfigPayload().merge_train_enabled).toBe(false);
    const on = await postMergeTrainConfigPayload({ merge_train_enabled: true });
    expect(on.body).toMatchObject({ merge_train_enabled: true });
    expect(getMergeTrainConfigPayload().merge_train_enabled).toBe(true);
  });

  it('persists the batch window keys and rejects values outside their bounds (PAN-4753)', async () => {
    const saved = await postMergeTrainConfigPayload({ batch_size: 5, batch_wait_minutes: 45 });
    expect(saved.status).toBe(200);
    expect(getMergeTrainConfigPayload()).toMatchObject({ batch_size: 5, batch_wait_minutes: 45 });
    for (const body of [{ batch_size: 0 }, { batch_size: 21 }, { batch_size: 2.5 }, { batch_size: '3' }, { batch_wait_minutes: 0 }, { batch_wait_minutes: 1441 }]) {
      const result = await postMergeTrainConfigPayload(body);
      expect(result.status).toBe(400);
    }
    expect(getMergeTrainConfigPayload()).toMatchObject({ batch_size: 5, batch_wait_minutes: 45 });
    await postMergeTrainConfigPayload({ batch_size: 3, batch_wait_minutes: 30 });
  });

  it('applies only the keys the body carries', async () => {
    const result = await postMergeTrainConfigPayload({ require_uat_before_merge: true });
    expect(result.status).toBe(200);
    expect(controlSettings.setFlywheelRequireUatBeforeMerge).toHaveBeenCalledWith(true);
    expect(controlSettings.setFlywheelAutoPickupBacklog).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean value', async () => {
    const result = await postMergeTrainConfigPayload({ merge_train_enabled: 'yes' });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'merge_train_enabled must be a boolean' });
  });

  it('rejects a body that is not a JSON object', async () => {
    expect((await postMergeTrainConfigPayload([])).status).toBe(400);
  });
});

describe('GET /api/merge-train/auto-merge/pending payload (PAN-4772)', () => {
  it('serves the cooldown queue and the scheduler\'s latest skip reasons', () => {
    skipReasons.resetSchedulerOutcomes();
    skipReasons.recordSchedulerOutcomes(
      [{ projectKey: 'overdeck', issueId: 'PAN-4759', scheduled: false, reason: 'PR is not approved at PR HEAD 697a05f8', head: '697a05f8' }],
      { now: () => Date.parse('2026-11-02T02:45:00.000Z'), log: () => {} },
    );
    try {
      expect(getPendingAutoMergePayload()).toEqual({
        pending: [],
        notScheduled: [{
          issueId: 'PAN-4759', projectKey: 'overdeck', head: '697a05f8',
          reason: 'PR is not approved at PR HEAD 697a05f8', at: '2026-11-02T02:45:00.000Z',
        }],
      });
    } finally {
      skipReasons.resetSchedulerOutcomes();
    }
  });
});
