import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { workspaceChangesetHasContent } from '../../../../src/lib/cloister/verification-runner.js';

const git = (cwd: string, command: string) =>
  execSync(`git ${command}`, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });

function makeRepo(dir: string, featureFile?: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init -b main');
  writeFileSync(join(dir, 'base.txt'), 'base\n');
  git(dir, 'add .');
  git(dir, 'commit -m base');
  git(dir, 'update-ref refs/remotes/origin/main HEAD');
  git(dir, 'checkout -b feature/min-999');
  if (featureFile) {
    mkdirSync(dirname(join(dir, featureFile)), { recursive: true });
    writeFileSync(join(dir, featureFile), 'change\n');
    git(dir, 'add .');
    git(dir, 'commit -m change');
  }
}

describe('workspaceChangesetHasContent (polyrepo)', () => {
  let workspace: string;
  let feDir: string;
  let apiDir: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'pan-verification-polyrepo-'));
    feDir = join(workspace, 'fe');
    apiDir = join(workspace, 'api');
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function resolveRepos(): void {
    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue([
      { repoKey: 'fe', dir: feDir, sourceBranch: 'feature/min-999', targetBranch: 'main', isPolyrepo: true },
      { repoKey: 'api', dir: apiDir, sourceBranch: 'feature/min-999', targetBranch: 'main', isPolyrepo: true },
    ]);
  }

  it('accepts implementation content in any sub-repo', async () => {
    makeRepo(feDir, 'src/view.tsx');
    makeRepo(apiDir);
    resolveRepos();

    await expect(workspaceChangesetHasContent('MIN-999', workspace)).resolves.toBe(true);
  });

  it('reports empty only when every sub-repo diff is empty', async () => {
    makeRepo(feDir);
    makeRepo(apiDir);
    resolveRepos();

    await expect(workspaceChangesetHasContent('MIN-999', workspace)).resolves.toBe(false);
  });

  it('skips the guard conservatively when a repo diff fails and none has content', async () => {
    makeRepo(feDir);
    resolveRepos();

    await expect(workspaceChangesetHasContent('MIN-999', workspace)).resolves.toBeUndefined();
  });
});
