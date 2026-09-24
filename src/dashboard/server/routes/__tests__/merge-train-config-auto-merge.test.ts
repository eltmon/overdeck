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
vi.mock('../../../../lib/overdeck/control-settings.js', () => ({
  isFlywheelAutoPickupBacklog: vi.fn(() => false),
  isFlywheelRequireUatBeforeMerge: vi.fn(() => false),
  isMergeTrainEnabled: vi.fn(() => true),
  setFlywheelAutoPickupBacklog: vi.fn(),
  setFlywheelRequireUatBeforeMerge: vi.fn(),
  setMergeTrainEnabled: vi.fn(),
}));

const {
  deleteAutoMergePayload,
  getMergeTrainConfigPayload,
  postAutoMergeSchedulePayload,
  postMergeTrainConfigPayload,
} = await import('../merge-train.js');
const controlSettings = await import('../../../../lib/overdeck/control-settings.js');

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
  isMergeTrainEnabled: () => true,
  isEligible: async () => ({ eligible: true }) as const,
  getProjectAutoMergeDefault: () => null,
  getIssueLabels: () => [],
  resolveProject: () => ({ projectKey: 'overdeck', projectName: 'Overdeck', projectPath: '/repos/overdeck' }),
  announce: vi.fn(),
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

  it('refuses while the merge train is disabled', async () => {
    const result = await postAutoMergeSchedulePayload({ issueId: 'PAN-3917' }, {
      ...baseDeps,
      isMergeTrainEnabled: () => false,
      mergeGate: async () => gate(),
      schedule: vi.fn() as never,
    });
    expect(result.status).toBe(412);
    expect(result.body).toEqual({ error: 'Merge train is disabled' });
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
    const result = deleteAutoMergePayload('pan-3917', {
      now: () => new Date('2026-09-18T12:00:00Z'),
      getPending: () => entry as never,
      cancel: () => true,
      countRemaining: () => 0,
      announce: vi.fn(),
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'cancelled', cancelledBy: 'operator', remainingActionable: 0 });
  });

  it('returns 409 once the entry is merging', () => {
    const result = deleteAutoMergePayload('PAN-3917', {
      getPending: () => ({ ...entry, status: 'merging' }) as never,
      cancel: () => false,
      announce: vi.fn(),
    });
    expect(result.status).toBe(409);
  });

  it('returns 404 when nothing is pending', () => {
    const result = deleteAutoMergePayload('PAN-3917', { getPending: () => null, announce: vi.fn() });
    expect(result.status).toBe(404);
  });
});

describe('GET/POST /api/merge-train/config', () => {
  it('returns the three merge-train settings', () => {
    expect(getMergeTrainConfigPayload()).toEqual({
      auto_pickup_backlog: false,
      require_uat_before_merge: false,
      merge_train_enabled: true,
    });
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
