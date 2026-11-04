/**
 * #3983: the merge train's scheduling crank. After the PAN-3917 cut nothing
 * called the schedule door, so no pending auto-merge was ever written. These
 * tests drive the pass through the real door policy check, the real merge
 * gate, the real schedule door and the real auto-merge opt-in (the
 * `auto-merge` / `hold-for-uat` label tiers), with only the forge, tracker and
 * database reads stubbed. The global UAT hold is on by default, as in
 * production.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '../../../../lib/projects.js';
import type {
  PendingAutoMerge,
  ScheduleAutoMergeInput,
  ScheduleAutoMergeResult,
} from '../../../../lib/overdeck/merge-sync.js';
import type { GitHubReviewsAtHead, PrFacts } from '../../../../lib/cloister/pr-facts.js';
import type { IssuePullRequestData } from '../../../../lib/overdeck/pull-requests.js';
import type { GhPrRow } from '../../../../lib/overdeck/derived-issue-state.js';
import type { ScheduleCandidates } from '../auto-merge-scheduler.js';

vi.mock('../../../../lib/activity-logger.js', () => ({ emitActivityTts: vi.fn() }));
vi.mock('../../../../lib/cloister/merge-eligibility.js', () => ({
  gatherMergeEligibility: vi.fn(async () => []),
  isMergeEligible: vi.fn(() => false),
}));
vi.mock('../../../../lib/cloister/merge-blockers.js', () => ({ getMergeBlockersPayload: vi.fn(() => []) }));
// PAN-4852: the SageOx merge guard reads git and projects.yaml; these tests judge forge facts only.
vi.mock('../../../../lib/sageox/merge-guard.js', () => ({ sageoxMergeGuardForIssue: vi.fn(async () => ({ ok: true })) }));

const {
  issueIdFromGateBranch,
  latestAutoMergeAllowsSchedule,
  listScheduleCandidates,
  runAutoMergeSchedulerTick,
  scheduleReadyAutoMerges,
} = await import('../auto-merge-scheduler.js');
const { autoMergePolicyRefusal, postAutoMergeSchedulePayload } = await import('../../routes/merge-train.js');
const { rereviewStaleApproval } = await import('../stale-approval-rereview.js');
const { listNotScheduledAutoMerges, resetSchedulerOutcomes } = await import('../auto-merge-skip-reasons.js');
const { evaluateIssueMergeGate } = await import('../../../../lib/cloister/merge-gate.js');
const { getPrFacts } = await import('../../../../lib/cloister/pr-facts.js');
const { isAutoMergeEligible } = await import('../../../../lib/cloister/auto-merge-eligibility.js');

type ListedPr = GhPrRow;

/** A listing that names only these candidates and rules nothing out. */
function only(...candidates: string[]): ScheduleCandidates {
  return { candidates, dropped: [] };
}

const PR_URL = 'https://github.com/eltmon/overdeck/pull/42';
const OVERDECK: { key: string; config: ProjectConfig } = {
  key: 'overdeck',
  config: { name: 'Overdeck', path: '/repos/overdeck' },
};

const READY_FACTS: PrFacts = {
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
  approvedAtHead: true,
  changesRequested: false,
  mergeable: true,
  mergeableState: 'mergeable',
  checks: 'green',
  testChecks: 'green',
  testJobSucceeded: true,
  uatVerdict: null,
};

function facts(overrides: Partial<PrFacts> = {}): PrFacts {
  return { ...READY_FACTS, ...overrides };
}

interface WorldOptions {
  labels?: string[];
  getFacts?: (issueId: string) => Promise<PrFacts>;
  globalRequireUat?: boolean;
  projectDefault?: 'auto' | 'hold';
  trainEnabled?: boolean;
  latest?: PendingAutoMerge | null;
  /** The latest row as the insert transaction sees it; `latest` by default. */
  latestAtInsert?: PendingAutoMerge | null;
  /** The cached tracker row says the issue is closed. */
  closed?: boolean;
  /** GitHub's reviews of the PR (`forgeApprovalAtHead`); none by default. */
  readReviews?: (repo: string, number: number) => Promise<GitHubReviewsAtHead>;
}

/**
 * One GitHub project with one candidate (PAN-42). The pass runs through the
 * real policy check, merge gate, schedule door and opt-in; `insert` is the
 * database write.
 */
function world(options: WorldOptions = {}) {
  const getFacts = options.getFacts ?? (async () => facts());
  const factsReads = vi.fn(getFacts);
  const latestAtInsert = options.latestAtInsert !== undefined ? options.latestAtInsert : (options.latest ?? null);
  // The database write, including the in-transaction re-check of the latest row.
  const insert = vi.fn((input: ScheduleAutoMergeInput): ScheduleAutoMergeResult => {
    if (latestAtInsert && input.canSchedule && !input.canSchedule(latestAtInsert)) {
      return { created: false, entry: latestAtInsert };
    }
    return { created: true, entry: row('pending', input.headSha ? { headSha: input.headSha } : {}) };
  });
  const listCandidates = vi.fn(async (_projectPath: string): Promise<ScheduleCandidates | null> => only('pan-42'));
  const globalRequireUat = options.globalRequireUat ?? true;
  const trainEnabled = options.trainEnabled ?? true;
  const labels = options.labels ?? [];
  const projectDefault = () => options.projectDefault;
  const policy = {
    getIssueLabels: () => labels,
    getProjectAutoMergeDefault: projectDefault,
    isRequireUatBeforeMerge: () => globalRequireUat,
    isMergeTrainEnabled: () => trainEnabled,
    isIssueClosed: () => options.closed ?? false,
  };
  // As in production: every merge door needs an approval bound to the head.
  // GitHub's reviews are read only when no marker proves it; none approve here
  // unless a test says so.
  const readReviews = vi.fn(options.readReviews ?? (async () => ({ headRefOid: null, reviews: [] })));
  const mergeGate = (issueId: string) => evaluateIssueMergeGate(
    issueId,
    { getFacts: factsReads, ciTestsRequired: () => false, readReviews },
  );

  const deps = {
    listProjects: () => [OVERDECK],
    isTrainEnabledForProject: () => trainEnabled,
    forgeOf: (): 'github' | 'gitlab' => 'github',
    listCandidates,
    policyRefusal: (issueId: string) => autoMergePolicyRefusal(issueId, policy),
    latestAutoMerge: () => options.latest ?? null,
    mergeGate,
    schedule: (issueId: string, canSchedule: (latest: PendingAutoMerge) => boolean) => postAutoMergeSchedulePayload({ issueId }, {
      ...policy,
      now: () => new Date('2026-09-24T12:00:00Z'),
      mergeGate,
      isEligible: (id) => isAutoMergeEligible(id, {
        getFacts: factsReads,
        getIssueLabels: async () => labels,
        getProjectDefault: projectDefault,
        isGlobalUatRequired: () => globalRequireUat,
        ciTestsRequired: () => false,
        readReviews,
      }),
      resolveProject: () => ({ projectKey: 'overdeck', projectName: 'Overdeck', projectPath: '/repos/overdeck' }),
      schedule: (input) => insert({ ...input, canSchedule }),
      announce: vi.fn(),
    }),
    // PAN-4772: no stale-approval re-review unless a test wires one.
    rereview: vi.fn(async (): Promise<string | null> => null),
    log: vi.fn(),
    env: {},
  };
  return { deps, insert, listCandidates, factsReads };
}

function row(status: PendingAutoMerge['status'], overrides: Partial<PendingAutoMerge> = {}): PendingAutoMerge {
  return {
    id: 7,
    issueId: 'PAN-42',
    prUrl: PR_URL,
    projectKey: 'overdeck',
    forge: 'github',
    status,
    scheduledMergeAt: '2026-09-24T11:00:00.000Z',
    scheduledAt: '2026-09-24T10:55:00.000Z',
    ...overrides,
  };
}

const MARKER_HEAD = 'a7b64f7c0000000000000000000000000000abcd';

/** A `gh pr view` payload: approved only by a trusted verdict marker comment. */
function markerApprovedPr(marker = `<!-- overdeck-verdict: APPROVED sha=${MARKER_HEAD} -->`): IssuePullRequestData {
  return {
    number: 42,
    title: 'feat: forty-two',
    url: PR_URL,
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'feature/pan-42',
    headRefOid: MARKER_HEAD,
    author: { login: 'eltmon' },
    createdAt: '2026-09-24T09:00:00Z',
    updatedAt: '2026-09-24T11:00:00Z',
    // No branch protection: the forge reaches no review decision.
    reviewDecision: '',
    reviewRequests: [],
    statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    files: [],
    labels: [],
    mergeable: 'MERGEABLE',
    body: 'Closes #42',
    comments: [{
      body: `${marker}\nLooks good.`,
      createdAt: '2026-09-24T11:00:00Z',
      author: { login: 'eltmon' },
      authorAssociation: 'OWNER',
    }],
    commits: [{ oid: MARKER_HEAD, committedDate: '2026-09-24T10:00:00Z' }],
  };
}

function listed(overrides: Partial<ListedPr> = {}): ListedPr {
  return {
    number: 42,
    url: PR_URL,
    title: 'feat: forty-two',
    state: 'OPEN',
    mergedAt: null,
    mergeable: 'MERGEABLE',
    headRefName: 'feature/pan-42',
    headRefOid: 'abc123',
    isDraft: false,
    reviewDecision: '',
    reviewRequests: [],
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ...overrides,
  };
}

describe('scheduleReadyAutoMerges (#3983)', () => {
  it('schedules a PR opted in by its auto-merge label that passes the merge gate', async () => {
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
      headSha: 'abc123',
    }));
  });

  it('creates no auto-merge row for a Deft issue that requires a human merge (PAN-4820)', async () => {
    const { deps, insert, factsReads } = world({ labels: ['auto-merge'] });
    const outcomes = await scheduleReadyAutoMerges({
      ...deps,
      deftHold: async (issueId) => `${issueId} runs on Deft and requires a human merge`,
    });
    expect(outcomes).toEqual([
      { projectKey: 'overdeck', issueId: 'PAN-42', scheduled: false, reason: 'PAN-42 runs on Deft and requires a human merge' },
    ]);
    expect(insert).not.toHaveBeenCalled();
    expect(factsReads).not.toHaveBeenCalled();
  });

  it('schedules a PR opted in by the project default', async () => {
    const { deps, insert } = world({ projectDefault: 'auto' });
    await scheduleReadyAutoMerges(deps);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('schedules a PR approved only by a trusted verdict marker that names its head', async () => {
    const { deps, insert } = world({
      labels: ['auto-merge'],
      getFacts: (issueId) => getPrFacts(issueId, {
        fetchGitHubPr: async () => ({ issueId, pr: markerApprovedPr() }),
      }),
    });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(outcomes).toEqual([{ projectKey: 'overdeck', issueId: 'PAN-42', scheduled: true }]);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('schedules a PR approved by a GitHub review of its exact head, with no marker', async () => {
    const { deps, insert } = world({
      labels: ['auto-merge'],
      getFacts: (issueId) => getPrFacts(issueId, {
        fetchGitHubPr: async () => ({ issueId, pr: { ...markerApprovedPr(), comments: [] } }),
      }),
      readReviews: async () => ({ headRefOid: MARKER_HEAD, reviews: [{ state: 'APPROVED', author: { login: 'eltmon' }, authorAssociation: 'OWNER', commit: { oid: MARKER_HEAD } }] }),
    });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(outcomes).toEqual([{ projectKey: 'overdeck', issueId: 'PAN-42', scheduled: true }]);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ headSha: MARKER_HEAD }));
  });

  it('schedules on the first tick after the PR turns ready, with no operator action', async () => {
    // Tick 1: green and mergeable, but no approval yet. Tick 2: the reviewer
    // has posted a marker naming the head, so the PR is ready.
    let pr: IssuePullRequestData = { ...markerApprovedPr(), comments: [] };
    const { deps, insert } = world({
      labels: ['auto-merge'],
      getFacts: (issueId) => getPrFacts(issueId, { fetchGitHubPr: async () => ({ issueId, pr }) }),
    });
    const before = await scheduleReadyAutoMerges(deps);
    expect(before[0]).toMatchObject({ scheduled: false });
    expect(insert).not.toHaveBeenCalled();

    pr = markerApprovedPr();
    const after = await scheduleReadyAutoMerges(deps);
    expect(after).toEqual([{ projectKey: 'overdeck', issueId: 'PAN-42', scheduled: true }]);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a PR whose marker approval names no head (#3983)', async () => {
    const { deps, insert } = world({
      labels: ['auto-merge'],
      getFacts: (issueId) => getPrFacts(issueId, {
        fetchGitHubPr: async () => ({ issueId, pr: markerApprovedPr('<!-- overdeck-verdict: APPROVED -->') }),
      }),
    });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ scheduled: false, reason: expect.stringContaining(`PR is not approved at PR HEAD ${MARKER_HEAD}`) });
  });

  it('does not schedule a PR whose marker approves an older head (#3983)', async () => {
    const { deps, insert } = world({
      labels: ['auto-merge'],
      getFacts: (issueId) => getPrFacts(issueId, {
        fetchGitHubPr: async () => ({
          issueId,
          pr: markerApprovedPr('<!-- overdeck-verdict: APPROVED sha=b1b2b3b40000000000000000000000000000ffff -->'),
        }),
      }),
    });
    await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not schedule a PR whose tracker issue is closed, and reads no forge for it', async () => {
    const { deps, insert, factsReads } = world({ labels: ['auto-merge'], closed: true });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
    expect(factsReads).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ scheduled: false, reason: 'PAN-42 is closed in the tracker' });
  });

  it('does not schedule a PR nothing opts in, and reads no forge for it', async () => {
    const { deps, insert, factsReads } = world();
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
    expect(factsReads).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ scheduled: false, reason: 'UAT is still required before merge' });
  });

  it('does not schedule a PR labelled hold-for-uat in an auto project', async () => {
    const { deps, insert, factsReads } = world({ labels: ['hold-for-uat'], projectDefault: 'auto' });
    await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
    expect(factsReads).not.toHaveBeenCalled();
  });

  it('does not schedule a PR in a project that holds for UAT', async () => {
    const { deps, insert } = world({ projectDefault: 'hold', globalRequireUat: false });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ scheduled: false, reason: 'UAT is still required before merge' });
  });

  it('does not schedule a PR carrying a blocker label', async () => {
    const { deps, insert } = world({ labels: ['auto-merge', 'do-not-merge'] });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ scheduled: false, reason: 'issue carries blocker label: do-not-merge' });
  });

  it('does not schedule when the merge gate says the PR is not ready', async () => {
    const { deps, insert } = world({ labels: ['auto-merge'], getFacts: async () => facts({ checks: 'red' }) });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ scheduled: false, reason: 'CI checks failing on PR HEAD abc123' });
  });

  it('does not schedule when the merge gate holds for a failed UAT the issue requires', async () => {
    const failedUat = facts({ uatVerdict: { status: 'failed', sha: 'abc123', postedAt: null } });
    const { deps, insert } = world({ labels: ['auto-merge'], getFacts: async () => failedUat });
    deps.mergeGate = (issueId: string) => evaluateIssueMergeGate(issueId, {
      getFacts: async () => failedUat,
      ciTestsRequired: () => false,
      uatRequired: async () => true,
    });
    await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
  });

  it('schedules nothing while OVERDECK_DISABLE_AUTO_MERGE=1 is set', async () => {
    const { deps, insert, listCandidates } = world({ labels: ['auto-merge'] });
    const outcomes = await scheduleReadyAutoMerges({ ...deps, env: { OVERDECK_DISABLE_AUTO_MERGE: '1' } });
    expect(outcomes).toEqual([]);
    expect(listCandidates).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('does nothing for a project whose merge train is off', async () => {
    const { deps, insert, listCandidates } = world({ labels: ['auto-merge'], trainEnabled: false });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(outcomes).toEqual([]);
    expect(listCandidates).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('skips a GitLab project with one log line', async () => {
    const { deps, insert, listCandidates } = world({ labels: ['auto-merge'] });
    const gitlab = { key: 'gitlab-only', config: { name: 'GitLab only', path: '/repos/gitlab-only' } };
    deps.listProjects = () => [gitlab];
    deps.forgeOf = () => 'gitlab';
    await scheduleReadyAutoMerges(deps);
    await scheduleReadyAutoMerges(deps);
    expect(listCandidates).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('gitlab-only is a GitLab project'));
  });

  it.each(['pending', 'merging'] as const)('leaves an issue alone whose auto-merge is already %s', async (status) => {
    const { deps, insert, factsReads } = world({ labels: ['auto-merge'], latest: row(status, { headSha: 'abc123' }) });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
    expect(factsReads).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ scheduled: false, reason: `auto-merge already ${status}` });
  });

  it('keeps a failed auto-merge for the same PR head', async () => {
    const { deps, insert } = world({ labels: ['auto-merge'], latest: row('failed', { headSha: 'abc123' }) });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ scheduled: false, reason: 'auto-merge failed for this PR head' });
  });

  it.each([
    ['the same head', { headSha: 'abc123' }],
    ['an older head', { headSha: 'old999' }],
    ['another PR', { prUrl: `${PR_URL}0`, headSha: 'old999' }],
  ] as const)('keeps an operator cancel on %s until the operator re-schedules, with no forge read', async (_label, where) => {
    const { deps, insert, factsReads } = world({ labels: ['auto-merge'], latest: row('cancelled', where) });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
    expect(factsReads).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({
      scheduled: false,
      reason: 'auto-merge cancelled by the operator; re-schedule it to resume',
    });
  });

  it.each(['blocked', 'failed'] as const)('does not re-arm a %s row written before heads were recorded', async (status) => {
    const { deps, insert } = world({ labels: ['auto-merge'], latest: row(status) });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ scheduled: false, reason: `auto-merge ${status} for this PR head` });
  });

  it.each(['failed', 'blocked'] as const)('re-arms a %s auto-merge once the PR has a new head', async (status) => {
    const { deps, insert } = world({ labels: ['auto-merge'], latest: row(status, { headSha: 'old999' }) });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(outcomes).toEqual([{ projectKey: 'overdeck', issueId: 'PAN-42', scheduled: true }]);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ headSha: 'abc123' }));
  });

  it('re-arms a blocked auto-merge at the same head once the gate passes again', async () => {
    const { deps, insert } = world({ labels: ['auto-merge'], latest: row('blocked', { headSha: 'abc123' }) });
    await scheduleReadyAutoMerges(deps);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('keeps a blocked auto-merge while the gate still refuses the PR', async () => {
    const { deps, insert } = world({
      labels: ['auto-merge'],
      latest: row('blocked', { headSha: 'abc123' }),
      getFacts: async () => facts({ checks: 'pending' }),
    });
    await scheduleReadyAutoMerges(deps);
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not overwrite a cancel that lands while the pass reads the forge', async () => {
    const { deps, insert } = world({
      labels: ['auto-merge'],
      latest: row('blocked', { headSha: 'abc123' }),
      latestAtInsert: row('cancelled', { headSha: 'abc123' }),
    });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.results[0]?.value).toMatchObject({ created: false });
    expect(outcomes[0]).toMatchObject({ scheduled: false, reason: 'auto-merge became cancelled during the pass' });
  });

  it('schedules again after an earlier auto-merge of the issue merged', async () => {
    const { deps, insert } = world({ labels: ['auto-merge'], latest: row('merged') });
    await scheduleReadyAutoMerges(deps);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one project fails to list its candidates', async () => {
    const { deps, insert } = world({ labels: ['auto-merge'] });
    deps.listProjects = () => [{ key: 'broken', config: { name: 'Broken', path: '/repos/broken' } }, OVERDECK];
    deps.listCandidates = vi.fn(async (projectPath: string): Promise<ScheduleCandidates | null> => {
      if (projectPath === '/repos/broken') throw new Error('gh failed');
      return only('PAN-42');
    });
    const outcomes = await scheduleReadyAutoMerges(deps);
    expect(outcomes).toEqual([{ projectKey: 'overdeck', issueId: 'PAN-42', scheduled: true }]);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe('latestAutoMergeAllowsSchedule (#3983)', () => {
  const pr = { url: PR_URL, headSha: 'abc123' };

  it('allows a first schedule, and one after a merge', () => {
    expect(latestAutoMergeAllowsSchedule(null, pr)).toBe(true);
    expect(latestAutoMergeAllowsSchedule(row('merged', { headSha: 'abc123' }), pr)).toBe(true);
  });

  it('holds an operator cancel for the whole issue, whatever the PR or head', () => {
    expect(latestAutoMergeAllowsSchedule(row('cancelled', { headSha: 'abc123' }), pr)).toBe(false);
    expect(latestAutoMergeAllowsSchedule(row('cancelled'), pr)).toBe(false);
    expect(latestAutoMergeAllowsSchedule(row('cancelled', { headSha: 'def456' }), pr)).toBe(false);
    expect(latestAutoMergeAllowsSchedule(row('cancelled', { prUrl: `${PR_URL}0`, headSha: 'abc123' }), pr)).toBe(false);
  });

  it('re-arms blocked and failed rows only on a head it can compare', () => {
    expect(latestAutoMergeAllowsSchedule(row('blocked'), pr)).toBe(false);
    expect(latestAutoMergeAllowsSchedule(row('failed'), pr)).toBe(false);
    expect(latestAutoMergeAllowsSchedule(row('failed', { headSha: 'abc' }), pr)).toBe(false);
    expect(latestAutoMergeAllowsSchedule(row('failed', { headSha: 'def456' }), pr)).toBe(true);
    expect(latestAutoMergeAllowsSchedule(row('blocked', { headSha: 'abc123' }), pr)).toBe(true);
    expect(latestAutoMergeAllowsSchedule(row('failed', { prUrl: `${PR_URL}0` }), pr)).toBe(true);
  });

  it('re-arms a row blocked by a refusal inside triggerMerge at the same head (PAN-4540)', () => {
    const refused = row('blocked', { headSha: 'abc123', failureReason: 'PAN-1 is not ready to merge: Cannot merge: the forge has not computed mergeability yet' });
    expect(latestAutoMergeAllowsSchedule(refused, pr)).toBe(true);
  });
});

describe('listScheduleCandidates (#3983)', () => {
  it('lists open green feature PRs without reading the forge review decision', async () => {
    const rows: ListedPr[] = [
      listed(),
      // #4066 review: a strike PR is the operator's to merge (PAN-3973).
      listed({ number: 43, headRefName: 'strike/pan-43' }),
      // Automatic merges land feature/<id> only: nothing links these.
      listed({ number: 44, headRefName: 'fix/pan-3983-merge-train-schedule' }),
      listed({ number: 45, headRefName: 'feat/pan-45' }),
      listed({ number: 46, headRefName: 'feature/pan-46', isDraft: true }),
      listed({ number: 47, headRefName: 'feature/pan-47', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] }),
      listed({ number: 48, headRefName: 'feature/pan-48', statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: null }] }),
      // PAN-4589: a failing commit status (Dagger Cloud) excludes it too.
      listed({ number: 53, headRefName: 'feature/pan-53', statusCheckRollup: [{ state: 'FAILURE' }] }),
      listed({ number: 49, headRefName: 'feature/pan-49', mergeable: 'CONFLICTING' }),
      listed({ number: 50, headRefName: 'feature/pan-50', state: 'CLOSED' }),
      listed({ number: 51, headRefName: 'feature/pan-51', state: 'MERGED', mergedAt: '2026-09-24T08:00:00Z' }),
      // Mergeability not computed yet: the gate decides.
      listed({ number: 52, headRefName: 'feature/pan-52', mergeable: 'UNKNOWN' }),
    ];
    await expect(listScheduleCandidates('/repos/overdeck', { listPullRequests: async () => rows }))
      .resolves.toEqual({
        candidates: ['PAN-42', 'PAN-52'],
        // PAN-5036: open gate-linked PRs the listing rules out, with the head it judged.
        dropped: [
          { issueId: 'PAN-47', head: 'abc123', reason: 'checks red in the PR listing at abc123' },
          { issueId: 'PAN-48', head: 'abc123', reason: 'checks pending in the PR listing at abc123' },
          { issueId: 'PAN-53', head: 'abc123', reason: 'checks red in the PR listing at abc123' },
          { issueId: 'PAN-49', head: 'abc123', reason: 'PR conflicts with its base in the PR listing at abc123' },
        ],
      });
  });

  it('answers null when the listing read failed, and an empty listing when there are no PRs (PAN-5036)', async () => {
    await expect(listScheduleCandidates('/repos/overdeck', { listPullRequests: async () => null })).resolves.toBeNull();
    await expect(listScheduleCandidates('/repos/overdeck', { listPullRequests: async () => [] }))
      .resolves.toEqual({ candidates: [], dropped: [] });
  });

  it('links an issue by its feature branch only, never a strike branch', () => {
    expect(issueIdFromGateBranch('feature/pan-3983')).toBe('PAN-3983');
    expect(issueIdFromGateBranch('strike/min-1039')).toBeNull();
    expect(issueIdFromGateBranch('fix/pan-3983-merge-train-schedule')).toBeNull();
    expect(issueIdFromGateBranch(undefined)).toBeNull();
  });
});

describe('runAutoMergeSchedulerTick (#3983)', () => {
  it('lets an abandoned pass that wakes up later start no forge read and write nothing', async () => {
    vi.useFakeTimers();
    try {
      let releaseList!: (listing: ScheduleCandidates) => void;
      const { deps, insert, factsReads } = world({ labels: ['auto-merge'] });
      let calls = 0;
      deps.listCandidates = vi.fn(async (): Promise<ScheduleCandidates | null> => {
        calls += 1;
        // The first pass hangs on its listing; the next tick's pass lists nothing.
        return calls === 1 ? new Promise((resolve) => { releaseList = resolve; }) : only();
      });

      const stale = runAutoMergeSchedulerTick(deps, 1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(stale).resolves.toEqual([]);
      const next = runAutoMergeSchedulerTick(deps, 1_000);
      await next;

      // The hung listing finally answers, long after the pass was abandoned.
      releaseList(only('PAN-42'));
      await vi.advanceTimersByTimeAsync(0);
      expect(factsReads).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('abandons a hung pass with a log line so the next tick runs', async () => {
    vi.useFakeTimers();
    try {
      const log = vi.fn();
      const listProjects = vi.fn(() => [OVERDECK]);
      const deps = {
        listProjects,
        isTrainEnabledForProject: () => true,
        forgeOf: (): 'github' | 'gitlab' => 'github',
        policyRefusal: () => null,
        latestAutoMerge: () => null,
        listCandidates: () => new Promise<never>(() => {}),
        log,
        env: {},
      };
      const hung = runAutoMergeSchedulerTick(deps, 1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(hung).resolves.toEqual([]);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('abandoning it'));

      const next = runAutoMergeSchedulerTick(deps, 1_000);
      expect(next).not.toBe(hung);
      await vi.advanceTimersByTimeAsync(1_000);
      await next;
      expect(listProjects).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('joins a pass already in flight instead of starting a second one', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const listProjects = vi.fn(() => [OVERDECK]);
    const deps = {
      listProjects,
      isTrainEnabledForProject: () => true,
      forgeOf: (): 'github' | 'gitlab' => 'github',
      policyRefusal: () => null,
      latestAutoMerge: () => null,
      listCandidates: async () => { await gate; return only(); },
      log: vi.fn(),
      env: {},
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

/**
 * PAN-4772 (the PAN-4759 / #4768 incident): approved at head A, the agent
 * pushed head B, and the PR sat "approved and green" with no review request
 * and no visible reason.
 */
describe('stale approval re-review and visible skip reasons (PAN-4772)', () => {
  const HEAD_A = '1d360ce2d0000000000000000000000000000000';
  const HEAD_B = '697a05f820000000000000000000000000000000';
  type JournalEntry = import('../../../../lib/cloister/pipeline-journal.js').PipelineJournalEntry;

  function staleWorld() {
    let current = facts({ headSha: HEAD_A });
    const w = world({ labels: ['auto-merge'], getFacts: async () => current });
    const journal: JournalEntry[] = [];
    const requestReview = vi.fn(async () => ({ kind: 'started' as const, autoRequeueCount: 0 }));
    w.deps.rereview = vi.fn((issueId: string, gateFacts: Parameters<typeof rereviewStaleApproval>[1]) => rereviewStaleApproval(issueId, gateFacts, {
      workspacePathFor: () => '/repos/overdeck/workspaces/feature-pan-42',
      exists: () => true,
      readJournal: () => journal,
      appendEntry: (_path, entry) => {
        const stamped = { at: '2026-11-02T02:45:00.000Z', ...entry };
        journal.push(stamped);
        return stamped;
      },
      requestReview,
    }));
    return { ...w, requestReview, journal, setFacts: (next: Partial<PrFacts>) => { current = facts(next); } };
  }

  it('requests exactly one review for head B, then schedules once B is approved', async () => {
    const { deps, insert, requestReview, setFacts } = staleWorld();

    // Approved at A: scheduled as before.
    await expect(scheduleReadyAutoMerges(deps)).resolves.toEqual([{ projectKey: 'overdeck', issueId: 'PAN-42', scheduled: true }]);
    deps.latestAutoMerge = () => row('blocked', { headSha: HEAD_A });

    // Head B pushed after the approval: GitHub still says APPROVED.
    setFacts({ headSha: HEAD_B, approvedAtHead: false });
    const [stale] = await scheduleReadyAutoMerges(deps);
    expect(stale).toMatchObject({
      scheduled: false,
      head: HEAD_B,
      reason: expect.stringContaining('approval is stale at 697a05f8; review re-requested (started)'),
    });
    expect(requestReview).toHaveBeenCalledTimes(1);

    // Every later tick at B asks nothing more.
    for (let tick = 0; tick < 3; tick += 1) {
      const [again] = await scheduleReadyAutoMerges(deps);
      expect(again.reason).toContain('review already re-requested for this head');
    }
    expect(requestReview).toHaveBeenCalledTimes(1);

    // The review approves B: the PR schedules with no human action.
    setFacts({ headSha: HEAD_B, approvedAtHead: true });
    await expect(scheduleReadyAutoMerges(deps)).resolves.toEqual([{ projectKey: 'overdeck', issueId: 'PAN-42', scheduled: true }]);
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it('does not ask for review when the gate refuses for another reason', async () => {
    const { deps, requestReview, setFacts } = staleWorld();
    setFacts({ headSha: HEAD_B, checks: 'red' });
    const [outcome] = await scheduleReadyAutoMerges(deps);
    expect(outcome.reason).toBe(`CI checks failing on PR HEAD ${HEAD_B}`);
    expect(requestReview).not.toHaveBeenCalled();
  });

  it('keeps each skip reason from the last completed tick and logs it only when it changes', async () => {
    vi.useFakeTimers();
    resetSchedulerOutcomes();
    try {
      vi.setSystemTime(new Date('2026-11-02T02:45:00.000Z'));
      const { deps, setFacts } = staleWorld();
      setFacts({ headSha: HEAD_B, checks: 'red' });

      await runAutoMergeSchedulerTick(deps, 1_000);
      await vi.advanceTimersByTimeAsync(60_000);
      await runAutoMergeSchedulerTick(deps, 1_000);
      expect(listNotScheduledAutoMerges()).toEqual([{
        issueId: 'PAN-42', projectKey: 'overdeck', head: HEAD_B,
        reason: `CI checks failing on PR HEAD ${HEAD_B}`, at: '2026-11-02T02:45:00.000Z',
      }]);
      const notScheduledLogs = () => deps.log.mock.calls.filter(([line]) => String(line).includes('PAN-42 not scheduled')).length;
      expect(notScheduledLogs()).toBe(1);

      setFacts({ headSha: HEAD_B, mergeable: false });
      await runAutoMergeSchedulerTick(deps, 1_000);
      expect(listNotScheduledAutoMerges()[0].reason).toContain('PR is not mergeable');
      expect(notScheduledLogs()).toBe(2);

      // Scheduled now: nothing left to explain.
      setFacts({ headSha: HEAD_B });
      await runAutoMergeSchedulerTick(deps, 1_000);
      expect(listNotScheduledAutoMerges()).toEqual([]);
    } finally {
      vi.useRealTimers();
      resetSchedulerOutcomes();
    }
  });

  it('does not report an issue that is already pending as not scheduled', async () => {
    vi.useFakeTimers();
    resetSchedulerOutcomes();
    try {
      const { deps } = world({ labels: ['auto-merge'], latest: row('pending') });
      await runAutoMergeSchedulerTick(deps, 1_000);
      expect(listNotScheduledAutoMerges()).toEqual([]);
    } finally {
      vi.useRealTimers();
      resetSchedulerOutcomes();
    }
  });

  it('keeps the previous reasons when a pass is abandoned', async () => {
    vi.useFakeTimers();
    resetSchedulerOutcomes();
    try {
      const { deps, setFacts } = staleWorld();
      setFacts({ headSha: HEAD_B, checks: 'red' });
      await runAutoMergeSchedulerTick(deps, 1_000);
      expect(listNotScheduledAutoMerges()).toHaveLength(1);

      deps.listCandidates = vi.fn(() => new Promise<never>(() => {}));
      const hung = runAutoMergeSchedulerTick(deps, 1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(hung).resolves.toEqual([]);
      expect(listNotScheduledAutoMerges()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      resetSchedulerOutcomes();
    }
  });
});

/**
 * PAN-5036: three approved, green, CLEAN PRs sat unscheduled for 40 minutes
 * with `notScheduled: []` and no log line, because a failed or stale PR
 * listing looked exactly like "nothing to schedule".
 */
describe('a failed or stale PR listing is never silent (PAN-5036)', () => {
  const HEAD = '697a05f820000000000000000000000000000000';

  it('records a project skip reason and one log line while the listing read fails, and logs when it clears', async () => {
    vi.useFakeTimers();
    resetSchedulerOutcomes();
    try {
      vi.setSystemTime(new Date('2026-11-04T15:00:00.000Z'));
      const { deps, insert, factsReads } = world({ labels: ['auto-merge'] });
      let rows: readonly ListedPr[] | null = null;
      deps.listCandidates = vi.fn((projectPath: string) => listScheduleCandidates(projectPath, { listPullRequests: async () => rows }));
      const unavailableLogs = () => deps.log.mock.calls.filter(([line]) => String(line).includes('PR listing unavailable')).length;

      await runAutoMergeSchedulerTick(deps, 1_000);
      await runAutoMergeSchedulerTick(deps, 1_000);
      expect(listNotScheduledAutoMerges()).toEqual([{
        issueId: 'overdeck', projectKey: 'overdeck', scope: 'project',
        reason: expect.stringContaining('PR listing unavailable'), at: '2026-11-04T15:00:00.000Z',
      }]);
      expect(unavailableLogs()).toBe(1);
      expect(factsReads).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();

      // The forge answers again: the PR schedules and the project skip clears.
      rows = [listed()];
      await runAutoMergeSchedulerTick(deps, 1_000);
      expect(insert).toHaveBeenCalledTimes(1);
      expect(listNotScheduledAutoMerges()).toEqual([]);
      expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('project overdeck: cleared "PR listing unavailable'));
    } finally {
      vi.useRealTimers();
      resetSchedulerOutcomes();
    }
  });

  it('names the head when an approved PR is ruled out by pending checks in the cached listing, with no forge read', async () => {
    vi.useFakeTimers();
    resetSchedulerOutcomes();
    try {
      vi.setSystemTime(new Date('2026-11-04T15:00:00.000Z'));
      const { deps, insert, factsReads } = world({ labels: ['auto-merge'] });
      const pending = listed({ headRefOid: HEAD, statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: null }] });
      deps.listCandidates = vi.fn((projectPath: string) => listScheduleCandidates(projectPath, { listPullRequests: async () => [pending] }));

      await expect(runAutoMergeSchedulerTick(deps, 1_000)).resolves.toEqual([{
        projectKey: 'overdeck', issueId: 'PAN-42', scheduled: false, head: HEAD,
        reason: 'checks pending in the PR listing at 697a05f8',
      }]);
      expect(listNotScheduledAutoMerges()).toEqual([{
        issueId: 'PAN-42', projectKey: 'overdeck', head: HEAD,
        reason: 'checks pending in the PR listing at 697a05f8', at: '2026-11-04T15:00:00.000Z',
      }]);
      expect(deps.log).toHaveBeenCalledWith('[auto-merge-scheduler] PAN-42 not scheduled: checks pending in the PR listing at 697a05f8');
      expect(factsReads).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      resetSchedulerOutcomes();
    }
  });

  it('runs a ruled-out PR through the free checks first, so policy and pending rows keep their meaning', async () => {
    const conflicting = listed({ headRefOid: HEAD, mergeable: 'CONFLICTING' });
    const listCandidates = vi.fn((projectPath: string) => listScheduleCandidates(projectPath, { listPullRequests: async () => [conflicting] }));

    const notOptedIn = world();
    notOptedIn.deps.listCandidates = listCandidates;
    const [refused] = await scheduleReadyAutoMerges(notOptedIn.deps);
    expect(refused).toMatchObject({ issueId: 'PAN-42', scheduled: false });
    expect(refused.reason).not.toContain('PR listing');

    const alreadyPending = world({ labels: ['auto-merge'], latest: row('pending') });
    alreadyPending.deps.listCandidates = listCandidates;
    await expect(scheduleReadyAutoMerges(alreadyPending.deps)).resolves.toEqual([{
      projectKey: 'overdeck', issueId: 'PAN-42', scheduled: false, reason: 'auto-merge already pending', alreadyScheduled: true,
    }]);

    const optedIn = world({ labels: ['auto-merge'] });
    optedIn.deps.listCandidates = listCandidates;
    await expect(scheduleReadyAutoMerges(optedIn.deps)).resolves.toEqual([{
      projectKey: 'overdeck', issueId: 'PAN-42', scheduled: false, head: HEAD,
      reason: 'PR conflicts with its base in the PR listing at 697a05f8',
    }]);
    expect(optedIn.factsReads).not.toHaveBeenCalled();
  });
});
