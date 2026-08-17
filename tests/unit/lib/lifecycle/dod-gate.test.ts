import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const issueClosureMocks = vi.hoisted(() => ({
  isIssueClosed: vi.fn(),
  isTrackerIssueClosed: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/issue-closed.js', () => ({
  isIssueClosed: issueClosureMocks.isIssueClosed,
  isTrackerIssueClosed: issueClosureMocks.isTrackerIssueClosed,
}));

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
  reconcileContainedStrike,
  readContainingDefaultBranchCommits,
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

  it('accepts missing verification verdicts when merged work is green on main', async () => {
    // An out-of-band landing bypasses merge-ops, which normally writes the
    // verdict for CI-green skip. Merge plus main-CI evidence is still sufficient.
    const row = await checkVerificationRow(
      issueId,
      deps(live({ verificationStatus: undefined, lastVerifiedCommit: undefined })),
      { trackerClosed: false, landedWork: true, mainVerifyStatus: 'pass' },
    );

    expect(row).toMatchObject({
      status: 'pass',
      observed: 'verificationStatus: missing; verification satisfied by green main CI after landing',
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

  it('settles absent or pending verdicts after a tracker-closed issue has landed', async () => {
    const source = deps(live({
      reviewStatus: 'pending',
      testStatus: undefined,
      verificationStatus: 'pending',
      lastVerifiedCommit: undefined,
    }));
    const settlement = { trackerClosed: true, landedWork: true, mainVerifyStatus: 'skip' as const };
    const review = await checkReviewRow(issueId, source, settlement);
    const tests = await checkTestsRow(issueId, source, settlement);
    const verification = await checkVerificationRow(issueId, source, settlement);

    expect(review).toMatchObject({ status: 'skip', observed: expect.stringContaining('reviewStatus: pending') });
    expect(tests).toMatchObject({ status: 'skip', observed: expect.stringContaining('testStatus: missing') });
    expect(verification).toMatchObject({ status: 'skip', observed: expect.stringContaining('verificationStatus: pending') });
  });

  it('does not settle review without both tracker closure and landed work', async () => {
    const source = deps(live({ reviewStatus: 'pending' }));
    const closedWithoutLanding = await checkReviewRow(issueId, source, {
      trackerClosed: true,
      landedWork: false,
      mainVerifyStatus: 'pass',
    });
    const openWithLanding = await checkReviewRow(issueId, source, {
      trackerClosed: false,
      landedWork: true,
      mainVerifyStatus: 'pass',
    });

    expect(closedWithoutLanding).toMatchObject({ status: 'miss', observed: 'reviewStatus: pending' });
    expect(openWithLanding).toMatchObject({ status: 'miss', observed: 'reviewStatus: pending' });
  });

  it('never supersedes a negative review verdict', async () => {
    const row = await checkReviewRow(issueId, deps(live({ reviewStatus: 'blocked' })), {
      trackerClosed: true,
      landedWork: true,
      mainVerifyStatus: 'pass',
    });

    expect(row).toMatchObject({ status: 'miss', observed: 'reviewStatus: blocked' });
  });

  it('supersedes a negative test verdict only when landed work is green on main', async () => {
    const source = deps(live({ testStatus: 'failed' }));
    const green = await checkTestsRow(issueId, source, {
      trackerClosed: true,
      landedWork: true,
      mainVerifyStatus: 'pass',
    });
    const unproved = await checkTestsRow(issueId, source, {
      trackerClosed: true,
      landedWork: true,
      mainVerifyStatus: 'skip',
    });

    expect(green).toMatchObject({ status: 'skip', observed: expect.stringContaining('testStatus: failed') });
    expect(unproved).toMatchObject({ status: 'miss', observed: 'testStatus: failed' });
  });
});

describe('contained strike reconciliation', () => {
  const head = 'b'.repeat(40);
  const ctx = { issueId, projectPath: '/tmp/overdeck' };
  const contained = {
    id: 'merged' as const,
    num: 4,
    title: 'Merged to main',
    expected: 'merged',
    observed: 'contained strike',
    status: 'pass' as const,
    evidence: 'branch-containment' as const,
    containedStrikeHead: head,
  };

  it('records terminal strike verdicts through the canonical writer', async () => {
    const setStatus = vi.fn();
    await reconcileContainedStrike(ctx, contained, {
      getStatus: () => live({
        reviewStatus: 'pending', testStatus: 'pending', verificationStatus: undefined,
        strikeReadyHead: head, strikeReadyAt: '2026-08-13T00:00:00Z', strikeLandingState: 'needs_you',
      }),
      setStatus,
    });

    expect(setStatus).toHaveBeenCalledWith(issueId, expect.objectContaining({
      reviewStatus: 'passed', testStatus: 'passed', verificationStatus: 'passed',
      lastVerifiedCommit: head, mergeStatus: 'merged', strikeLandingState: 'landed',
      strikeReadyHead: undefined, strikeReadyAt: undefined,
    }));
  });

  it('requires readiness evidence tied to the contained head', async () => {
    const setStatus = vi.fn();
    await reconcileContainedStrike(ctx, contained, {
      getStatus: () => live({ strikeReadyHead: 'c'.repeat(40) }),
      setStatus,
    });
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('preserves every existing negative verdict', async () => {
    const setStatus = vi.fn();
    await reconcileContainedStrike(ctx, contained, {
      getStatus: () => live({
        reviewStatus: 'blocked', testStatus: 'failed', verificationStatus: 'failed', strikeReadyHead: head,
      }),
      setStatus,
    });
    const update = setStatus.mock.calls[0]?.[1];
    expect(update).not.toHaveProperty('reviewStatus');
    expect(update).not.toHaveProperty('testStatus');
    expect(update).not.toHaveProperty('verificationStatus');
  });

  it('does nothing for a normal PR-landed strike', async () => {
    const setStatus = vi.fn();
    await reconcileContainedStrike(ctx, { ...contained, evidence: undefined }, {
      getStatus: () => live({ strikeReadyHead: head }),
      setStatus,
    });
    expect(setStatus).not.toHaveBeenCalled();
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

  it('records a merged GitLab MR as branch-absence evidence', async () => {
    const row = await checkMergedRow({ issueId, projectPath: '/tmp/mind-your-now' }, {
      verifyMerged: async () => stepFailed('close-out:verify-merged', BRANCH_ABSENT_MERGE_ERROR),
      readPullRequest: async () => ({}),
      readDurableMerges: async () => [],
      readMergedForgeArtifacts: async () => [{
        forge: 'gitlab',
        id: '75',
        url: 'https://gitlab.com/acme/app/-/merge_requests/75',
      }],
    });

    expect(row.status).toBe('pass');
    expect(row.evidence).toBeUndefined();
    expect(row.observed).toContain('MR !75 merged (https://gitlab.com/acme/app/-/merge_requests/75)');
    expect(row.observed).not.toContain('non-PR landing');
    expect(row.observed).not.toContain('no merged forge artifact');
  });

  it('preserves MR details already returned by the merge verifier', async () => {
    const row = await checkMergedRow({ issueId, projectPath: '/tmp/mind-your-now' }, {
      verifyMerged: async () => stepOk('close-out:verify-merged', [
        'fe: MR !75 is merged and feature/min-908 matches the merged MR head',
      ]),
      readPullRequest: async () => ({}),
    });

    expect(row).toMatchObject({
      status: 'pass',
      observed: expect.stringContaining('MR !75'),
    });
  });

  it('keeps branch-containment evidence when no merged forge artifact exists', async () => {
    const row = await checkMergedRow({ issueId, projectPath: '/tmp/mind-your-now' }, {
      verifyMerged: async () => stepFailed('close-out:verify-merged', BRANCH_ABSENT_MERGE_ERROR),
      readPullRequest: async () => ({}),
      readDurableMerges: async () => [],
      readMergedForgeArtifacts: async () => [],
      readBranchContainment: async () => ({
        mergedWorkRefs: ['fe:feature/min-908'],
        unmergedRefs: [],
        pointerRefs: [],
      }),
    });

    expect(row.evidence).toBe('branch-containment');
    expect(row.observed).toContain('non-PR landing (membership L2-work lens): fe:feature/min-908');
  });

  it('carries the contained strike head as reconciliation evidence', async () => {
    const head = 'a'.repeat(40);
    const row = await checkMergedRow({ issueId, projectPath: '/tmp/overdeck' }, {
      verifyMerged: async () => stepFailed('close-out:verify-merged', BRANCH_ABSENT_MERGE_ERROR),
      readPullRequest: async () => ({}),
      readDurableMerges: async () => [],
      readBranchContainment: async () => ({
        mergedWorkRefs: [`/tmp/overdeck:strike/${issueId.toLowerCase()}`],
        mergedWorkHeads: [{ ref: `/tmp/overdeck:strike/${issueId.toLowerCase()}`, head }],
        unmergedRefs: [],
        pointerRefs: [],
      }),
    });

    expect(row).toMatchObject({ evidence: 'branch-containment', containedStrikeHead: head });
  });

  it('reports unavailable merged-forge evidence without throwing', async () => {
    const row = await checkMergedRow({ issueId, projectPath: '/tmp/mind-your-now' }, {
      verifyMerged: async () => stepFailed('close-out:verify-merged', BRANCH_ABSENT_MERGE_ERROR),
      readPullRequest: async () => ({}),
      readDurableMerges: async () => [],
      readMergedForgeArtifacts: async () => { throw new Error('glab unavailable'); },
      readBranchContainment: async () => ({ mergedWorkRefs: [], unmergedRefs: [], pointerRefs: [] }),
    });

    expect(row.status).toBe('miss');
    expect(row.observed).toContain('forge artifact evidence unavailable: glab unavailable');
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

  it('records containment evidence when git verification passes without a merged PR', async () => {
    const readBranchContainment = vi.fn(async () => ({
      mergedWorkRefs: ['frontend:feature/pan-2715'],
      unmergedRefs: [],
      pointerRefs: [],
    }));
    const row = await checkMergedRow(ctx, {
      verifyMerged: async () => stepOk('close-out:verify-merged', ['All commits merged to main']),
      readPullRequest: async () => ({}),
      readBranchContainment,
    });

    expect(row).toMatchObject({ status: 'pass', evidence: 'branch-containment' });
    expect(readBranchContainment).toHaveBeenCalledOnce();
  });

  it('does not record containment evidence when git verification passes with unmerged work', async () => {
    const row = await checkMergedRow(ctx, {
      verifyMerged: async () => stepOk('close-out:verify-merged', ['Remote branch fully merged']),
      readPullRequest: async () => ({}),
      readBranchContainment: async () => ({
        mergedWorkRefs: ['frontend:feature/pan-2715'],
        unmergedRefs: ['api:feature/pan-2715'],
        pointerRefs: [],
      }),
    });

    expect(row.status).toBe('pass');
    expect(row.evidence).toBeUndefined();
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

  // PAN-3188 (row 5): terminal canonical states settle the row — 'done' proves
  // the lifecycle already ran; 'canceled' makes it moot. Without this, every
  // re-evaluated terminal issue wedges on the transient verifying_on_main marker.
  it('passes on terminal canonical state done with no running agents', async () => {
    const row = await checkPostMergeRow(ctx, undefined, {
      readCanonicalState: async () => 'done',
      readMergeStatus: () => null,
      listAgents: clearAgents,
    });
    expect(row).toMatchObject({ status: 'pass', observed: expect.stringContaining('terminal canonical state: done') });
  });

  it('skips on terminal canonical state canceled', async () => {
    const row = await checkPostMergeRow(ctx, undefined, {
      readCanonicalState: async () => 'canceled',
      readMergeStatus: () => null,
      listAgents: clearAgents,
    });
    expect(row).toMatchObject({ status: 'skip', observed: expect.stringContaining('terminal canonical state: canceled') });
  });

  it('still misses on terminal state done while a work agent runs', async () => {
    const row = await checkPostMergeRow(ctx, undefined, {
      readCanonicalState: async () => 'done',
      readMergeStatus: () => null,
      listAgents: () => [{ id: 'agent-pan-2715', issueId, role: 'work', status: 'running' }],
    });
    expect(row).toMatchObject({ status: 'miss' });
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
  const required = ['test', 'lint', 'build (22)', 'guard'];
  const runs = (names: string[], successful: string[] = names) => ({
    total: names.length,
    names,
    successful,
    failed: names.filter(name => !successful.includes(name)),
    pending: [],
  });

  it('passes when every named required check is present and successful', async () => {
    const row = await checkMainVerifyRow(ctx, 'abc123', {
      readCheckRuns: async () => runs([...required, 'Mintlify Deployment']),
      readRequiredChecks: async () => required,
      readContainingDefaultBranchCommits: async () => { throw new Error('must not run'); },
    });

    expect(row).toMatchObject({ status: 'pass' });
    expect(row.observed).toContain('required checks concluded successfully on abc123: test, lint, build (22), guard');
  });

  it('misses when a named required check fails', async () => {
    const row = await checkMainVerifyRow(ctx, 'abc123', {
      readCheckRuns: async () => runs(required, required.filter(check => check !== 'test')),
      readRequiredChecks: async () => required,
      readContainingDefaultBranchCommits: async () => [],
    });

    expect(row).toMatchObject({ status: 'miss' });
    expect(row.observed).toContain('required checks not successful: test');
  });

  it('misses an absent required check when only Mintlify Deployment is present', async () => {
    const row = await checkMainVerifyRow(ctx, 'd20c97c4', {
      readCheckRuns: async () => runs(['Mintlify Deployment']),
      readRequiredChecks: async () => required,
      readContainingDefaultBranchCommits: async () => [],
    });

    expect(row).toMatchObject({ status: 'miss' });
    expect(row.observed).toContain('missing required checks on d20c97c4: test, lint, build (22), guard');
  });

  it('keeps the no-merge-commit skip path unchanged', async () => {
    const row = await checkMainVerifyRow(ctx, undefined, {
      readCheckRuns: async () => { throw new Error('must not run'); },
      readRequiredChecks: async () => { throw new Error('must not run'); },
      readContainingDefaultBranchCommits: async () => { throw new Error('must not run'); },
    });

    expect(row).toMatchObject({ status: 'skip', observed: expect.stringContaining('no merge commit resolvable') });
  });

  it('turns check-run read failures into an observed miss', async () => {
    const row = await checkMainVerifyRow(ctx, 'abc123', {
      readCheckRuns: async () => { throw new Error('rate limited'); },
      readRequiredChecks: async () => required,
      readContainingDefaultBranchCommits: async () => [],
    });
    expect(row).toMatchObject({ status: 'miss', observed: expect.stringContaining('rate limited') });
  });

  // PAN-3202: a merge that lands inside a red-main window can never green its own
  // checks, so a later green default-branch head containing it is accepted.
  it('passes on a later default-branch run with every required check green', async () => {
    const checkRuns = new Map([
      ['mergecommit', runs(required, required.filter(check => check !== 'test'))],
      ['tip', runs(required, required.filter(check => check !== 'test'))],
      ['greenhead', runs(required)],
    ]);
    const row = await checkMainVerifyRow(ctx, 'mergecommit', {
      readCheckRuns: async (_ctx, commit) => checkRuns.get(commit) ?? runs([]),
      readRequiredChecks: async () => required,
      readContainingDefaultBranchCommits: async () => ['tip', 'greenhead'],
    });
    expect(row).toMatchObject({ status: 'pass' });
    expect(row.observed).toContain('required checks not successful: test');
    expect(row.observed).toContain('verified on main by later green CI run greenhead containing the merge');
  });

  it('finds first-parent default-branch candidates when a batch merge arrives through a promote commit second parent', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'pan-3628-dod-gate-'));
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf-8' }).trim();
    const commit = (message: string) => {
      git(['add', '-A']);
      git(['commit', '--quiet', '-m', message]);
      return git(['rev-parse', 'HEAD']);
    };

    try {
      git(['init', '--quiet', '-b', 'main']);
      git(['config', 'user.email', 'test@example.com']);
      git(['config', 'user.name', 'Test']);
      writeFileSync(join(repo, 'history.txt'), 'base\n', 'utf-8');
      commit('base');

      git(['checkout', '--quiet', '-b', 'feature/pan-3628']);
      writeFileSync(join(repo, 'history.txt'), 'feature\n', 'utf-8');
      const featureCommit = commit('feature work');

      git(['checkout', '--quiet', '-b', 'uat/pan-3628', 'main']);
      git(['merge', '--quiet', '--no-ff', 'feature/pan-3628', '-m', 'batch merge']);
      const batchMerge = git(['rev-parse', 'HEAD']);

      git(['checkout', '--quiet', 'main']);
      git(['merge', '--quiet', '--no-ff', 'uat/pan-3628', '-m', 'promote batch']);
      const promoteCommit = git(['rev-parse', 'HEAD']);
      writeFileSync(join(repo, 'history.txt'), 'post-promote\n', 'utf-8');
      const laterMainCommit = commit('post-promote main commit');
      git(['update-ref', 'refs/remotes/origin/main', laterMainCommit]);

      const fixtureCtx = { ...ctx, projectPath: repo };
      expect(await readContainingDefaultBranchCommits(fixtureCtx, batchMerge))
        .toEqual([laterMainCommit, promoteCommit]);

      const probed: string[] = [];
      const checkRuns = new Map([
        [batchMerge, runs(required, required.filter(check => check !== 'test'))],
        [laterMainCommit, runs(required, required.filter(check => check !== 'test'))],
        [promoteCommit, runs(required)],
      ]);
      const row = await checkMainVerifyRow(fixtureCtx, batchMerge, {
        readCheckRuns: async (_ctx, commitSha) => {
          probed.push(commitSha);
          return checkRuns.get(commitSha) ?? runs([]);
        },
        readRequiredChecks: async () => required,
      });

      expect(probed).toEqual([batchMerge, laterMainCommit, promoteCommit]);
      expect(probed).not.toContain(featureCommit);
      expect(row).toMatchObject({ status: 'pass' });
      expect(row.observed).toContain(`verified on main by later green CI run ${promoteCommit} containing the merge`);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('probes at most the five newest containing commits', async () => {
    const probed: string[] = [];
    const row = await checkMainVerifyRow(ctx, 'mergecommit', {
      readCheckRuns: async (_ctx, commit) => {
        if (commit !== 'mergecommit') probed.push(commit);
        return runs(required, []);
      },
      readRequiredChecks: async () => required,
      readContainingDefaultBranchCommits: async () =>
        Array.from({ length: 9 }, (_unused, index) => `head-${index}`),
    });
    expect(probed).toEqual(['head-0', 'head-1', 'head-2', 'head-3', 'head-4']);
    expect(row).toMatchObject({ status: 'miss' });
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

  it('skips before reading dashboard health when the merged row passed without a merge commit and main-verify skipped (PAN-3188)', async () => {
    const dashboardUrl = vi.fn(baseDeps.dashboardUrl);
    const readJson = vi.fn(baseDeps.readJson);
    const commitContains = vi.fn(baseDeps.commitContains);
    const row = await checkDeployRow(ctx, { mergedRowStatus: 'pass', mainVerifyRowStatus: 'skip' }, {
      dashboardUrl,
      readJson,
      commitContains,
    });

    expect(row).toMatchObject({
      status: 'skip',
      observed: expect.stringContaining('no merge commit resolvable'),
    });
    expect(dashboardUrl).not.toHaveBeenCalled();
    expect(readJson).not.toHaveBeenCalled();
    expect(commitContains).not.toHaveBeenCalled();
  });

  it('still misses when the merged row passed without a merge commit but main-verify did not skip', async () => {
    const dashboardUrl = vi.fn(baseDeps.dashboardUrl);
    const readJson = vi.fn(baseDeps.readJson);
    const commitContains = vi.fn(baseDeps.commitContains);
    const row = await checkDeployRow(ctx, { mergedRowStatus: 'pass', mainVerifyRowStatus: 'pass' }, {
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
    ship: async () => makeRow('ship', 'skip'),
    deploy: async (_ctx: unknown, merge: {
      mergedAt?: string;
      mergeCommit?: string;
      mergedRowStatus?: DodRowResult['status'];
      mainVerifyRowStatus?: DodRowResult['status'];
    }) => {
      expect(merge).toEqual({
        mergedAt: '2026-07-15T12:00:00Z',
        mergeCommit: 'abc123',
        mergedRowStatus: 'pass',
        mainVerifyRowStatus: 'pass',
      });
      return makeRow('deploy', deployStatus);
    },
    trackerClosed: async () => false,
    now: () => '2026-07-15T13:00:00Z',
  });

  it('runs rows one through eight in canonical order and passes a green gate', async () => {
    const gate = await evaluateDodGate(ctx, {}, deps());
    expect(gate.passed).toBe(true);
    expect(gate.rows.map(row => row.id)).toEqual(DOD_ROWS.slice(0, 8).map(row => row.id));
  });

  it('computes landed and main-verify evidence before passing terminal settlement to verdict rows', async () => {
    const calls: string[] = [];
    const review = vi.fn(async (_issueId: string, settlement?: unknown) => {
      calls.push('review');
      expect(settlement).toEqual({ trackerClosed: true, landedWork: true, mainVerifyStatus: 'pass' });
      return makeRow('review', 'skip');
    });
    const gate = await evaluateDodGate(ctx, {}, {
      review,
      tests: async (_issueId: string, settlement?: unknown) => {
        expect(settlement).toEqual({ trackerClosed: true, landedWork: true, mainVerifyStatus: 'pass' });
        return makeRow('tests', 'skip');
      },
      verification: async (_issueId: string, settlement?: unknown) => {
        expect(settlement).toEqual({ trackerClosed: true, landedWork: true, mainVerifyStatus: 'pass' });
        return makeRow('verification', 'skip');
      },
      merged: async () => {
        calls.push('merged');
        return { ...makeRow('merged'), mergeCommit: 'abc123' };
      },
      postMerge: async () => makeRow('post-merge'),
      mainVerify: async () => {
        calls.push('main-verify');
        return makeRow('main-verify');
      },
      ship: async () => makeRow('ship', 'skip'),
      trackerClosed: async () => {
        calls.push('tracker-closed');
        return true;
      },
      deploy: async () => makeRow('deploy'),
      now: () => '2026-07-15T13:00:00Z',
    });

    expect(calls.slice(0, 3)).toEqual(['merged', 'main-verify', 'tracker-closed']);
    expect(review).toHaveBeenCalledTimes(1);
    expect(gate.rows.slice(0, 3).map(row => row.status)).toEqual(['skip', 'skip', 'skip']);
  });

  it('does not settle verdict rows from terminal shadow state while the tracker is open', async () => {
    vi.clearAllMocks();
    issueClosureMocks.isIssueClosed.mockResolvedValue(true);
    issueClosureMocks.isTrackerIssueClosed.mockResolvedValue(false);
    const settlements: unknown[] = [];
    const verdictRow = (id: 'review' | 'tests' | 'verification') =>
      async (_issueId: string, settlement?: unknown) => {
        settlements.push(settlement);
        return makeRow(id, 'miss');
      };

    const gate = await evaluateDodGate(ctx, {}, {
      review: verdictRow('review'),
      tests: verdictRow('tests'),
      verification: verdictRow('verification'),
      merged: async () => ({ ...makeRow('merged'), mergeCommit: 'abc123' }),
      postMerge: async () => makeRow('post-merge'),
      mainVerify: async () => makeRow('main-verify'),
      ship: async () => makeRow('ship', 'skip'),
      deploy: async () => makeRow('deploy'),
      now: () => '2026-07-15T13:00:00Z',
    });

    expect(issueClosureMocks.isTrackerIssueClosed).toHaveBeenCalledWith(issueId);
    expect(issueClosureMocks.isIssueClosed).not.toHaveBeenCalled();
    expect(settlements).toEqual(Array(3).fill({
      trackerClosed: false,
      landedWork: true,
      mainVerifyStatus: 'pass',
    }));
    expect(gate.misses).toEqual(['review', 'tests', 'verification']);
  });

  // PAN-3188: a landing with no resolvable merge commit must skip row 7 when
  // row 6 skips — the GitLab-backed landing class that wedged six MYN close-outs.
  it('passes main-verify status into deploy so a no-commit landing skips both rows', async () => {
    const deploySpy = vi.fn(async () => makeRow('deploy', 'skip'));
    const gate = await evaluateDodGate(ctx, {}, {
      review: async () => makeRow('review'),
      tests: async () => makeRow('tests'),
      verification: async () => makeRow('verification'),
      merged: async () => ({ ...makeRow('merged'), mergedAt: '2026-07-15T12:00:00Z' }),
      postMerge: async () => makeRow('post-merge'),
      mainVerify: async () => makeRow('main-verify', 'skip'),
      ship: async () => makeRow('ship', 'skip'),
      trackerClosed: async () => false,
      deploy: deploySpy,
      now: () => '2026-07-15T13:00:00Z',
    });
    expect(deploySpy).toHaveBeenCalledWith(ctx, expect.objectContaining({
      mergedRowStatus: 'pass',
      mainVerifyRowStatus: 'skip',
      mergeCommit: undefined,
    }));
    expect(gate.rows.map(row => [row.id, row.status])).toEqual([
      ['review', 'pass'], ['tests', 'pass'], ['verification', 'pass'], ['merged', 'pass'],
      ['post-merge', 'pass'], ['main-verify', 'skip'], ['ship', 'skip'], ['deploy', 'skip'],
    ]);
    expect(gate.passed).toBe(true);
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

  it('resolves post-merge when git verification passes for a contained branch without a merged PR', async () => {
    const nonPrCtx = {
      issueId: 'PAN-3702',
      projectPath: '/overdeck',
      github: { owner: 'eltmon', repo: 'overdeck', number: 3702 },
    };
    const merged = await checkMergedRow(nonPrCtx, {
      verifyMerged: async () => stepOk('close-out:verify-merged', ['Remote branch fully merged']),
      readPullRequest: async () => ({}),
      readBranchContainment: async () => ({
        mergedWorkRefs: ['overdeck:feature/pan-3702'],
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
      ship: async () => makeRow('ship', 'skip'),
      trackerClosed: async () => false,
      deploy: async () => makeRow('deploy', 'skip'),
      now: () => '2026-07-15T13:00:00Z',
    });

    expect(gate.misses).toEqual(['review', 'tests', 'verification']);
    expect(gate.rows.find(row => row.id === 'merged')).toMatchObject({
      status: 'pass',
      evidence: 'branch-containment',
    });
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
      ship: async () => makeRow('ship', 'skip'),
      trackerClosed: async () => false,
      deploy: async () => makeRow('deploy'),
      now: () => '2026-07-26T23:00:00Z',
    });

    expect(gate).toMatchObject({ passed: true, misses: [], accepted: [] });
    // Row 8 is appended by the close-out workflow once teardown succeeds; the gate
    // itself owns rows 1–7, and none of them may be a silent pass for a strike.
    expect(gate.rows).toHaveLength(DOD_ROWS.length - 1);
    expect(gate.rows.filter(row => row.status === 'skip').map(row => row.id)).toEqual(['review', 'tests', 'post-merge', 'ship']);
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
