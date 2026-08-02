import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repoRootsMock = vi.hoisted(() => vi.fn());

vi.mock('../../project-repos.js', async () => {
  const actual = await vi.importActual<typeof import('../../project-repos.js')>('../../project-repos.js');
  return {
    ...actual,
    resolveWorkspaceRepoRootsSync: repoRootsMock,
  };
});

import { syncMainIntoWorkspace } from '../merge-agent.js';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

interface TestRepo {
  seed: string;
  workspace: string;
}

function createTestRepo(root: string, name: string): TestRepo {
  const remote = join(root, `${name}.git`);
  const seed = join(root, `${name}-seed`);
  const workspace = join(root, 'workspace', name);
  git(root, 'init', '--bare', '-q', remote);
  git(root, 'clone', '-q', remote, seed);
  git(seed, 'config', 'user.email', 'test@overdeck.local');
  git(seed, 'config', 'user.name', 'Overdeck Test');
  git(seed, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(seed, 'value.txt'), 'base\n');
  git(seed, 'add', 'value.txt');
  git(seed, 'commit', '-q', '-m', 'base');
  git(seed, 'branch', '-M', 'main');
  git(seed, 'push', '-q', '-u', 'origin', 'main');
  git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  mkdirSync(join(root, 'workspace'), { recursive: true });
  git(root, 'clone', '-q', remote, workspace);
  git(workspace, 'config', 'user.email', 'test@overdeck.local');
  git(workspace, 'config', 'user.name', 'Overdeck Test');
  git(workspace, 'config', 'commit.gpgsign', 'false');
  git(workspace, 'switch', '-q', '-c', 'feature/min-850');
  return { seed, workspace };
}

function advanceMain(repo: TestRepo, value: string): void {
  writeFileSync(join(repo.seed, 'value.txt'), `${value}\n`);
  git(repo.seed, 'commit', '-qam', value);
  git(repo.seed, 'push', '-q', 'origin', 'main');
}

describe('syncMainIntoWorkspace polyrepo support', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-sync-main-polyrepo-'));
    repoRootsMock.mockReset();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('syncs each member repo and aggregates prefixed changed files', async () => {
    const api = createTestRepo(root, 'api');
    const fe = createTestRepo(root, 'fe');
    advanceMain(api, 'api upstream');
    advanceMain(fe, 'fe upstream');
    repoRootsMock.mockReturnValue([
      { repoKey: 'api', dir: api.workspace, sourceBranch: 'feature/min-850', targetBranch: 'main', isPolyrepo: true },
      { repoKey: 'fe', dir: fe.workspace, sourceBranch: 'feature/min-850', targetBranch: 'main', isPolyrepo: true },
    ]);

    const result = await syncMainIntoWorkspace(join(root, 'workspace'), 'MIN-850');

    expect(result).toMatchObject({ success: true, commitCount: 2 });
    expect(result.changedFiles).toEqual(['api/value.txt', 'fe/value.txt']);
    expect(result.repos).toEqual([
      expect.objectContaining({ repoKey: 'api', success: true, commitCount: 1, changedFiles: ['api/value.txt'] }),
      expect.objectContaining({ repoKey: 'fe', success: true, commitCount: 1, changedFiles: ['fe/value.txt'] }),
    ]);
  });

  it('aborts a conflicting repo and skips every remaining repo', async () => {
    const api = createTestRepo(root, 'api');
    const fe = createTestRepo(root, 'fe');
    writeFileSync(join(api.workspace, 'value.txt'), 'feature\n');
    git(api.workspace, 'commit', '-qam', 'feature change');
    advanceMain(api, 'main change');
    const feHead = git(fe.workspace, 'rev-parse', 'HEAD');
    repoRootsMock.mockReturnValue([
      { repoKey: 'api', dir: api.workspace, sourceBranch: 'feature/min-850', targetBranch: 'main', isPolyrepo: true },
      { repoKey: 'fe', dir: fe.workspace, sourceBranch: 'feature/min-850', targetBranch: 'main', isPolyrepo: true },
    ]);

    const result = await syncMainIntoWorkspace(join(root, 'workspace'), 'MIN-850');

    expect(result).toMatchObject({ success: false, reason: expect.stringContaining('[api]') });
    expect(result.conflictFiles).toEqual(['api/value.txt']);
    expect(result.repos?.[1]).toMatchObject({ repoKey: 'fe', success: false, skipped: true });
    expect(() => git(api.workspace, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).toThrow();
    expect(git(api.workspace, 'status', '--porcelain')).toBe('');
    expect(git(fe.workspace, 'rev-parse', 'HEAD')).toBe(feHead);
  });

  it('reports the aggregate as already up to date when every member repo is current', async () => {
    const api = createTestRepo(root, 'api');
    const fe = createTestRepo(root, 'fe');
    repoRootsMock.mockReturnValue([
      { repoKey: 'api', dir: api.workspace, sourceBranch: 'feature/min-850', targetBranch: 'main', isPolyrepo: true },
      { repoKey: 'fe', dir: fe.workspace, sourceBranch: 'feature/min-850', targetBranch: 'main', isPolyrepo: true },
    ]);

    const result = await syncMainIntoWorkspace(join(root, 'workspace'), 'MIN-850');

    expect(result).toMatchObject({ success: true, alreadyUpToDate: true });
    expect(result.repos).toEqual([
      expect.objectContaining({ repoKey: 'api', success: true, alreadyUpToDate: true }),
      expect.objectContaining({ repoKey: 'fe', success: true, alreadyUpToDate: true }),
    ]);
  });

  it('auto-resolves pipeline-owned conflicts from the configured target branch', async () => {
    const api = createTestRepo(root, 'api');
    const pipelineFile = join('.pan', 'continues', 'PAN-3037.json');
    mkdirSync(join(api.seed, '.pan', 'continues'), { recursive: true });
    writeFileSync(join(api.seed, pipelineFile), 'base\n');
    git(api.seed, 'add', pipelineFile);
    git(api.seed, 'commit', '-q', '-m', 'pipeline base');
    git(api.seed, 'push', '-q', 'origin', 'main');
    git(api.workspace, 'fetch', '-q', 'origin', 'main');
    git(api.workspace, 'merge', '-q', 'origin/main');

    git(api.seed, 'switch', '-q', '-c', 'develop');
    writeFileSync(join(api.seed, pipelineFile), 'develop\n');
    git(api.seed, 'commit', '-qam', 'develop pipeline state');
    git(api.seed, 'push', '-q', '-u', 'origin', 'develop');
    writeFileSync(join(api.workspace, pipelineFile), 'feature\n');
    git(api.workspace, 'commit', '-qam', 'feature pipeline state');
    repoRootsMock.mockReturnValue([
      { repoKey: 'api', dir: api.workspace, sourceBranch: 'feature/min-850', targetBranch: 'develop', isPolyrepo: true },
    ]);

    const result = await syncMainIntoWorkspace(join(root, 'workspace'), 'MIN-850');

    expect(result).toMatchObject({ success: true });
    expect(readFileSync(join(api.workspace, pipelineFile), 'utf8')).toBe('develop\n');
    expect(() => git(api.workspace, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).toThrow();
  });

  it('preserves unprefixed top-level paths for a monorepo workspace', async () => {
    const repo = createTestRepo(root, 'overdeck');
    advanceMain(repo, 'upstream');
    repoRootsMock.mockReturnValue([
      { repoKey: 'overdeck', dir: repo.workspace, sourceBranch: 'feature/pan-3037', targetBranch: 'main', isPolyrepo: false },
    ]);

    const result = await syncMainIntoWorkspace(repo.workspace, 'PAN-3037');

    expect(result).toMatchObject({ success: true, commitCount: 1, changedFiles: ['value.txt'] });
    expect(result.repos).toEqual([
      expect.objectContaining({ repoKey: 'overdeck', success: true, commitCount: 1, changedFiles: ['value.txt'] }),
    ]);
  });

  it('merge-syncs main into a strike branch without rebasing or changing branches', async () => {
    const repo = createTestRepo(root, 'overdeck');
    git(repo.workspace, 'branch', '-m', 'strike/pan-3440');
    writeFileSync(join(repo.workspace, 'strike.txt'), 'strike work\n');
    git(repo.workspace, 'add', 'strike.txt');
    git(repo.workspace, 'commit', '-q', '-m', 'strike work');
    advanceMain(repo, 'upstream');
    repoRootsMock.mockReturnValue([
      { repoKey: 'overdeck', dir: repo.workspace, sourceBranch: 'strike/pan-3440', targetBranch: 'main', isPolyrepo: false },
    ]);

    const result = await syncMainIntoWorkspace(repo.workspace, 'PAN-3440');

    expect(result).toMatchObject({ success: true, commitCount: 2, changedFiles: ['value.txt'] });
    expect(git(repo.workspace, 'branch', '--show-current')).toBe('strike/pan-3440');
    expect(git(repo.workspace, 'show', '-s', '--format=%P', 'HEAD').split(' ')).toHaveLength(2);
    expect(readFileSync(join(repo.workspace, 'strike.txt'), 'utf8')).toBe('strike work\n');
  });

  it('returns the active cancellation and skips unattempted repos', async () => {
    const api = createTestRepo(root, 'api');
    const fe = createTestRepo(root, 'fe');
    const controller = new AbortController();
    controller.abort();
    repoRootsMock.mockReturnValue([
      { repoKey: 'api', dir: api.workspace, sourceBranch: 'feature/min-850', targetBranch: 'main', isPolyrepo: true },
      { repoKey: 'fe', dir: fe.workspace, sourceBranch: 'feature/min-850', targetBranch: 'main', isPolyrepo: true },
    ]);

    const result = await syncMainIntoWorkspace(join(root, 'workspace'), 'MIN-850', controller.signal);

    expect(result).toMatchObject({ success: false, reason: expect.stringContaining('[api]') });
    expect(result.repos?.[0]).toMatchObject({ repoKey: 'api', success: false });
    expect(result.repos?.[1]).toMatchObject({ repoKey: 'fe', success: false, skipped: true });
    expect(() => git(api.workspace, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).toThrow();
  });
});
