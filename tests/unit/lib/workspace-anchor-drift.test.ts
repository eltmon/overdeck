import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repoRootsMock = vi.hoisted(() => ({
  resolveWorkspaceRepoRootsSync: vi.fn(),
}));

vi.mock('../../../src/lib/project-repos.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/project-repos.js')>(
    '../../../src/lib/project-repos.js',
  );
  return {
    ...actual,
    resolveWorkspaceRepoRootsSync: repoRootsMock.resolveWorkspaceRepoRootsSync,
  };
});

import {
  rehydrateHeadAnchor,
  snapshotWorkspaceHeadsPromise,
} from '../../../src/lib/git-utils.js';
import {
  evaluateWorkspaceAnchorDrift,
  type WorkspaceAnchorDriftChecks,
} from '../../../src/lib/workspace-anchor-drift.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function initializeRepo(parent: string, name: string): string {
  const repo = join(parent, name);
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@test.com');
  git(repo, 'config', 'user.name', 'Test');
  writeFileSync(join(repo, 'app.ts'), `export const name = '${name}';\n`);
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'base');
  git(repo, 'update-ref', 'refs/remotes/origin/main', git(repo, 'rev-parse', 'HEAD'));
  return repo;
}

function root(repoKey: string, dir: string, isPolyrepo: boolean) {
  return {
    repoKey,
    dir,
    sourceBranch: 'feature/pan-3076',
    targetBranch: 'main',
    isPolyrepo,
  };
}

function checks(
  overrides: Partial<WorkspaceAnchorDriftChecks> = {},
): WorkspaceAnchorDriftChecks {
  return {
    sameTree: vi.fn().mockResolvedValue(false),
    sameEffectiveCode: vi.fn().mockResolvedValue(false),
    sameCodeContribution: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe('evaluateWorkspaceAnchorDrift', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'pan-3076-anchor-'));
    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReset();
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('reports current anchors and real changes in any polyrepo root', async () => {
    const fe = initializeRepo(workspace, 'fe');
    const api = initializeRepo(workspace, 'api');
    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue([
      root('fe', fe, true),
      root('api', api, true),
    ]);
    const storedAnchor = await snapshotWorkspaceHeadsPromise('PAN-3076', workspace);
    expect(storedAnchor).toBeDefined();

    await expect(evaluateWorkspaceAnchorDrift(
      'PAN-3076',
      workspace,
      storedAnchor!,
    )).resolves.toEqual({ kind: 'current', currentAnchor: storedAnchor });

    writeFileSync(join(api, 'app.ts'), "export const name = 'changed';\n");
    git(api, 'add', 'app.ts');
    git(api, 'commit', '-m', 'change api');

    const verdict = await evaluateWorkspaceAnchorDrift('PAN-3076', workspace, storedAnchor!);
    expect(verdict.kind).toBe('drifted');
    expect(verdict.changedRepos).toEqual(['api']);
  });

  it('reports a tree-identical rewritten sub-repo head as benign', async () => {
    const fe = initializeRepo(workspace, 'fe');
    const api = initializeRepo(workspace, 'api');
    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue([
      root('fe', fe, true),
      root('api', api, true),
    ]);
    const storedAnchor = await snapshotWorkspaceHeadsPromise('PAN-3076', workspace);
    const tree = git(api, 'rev-parse', 'HEAD^{tree}');
    const rewrittenHead = execFileSync(
      'git',
      ['commit-tree', tree],
      { cwd: api, encoding: 'utf-8', input: 'rewritten base\n' },
    ).trim();
    git(api, 'update-ref', 'HEAD', rewrittenHead);

    const verdict = await evaluateWorkspaceAnchorDrift('PAN-3076', workspace, storedAnchor!);
    expect(verdict).toEqual({
      kind: 'benign',
      currentAnchor: await snapshotWorkspaceHeadsPromise('PAN-3076', workspace),
      changedRepos: ['api'],
    });
  });

  it('treats an anchor SHAPE mismatch as unreadable, never drifted (PAN-3254)', async () => {
    const fe = initializeRepo(workspace, 'fe');
    const api = initializeRepo(workspace, 'api');
    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue([
      root('fe', fe, true),
      root('api', api, true),
    ]);

    // A composite/bare disagreement is a producer disagreement (legacy plain
    // anchor, or a snapshot degraded to the wrapper HEAD) — not evidence of
    // new code. Reporting it as drift re-drove MIN-901 through 426 identical
    // review cycles; unreadable preserves the existing verdict instead.
    await expect(evaluateWorkspaceAnchorDrift(
      'PAN-3076',
      workspace,
      rehydrateHeadAnchor('a'.repeat(40)),
    )).resolves.toEqual({ kind: 'unreadable' });
  });

  it('preserves monorepo benign semantics and detects real code drift', async () => {
    const repo = initializeRepo(workspace, 'repo');
    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue([root('overdeck', repo, false)]);
    const storedAnchor = await snapshotWorkspaceHeadsPromise('PAN-3076', repo);

    mkdirSync(join(repo, '.pan', 'specs'), { recursive: true });
    writeFileSync(join(repo, '.pan', 'specs', 'plan.json'), '{}\n');
    git(repo, 'add', '.pan');
    git(repo, 'commit', '-m', 'state only');
    await expect(evaluateWorkspaceAnchorDrift(
      'PAN-3076',
      repo,
      storedAnchor!,
    )).resolves.toMatchObject({ kind: 'benign' });

    writeFileSync(join(repo, 'app.ts'), "export const name = 'changed';\n");
    git(repo, 'add', 'app.ts');
    git(repo, 'commit', '-m', 'real code change');
    await expect(evaluateWorkspaceAnchorDrift(
      'PAN-3076',
      repo,
      storedAnchor!,
    )).resolves.toMatchObject({ kind: 'drifted' });
  });

  it('continues to later benign checks when the tree lookup fails', async () => {
    const repo = initializeRepo(workspace, 'repo');
    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue([root('overdeck', repo, false)]);
    const storedAnchor = await snapshotWorkspaceHeadsPromise('PAN-3076', repo);
    writeFileSync(join(repo, 'app.ts'), "export const name = 'changed';\n");
    git(repo, 'add', 'app.ts');
    git(repo, 'commit', '-m', 'rewrite code');
    const sameCodeContribution = vi.fn().mockResolvedValue(false);
    const probeChecks = checks({
      sameTree: vi.fn().mockRejectedValue(new Error('tree unavailable')),
      sameEffectiveCode: vi.fn().mockResolvedValue(true),
      sameCodeContribution,
    });

    await expect(evaluateWorkspaceAnchorDrift(
      'PAN-3076',
      repo,
      storedAnchor!,
      probeChecks,
    )).resolves.toMatchObject({ kind: 'benign' });
    expect(probeChecks.sameEffectiveCode).toHaveBeenCalledOnce();
    expect(sameCodeContribution).not.toHaveBeenCalled();
  });

  it('returns drifted when every benign comparison fails', async () => {
    const repo = initializeRepo(workspace, 'repo');
    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue([root('overdeck', repo, false)]);
    const storedAnchor = await snapshotWorkspaceHeadsPromise('PAN-3076', repo);
    writeFileSync(join(repo, 'app.ts'), "export const name = 'changed';\n");
    git(repo, 'add', 'app.ts');
    git(repo, 'commit', '-m', 'uninspectable code move');
    const probeChecks = checks({
      sameTree: vi.fn().mockRejectedValue(new Error('tree unavailable')),
      sameEffectiveCode: vi.fn().mockRejectedValue(new Error('history unavailable')),
      sameCodeContribution: vi.fn().mockRejectedValue(new Error('patch unavailable')),
    });

    await expect(evaluateWorkspaceAnchorDrift(
      'PAN-3076',
      repo,
      storedAnchor!,
      probeChecks,
    )).resolves.toMatchObject({ kind: 'drifted' });
    expect(probeChecks.sameTree).toHaveBeenCalledOnce();
    expect(probeChecks.sameEffectiveCode).toHaveBeenCalledOnce();
    expect(probeChecks.sameCodeContribution).toHaveBeenCalledOnce();
  });

  it('returns drifted when a changed composite repo has no resolved root', async () => {
    const fe = initializeRepo(workspace, 'fe');
    const api = initializeRepo(workspace, 'api');
    const bothRoots = [root('fe', fe, true), root('api', api, true)];
    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue(bothRoots);
    const storedAnchor = await snapshotWorkspaceHeadsPromise('PAN-3076', workspace);
    writeFileSync(join(api, 'app.ts'), "export const name = 'changed';\n");
    git(api, 'add', 'app.ts');
    git(api, 'commit', '-m', 'change api');
    const currentAnchor = await snapshotWorkspaceHeadsPromise('PAN-3076', workspace);
    repoRootsMock.resolveWorkspaceRepoRootsSync
      .mockReset()
      .mockReturnValueOnce(bothRoots)
      .mockReturnValueOnce([root('fe', fe, true)]);

    await expect(evaluateWorkspaceAnchorDrift(
      'PAN-3076',
      workspace,
      storedAnchor!,
    )).resolves.toEqual({
      kind: 'drifted',
      currentAnchor,
      changedRepos: ['api'],
    });
  });

  it('reports unreadable when no current workspace head can be produced', async () => {
    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue([
      root('missing', join(workspace, 'missing'), false),
    ]);

    await expect(evaluateWorkspaceAnchorDrift(
      'PAN-3076',
      workspace,
      // The fixture simulates a legacy anchor read back from unbranded storage.
      rehydrateHeadAnchor('a'.repeat(40)),
    )).resolves.toEqual({ kind: 'unreadable' });
  });
});
