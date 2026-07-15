import { describe, expect, it } from 'vitest';
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
import { DOD_ROWS, type DodRowId, type DodRowResult } from '../../../../src/lib/lifecycle/dod.js';
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

describe('Definition-of-Done deploy row', () => {
  const ctx = { issueId, projectPath: '/repo/overdeck' };
  const merge = { mergedAt: '2026-07-15T12:00:00Z', mergeCommit: 'abcdef123456' };
  const baseDeps = {
    dashboardUrl: () => 'http://localhost:3011',
    readJson: async (url: string) => url.endsWith('/api/health')
      ? { repoRoot: '/repo/overdeck' }
      : {},
    commitContains: async () => true,
    serverStartedAt: async () => new Date('2026-07-15T12:02:00Z'),
    distMtime: async () => new Date('2026-07-15T12:01:00Z'),
  };

  it('passes when the live build commit contains the merge commit', async () => {
    const row = await checkDeployRow(ctx, merge, {
      ...baseDeps,
      readJson: async url => url.endsWith('/api/health')
        ? { repoRoot: '/repo/overdeck' }
        : { buildCommit: 'fedcba654321' },
      commitContains: async (repoRoot, mergeCommit, buildCommit) => {
        expect([repoRoot, mergeCommit, buildCommit]).toEqual(['/repo/overdeck', 'abcdef123456', 'fedcba654321']);
        return true;
      },
    });
    expect(row).toMatchObject({ status: 'pass', observed: 'build commit fedcba65 contains merge abcdef12' });
  });

  it('misses when the live build does not contain the merge', async () => {
    const row = await checkDeployRow(ctx, merge, {
      ...baseDeps,
      readJson: async url => url.endsWith('/api/health')
        ? { repoRoot: '/repo/overdeck' }
        : { commit: 'fedcba654321' },
      commitContains: async () => false,
    });
    expect(row).toMatchObject({ status: 'miss', observed: expect.stringContaining('does not contain') });
  });

  it('uses timestamp evidence only when both process and build are newer than the merge', async () => {
    const fresh = await checkDeployRow(ctx, merge, baseDeps);
    const staleProcess = await checkDeployRow(ctx, merge, {
      ...baseDeps,
      serverStartedAt: async () => new Date('2026-07-15T11:59:00Z'),
    });
    const staleDist = await checkDeployRow(ctx, merge, {
      ...baseDeps,
      distMtime: async () => new Date('2026-07-15T11:58:00Z'),
    });
    expect(fresh).toMatchObject({ status: 'pass', observed: expect.stringContaining('best-effort') });
    expect(fresh.observed).toContain('PAN-2713');
    expect(staleProcess).toMatchObject({ status: 'miss', observed: expect.stringContaining('11:59:00.000Z') });
    expect(staleDist).toMatchObject({ status: 'miss', observed: expect.stringContaining('11:58:00.000Z') });
  });

  it('skips another project and misses an unreachable dashboard', async () => {
    const otherProject = await checkDeployRow(ctx, merge, {
      ...baseDeps,
      readJson: async () => ({ repoRoot: '/repo/other' }),
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
    deploy: async (_ctx: unknown, merge: { mergedAt?: string; mergeCommit?: string }) => {
      expect(merge).toEqual({ mergedAt: '2026-07-15T12:00:00Z', mergeCommit: 'abc123' });
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

  it('rejects unknown and non-overridable acceptance rows', async () => {
    await expect(evaluateDodGate(ctx, { acceptedRows: ['teardown'] }, deps())).rejects.toThrow(TypeError);
    await expect(evaluateDodGate(ctx, { acceptedRows: ['unknown' as DodRowId] }, deps())).rejects.toThrow(TypeError);
  });
});
