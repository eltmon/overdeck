import { describe, expect, it, vi } from 'vitest';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';
import type { PanIssuePipelineRecord } from '../../../../src/lib/pan-dir/record.js';
import {
  checkMergedRow,
  checkMainVerifyRow,
  checkDeployRow,
  checkPostMergeRow,
  checkReviewRow,
  checkTestsRow,
  checkVerificationRow,
  evaluateDodGate,
  type DodStatusRowDeps,
} from '../../../../src/lib/lifecycle/dod-gate.js';
import { BRANCH_ABSENT_MERGE_ERROR, DOD_ROWS, type DodRowId, type DodRowResult } from '../../../../src/lib/lifecycle/dod.js';
import { stepFailed, stepOk, stepSkipped } from '../../../../src/lib/lifecycle/types.js';

const issueId = 'PAN-2715';

function live(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId,
    reviewStatus: 'passed',
    testStatus: 'passed',
    verificationStatus: 'passed',
    lastVerifiedCommit: 'abc123',
    updatedAt: '2026-07-15T00:00:00Z',
    readyForMerge: true,
    ...overrides,
  };
}

function journal(overrides: Partial<PanIssuePipelineRecord> = {}): PanIssuePipelineRecord {
  return {
    issueId,
    reviewStatus: 'passed',
    testStatus: 'passed',
    verificationStatus: 'passed',
    lastVerifiedCommit: 'journal123',
    readyForMerge: true,
    updatedAt: '2026-07-15T00:00:00Z',
    ...overrides,
  };
}

function deps(status: ReviewStatus | null, pipeline: PanIssuePipelineRecord | null = null): DodStatusRowDeps {
  return { getReviewStatus: () => status, getJournalStatus: () => pipeline };
}

describe('Definition-of-Done status rows', () => {
  it('passes live review, test, and verified-commit verdicts', async () => {
    const source = deps(live());
    expect(await checkReviewRow(issueId, source)).toMatchObject({ status: 'pass', observed: 'reviewStatus: passed' });
    expect(await checkTestsRow(issueId, source)).toMatchObject({ status: 'pass', observed: 'testStatus: passed' });
    expect(await checkVerificationRow(issueId, source)).toMatchObject({ status: 'pass', observed: 'verificationStatus: passed at abc123' });
  });

  it('treats skipped verdicts as policy-approved passes', async () => {
    const source = deps(live({ reviewStatus: 'skipped', testStatus: 'skipped', verificationStatus: 'skipped' }));
    for (const row of await Promise.all([checkReviewRow(issueId, source), checkTestsRow(issueId, source), checkVerificationRow(issueId, source)])) {
      expect(row.status).toBe('pass');
      expect(row.observed).toContain('skipped per issue policy');
    }
  });

  it('reports the actual non-passing verdict', async () => {
    const source = deps(live({ reviewStatus: 'failed', testStatus: 'pending', verificationStatus: 'failed' }));
    expect(await checkReviewRow(issueId, source)).toMatchObject({ status: 'miss', observed: 'reviewStatus: failed' });
    expect(await checkTestsRow(issueId, source)).toMatchObject({ status: 'miss', observed: 'testStatus: pending' });
    expect(await checkVerificationRow(issueId, source)).toMatchObject({ status: 'miss', observed: 'verificationStatus: failed at abc123' });
  });

  it('passes a verified verdict whose best-effort commit anchor was never recorded, and names the gap', async () => {
    // PAN-3067: lastVerifiedCommit is written best-effort by the verification runner,
    // so its absence must neither block the row nor hide itself from the observed string.
    expect(await checkVerificationRow(issueId, deps(live({ lastVerifiedCommit: undefined })))).toMatchObject({
      status: 'pass',
      observed: 'verificationStatus: passed (no lastVerifiedCommit recorded)',
    });
    expect(
      await checkVerificationRow(issueId, deps(live({ verificationStatus: 'skipped', lastVerifiedCommit: undefined }))),
    ).toMatchObject({
      status: 'pass',
      observed: 'verificationStatus: skipped (skipped per issue policy; no lastVerifiedCommit recorded)',
    });
  });

  it('never claims a missing anchor for a verdict that already fails on its own', async () => {
    expect(await checkVerificationRow(issueId, deps(live({ verificationStatus: undefined, lastVerifiedCommit: undefined })))).toMatchObject({
      status: 'miss',
      observed: 'verificationStatus: missing',
    });
  });

  it('falls back to durable pipeline journal verdicts after live status is cleared', async () => {
    const source = deps(null, journal());
    for (const row of await Promise.all([checkReviewRow(issueId, source), checkTestsRow(issueId, source), checkVerificationRow(issueId, source)])) {
      expect(row.status).toBe('pass');
      expect(row.observed).toContain('from pipeline journal');
    }
  });

  it('passes a durable journal verdict without a commit anchor and still reports both facts', async () => {
    const row = await checkVerificationRow(issueId, deps(null, journal({ lastVerifiedCommit: undefined })));
    expect(row).toMatchObject({
      status: 'pass',
      observed: 'verificationStatus: passed (from pipeline journal; no lastVerifiedCommit recorded)',
    });
  });

  it('returns misses instead of throwing when both sources are empty or a door fails', async () => {
    const empty = deps(null);
    const failing: DodStatusRowDeps = {
      getReviewStatus: () => { throw new Error('database unavailable'); },
      getJournalStatus: () => { throw new Error('journal unavailable'); },
    };
    for (const source of [empty, failing]) {
      for (const row of await Promise.all([checkReviewRow(issueId, source), checkTestsRow(issueId, source), checkVerificationRow(issueId, source)])) {
        expect(row).toMatchObject({ status: 'miss', observed: 'no review status or journal record found' });
      }
    }
  });

  it('marks review and tests skipped-by-strike for a strike-landed issue, never passed', async () => {
    // PAN-3180: a strike dispatches neither specialist by design, so "never ran"
    // must resolve as a deliberate skip while still reporting the real verdict.
    const source = deps(live({ reviewStatus: 'pending', testStatus: 'pending', strikeLandingState: 'landed' }));
    const [review, tests] = await Promise.all([checkReviewRow(issueId, source), checkTestsRow(issueId, source)]);

    expect(review).toMatchObject({ status: 'skip' });
    expect(review.observed).toContain('reviewStatus: pending');
    expect(review.observed).toContain('skipped by the strike path (strikeLandingState: landed)');
    expect(review.observed).toContain('no review specialist is dispatched for a strike');

    expect(tests).toMatchObject({ status: 'skip' });
    expect(tests.observed).toContain('testStatus: pending');
    expect(tests.observed).toContain('no test specialist is dispatched for a strike');
  });

  it('reads the strike waiver from the durable pipeline journal after live status is cleared', async () => {
    const source = deps(null, journal({ reviewStatus: 'pending', testStatus: 'pending', strikeLandingState: 'landed' }));
    for (const row of await Promise.all([checkReviewRow(issueId, source), checkTestsRow(issueId, source)])) {
      expect(row.status).toBe('skip');
      expect(row.observed).toContain('from pipeline journal');
      expect(row.observed).toContain('skipped by the strike path');
    }
  });

  it('keeps review and tests blocking for a normal work-agent issue and for an in-flight strike', async () => {
    const normal = deps(live({ reviewStatus: 'pending', testStatus: 'pending' }));
    for (const row of await Promise.all([checkReviewRow(issueId, normal), checkTestsRow(issueId, normal)])) {
      expect(row.status).toBe('miss');
      expect(row.observed).not.toContain('strike');
    }

    // Only `landed` is the strike path's statement that the work reached main.
    for (const state of ['ready', 'landing', 'recovering', 'needs_you'] as const) {
      const inFlight = deps(live({ reviewStatus: 'pending', testStatus: 'failed', strikeLandingState: state }));
      for (const row of await Promise.all([checkReviewRow(issueId, inFlight), checkTestsRow(issueId, inFlight)])) {
        expect(row.status).toBe('miss');
      }
    }
  });

  it('never lets the strike waiver overwrite a verdict a specialist actually produced', async () => {
    const passed = deps(live({ reviewStatus: 'passed', testStatus: 'passed', strikeLandingState: 'landed' }));
    expect(await checkReviewRow(issueId, passed)).toMatchObject({ status: 'pass', observed: 'reviewStatus: passed' });
    expect(await checkTestsRow(issueId, passed)).toMatchObject({ status: 'pass', observed: 'testStatus: passed' });

    // A specialist that ran and rejected the work is a different fact from one
    // that was never dispatched — those keep blocking until an operator accepts.
    const negative = deps(live({ reviewStatus: 'blocked', testStatus: 'failed', strikeLandingState: 'landed' }));
    expect(await checkReviewRow(issueId, negative)).toMatchObject({ status: 'miss', observed: 'reviewStatus: blocked' });
    expect(await checkTestsRow(issueId, negative)).toMatchObject({ status: 'miss', observed: 'testStatus: failed' });
  });
});

describe('Definition-of-Done merged row', () => {
  const ctx = {
    issueId,
    projectPath: '/tmp/overdeck',
    github: { owner: 'eltmon', repo: 'overdeck', number: 2715 },
  };

  it('maps the existing merge verifier result without changing its verdict', async () => {
    const pass = await checkMergedRow(ctx, {
      verifyMerged: async () => stepOk('close-out:verify-merged', ['All commits merged to main']),
      readPullRequest: async () => ({}),
    });
    const miss = await checkMergedRow(ctx, {
      verifyMerged: async () => stepFailed('close-out:verify-merged', 'branch has 2 unmerged commit(s)'),
      readPullRequest: async () => ({}),
    });
    expect(pass).toMatchObject({ status: 'pass', observed: expect.stringContaining('All commits merged to main') });
    expect(miss).toMatchObject({ status: 'miss', observed: expect.stringContaining('2 unmerged commit') });
  });

  it('rejects branch absence when neither the forge nor the durable record proves a merge', async () => {
    const row = await checkMergedRow(ctx, {
      verifyMerged: async () => stepFailed('close-out:verify-merged', BRANCH_ABSENT_MERGE_ERROR),
      readPullRequest: async () => ({}),
      readDurableMerges: async () => [],
    });

    expect(row).toMatchObject({
      status: 'miss',
      observed: expect.stringContaining('no merged forge artifact or durable close-out merge record found'),
    });
  });

  it('accepts a deleted branch only with positive durable or forge merge evidence', async () => {
    const durable = await checkMergedRow({ issueId, projectPath: '/tmp/overdeck' }, {
      verifyMerged: async () => stepFailed('close-out:verify-merged', BRANCH_ABSENT_MERGE_ERROR),
      readPullRequest: async () => ({}),
      readDurableMerges: async () => ['https://github.com/eltmon/overdeck/pull/2720'],
    });
    const forge = await checkMergedRow(ctx, {
      verifyMerged: async () => stepFailed('close-out:verify-merged', BRANCH_ABSENT_MERGE_ERROR),
      readPullRequest: async () => ({ number: 2720, state: 'MERGED', mergedAt: '2026-07-15T12:00:00Z' }),
      readDurableMerges: async () => [],
    });

    expect(durable).toMatchObject({ status: 'pass', observed: expect.stringContaining('1 merge artifact') });
    expect(forge).toMatchObject({ status: 'pass', mergedAt: '2026-07-15T12:00:00Z' });
  });

  it('treats the existing idempotent skip as a pass', async () => {
    const row = await checkMergedRow({ issueId, projectPath: '/tmp/overdeck' }, {
      verifyMerged: async () => stepSkipped('close-out:verify-merged', ['Issue already closed on forge']),
      readPullRequest: async () => { throw new Error('must not read without GitHub context'); },
    });
    expect(row).toMatchObject({ status: 'pass', observed: 'Issue already closed on forge' });
  });

  it('adds forge merge time and commit metadata when available', async () => {
    const row = await checkMergedRow(ctx, {
      verifyMerged: async () => stepOk('close-out:verify-merged', ['Merge specialist confirmed merge completed']),
      readPullRequest: async (_ctx, branch) => {
        expect(branch).toBe('feature/pan-2715');
        return {
          number: 2720,
          state: 'MERGED',
          mergedAt: '2026-07-15T12:00:00Z',
          mergeCommit: { oid: 'deadbeef' },
        };
      },
    });
    expect(row).toMatchObject({
      status: 'pass',
      mergedAt: '2026-07-15T12:00:00Z',
      mergeCommit: 'deadbeef',
      observed: expect.stringContaining('PR #2720 MERGED at 2026-07-15T12:00:00Z'),
    });
  });

  it('keeps a git-verified pass when forge metadata lookup fails', async () => {
    const row = await checkMergedRow(ctx, {
      verifyMerged: async () => stepOk('close-out:verify-merged', ['All commits merged to main']),
      readPullRequest: async () => { throw new Error('gh timed out'); },
    });
    expect(row).toMatchObject({
      status: 'pass',
      observed: expect.stringContaining('forge metadata unavailable: gh timed out'),
    });
  });

  it('accepts branch work contained in main as a non-PR landing', async () => {
    const row = await checkMergedRow(ctx, {
      verifyMerged: async () => stepFailed('close-out:verify-merged', BRANCH_ABSENT_MERGE_ERROR),
      readPullRequest: async () => ({}),
      readDurableMerges: async () => [],
      readBranchContainment: async () => ({
        mergedWorkRefs: ['frontend:feature/min-873'],
        unmergedRefs: [],
        pointerRefs: [],
      }),
    });

    expect(row).toMatchObject({
      status: 'pass',
      evidence: 'branch-containment',
      observed: expect.stringContaining('frontend:feature/min-873'),
    });
    expect(row.mergedAt).toBeUndefined();
    expect(row.mergeCommit).toBeUndefined();
  });

  it('does not accept containment while any issue branch remains unmerged', async () => {
    const row = await checkMergedRow(ctx, {
      verifyMerged: async () => stepFailed('close-out:verify-merged', BRANCH_ABSENT_MERGE_ERROR),
      readPullRequest: async () => ({}),
      readDurableMerges: async () => [],
      readBranchContainment: async () => ({
        mergedWorkRefs: ['frontend:feature/min-873'],
        unmergedRefs: ['api:feature/min-873'],
        pointerRefs: [],
      }),
    });

    expect(row.status).toBe('miss');
    expect(row.evidence).toBeUndefined();
  });

  it('reports unavailable containment evidence and keeps the merged row missing', async () => {
    const row = await checkMergedRow(ctx, {
      verifyMerged: async () => stepFailed('close-out:verify-merged', BRANCH_ABSENT_MERGE_ERROR),
      readPullRequest: async () => ({}),
      readDurableMerges: async () => [],
      readBranchContainment: async () => { throw new Error('git unavailable'); },
    });

    expect(row).toMatchObject({
      status: 'miss',
      observed: expect.stringContaining('branch containment evidence unavailable: git unavailable'),
    });
  });

  it('does not gather containment when merge evidence already passes', async () => {
    const readBranchContainment = vi.fn();
    const row = await checkMergedRow(ctx, {
      verifyMerged: async () => stepOk('close-out:verify-merged', ['All commits merged to main']),
      readPullRequest: async () => ({}),
      readBranchContainment,
    });

    expect(row.status).toBe('pass');
    expect(readBranchContainment).not.toHaveBeenCalled();
  });

  it('describes branch containment as accepted merged-row evidence', () => {
    expect(DOD_ROWS.find(row => row.id === 'merged')?.expected)
      .toBe('PR merged on the forge (feature or strike head), or branch work contained in main (non-PR landing)');
  });
});

describe('Definition-of-Done post-merge row', () => {
  const ctx = {
    issueId,
    projectPath: '/tmp/overdeck',
    github: { owner: 'eltmon', repo: 'overdeck', number: 2715 },
  };
  const clearAgents = () => [];

  it('passes when the issue is verifying on main and issue agents are stopped', async () => {
    const row = await checkPostMergeRow(ctx, undefined, {
      readCanonicalState: async () => 'verifying_on_main',
      readMergeStatus: () => 'merged',
      listAgents: clearAgents,
    });
    expect(row).toMatchObject({ status: 'pass', observed: expect.stringContaining('no running work/planning agents') });
  });

  it('misses and names running work or planning agents', async () => {
    const row = await checkPostMergeRow(ctx, undefined, {
      readCanonicalState: async () => 'verifying_on_main',
      readMergeStatus: () => 'merged',
      listAgents: () => [
        { id: 'agent-pan-2715', issueId, role: 'work', status: 'running' },
        { id: 'planning-pan-2715', issueId, role: 'plan', status: 'starting' },
      ],
    });
    expect(row).toMatchObject({ status: 'miss' });
    expect(row.observed).toContain('agent-pan-2715');
    expect(row.observed).toContain('planning-pan-2715');
  });

  it('misses when neither canonical state nor merge status proves lifecycle completion', async () => {
    const row = await checkPostMergeRow(ctx, undefined, {
      readCanonicalState: async () => 'in_review',
      readMergeStatus: () => 'verifying',
      listAgents: clearAgents,
    });
    expect(row).toMatchObject({ status: 'miss', observed: expect.stringContaining('canonical state: in_review') });
  });

  it('turns canonical-state probe failures into an observed miss', async () => {
    const row = await checkPostMergeRow(ctx, undefined, {
      readCanonicalState: async () => { throw new Error('gh timed out'); },
      readMergeStatus: () => 'merged',
      listAgents: clearAgents,
    });
    expect(row).toMatchObject({ status: 'miss', observed: expect.stringContaining('gh timed out') });
  });

  it('waives the unobservable lifecycle half for a quiescent non-PR landing', async () => {
    const merged = {
      ...DOD_ROWS.find(row => row.id === 'merged')!,
      status: 'pass' as const,
      observed: 'branch work contained',
      evidence: 'branch-containment' as const,
    };
    const row = await checkPostMergeRow(ctx, merged, {
      readCanonicalState: async () => 'in_review',
      readMergeStatus: () => 'verifying',
      listAgents: clearAgents,
    });

    expect(row).toMatchObject({
      status: 'pass',
      observed: expect.stringContaining('post-merge lifecycle not applicable'),
    });
  });

  it('keeps a containment-evidenced landing blocked while an issue agent runs', async () => {
    const merged = {
      ...DOD_ROWS.find(row => row.id === 'merged')!,
      status: 'pass' as const,
      observed: 'branch work contained',
      evidence: 'branch-containment' as const,
    };
    const row = await checkPostMergeRow(ctx, merged, {
      readCanonicalState: async () => 'in_review',
      readMergeStatus: () => 'verifying',
      listAgents: () => [{ id: 'agent-pan-2715', issueId, role: 'work', status: 'running' }],
    });

    expect(row).toMatchObject({ status: 'miss' });
    expect(row.observed).toContain('agent-pan-2715');
  });

  it('marks the work-agent handoff skipped-by-strike for a quiescent strike landing', async () => {
    // PAN-3180: `postMergeLifecycle()` is the work-agent handoff. A strike has no
    // work agent to pause and the Deacon owns its landing, so the marker this row
    // looks for is never written and its absence is not evidence of a gap.
    const row = await checkPostMergeRow(ctx, undefined, {
      readCanonicalState: async () => 'in_review',
      readMergeStatus: () => 'verifying',
      listAgents: clearAgents,
      readStrikeLanded: () => true,
    });

    expect(row).toMatchObject({ status: 'skip' });
    expect(row.observed).toContain('strikeLandingState: landed');
    expect(row.observed).toContain('not the strike path');
    expect(row.observed).toContain('no running work/planning agents');
  });

  it('keeps a strike landing blocked while an issue work agent is still running', async () => {
    const row = await checkPostMergeRow(ctx, undefined, {
      readCanonicalState: async () => 'in_review',
      readMergeStatus: () => 'verifying',
      listAgents: () => [{ id: 'agent-pan-2715', issueId, role: 'work', status: 'running' }],
      readStrikeLanded: () => true,
    });

    expect(row).toMatchObject({ status: 'miss' });
    expect(row.observed).toContain('agent-pan-2715');
  });

  it('prefers the observed work-agent lifecycle over the strike waiver when both are present', async () => {
    const row = await checkPostMergeRow(ctx, undefined, {
      readCanonicalState: async () => 'verifying_on_main',
      readMergeStatus: () => 'merged',
      listAgents: clearAgents,
      readStrikeLanded: () => true,
    });

    expect(row).toMatchObject({ status: 'pass' });
    expect(row.observed).not.toContain('strikeLandingState');
  });
});

describe('Definition-of-Done main-verification row', () => {
  const ctx = {
    issueId,
    projectPath: '/tmp/overdeck',
    github: { owner: 'eltmon', repo: 'overdeck', number: 2715 },
  };

  it('passes when every merge-commit check-run concluded successfully', async () => {
    const row = await checkMainVerifyRow(ctx, 'abc123', {
      readCheckRuns: async () => ({ total: 4, failed: [], pending: [] }),
    });
    expect(row).toMatchObject({ status: 'pass', observed: '4 check-runs concluded successfully on abc123' });
  });

  it('misses and names failed and pending check-runs', async () => {
    const row = await checkMainVerifyRow(ctx, 'abc123', {
      readCheckRuns: async () => ({ total: 3, failed: ['unit'], pending: ['browser'] }),
    });
    expect(row).toMatchObject({ status: 'miss' });
    expect(row.observed).toContain('failed checks: unit');
    expect(row.observed).toContain('still running: browser');
  });

  it('skips when no merge commit or no check-runs can prove verification', async () => {
    const noCommit = await checkMainVerifyRow(ctx, undefined, {
      readCheckRuns: async () => { throw new Error('must not run'); },
    });
    const noChecks = await checkMainVerifyRow(ctx, 'abc123', {
      readCheckRuns: async () => ({ total: 0, failed: [], pending: [] }),
    });
    expect(noCommit).toMatchObject({ status: 'skip', observed: expect.stringContaining('no merge commit resolvable') });
    expect(noChecks).toMatchObject({ status: 'skip', observed: expect.stringContaining('no CI check-runs') });
  });

  it('turns gh failures into an observed miss', async () => {
    const row = await checkMainVerifyRow(ctx, 'abc123', {
      readCheckRuns: async () => { throw new Error('rate limited'); },
    });
    expect(row).toMatchObject({ status: 'miss', observed: expect.stringContaining('rate limited') });
  });
});

describe('Definition-of-Done deploy row', () => {
  const ctx = { issueId, projectPath: '/repo/overdeck' };
  const merge = { mergedAt: '2026-07-15T12:00:00Z', mergeCommit: 'abcdef123456' };
  const baseDeps = {
    dashboardUrl: () => 'http://localhost:3011',
    readJson: async (url: string) => {
      expect(url).toBe('http://localhost:3011/api/health');
      return {
        repoRoot: '/repo/overdeck',
        buildCommit: 'fedcba654321',
        builtAt: '2026-07-15T12:01:00Z',
      };
    },
    commitContains: async () => true,
  };

  it('preserves old-server health behavior when the canonical live build contains the merge commit', async () => {
    const commitContains = vi.fn(async () => true);
    const row = await checkDeployRow(ctx, merge, {
      ...baseDeps,
      commitContains,
    });
    expect(commitContains.mock.calls).toEqual([
      ['/repo/overdeck', 'fedcba654321', 'origin/main'],
      ['/repo/overdeck', 'abcdef123456', 'fedcba654321'],
    ]);
    expect(row).toMatchObject({ status: 'pass', observed: 'build commit fedcba65 contains merge abcdef12' });
  });

  it('misses when a newer rebuild comes from a sibling commit that does not contain the merge', async () => {
    const row = await checkDeployRow(ctx, merge, {
      ...baseDeps,
      readJson: async () => ({
        repoRoot: '/repo/overdeck',
        buildCommit: 'sibling987654',
        builtAt: '2026-07-15T12:05:00Z',
      }),
      commitContains: async (_repoRoot, _ancestor, descendant) => descendant === 'origin/main',
    });
    expect(row).toMatchObject({
      status: 'miss',
      observed: 'build commit sibling9 does not contain merge abcdef12',
    });
  });

  it('misses a dirty live build before checking commit ancestry', async () => {
    const commitContains = vi.fn(async () => true);
    const row = await checkDeployRow(ctx, merge, {
      ...baseDeps,
      readJson: async () => ({
        repoRoot: '/repo/overdeck',
        buildCommit: 'dirty9876543',
        buildDirty: true,
      }),
      commitContains,
    });

    expect(row).toMatchObject({ status: 'miss' });
    expect(row.observed).toContain('dirty working tree');
    expect(row.observed).toContain('pan reload');
    expect(commitContains).not.toHaveBeenCalled();
  });

  it('misses when the live build commit is not an ancestor of origin/main', async () => {
    const commitContains = vi.fn(async () => false);
    const row = await checkDeployRow(ctx, merge, {
      ...baseDeps,
      readJson: async () => ({
        repoRoot: '/repo/overdeck',
        buildCommit: 'local9876543',
        buildDirty: false,
      }),
      commitContains,
    });

    expect(commitContains).toHaveBeenCalledOnce();
    expect(commitContains).toHaveBeenCalledWith('/repo/overdeck', 'local9876543', 'origin/main');
    expect(row).toMatchObject({ status: 'miss' });
    expect(row.observed).toContain('not an ancestor of origin/main');
    expect(row.observed).toContain('pan reload');
    expect(row.observed).not.toContain('does not contain merge');
  });

  it('misses when the live server does not expose a build commit', async () => {
    const row = await checkDeployRow(ctx, merge, {
      ...baseDeps,
      readJson: async () => ({ repoRoot: '/repo/overdeck' }),
    });
    expect(row).toMatchObject({ status: 'miss', observed: expect.stringContaining('did not report buildCommit') });
  });

  it('skips deploy ancestry before reading dashboard health when the merged row missed without a merge commit', async () => {
    const dashboardUrl = vi.fn(baseDeps.dashboardUrl);
    const readJson = vi.fn(baseDeps.readJson);
    const commitContains = vi.fn(baseDeps.commitContains);
    const row = await checkDeployRow(ctx, { mergedRowStatus: 'miss' }, {
      dashboardUrl,
      readJson,
      commitContains,
    });

    expect(row).toMatchObject({
      status: 'skip',
      observed: 'no merge commit resolved because the merged row missed — deploy ancestry depends on row 4; build ancestry unchecked',
    });
    expect(dashboardUrl).not.toHaveBeenCalled();
    expect(readJson).not.toHaveBeenCalled();
    expect(commitContains).not.toHaveBeenCalled();
  });

  it('misses before reading dashboard health when the merged row passed without a resolvable merge commit', async () => {
    const dashboardUrl = vi.fn(baseDeps.dashboardUrl);
    const readJson = vi.fn(baseDeps.readJson);
    const commitContains = vi.fn(baseDeps.commitContains);
    const row = await checkDeployRow(ctx, { mergedRowStatus: 'pass' }, {
      dashboardUrl,
      readJson,
      commitContains,
    });

    expect(row).toMatchObject({
      status: 'miss',
      observed: 'merged row passed without a resolvable merge commit; build ancestry cannot be checked',
    });
    expect(dashboardUrl).not.toHaveBeenCalled();
    expect(readJson).not.toHaveBeenCalled();
    expect(commitContains).not.toHaveBeenCalled();
  });

  it('skips another project and misses an unreachable dashboard', async () => {
    const otherProject = await checkDeployRow(ctx, merge, {
      ...baseDeps,
      readJson: async () => ({ repoRoot: '/repo/other', buildCommit: 'fedcba654321' }),
    });
    const unreachable = await checkDeployRow(ctx, merge, {
      ...baseDeps,
      readJson: async () => { throw new Error('connection refused'); },
    });
    expect(otherProject).toMatchObject({ status: 'skip', observed: expect.stringContaining('not this project') });
    expect(unreachable).toMatchObject({ status: 'miss', observed: expect.stringContaining('dashboard not reachable') });
  });
});

describe('assembled Definition-of-Done gate', () => {
  const ctx = { issueId, projectPath: '/repo/overdeck' };
  const makeRow = (id: DodRowId, status: DodRowResult['status'] = 'pass'): DodRowResult => {
    const def = DOD_ROWS.find(row => row.id === id)!;
    return { ...def, status, observed: `${id} observed` };
  };
  const deps = (deployStatus: DodRowResult['status'] = 'pass') => ({
    review: async () => makeRow('review'),
    tests: async () => makeRow('tests'),
    verification: async () => makeRow('verification'),
    merged: async () => ({ ...makeRow('merged'), mergedAt: '2026-07-15T12:00:00Z', mergeCommit: 'abc123' }),
    postMerge: async () => makeRow('post-merge'),
    mainVerify: async (_ctx: unknown, commit?: string) => {
      expect(commit).toBe('abc123');
      return makeRow('main-verify');
    },
    deploy: async (_ctx: unknown, merge: {
      mergedAt?: string;
      mergeCommit?: string;
      mergedRowStatus?: DodRowResult['status'];
    }) => {
      expect(merge).toEqual({
        mergedAt: '2026-07-15T12:00:00Z',
        mergeCommit: 'abc123',
        mergedRowStatus: 'pass',
      });
      return makeRow('deploy', deployStatus);
    },
    now: () => '2026-07-15T13:00:00Z',
  });

  it('runs rows one through seven in canonical order and passes a green gate', async () => {
    const gate = await evaluateDodGate(ctx, {}, deps());
    expect(gate.passed).toBe(true);
    expect(gate.rows.map(row => row.id)).toEqual(DOD_ROWS.slice(0, 7).map(row => row.id));
  });

  it('blocks an unaccepted miss and records an accepted miss with who and when', async () => {
    const blocked = await evaluateDodGate(ctx, {}, deps('miss'));
    const accepted = await evaluateDodGate(ctx, { acceptedRows: ['deploy'], acceptedBy: 'operator' }, deps('miss'));
    expect(blocked).toMatchObject({ passed: false, misses: ['deploy'], accepted: [] });
    expect(accepted).toMatchObject({ passed: true, misses: ['deploy'], accepted: ['deploy'] });
    expect(accepted.rows.at(-1)?.acceptedBy).toEqual({
      flag: '--accept-deploy',
      by: 'operator',
      at: '2026-07-15T13:00:00Z',
    });
  });

  it('leaves only review, tests, and verification missing for a quiescent non-PR landing', async () => {
    const nonPrCtx = { issueId: 'MIN-305', projectPath: '/myn' };
    const merged = await checkMergedRow(nonPrCtx, {
      verifyMerged: async () => stepFailed('close-out:verify-merged', BRANCH_ABSENT_MERGE_ERROR),
      readPullRequest: async () => ({}),
      readDurableMerges: async () => [],
      readBranchContainment: async () => ({
        mergedWorkRefs: ['frontend:feature/min-305'],
        unmergedRefs: [],
        pointerRefs: [],
      }),
    });
    const gate = await evaluateDodGate(nonPrCtx, {}, {
      review: async () => makeRow('review', 'miss'),
      tests: async () => makeRow('tests', 'miss'),
      verification: async () => makeRow('verification', 'miss'),
      merged: async () => merged,
      postMerge: (postMergeCtx, mergedRow) => checkPostMergeRow(postMergeCtx, mergedRow, {
        readCanonicalState: async () => 'in_review',
        readMergeStatus: () => 'verifying',
        listAgents: () => [],
      }),
      mainVerify: async () => makeRow('main-verify', 'skip'),
      deploy: async () => makeRow('deploy', 'skip'),
      now: () => '2026-07-15T13:00:00Z',
    });

    expect(gate.misses).toEqual(['review', 'tests', 'verification']);
    expect(gate.rows.find(row => row.id === 'merged')).toMatchObject({ status: 'pass' });
    expect(gate.rows.find(row => row.id === 'post-merge')).toMatchObject({ status: 'pass' });
  });

  it('resolves every row for a strike-landed close-out without a single --accept-<row> override', async () => {
    // PAN-3180 regression: rows 1, 2 and 5 resolve from the strike lens (PAN-3155
    // already covered row 4), so a strike that merged cleanly closes out on its own.
    const strikeCtx = { issueId: 'PAN-3165', projectPath: '/repo/overdeck' };
    const strikeStatus: DodStatusRowDeps = {
      getReviewStatus: () => live({
        issueId: strikeCtx.issueId,
        reviewStatus: 'pending',
        testStatus: 'pending',
        verificationStatus: 'passed',
        strikeLandingState: 'landed',
      }),
      getJournalStatus: () => null,
    };
    const gate = await evaluateDodGate(strikeCtx, {}, {
      review: rowIssueId => checkReviewRow(rowIssueId, strikeStatus),
      tests: rowIssueId => checkTestsRow(rowIssueId, strikeStatus),
      verification: rowIssueId => checkVerificationRow(rowIssueId, strikeStatus),
      merged: async () => ({ ...makeRow('merged'), mergeCommit: 'strike123' }),
      postMerge: (postMergeCtx, mergedRow) => checkPostMergeRow(postMergeCtx, mergedRow, {
        readCanonicalState: async () => 'in_review',
        readMergeStatus: () => 'failed',
        listAgents: () => [],
        readStrikeLanded: () => true,
      }),
      mainVerify: async () => makeRow('main-verify'),
      deploy: async () => makeRow('deploy'),
      now: () => '2026-07-26T23:00:00Z',
    });

    expect(gate).toMatchObject({ passed: true, misses: [], accepted: [] });
    // Row 8 is appended by the close-out workflow once teardown succeeds; the gate
    // itself owns rows 1–7, and none of them may be a silent pass for a strike.
    expect(gate.rows).toHaveLength(DOD_ROWS.length - 1);
    expect(gate.rows.filter(row => row.status === 'skip').map(row => row.id)).toEqual(['review', 'tests', 'post-merge']);
    for (const id of ['review', 'tests', 'post-merge'] as const) {
      expect(gate.rows.find(row => row.id === id)?.observed).toContain('strike');
    }
  });

  it('rejects Definition-of-Done overrides issued by the autonomous flywheel', async () => {
    await expect(evaluateDodGate(ctx, {
      acceptedRows: ['review', 'tests', 'verification'],
      acceptedBy: 'flywheel-orchestrator',
    }, deps('miss'))).rejects.toThrow('flywheel orchestrator cannot accept');
  });

  it('rejects unknown and non-overridable acceptance rows', async () => {
    await expect(evaluateDodGate(ctx, { acceptedRows: ['teardown'] }, deps())).rejects.toThrow(TypeError);
    await expect(evaluateDodGate(ctx, { acceptedRows: ['unknown' as DodRowId] }, deps())).rejects.toThrow(TypeError);
  });
});
