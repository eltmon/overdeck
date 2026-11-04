/**
 * PAN-4683 WI-3: pushFeatureBranch pushes feature/<id> with an explicit refspec
 * and leaves the branch's origin/main upstream alone.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pushFeatureBranch } from '../feature-branch-push.js';

const roots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function configureIdentity(cwd: string): void {
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'config', 'commit.gpgsign', 'false');
}

/** Bare origin, a clone, and a worktree branch cut from origin/main — the production workspace shape. */
function workspaceFixture(): { clone: string; ws: string } {
  const base = mkdtempSync(join(tmpdir(), 'feature-branch-push-'));
  roots.push(base);
  const origin = join(base, 'origin.git');
  const seed = join(base, 'seed');
  const clone = join(base, 'clone');
  const ws = join(base, 'ws');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  mkdirSync(seed);
  git(seed, 'init', '-q', '-b', 'main');
  configureIdentity(seed);
  writeFileSync(join(seed, 'README.md'), 'readme\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'init');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '-q', 'origin', 'main');
  execFileSync('git', ['clone', '-q', origin, clone]);
  configureIdentity(clone);
  git(clone, 'worktree', 'add', '-q', '-b', 'feature/pan-9003', ws, 'origin/main');
  writeFileSync(join(ws, 'plan.txt'), 'plan\n');
  git(ws, 'add', '.');
  git(ws, 'commit', '-q', '-m', 'plan');
  return { clone, ws };
}

function execSpy(handler: (args: string[]) => { stdout: string } | Error) {
  return vi.fn(async (_file: string, args: string[]) => {
    const result = handler(args);
    if (result instanceof Error) throw result;
    return { stdout: result.stdout, stderr: '' };
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('pushFeatureBranch', () => {
  it('pushes the worktree branch to origin and keeps its origin/main upstream', async () => {
    const { ws } = workspaceFixture();
    expect(git(ws, 'config', '--get', 'branch.feature/pan-9003.merge')).toBe('refs/heads/main');

    const result = await pushFeatureBranch({ cwd: ws, branch: 'feature/pan-9003' });

    expect(result).toEqual({ pushed: true });
    const headSha = git(ws, 'rev-parse', 'HEAD');
    expect(git(ws, 'ls-remote', 'origin', 'refs/heads/feature/pan-9003')).toContain(headSha);
    expect(git(ws, 'config', '--get', 'branch.feature/pan-9003.merge')).toBe('refs/heads/main');
  });

  it('pushes with exactly the explicit refspec', async () => {
    const exec = execSpy((args) => {
      if (args[0] === 'symbolic-ref') return { stdout: 'feature/pan-9003\n' };
      if (args[0] === 'remote') return { stdout: 'origin\n' };
      return { stdout: '' };
    });

    const result = await pushFeatureBranch({ cwd: '/ws', branch: 'feature/pan-9003', execImpl: exec as never });

    expect(result).toEqual({ pushed: true });
    const pushCalls = exec.mock.calls.filter(([, args]) => args[0] === 'push');
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0][1]).toEqual(['push', 'origin', 'HEAD:refs/heads/feature/pan-9003']);
  });

  it('refuses without pushing when HEAD is on another branch', async () => {
    const exec = execSpy((args) => (args[0] === 'symbolic-ref' ? { stdout: 'main\n' } : { stdout: 'origin\n' }));

    const result = await pushFeatureBranch({ cwd: '/ws', branch: 'feature/pan-9003', execImpl: exec as never });

    expect(result).toEqual({ pushed: false, reason: 'HEAD is on main, expected feature/pan-9003' });
    expect(exec.mock.calls.some(([, args]) => args[0] === 'push')).toBe(false);
  });

  it('refuses when HEAD is detached', async () => {
    const exec = execSpy(() => new Error('fatal: ref HEAD is not a symbolic ref'));

    await expect(pushFeatureBranch({ cwd: '/ws', branch: 'feature/pan-9003', execImpl: exec as never }))
      .resolves.toEqual({ pushed: false, reason: 'HEAD is detached' });
  });

  it('refuses when there is no origin remote', async () => {
    const exec = execSpy((args) => (args[0] === 'symbolic-ref' ? { stdout: 'feature/pan-9003\n' } : { stdout: 'upstream\n' }));

    await expect(pushFeatureBranch({ cwd: '/ws', branch: 'feature/pan-9003', execImpl: exec as never }))
      .resolves.toEqual({ pushed: false, reason: 'no origin remote' });
    expect(exec.mock.calls.some(([, args]) => args[0] === 'push')).toBe(false);
  });

  it('reports a rejected push without throwing', async () => {
    const exec = execSpy((args) => {
      if (args[0] === 'symbolic-ref') return { stdout: 'feature/pan-9003\n' };
      if (args[0] === 'remote') return { stdout: 'origin\n' };
      return Object.assign(new Error('Command failed: git push'), { stderr: ' ! [rejected] HEAD -> feature/pan-9003 (fetch first)\nerror: failed to push\n' });
    });

    await expect(pushFeatureBranch({ cwd: '/ws', branch: 'feature/pan-9003', execImpl: exec as never }))
      .resolves.toEqual({ pushed: false, reason: '! [rejected] HEAD -> feature/pan-9003 (fetch first)' });
  });
});
