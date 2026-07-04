import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const projectMock = vi.hoisted(() => ({
  current: {
    name: 'Overdeck',
    path: '/repo',
    github_repo: 'eltmon/overdeck',
  },
}));

vi.mock('../../projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../projects.js')>();
  return {
    ...actual,
    loadProjectsConfigSync: () => ({ projects: { overdeck: projectMock.current } }),
    resolveProjectFromIssueSync: () => ({ projectKey: 'overdeck', projectPath: projectMock.current.path }),
    getProjectSync: () => projectMock.current,
  };
});

import { reconcileMergeFulfillment, reconcileMergedIssue, verifyIssueMergeFulfillment, type MergeFulfillmentDeps } from '../merge-fulfillment.js';
import type { ProjectConfig } from '../../projects.js';
import type { PanIssueRecord } from '../record.js';

const project = projectMock.current as ProjectConfig;

function record(overrides: Partial<PanIssueRecord['pipeline']> = {}): PanIssueRecord {
  return {
    issueId: 'PAN-123',
    schemaVersion: 2,
    pipeline: {
      issueId: 'PAN-123',
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'pending',
      readyForMerge: false,
      updatedAt: '2026-07-03T00:00:00.000Z',
      ...overrides,
    },
    closeOut: {
      usage: { byStage: {}, totals: {} },
      merges: [],
      ranOn: 'test',
    },
  };
}

function makeDeps(options: {
  record?: PanIssueRecord | null;
  existingBranches?: string[];
  mergedBranches?: string[];
  prMerged?: boolean;
  prError?: boolean;
  issueState?: 'OPEN' | 'CLOSED';
  appConfigured?: boolean;
} = {}): MergeFulfillmentDeps & { commands: string[]; setReviewStatus: ReturnType<typeof vi.fn>; cleanupMergedLabels: ReturnType<typeof vi.fn> } {
  const commands: string[] = [];
  return {
    commands,
    readRecord: () => options.record ?? record(),
    setReviewStatus: vi.fn(),
    cleanupMergedLabels: vi.fn(async () => ({ step: 'label-cleanup:merged', success: true, skipped: false, details: [] })),
    isGitHubAppConfigured: () => options.appConfigured === true,
    getPullRequestState: vi.fn(async () => ({ merged: options.prMerged === true, state: options.prMerged ? 'CLOSED' : 'OPEN' })),
    exec: vi.fn(async (command: string) => {
      commands.push(command);
      if (command.startsWith('gh pr view')) {
        if (options.prError) {
          throw new Error('gh unavailable');
        }
        return {
          stdout: JSON.stringify({
            merged: options.prMerged === true,
            mergedAt: options.prMerged ? '2026-07-03T00:00:00Z' : null,
            mergeCommit: options.prMerged ? { oid: 'abc123' } : null,
            state: options.prMerged ? 'MERGED' : 'OPEN',
          }),
          stderr: '',
        };
      }
      if (command.startsWith('gh issue view')) {
        return { stdout: JSON.stringify({ state: options.issueState ?? 'CLOSED' }), stderr: '' };
      }
      if (command.startsWith('git rev-parse --verify')) {
        const branch = command.match(/'([^']+)'/)?.[1];
        if (branch && options.existingBranches?.includes(branch)) return { stdout: `${branch}\n`, stderr: '' };
        throw Object.assign(new Error('not found'), { code: 1 });
      }
      if (command.startsWith('git merge-base --is-ancestor')) {
        const branch = command.match(/'([^']+)'/)?.[1];
        if (branch && options.mergedBranches?.includes(branch)) return { stdout: '', stderr: '' };
        throw Object.assign(new Error('not ancestor'), { code: 1 });
      }
      if (command.startsWith('git branch -D') || command.startsWith('git push origin --delete')) {
        return { stdout: '', stderr: '' };
      }
      if (command.startsWith('gh label create') || command.startsWith('gh issue edit')) {
        return { stdout: '', stderr: '' };
      }
      throw new Error(`unexpected command: ${command}`);
    }),
  };
}

function writeTempRecord(tempRoot: string, issueId: string, value: PanIssueRecord): void {
  const recordsDir = join(tempRoot, '.pan', 'records');
  mkdirSync(recordsDir, { recursive: true });
  writeFileSync(join(recordsDir, `${issueId.toLowerCase()}.json`), JSON.stringify(value), 'utf-8');
}

describe('verifyIssueMergeFulfillment', () => {
  it('returns merged with branch evidence when feature branch is an ancestor of origin/main', async () => {
    const deps = makeDeps({
      existingBranches: ['feature/pan-123'],
      mergedBranches: ['feature/pan-123'],
    });

    await expect(verifyIssueMergeFulfillment('PAN-123', project, deps)).resolves.toEqual({
      verdict: 'merged',
      evidence: 'feature/pan-123 is an ancestor of origin/main',
    });
  });

  it.each(['origin/feature/pan-123', 'origin/strike/pan-123'])('returns merged when only %s is an ancestor of origin/main', async (branch) => {
    const deps = makeDeps({
      existingBranches: [branch],
      mergedBranches: [branch],
    });

    await expect(verifyIssueMergeFulfillment('PAN-123', project, deps)).resolves.toEqual({
      verdict: 'merged',
      evidence: `${branch} is an ancestor of origin/main`,
    });
  });

  it('returns merged with PR evidence when the tracked PR reports merged', async () => {
    const deps = makeDeps({
      record: record({ prUrl: 'https://github.com/eltmon/overdeck/pull/123', prNumber: 123 }),
      prMerged: true,
    });

    await expect(verifyIssueMergeFulfillment('PAN-123', project, deps)).resolves.toEqual({
      verdict: 'merged',
      evidence: 'PAN-123 PR #123 reports merged via gh',
    });
  });

  it('continues to branch evidence when tracked PR state cannot be resolved', async () => {
    const deps = makeDeps({
      record: record({ prUrl: 'https://github.com/eltmon/overdeck/pull/123', prNumber: 123 }),
      prError: true,
      existingBranches: ['feature/pan-123'],
      mergedBranches: ['feature/pan-123'],
    });

    await expect(verifyIssueMergeFulfillment('PAN-123', project, deps)).resolves.toEqual({
      verdict: 'merged',
      evidence: 'feature/pan-123 is an ancestor of origin/main',
    });
  });

  it('returns unknown instead of stranded when PR lookup fails and the branch is unmerged', async () => {
    const deps = makeDeps({
      record: record({ prUrl: 'https://github.com/eltmon/overdeck/pull/123', prNumber: 123 }),
      prError: true,
      existingBranches: ['feature/pan-123'],
      mergedBranches: [],
    });

    await expect(verifyIssueMergeFulfillment('PAN-123', project, deps)).resolves.toEqual({
      verdict: 'unknown',
      evidence: 'PAN-123 PR #123 state could not be resolved via gh: gh unavailable',
    });
  });

  it('returns stranded when a branch exists but is not an ancestor of origin/main', async () => {
    const deps = makeDeps({
      existingBranches: ['strike/pan-123'],
      mergedBranches: [],
    });

    await expect(verifyIssueMergeFulfillment('PAN-123', project, deps)).resolves.toEqual({
      verdict: 'stranded',
      evidence: 'PAN-123 has a branch that is not an ancestor of origin/main and no merged PR was found',
    });
  });

  it('does not use incidental git log mentions as merge evidence', async () => {
    const deps = makeDeps();

    const result = await verifyIssueMergeFulfillment('PAN-123', project, deps);

    expect(result).toEqual({
      verdict: 'unknown',
      evidence: 'PAN-123 has no resolvable merged PR and no feature/strike branch',
    });
    expect(deps.commands.join('\n')).not.toContain('git log');
  });
});

describe('reconcileMergeFulfillment', () => {
  it('dry-runs a fulfilled merge for a single issue without writing', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'merge-fulfillment-'));
    const previousPath = projectMock.current.path;
    projectMock.current.path = tempRoot;
    try {
      writeTempRecord(tempRoot, 'PAN-123', record({ prUrl: 'https://github.com/eltmon/overdeck/pull/123', prNumber: 123 }));
      const deps = makeDeps({ prMerged: true });

      const result = await reconcileMergeFulfillment({ issueId: 'PAN-123', dryRun: true }, deps);

      expect(result).toEqual({
        reconciled: 1,
        flagged: 0,
        skipped: 0,
        failed: 0,
        details: [{
          issueId: 'PAN-123',
          action: 'would-reconcile',
          verdict: 'merged',
          evidence: 'PAN-123 PR #123 reports merged via gh',
        }],
      });
      expect(deps.setReviewStatus).not.toHaveBeenCalled();
      expect(deps.cleanupMergedLabels).not.toHaveBeenCalled();
    } finally {
      projectMock.current.path = previousPath;
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('skips fulfilled merge reconciliation when the issue is still open', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'merge-fulfillment-'));
    const previousPath = projectMock.current.path;
    projectMock.current.path = tempRoot;
    try {
      writeTempRecord(tempRoot, 'PAN-123', record({ prUrl: 'https://github.com/eltmon/overdeck/pull/123', prNumber: 123 }));
      const deps = makeDeps({ prMerged: true, issueState: 'OPEN' });

      const result = await reconcileMergeFulfillment({ issueId: 'PAN-123' }, deps);

      expect(result).toEqual({
        reconciled: 0,
        flagged: 0,
        skipped: 1,
        failed: 0,
        details: [{
          issueId: 'PAN-123',
          action: 'skipped',
          reason: 'issue is not closed',
        }],
      });
      expect(deps.setReviewStatus).not.toHaveBeenCalled();
      expect(deps.cleanupMergedLabels).not.toHaveBeenCalled();
    } finally {
      projectMock.current.path = previousPath;
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('flags stranded single-issue records without reconciling them', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'merge-fulfillment-'));
    const previousPath = projectMock.current.path;
    projectMock.current.path = tempRoot;
    try {
      writeTempRecord(tempRoot, 'PAN-123', record());
      const deps = makeDeps({
        existingBranches: ['feature/pan-123'],
        mergedBranches: [],
      });

      const result = await reconcileMergeFulfillment({ issueId: 'PAN-123' }, deps);

      expect(result.reconciled).toBe(0);
      expect(result.flagged).toBe(1);
      expect(result.details[0]).toEqual({
        issueId: 'PAN-123',
        action: 'flagged',
        verdict: 'stranded',
        evidence: 'PAN-123 has a branch that is not an ancestor of origin/main and no merged PR was found',
        reason: 'stranded: PAN-123 has a branch that is not an ancestor of origin/main and no merged PR was found',
      });
      expect(deps.setReviewStatus).not.toHaveBeenCalled();
      expect(deps.cleanupMergedLabels).not.toHaveBeenCalled();
    } finally {
      projectMock.current.path = previousPath;
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('reconcileMergedIssue', () => {
  it('persists merged review status and applies merged plus closed-out labels', async () => {
    const deps = makeDeps({ existingBranches: [], mergedBranches: [] });

    const result = await reconcileMergedIssue('PAN-123', project, { closed: true }, deps);

    expect(deps.setReviewStatus).toHaveBeenCalledWith('PAN-123', {
      mergeStatus: 'merged',
      reviewStatus: 'passed',
      readyForMerge: false,
    });
    expect(deps.cleanupMergedLabels).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-123',
      projectPath: '/repo',
      github: { owner: 'eltmon', repo: 'overdeck', number: 123 },
    }));
    expect(deps.commands).toContain("gh label create 'closed-out' --repo 'eltmon/overdeck' --color '1d4ed8' --description 'Verified and closed out' --force");
    expect(deps.commands).toContain("gh issue edit 123 --repo 'eltmon/overdeck' --add-label 'closed-out'");
    expect(result.actions).toEqual(expect.arrayContaining([
      'set mergeStatus=merged, reviewStatus=passed, readyForMerge=false',
      'applied merged label',
      'applied closed-out label to PAN-123',
    ]));
  });

  it('deletes only feature and strike branches that are ancestors of origin/main', async () => {
    const deps = makeDeps({
      existingBranches: ['feature/pan-123', 'strike/pan-123'],
      mergedBranches: ['feature/pan-123'],
    });

    const result = await reconcileMergedIssue('PAN-123', project, {}, deps);

    expect(deps.commands).toContain("git branch -D 'feature/pan-123'");
    expect(deps.commands).toContain("git push origin --delete 'feature/pan-123'");
    expect(deps.commands).not.toContain("git branch -D 'strike/pan-123'");
    expect(deps.commands).not.toContain("git push origin --delete 'strike/pan-123'");
    expect(result.branchActions).toEqual([
      { branch: 'feature/pan-123', status: 'deleted', reason: 'branch is an ancestor of origin/main' },
      { branch: 'strike/pan-123', status: 'kept', reason: 'branch is not an ancestor of origin/main' },
      { branch: 'origin/feature/pan-123', status: 'missing', reason: 'branch was not found' },
      { branch: 'origin/strike/pan-123', status: 'missing', reason: 'branch was not found' },
    ]);
  });

  it('deletes a merged remote-only feature branch without deleting a local branch', async () => {
    const deps = makeDeps({
      existingBranches: ['origin/feature/pan-123'],
      mergedBranches: ['origin/feature/pan-123'],
    });

    const result = await reconcileMergedIssue('PAN-123', project, {}, deps);

    expect(deps.commands).not.toContain("git branch -D 'origin/feature/pan-123'");
    expect(deps.commands).toContain("git push origin --delete 'feature/pan-123'");
    expect(result.branchActions).toEqual([
      { branch: 'feature/pan-123', status: 'missing', reason: 'branch was not found' },
      { branch: 'strike/pan-123', status: 'missing', reason: 'branch was not found' },
      { branch: 'origin/feature/pan-123', status: 'deleted', reason: 'branch is an ancestor of origin/main' },
      { branch: 'origin/strike/pan-123', status: 'missing', reason: 'branch was not found' },
    ]);
  });

  it('does not write when the issue record is already merged and no label repair is requested', async () => {
    const deps = makeDeps({ record: record({ mergeStatus: 'merged' }) });

    const result = await reconcileMergedIssue('PAN-123', project, {}, deps);

    expect(result).toEqual({
      issueId: 'PAN-123',
      dryRun: false,
      skipped: true,
      actions: ['skipped: record already has mergeStatus=merged'],
      branchActions: [],
    });
    expect(deps.setReviewStatus).not.toHaveBeenCalled();
    expect(deps.cleanupMergedLabels).not.toHaveBeenCalled();
    expect(deps.commands).toEqual([]);
  });

  it('repairs labels for an already merged record when closed-out labeling is requested', async () => {
    const deps = makeDeps({ record: record({ mergeStatus: 'merged' }) });

    const result = await reconcileMergedIssue('PAN-123', project, { closed: true }, deps);

    expect(deps.setReviewStatus).not.toHaveBeenCalled();
    expect(deps.cleanupMergedLabels).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-123',
      projectPath: '/repo',
      github: { owner: 'eltmon', repo: 'overdeck', number: 123 },
    }));
    expect(deps.commands).toContain("gh issue edit 123 --repo 'eltmon/overdeck' --add-label 'closed-out'");
    expect(result.skipped).toBe(false);
    expect(result.actions).toEqual(expect.arrayContaining([
      'skipped status update: record already has mergeStatus=merged',
      'applied merged label',
      'applied closed-out label to PAN-123',
    ]));
  });

  it('dry-runs without writing status, labels, or branch deletes', async () => {
    const deps = makeDeps({
      existingBranches: ['feature/pan-123', 'strike/pan-123'],
      mergedBranches: ['feature/pan-123'],
    });

    const result = await reconcileMergedIssue('PAN-123', project, { closed: true, dryRun: true }, deps);

    expect(deps.setReviewStatus).not.toHaveBeenCalled();
    expect(deps.cleanupMergedLabels).not.toHaveBeenCalled();
    expect(deps.commands).not.toContain("git branch -D 'feature/pan-123'");
    expect(deps.commands).not.toContain("git push origin --delete 'feature/pan-123'");
    expect(result.actions).toEqual([
      'would set mergeStatus=merged, reviewStatus=passed, readyForMerge=false',
      'would apply merged label',
      'would apply closed-out label',
    ]);
    expect(result.branchActions).toEqual([
      { branch: 'feature/pan-123', status: 'planned-delete', reason: 'branch is an ancestor of origin/main' },
      { branch: 'strike/pan-123', status: 'planned-keep', reason: 'branch is not an ancestor of origin/main' },
      { branch: 'origin/feature/pan-123', status: 'missing', reason: 'branch was not found' },
      { branch: 'origin/strike/pan-123', status: 'missing', reason: 'branch was not found' },
    ]);
  });
});
