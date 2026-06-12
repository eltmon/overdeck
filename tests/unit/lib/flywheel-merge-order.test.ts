import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { orderMergeCandidates, planMergeTrain, planUatCandidate } from '../../../src/lib/flywheel-merge-order.js';

const execFileAsync = promisify(execFile);

const c = (issueId: string, footprint: number, conflictCount: number) => ({
  issueId,
  footprint,
  conflictCount,
});

describe('orderMergeCandidates (PAN-1691 conflict-aware order)', () => {
  it('orders all-disjoint candidates by issue number', () => {
    const out = orderMergeCandidates([c('PAN-30', 5, 0), c('PAN-10', 99, 0), c('PAN-20', 1, 0)]);
    expect(out.map((x) => x.issueId)).toEqual(['PAN-10', 'PAN-20', 'PAN-30']);
  });

  it('puts disjoint (safe) candidates before conflicting ones', () => {
    const out = orderMergeCandidates([c('PAN-1', 100, 2), c('PAN-99', 1, 0)]);
    expect(out.map((x) => x.issueId)).toEqual(['PAN-99', 'PAN-1']);
  });

  it('orders conflicting candidates broadest-footprint first', () => {
    const out = orderMergeCandidates([c('PAN-5', 3, 1), c('PAN-6', 40, 1), c('PAN-7', 12, 1)]);
    expect(out.map((x) => x.issueId)).toEqual(['PAN-6', 'PAN-7', 'PAN-5']);
  });

  it('breaks footprint ties within a cluster by issue number', () => {
    const out = orderMergeCandidates([c('PAN-8', 10, 1), c('PAN-3', 10, 1)]);
    expect(out.map((x) => x.issueId)).toEqual(['PAN-3', 'PAN-8']);
  });

  it('combines tiers: disjoint-by-number, then conflicting-by-footprint', () => {
    const out = orderMergeCandidates([
      c('PAN-50', 8, 1),
      c('PAN-12', 2, 0),
      c('PAN-40', 30, 2),
      c('PAN-3', 99, 0),
    ]);
    expect(out.map((x) => x.issueId)).toEqual(['PAN-3', 'PAN-12', 'PAN-40', 'PAN-50']);
  });
});

describe('planMergeTrain (PAN-1691 batch/serialize plan)', () => {
  it('batches all disjoint candidates with an empty serialize list', () => {
    const plan = planMergeTrain([c('PAN-2', 4, 0), c('PAN-1', 9, 0)]);
    expect(plan.batch).toEqual(['PAN-1', 'PAN-2']);
    expect(plan.serialize).toEqual([]);
    expect(plan.order).toEqual(['PAN-1', 'PAN-2']);
  });

  it('splits disjoint into batch and conflicting into serialize (broadest first)', () => {
    const plan = planMergeTrain([c('PAN-10', 5, 0), c('PAN-20', 3, 1), c('PAN-30', 50, 2)]);
    expect(plan.batch).toEqual(['PAN-10']);
    expect(plan.serialize).toEqual(['PAN-30', 'PAN-20']);
    expect(plan.order).toEqual(['PAN-10', 'PAN-30', 'PAN-20']);
  });

  it('returns empty plan for no candidates', () => {
    expect(planMergeTrain([])).toEqual({ batch: [], serialize: [], order: [] });
  });
});

describe('planUatCandidate (PAN-1691 on-demand UAT branch)', () => {
  const qi = (issueId: string, batchGroup: 'batch' | 'serialize') => ({
    issueId,
    title: issueId,
    branchName: `feature/${issueId.toLowerCase()}`,
    mergeOrder: 1,
    conflictsWith: [] as string[],
    batchGroup,
  });

  it('bundles only the batch items and dates the branch name', () => {
    const plan = planUatCandidate(
      [qi('PAN-1', 'batch'), qi('PAN-2', 'serialize'), qi('PAN-3', 'batch')],
      { dateIso: '2026-06-09T12:00:00.000Z' },
    );
    expect(plan.bundled).toEqual(['PAN-1', 'PAN-3']);
    expect(plan.branchName).toBe('uat/candidate-2026-06-09');
  });

  it('uses the label in the branch name', () => {
    const plan = planUatCandidate([qi('PAN-1', 'batch')], { dateIso: '2026-06-09T00:00:00Z', label: 'pan' });
    expect(plan.branchName).toBe('uat/pan-2026-06-09');
  });

  it('returns an empty bundle when nothing is batchable', () => {
    expect(planUatCandidate([qi('PAN-1', 'serialize')], { dateIso: '2026-06-09T00:00:00Z' }).bundled).toEqual([]);
  });
});

describe('mergeGateEligibility (PAN-1759 verb vs authoritative state)', () => {
  it('passes only when review passed and test passed/skipped', async () => {
    const { mergeGateEligibility } = await import('../../../src/lib/review-status.js');
    expect(mergeGateEligibility({ reviewStatus: 'passed', testStatus: 'passed', verificationStatus: 'passed' })).toEqual({ eligible: true });
    expect(mergeGateEligibility({ reviewStatus: 'passed', testStatus: 'skipped', verificationStatus: 'pending' })).toEqual({ eligible: true });
  });

  it('rejects mid-review, unfinished tests, failed verification, missing records, and already-merged', async () => {
    const { mergeGateEligibility } = await import('../../../src/lib/review-status.js');
    expect(mergeGateEligibility({ reviewStatus: 'reviewing', testStatus: 'pending', verificationStatus: 'passed' }))
      .toEqual({ eligible: false, reason: 'review is reviewing' });
    expect(mergeGateEligibility({ reviewStatus: 'passed', testStatus: 'testing', verificationStatus: 'passed' }))
      .toEqual({ eligible: false, reason: 'test is testing' });
    expect(mergeGateEligibility({ reviewStatus: 'passed', testStatus: 'passed', verificationStatus: 'failed' }))
      .toEqual({ eligible: false, reason: 'verification failed' });
    expect(mergeGateEligibility(null)).toEqual({ eligible: false, reason: 'no review record' });
    expect(mergeGateEligibility({ reviewStatus: 'passed', testStatus: 'passed', verificationStatus: 'passed', mergeStatus: 'merged' }))
      .toEqual({ eligible: false, reason: 'already merged' });
  });
});

describe('computeMergeQueueFromCandidates', () => {
  let repoDir: string | null = null;

  afterEach(async () => {
    if (repoDir) await rm(repoDir, { recursive: true, force: true });
    repoDir = null;
  });

  async function git(args: string[]) {
    await execFileAsync('git', args, { cwd: repoDir! });
  }

  async function commitBranch(branchName: string, files: Record<string, string>) {
    await git(['switch', '-c', branchName, 'main']);
    for (const [file, content] of Object.entries(files)) {
      await writeFile(join(repoDir!, file), content, 'utf8');
    }
    await git(['add', '.']);
    await git(['commit', '-m', `commit ${branchName}`]);
    await git(['switch', 'main']);
  }

  it('preserves conflict-aware ordering, conflict sets, and batch groups for candidate inputs', async () => {
    const { Effect } = await import('effect');
    const { layer: nodeServicesLayer } = await import('@effect/platform-node/NodeServices');
    const { computeMergeQueueFromCandidates } = await import('../../../src/lib/flywheel-merge-order.js');
    repoDir = await mkdtemp(join(tmpdir(), 'pan-merge-order-'));
    await git(['init', '-b', 'main']);
    await git(['config', 'user.email', 'test@example.invalid']);
    await git(['config', 'user.name', 'Pan Test']);
    await writeFile(join(repoDir, 'base.txt'), 'base\n', 'utf8');
    await git(['add', '.']);
    await git(['commit', '-m', 'base']);
    await commitBranch('feature/pan-1', { 'alpha.txt': 'alpha\n' });
    await commitBranch('feature/pan-2', { 'beta.txt': 'beta\n' });
    await commitBranch('feature/pan-3', { 'shared.txt': 'three\n' });
    await commitBranch('feature/pan-4', { 'shared.txt': 'four\n', 'delta.txt': 'delta\n' });

    const queue = await Effect.runPromise(
      computeMergeQueueFromCandidates([
        { issueId: 'PAN-4', title: 'Wide conflict', pr: 4 },
        { issueId: 'PAN-1', title: 'Alpha', pr: 1 },
        { issueId: 'PAN-3', title: 'Narrow conflict', pr: 3 },
        { issueId: 'PAN-2', title: 'Beta', pr: 2 },
        { issueId: 'PAN-99', title: 'Missing branch', pr: 99 },
      ], repoDir, {
        eligibility: () => ({ eligible: true }),
        getPrUrl: (item) => `https://example.test/${item.pr}`,
      }).pipe(Effect.provide(nodeServicesLayer)),
    );

    expect(queue.map((item) => item.issueId)).toEqual(['PAN-1', 'PAN-2', 'PAN-4', 'PAN-3']);
    expect(queue.map((item) => item.batchGroup)).toEqual(['batch', 'batch', 'serialize', 'serialize']);
    expect(queue.map((item) => item.mergeOrder)).toEqual([1, 2, 3, 4]);
    expect(queue.find((item) => item.issueId === 'PAN-1')).toMatchObject({
      title: 'Alpha',
      branchName: 'feature/pan-1',
      pr: 1,
      prUrl: 'https://example.test/1',
      conflictsWith: [],
    });
    expect(queue.find((item) => item.issueId === 'PAN-3')?.conflictsWith).toEqual(['PAN-4']);
    expect(queue.find((item) => item.issueId === 'PAN-4')?.conflictsWith).toEqual(['PAN-3']);
  });
});

describe('listEligibleCandidatesByProject', () => {
  afterEach(() => {
    vi.doUnmock('../../../src/lib/database/review-status-db.js');
    vi.doUnmock('../../../src/lib/projects.js');
    vi.resetModules();
  });

  function status(issueId: string, overrides: Record<string, unknown> = {}) {
    return {
      issueId,
      reviewStatus: 'passed',
      testStatus: 'passed',
      verificationStatus: 'passed',
      mergeStatus: 'pending',
      readyForMerge: false,
      updatedAt: '2026-06-12T00:00:00.000Z',
      ...overrides,
    };
  }

  async function loadWith(statuses: Record<string, unknown>, projectFor: (issueId: string) => unknown) {
    vi.resetModules();
    vi.doMock('../../../src/lib/database/review-status-db.js', () => ({
      getAllReviewStatusesFromDb: () => statuses,
      getReviewStatusFromDbSync: (issueId: string) => statuses[issueId.toUpperCase()] ?? null,
      getReviewStatusesFromDb: (issueIds: string[]) => Object.fromEntries(issueIds.map((issueId) => [issueId, statuses[issueId.toUpperCase()]]).filter(([, value]) => value)),
      getReviewStatusFromDb: () => null,
      upsertReviewStatusSync: vi.fn(),
      deleteReviewStatus: vi.fn(),
      markWorkspaceStuck: vi.fn(),
      clearWorkspaceStuck: vi.fn(),
      setDeaconIgnored: vi.fn(),
      setAutoMerge: vi.fn(),
    }));
    vi.doMock('../../../src/lib/projects.js', () => ({
      resolveProjectFromIssueSync: projectFor,
    }));
    return import('../../../src/lib/flywheel-merge-order.js');
  }

  it('groups only eligible non-ignored review-status records by resolved project', async () => {
    const { listEligibleCandidatesByProject } = await loadWith({
      'PAN-1': status('PAN-1', { prNumber: 101, readyForMerge: false }),
      'PAN-2': status('PAN-2', { reviewStatus: 'reviewing', readyForMerge: true }),
      'PAN-3': status('PAN-3', { testStatus: 'failed', readyForMerge: true }),
      'PAN-4': status('PAN-4', { verificationStatus: 'failed', readyForMerge: true }),
      'PAN-5': status('PAN-5', { mergeStatus: 'merged', readyForMerge: true }),
      'PAN-6': status('PAN-6', { deaconIgnored: true, readyForMerge: true }),
      'MIN-7': status('MIN-7', { prNumber: 207 }),
      'EXT-8': status('EXT-8'),
    }, (issueId) => {
      if (issueId.startsWith('PAN-')) return { projectKey: 'panopticon-cli', projectPath: '/repo/panopticon-cli' };
      if (issueId.startsWith('MIN-')) return { projectKey: 'mind-your-now', projectPath: '/repo/myn' };
      return null;
    });

    const groups = listEligibleCandidatesByProject({ titleFor: (issueId) => issueId === 'PAN-1' ? 'Pan issue' : undefined });

    expect([...groups.keys()]).toEqual(['panopticon-cli', 'mind-your-now']);
    expect(groups.get('panopticon-cli')).toEqual({
      projectKey: 'panopticon-cli',
      projectRoot: '/repo/panopticon-cli',
      candidates: [{ issueId: 'PAN-1', title: 'Pan issue', pr: 101 }],
    });
    expect(groups.get('mind-your-now')).toEqual({
      projectKey: 'mind-your-now',
      projectRoot: '/repo/myn',
      candidates: [{ issueId: 'MIN-7', title: 'MIN-7', pr: 207 }],
    });
  });
});
