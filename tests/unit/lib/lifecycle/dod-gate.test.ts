import { describe, expect, it } from 'vitest';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';
import type { PanIssuePipelineRecord } from '../../../../src/lib/pan-dir/record.js';
import {
  checkMergedRow,
  checkMainVerifyRow,
  checkPostMergeRow,
  checkReviewRow,
  checkTestsRow,
  checkVerificationRow,
  type DodStatusRowDeps,
} from '../../../../src/lib/lifecycle/dod-gate.js';
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
    readyForMerge: true,
    updatedAt: '2026-07-15T00:00:00Z',
    ...overrides,
  };
}

function deps(status: ReviewStatus | null, pipeline: PanIssuePipelineRecord | null = null): DodStatusRowDeps {
  return { getReviewStatus: () => status, getJournalStatus: () => pipeline };
}

describe('Definition-of-Done status rows', () => {
  it('passes live review, test, and verified-commit verdicts', () => {
    const source = deps(live());
    expect(checkReviewRow(issueId, source)).toMatchObject({ status: 'pass', observed: 'reviewStatus: passed' });
    expect(checkTestsRow(issueId, source)).toMatchObject({ status: 'pass', observed: 'testStatus: passed' });
    expect(checkVerificationRow(issueId, source)).toMatchObject({ status: 'pass', observed: 'verificationStatus: passed at abc123' });
  });

  it('treats skipped verdicts as policy-approved passes', () => {
    const source = deps(live({ reviewStatus: 'skipped', testStatus: 'skipped', verificationStatus: 'skipped' }));
    for (const row of [checkReviewRow(issueId, source), checkTestsRow(issueId, source), checkVerificationRow(issueId, source)]) {
      expect(row.status).toBe('pass');
      expect(row.observed).toContain('skipped per issue policy');
    }
  });

  it('reports the actual non-passing verdict', () => {
    const source = deps(live({ reviewStatus: 'failed', testStatus: 'pending', verificationStatus: 'failed' }));
    expect(checkReviewRow(issueId, source)).toMatchObject({ status: 'miss', observed: 'reviewStatus: failed' });
    expect(checkTestsRow(issueId, source)).toMatchObject({ status: 'miss', observed: 'testStatus: pending' });
    expect(checkVerificationRow(issueId, source)).toMatchObject({ status: 'miss', observed: 'verificationStatus: failed at abc123' });
  });

  it('requires a commit for a passed live verification verdict', () => {
    expect(checkVerificationRow(issueId, deps(live({ lastVerifiedCommit: undefined })))).toMatchObject({
      status: 'miss',
      observed: 'verificationStatus: passed',
    });
  });

  it('falls back to durable pipeline journal verdicts after live status is cleared', () => {
    const source = deps(null, journal());
    for (const row of [checkReviewRow(issueId, source), checkTestsRow(issueId, source), checkVerificationRow(issueId, source)]) {
      expect(row.status).toBe('pass');
      expect(row.observed).toContain('from pipeline journal');
    }
  });

  it('returns misses instead of throwing when both sources are empty or a door fails', () => {
    const empty = deps(null);
    const failing: DodStatusRowDeps = {
      getReviewStatus: () => { throw new Error('database unavailable'); },
      getJournalStatus: () => { throw new Error('journal unavailable'); },
    };
    for (const source of [empty, failing]) {
      for (const row of [checkReviewRow(issueId, source), checkTestsRow(issueId, source), checkVerificationRow(issueId, source)]) {
        expect(row).toMatchObject({ status: 'miss', observed: 'no review status or journal record found' });
      }
    }
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
});

describe('Definition-of-Done post-merge row', () => {
  const ctx = {
    issueId,
    projectPath: '/tmp/overdeck',
    github: { owner: 'eltmon', repo: 'overdeck', number: 2715 },
  };
  const clearAgents = () => [];

  it('passes when the issue is verifying on main and issue agents are stopped', async () => {
    const row = await checkPostMergeRow(ctx, {
      readCanonicalState: async () => 'verifying_on_main',
      readMergeStatus: () => 'merged',
      listAgents: clearAgents,
    });
    expect(row).toMatchObject({ status: 'pass', observed: expect.stringContaining('no running work/planning agents') });
  });

  it('misses and names running work or planning agents', async () => {
    const row = await checkPostMergeRow(ctx, {
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
    const row = await checkPostMergeRow(ctx, {
      readCanonicalState: async () => 'in_review',
      readMergeStatus: () => 'verifying',
      listAgents: clearAgents,
    });
    expect(row).toMatchObject({ status: 'miss', observed: expect.stringContaining('canonical state: in_review') });
  });

  it('turns canonical-state probe failures into an observed miss', async () => {
    const row = await checkPostMergeRow(ctx, {
      readCanonicalState: async () => { throw new Error('gh timed out'); },
      readMergeStatus: () => 'merged',
      listAgents: clearAgents,
    });
    expect(row).toMatchObject({ status: 'miss', observed: expect.stringContaining('gh timed out') });
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
