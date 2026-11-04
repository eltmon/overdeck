/**
 * PAN-4852 WI-15: the SageOx merge guard — the pure rule, the diff read
 * against a scratch git repo, and the per-issue composition with injected
 * deps (fail closed on a missing head).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  evaluateSageoxMergeGuard,
  readSageoxChangedPaths,
  sageoxMergeGuardForIssue,
  type SageoxGuardDeps,
} from '../merge-guard.js';

const scratch = mkdtempSync(join(tmpdir(), 'sageox-merge-guard-'));

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf-8' }).trim();
}

function write(root: string, file: string, content: string): void {
  mkdirSync(join(root, file, '..'), { recursive: true });
  writeFileSync(join(root, file), content);
}

/** A repo whose `main` has one commit and whose `feature` adds `.sageox/README.md` and `src/a.ts`. */
function makeRepo(name: string): { root: string; head: string } {
  const root = join(scratch, name);
  mkdirSync(root, { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  write(root, 'README.md', 'readme\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'init']);
  git(root, ['checkout', '-q', '-b', 'feature']);
  write(root, '.sageox/README.md', 'sageox\n');
  write(root, 'src/a.ts', 'export {};\n');
  git(root, ['add', '-f', '.']);
  git(root, ['commit', '-q', '-m', 'feature']);
  return { root, head: git(root, ['rev-parse', 'HEAD']) };
}

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('evaluateSageoxMergeGuard', () => {
  it('refuses .sageox/config.json without a committed binding and names the project', () => {
    const verdict = evaluateSageoxMergeGuard({ changedPaths: ['.sageox/config.json', 'src/a.ts'], committed: false, projectKey: 'app' });
    expect(verdict).toEqual({
      ok: false,
      reason:
        'PR changes SageOx link files (.sageox/) but app has not opted in to committing them; remove them from the PR or run pan skills pack sageox commit --project app',
      paths: ['.sageox/config.json'],
    });
  });

  it('passes .sageox/config.json with a committed binding', () => {
    expect(evaluateSageoxMergeGuard({ changedPaths: ['.sageox/config.json'], committed: true, projectKey: 'app' })).toEqual({ ok: true });
  });

  it('passes a PR that touches no SageOx path', () => {
    expect(evaluateSageoxMergeGuard({ changedPaths: ['src/a.ts', '.sageoxish/x', 'docs/.sageox/y'], committed: false, projectKey: 'app' })).toEqual({ ok: true });
  });

  it('refuses a bare .sageox file', () => {
    const verdict = evaluateSageoxMergeGuard({ changedPaths: ['.sageox'], committed: false, projectKey: 'app' });
    expect(verdict.ok).toBe(false);
  });
});

describe('readSageoxChangedPaths', () => {
  it('returns the .sageox path HEAD adds and nothing else', async () => {
    const { root, head } = makeRepo('local');
    await expect(readSageoxChangedPaths(root, 'main', head, 'feature')).resolves.toEqual(['.sageox/README.md']);
  });

  it('fetches the head branch once when the head commit is not local', async () => {
    const { root: origin, head } = makeRepo('origin-src');
    const bare = join(scratch, 'origin.git');
    git(scratch, ['clone', '-q', '--bare', origin, bare]);
    const clone = join(scratch, 'clone');
    git(scratch, ['clone', '-q', '--no-local', '--single-branch', '-b', 'main', bare, clone]);
    expect(() => git(clone, ['cat-file', '-e', `${head}^{commit}`])).toThrow();
    await expect(readSageoxChangedPaths(clone, 'origin/main', head, 'feature')).resolves.toEqual(['.sageox/README.md']);
  });

  it('throws when the head is not local and there is no branch to fetch', async () => {
    const { root } = makeRepo('nobranch');
    await expect(readSageoxChangedPaths(root, 'main', 'deadbeef'.repeat(5), null)).rejects.toThrow(/no head branch/);
  });
});

describe('sageoxMergeGuardForIssue', () => {
  const baseDeps = (overrides: Partial<SageoxGuardDeps> = {}): Partial<SageoxGuardDeps> => ({
    resolveProject: () => ({ projectKey: 'app', projectPath: '/repo/app', config: { name: 'app', path: '/repo/app' } }),
    workspacePath: () => '/repo/app/workspaces/feature-app-1',
    isGitWorkTree: async () => true,
    readCommitted: async () => false,
    defaultBranchTracks: async () => false,
    readChangedPaths: async () => ['.sageox/config.json'],
    ...overrides,
  });

  it('refuses a null head (fail closed)', async () => {
    const readChangedPaths = vi.fn(async () => []);
    const verdict = await sageoxMergeGuardForIssue('APP-1', null, 'feature/app-1', baseDeps({ readChangedPaths }));
    expect(verdict).toEqual({
      ok: false,
      reason:
        "SageOx merge guard could not read the PR's changed files: no PR head; fetch the PR head in /repo/app/workspaces/feature-app-1",
      paths: [],
    });
    expect(readChangedPaths).not.toHaveBeenCalled();
  });

  it('refuses a diff read failure', async () => {
    const verdict = await sageoxMergeGuardForIssue('APP-1', 'abc123', 'feature/app-1', baseDeps({
      readChangedPaths: async () => {
        throw Object.assign(new Error('git failed'), { stderr: 'fatal: bad revision\n' });
      },
    }));
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toContain('fatal: bad revision');
  });

  it('diffs the worktree against origin/<default> and refuses SageOx paths', async () => {
    const readChangedPaths = vi.fn(async () => ['.sageox/config.json']);
    const verdict = await sageoxMergeGuardForIssue('APP-1', 'abc123', 'feature/app-1', baseDeps({ readChangedPaths }));
    expect(verdict.ok).toBe(false);
    expect(readChangedPaths).toHaveBeenCalledWith('/repo/app/workspaces/feature-app-1', 'origin/main', 'abc123', 'feature/app-1');
  });

  it('falls back to the project root when the workspace is not a git work tree', async () => {
    const readChangedPaths = vi.fn(async () => []);
    await sageoxMergeGuardForIssue('APP-1', 'abc123', null, baseDeps({ isGitWorkTree: async () => false, readChangedPaths }));
    expect(readChangedPaths).toHaveBeenCalledWith('/repo/app', 'origin/main', 'abc123', null);
  });

  it('passes when the default branch tracks .sageox/config.json', async () => {
    const verdict = await sageoxMergeGuardForIssue('APP-1', null, null, baseDeps({ defaultBranchTracks: async () => true }));
    expect(verdict).toEqual({ ok: true });
  });

  it('passes when the project records sageox_binding: committed', async () => {
    const verdict = await sageoxMergeGuardForIssue('APP-1', 'abc123', null, baseDeps({ readCommitted: async () => true }));
    expect(verdict).toEqual({ ok: true });
  });

  it('skips a polyrepo workspace', async () => {
    const readChangedPaths = vi.fn(async () => ['.sageox/config.json']);
    const verdict = await sageoxMergeGuardForIssue('APP-1', 'abc123', null, baseDeps({
      resolveProject: () => ({
        projectKey: 'app',
        projectPath: '/repo/app',
        config: { name: 'app', path: '/repo/app', workspace: { type: 'polyrepo' } },
      }),
      readChangedPaths,
    }));
    expect(verdict).toEqual({ ok: true });
    expect(readChangedPaths).not.toHaveBeenCalled();
  });

  it('refuses when no project owns the issue', async () => {
    const verdict = await sageoxMergeGuardForIssue('ZZZ-1', 'abc123', null, baseDeps({ resolveProject: () => null }));
    expect(verdict.ok).toBe(false);
  });
});
