/**
 * #3983: the merge train's scheduling crank. After the PAN-3917 cut nothing
 * called the schedule door, so no pending auto-merge was ever written. These
 * tests drive the pass through the real merge gate, the real schedule door, and
 * the real auto-merge opt-in (the `auto-merge` / `hold-for-uat` label tiers),
 * with only the forge, tracker, and database reads stubbed.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DerivedIssueState } from '@overdeck/contracts';
import type { ProjectConfig } from '../../../../lib/projects.js';
import type { PendingAutoMerge } from '../../../../lib/overdeck/merge-sync.js';
import type { PrFacts } from '../../../../lib/cloister/pr-facts.js';

vi.mock('../../../../lib/activity-logger.js', () => ({ emitActivityTts: vi.fn() }));
vi.mock('../../../../lib/cloister/merge-eligibility.js', () => ({
  gatherMergeEligibility: vi.fn(async () => []),
  isMergeEligible: vi.fn(() => false),
}));
vi.mock('../../../../lib/cloister/merge-blockers.js', () => ({ getMergeBlockersPayload: vi.fn(() => []) }));

const { scheduleReadyAutoMerges, runAutoMergeSchedulerTick } = await import('../auto-merge-scheduler.js');
const { postAutoMergeSchedulePayload } = await import('../../routes/merge-train.js');
const { evaluateIssueMergeGate } = await import('../../../../lib/cloister/merge-gate.js');
const { isAutoMergeEligible } = await import('../../../../lib/cloister/auto-merge-eligibility.js');

const PR_URL = 'https://github.com/eltmon/overdeck/pull/42';

function facts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    issueId: 'PAN-42',
    forge: 'github',
    url: PR_URL,
    number: 42,
    exists: true,
    open: true,
    merged: false,
    closed: false,
    draft: false,
    headSha: 'abc123',
    headBranch: 'feature/pan-42',
    reviewDecision: 'APPROVED',
    approved: true,
    changesRequested: false,
    mergeable: true,
    mergeableState: 'clean',
    checks: 'green',
    testChecks: 'green',
    testJobSucceeded: true,
    uatVerdict: null,
    ...overrides,
  } as PrFacts;
}

function derivedReady(issueId: string): DerivedIssueState {
  return {
    issueId,
    state: 'ready',
    pr: { url: PR_URL, number: 42, reviewState: 'approved', checks: 'green', mergeable: true },
  } as DerivedIssueState;
}

interface WorldOptions {
  labels?: string[];
  prFacts?: PrFacts;
  globalRequireUat?: boolean;
  projectDefault?: 'auto' | 'hold';
  trainEnabled?: boolean;
  latest?: PendingAutoMerge | null;
}

/**
 * One project with one ready PR (PAN-42). The pass runs through the real merge
 * gate, schedule door and opt-in; `insert` is the database write.
 */
function world(options: WorldOptions = {}) {
  const prFacts = options.prFacts ?? facts();
  const getFacts = async () => prFacts;
  const insert = vi.fn(() => ({ created: true, entry: { id: 1, issueId: 'PAN-42', status: 'pending' } as PendingAutoMerge }));
  const listReady = vi.fn(async () => [{ issueId: 'pan-42' }]);
  const globalRequireUat = options.globalRequireUat ?? false;
  const projectDefault = () => options.projectDefault;

  const deps = {
    listProjects: () => [{ key: 'overdeck', config: { name: 'Overdeck', path: '/repos/overdeck' } as ProjectConfig }],
    isTrainEnabledForProject: () => options.trainEnabled ?? true,
    listReady,
    latestAutoMerge: () => options.latest ?? null,
    mergeGate: (issueId: string) => evaluateIssueMergeGate(issueId, { getFacts, ciTestsRequired: () => false }),
    schedule: (issueId: string) => postAutoMergeSchedulePayload({ issueId }, {
      now: () => new Date('2026-09-24T12:00:00Z'),
      isRequireUatBeforeMerge: () => globalRequireUat,
      isMergeTrainEnabled: () => options.trainEnabled ?? true,
      getProjectAutoMergeDefault: projectDefault,
      isEligible: (id) => isAutoMergeEligible(id, {
        getFacts,
        getIssueLabels: async () => options.labels ?? [],
        getProjectDefault: projectDefault,
        isGlobalUatRequired: () => globalRequireUat,
        ciTestsRequired: () => false,
      }),
      derivedState: async (id) => derivedReady(id),
      resolveProject: () => ({ projectKey: 'overdeck', projectName: 'Overdeck', projectPath: '/repos/overdeck' }),
      schedule: insert,
      announce: vi.fn(),
    }),
    log: vi.fn(),
  };
  return { deps, insert, listReady };
}

function row(status: PendingAutoMerge['status']): PendingAutoMerge {
  return {
    id: 7,
    issueId: 'PAN-42',
    prUrl: PR_URL,
    projectKey: 'overdeck',
    forge: 'github',
    status,
    scheduledMergeAt: '2026-09-24T11:00:00.000Z',
    scheduledAt: '2026-09-24T10:55:00.000Z',
  } as PendingAutoMerge;
}

describe('scheduleReadyAutoMerges (#3983)', () => {
  it('schedules an opted-in PR that passes the merge gate', async () => {
    const { deps, insert } = world({ labels: ['auto-merge'] });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(outcomes).toEqual([{ projectKey: 'overdeck', issueId: 'PAN-42', scheduled: true }]);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-42',
      prUrl: PR_URL,
      prNumber: 42,
      projectKey: 'overdeck',
      scheduledMergeAt: '2026-09-24T12:05:00.000Z',
    }));
  });

  it('schedules a PR opted in by the project default and the global setting', async () => {
    const { deps, insert } = world({ projectDefault: 'auto', globalRequireUat: true });
    await scheduleReadyAutoMerges(deps);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a PR labelled hold-for-uat', async () => {
    const { deps, insert } = world({ labels: ['hold-for-uat'] });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ scheduled: false, reason: 'held for UAT (auto-merge toggled off)' });
  });

  it('does not schedule a PR in a project that holds for UAT', async () => {
    const { deps, insert } = world({ projectDefault: 'hold' });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ scheduled: false, reason: 'UAT is still required before merge' });
  });

  it('does not schedule when UAT is required globally and nothing opts the issue in', async () => {
    const { deps, insert } = world({ globalRequireUat: true });
    await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not schedule a PR carrying a blocker label', async () => {
    const { deps, insert } = world({ labels: ['auto-merge', 'do-not-merge'] });
    await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not schedule when the merge gate says the PR is not ready', async () => {
    const { deps, insert } = world({ labels: ['auto-merge'], prFacts: facts({ checks: 'red' }) });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ scheduled: false, reason: 'CI checks failing on PR HEAD abc123' });
  });

  it('does not schedule when the merge gate holds for a failed UAT the issue requires', async () => {
    const { deps, insert } = world({ prFacts: facts({ uatVerdict: { status: 'failed', sha: 'abc123', postedAt: null } }) });
    deps.mergeGate = (issueId: string) => evaluateIssueMergeGate(issueId, {
      getFacts: async () => facts({ uatVerdict: { status: 'failed', sha: 'abc123', postedAt: null } }),
      ciTestsRequired: () => false,
      uatRequired: async () => true,
    });
    await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
  });

  it('does nothing for a project whose merge train is off', async () => {
    const { deps, insert, listReady } = world({ labels: ['auto-merge'], trainEnabled: false });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(outcomes).toEqual([]);
    expect(listReady).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it.each(['pending', 'merging', 'blocked', 'failed', 'cancelled'] as const)(
    'leaves an issue alone whose latest auto-merge is %s',
    async (status) => {
      const { deps, insert } = world({ labels: ['auto-merge'], latest: row(status) });
      const outcomes = await scheduleReadyAutoMerges(deps);
      expect(insert).not.toHaveBeenCalled();
      expect(outcomes[0]).toMatchObject({ scheduled: false, reason: `auto-merge already ${status}` });
    },
  );

  it('schedules again after an earlier auto-merge of the issue merged', async () => {
    const { deps, insert } = world({ labels: ['auto-merge'], latest: row('merged') });
    await scheduleReadyAutoMerges(deps);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one project fails to list its ready set', async () => {
    const { deps, insert } = world({ labels: ['auto-merge'] });
    deps.listProjects = () => [
      { key: 'broken', config: { name: 'Broken', path: '/repos/broken' } as ProjectConfig },
      { key: 'overdeck', config: { name: 'Overdeck', path: '/repos/overdeck' } as ProjectConfig },
    ];
    deps.listReady = vi.fn(async (projectPath: string) => {
      if (projectPath === '/repos/broken') throw new Error('gh failed');
      return [{ issueId: 'PAN-42' }];
    });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(outcomes).toEqual([{ projectKey: 'overdeck', issueId: 'PAN-42', scheduled: true }]);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe('runAutoMergeSchedulerTick (#3983)', () => {
  it('joins a pass already in flight instead of starting a second one', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const listProjects = vi.fn(() => [{ key: 'overdeck', config: { name: 'Overdeck', path: '/repos/overdeck' } as ProjectConfig }]);
    const deps = {
      listProjects,
      isTrainEnabledForProject: () => true,
      latestAutoMerge: () => null,
      listReady: async () => { await gate; return []; },
      log: vi.fn(),
    };
    const first = runAutoMergeSchedulerTick(deps);
    const second = runAutoMergeSchedulerTick(deps);
    expect(second).toBe(first);
    release();
    await first;
    expect(listProjects).toHaveBeenCalledTimes(1);
    // The finished pass is released: the next tick starts a fresh one.
    await runAutoMergeSchedulerTick(deps);
    expect(listProjects).toHaveBeenCalledTimes(2);
  });
});
