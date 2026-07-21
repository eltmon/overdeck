/**
 * PAN-2948: buildReviewContextPromise must aggregate per-sub-repo diffs for
 * polyrepo workspaces instead of diffing the (empty) wrapper repo at the
 * workspace root.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const repoRootsMock = vi.hoisted(() => ({
  resolveWorkspaceRepoRootsSync: vi.fn(),
}));

vi.mock('../../../../src/lib/project-repos.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/project-repos.js')>('../../../../src/lib/project-repos.js');
  return {
    ...actual,
    resolveWorkspaceRepoRootsSync: repoRootsMock.resolveWorkspaceRepoRootsSync,
  };
});

vi.mock('../../../../src/lib/cloister/coderabbit-ingestion.js', () => ({
  fetchCodeRabbitFindings: vi.fn().mockResolvedValue([]),
}));

import { buildReviewContextPromise } from '../../../../src/lib/cloister/review-context.js';

const git = (cwd: string, cmd: string) =>
  execSync(`git ${cmd}`, { cwd, encoding: 'utf-8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

/** Init a repo on main with one commit, then a feature branch with one change. */
function makeRepo(dir: string, featureFile: string, withFeatureCommit: boolean): void {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init -b main');
  writeFileSync(join(dir, 'base.txt'), 'base\n');
  git(dir, 'add .');
  git(dir, 'commit -m base');
  git(dir, 'checkout -b feature/min-999');
  if (withFeatureCommit) {
    mkdirSync(dirname(join(dir, featureFile)), { recursive: true });
    writeFileSync(join(dir, featureFile), 'change\n');
    git(dir, 'add .');
    git(dir, 'commit -m change');
  }
}

describe('buildReviewContextPromise (polyrepo)', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'pan-review-ctx-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('aggregates per-repo diffs with repo-prefixed paths and per-repo heads', async () => {
    const feDir = join(workspace, 'fe');
    const apiDir = join(workspace, 'api');
    makeRepo(feDir, 'src/view.tsx', true);
    makeRepo(apiDir, 'src/handler.ts', false); // untouched sub-repo — empty diff

    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue([
      { repoKey: 'fe', dir: feDir, sourceBranch: 'feature/min-999', targetBranch: 'main', isPolyrepo: true },
      { repoKey: 'api', dir: apiDir, sourceBranch: 'feature/min-999', targetBranch: 'main', isPolyrepo: true },
    ]);

    const manifest = await buildReviewContextPromise({
      runId: 'agent-min-999-review-test',
      issueId: 'MIN-999',
      workspace,
    });

    // Changed files come from the fe sub-repo, prefixed with the repo key.
    expect(manifest.changedFiles.map(f => f.path)).toEqual(['fe/src/view.tsx']);
    expect(manifest.largeChangeset.fileCount).toBe(1);

    // Top-level head/branch are the primary (changed) repo's, not the wrapper's.
    const feHead = git(feDir, 'rev-parse HEAD').trim();
    expect(manifest.headSha).toBe(feHead);
    expect(manifest.branch).toBe('feature/min-999');

    // Additive per-repo context records both sub-repos.
    expect(manifest.repos).toHaveLength(2);
    expect(manifest.repos?.[0]).toMatchObject({ repoKey: 'fe', headSha: feHead, fileCount: 1 });
    expect(manifest.repos?.[1]).toMatchObject({ repoKey: 'api', fileCount: 0 });

    // Diff stat carries the repo header for changed repos only.
    expect(manifest.diff.stat).toContain('── fe ──');
    expect(manifest.diff.stat).not.toContain('── api ──');
  });

  it('keeps monorepo behavior unchanged (no repos field, unprefixed paths)', async () => {
    const repoDir = join(workspace, 'code');
    makeRepo(repoDir, 'src/index.ts', true);

    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue([
      { repoKey: 'code', dir: repoDir, sourceBranch: 'feature/min-999', targetBranch: 'main', isPolyrepo: false },
    ]);

    const manifest = await buildReviewContextPromise({
      runId: 'agent-min-999-review-test',
      issueId: 'MIN-999',
      workspace: repoDir,
    });

    expect(manifest.changedFiles.map(f => f.path)).toEqual(['src/index.ts']);
    expect(manifest.repos).toBeUndefined();
    expect(manifest.headSha).toBe(git(repoDir, 'rev-parse HEAD').trim());
  });
});
