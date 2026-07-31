/**
 * PAN-3331 WI-1 — git-state module against real temp git repositories.
 *
 * These fixtures use real `git` because the whole point of the module is that
 * it asks git the right questions (the branch's own upstream, not origin/HEAD)
 * and spawns without a shell. Mocked exec would prove neither.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { getWorkspaceGitState, pullWorkspaceFastForward } from '../../../../src/lib/workspaces/git-state.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function commit(cwd: string, file: string, contents: string, message: string): void {
  writeFileSync(join(cwd, file), contents);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', message);
}

function configureIdentity(cwd: string): void {
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'config', 'commit.gpgsign', 'false');
}

describe('git-state', () => {
  let root: string;
  let origin: string;
  let seed: string;
  let ws: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-3331-git-state-'));
    origin = join(root, 'origin.git');
    seed = join(root, 'seed');
    ws = join(root, 'workspace');

    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin], { encoding: 'utf-8' });

    execFileSync('git', ['clone', '-q', origin, seed], { encoding: 'utf-8' });
    configureIdentity(seed);
    commit(seed, 'README.md', 'seed\n', 'init');
    git(seed, 'push', '-q', '-u', 'origin', 'main');
    // Give the bare repo a default branch so origin/HEAD resolves in clones.
    git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/main');

    execFileSync('git', ['clone', '-q', origin, ws], { encoding: 'utf-8' });
    configureIdentity(ws);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('getWorkspaceGitState', () => {
    it('reports the branch upstream counts, not origin/HEAD counts', async () => {
      // Feature branch that tracks its own remote branch, forked from main's tip.
      git(ws, 'checkout', '-q', '-b', 'feature/x');
      git(ws, 'push', '-q', '-u', 'origin', 'feature/x');

      // The remote's feature branch moves twice; main (origin/HEAD) does not move.
      git(seed, 'fetch', '-q', 'origin');
      git(seed, 'checkout', '-q', '-b', 'feature/x', 'origin/feature/x');
      commit(seed, 'a.txt', 'a\n', 'remote a');
      commit(seed, 'b.txt', 'b\n', 'remote b');
      git(seed, 'push', '-q', 'origin', 'feature/x');

      const state = await getWorkspaceGitState(ws, { fetch: true });

      // Against origin/HEAD (main) this checkout is even — 0/0. Against its own
      // upstream it is two commits behind. The upstream answer is the right one.
      expect(git(ws, 'rev-list', '--left-right', '--count', 'HEAD...origin/HEAD')).toBe('0\t0');
      expect(state.branch).toBe('feature/x');
      expect(state.detached).toBe(false);
      expect(state.hasUpstream).toBe(true);
      expect(state.upstreamRef).toBe('origin/feature/x');
      expect(state.ahead).toBe(0);
      expect(state.behind).toBe(2);
      expect(state.fetchedAt).toBeTypeOf('number');
    });

    it('counts local commits as ahead', async () => {
      git(ws, 'checkout', '-q', '-b', 'feature/ahead');
      git(ws, 'push', '-q', '-u', 'origin', 'feature/ahead');
      commit(ws, 'local.txt', 'local\n', 'local work');

      const state = await getWorkspaceGitState(ws);

      expect(state.ahead).toBe(1);
      expect(state.behind).toBe(0);
      expect(state.fetchedAt).toBeNull();
    });

    it('falls back to origin/HEAD with hasUpstream false when the branch tracks nothing', async () => {
      // Branch off the first commit, then move origin/main forward.
      const firstSha = git(ws, 'rev-parse', 'HEAD');
      commit(seed, 'later.txt', 'later\n', 'remote main moves');
      git(seed, 'push', '-q', 'origin', 'main');

      git(ws, 'checkout', '-q', '-b', 'local-only', firstSha);
      const state = await getWorkspaceGitState(ws, { fetch: true });

      expect(state.branch).toBe('local-only');
      expect(state.hasUpstream).toBe(false);
      expect(state.upstreamRef).toBe('origin/HEAD');
      expect(state.behind).toBe(1);
      expect(state.ahead).toBe(0);
    });

    it('reports detached HEAD', async () => {
      const sha = git(ws, 'rev-parse', 'HEAD');
      git(ws, 'checkout', '-q', '--detach', sha);

      const state = await getWorkspaceGitState(ws);

      expect(state.detached).toBe(true);
      expect(state.branch).toBeNull();
      expect(state.hasUpstream).toBe(false);
    });

    it('counts dirty files', async () => {
      writeFileSync(join(ws, 'dirty-one.txt'), 'x\n');
      writeFileSync(join(ws, 'dirty-two.txt'), 'y\n');

      const state = await getWorkspaceGitState(ws);

      expect(state.dirtyFiles).toBe(2);
    });

    it('returns remote commit entries capped at ten', async () => {
      git(ws, 'checkout', '-q', '-b', 'feature/log');
      git(ws, 'push', '-q', '-u', 'origin', 'feature/log');

      git(seed, 'fetch', '-q', 'origin');
      git(seed, 'checkout', '-q', '-b', 'feature/log', 'origin/feature/log');
      for (let i = 1; i <= 12; i += 1) {
        commit(seed, `n${i}.txt`, `${i}\n`, `remote commit ${i}`);
      }
      git(seed, 'push', '-q', 'origin', 'feature/log');

      const state = await getWorkspaceGitState(ws, { fetch: true });

      expect(state.behind).toBe(12);
      expect(state.recentRemoteCommits).toHaveLength(10);
      const [newest] = state.recentRemoteCommits;
      expect(newest.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(newest.subject).toBe('remote commit 12');
      expect(newest.author).toBe('Test');
      expect(Number.isNaN(Date.parse(newest.date))).toBe(false);
    });

    it('does not execute shell metacharacters in branch names or paths', async () => {
      // A branch name that would run a command if any git call were assembled as
      // a shell string. Argument-vector spawning makes it inert.
      const marker = join(root, 'pwned.txt');
      // `;>path` creates the file under any shell, and git accepts every one of
      // these characters in a branch name.
      const branch = `feature/x;>${marker}`;
      git(ws, 'checkout', '-q', '-b', branch);
      git(ws, 'push', '-q', '-u', 'origin', branch);

      const state = await getWorkspaceGitState(ws, { fetch: true });

      expect(state.branch).toBe(branch);
      expect(state.hasUpstream).toBe(true);
      expect(existsSync(marker)).toBe(false);
    });
  });

  describe('pullWorkspaceFastForward', () => {
    async function makeBehindByOne(): Promise<void> {
      commit(seed, 'incoming.txt', 'incoming\n', 'remote moved');
      git(seed, 'push', '-q', 'origin', 'main');
      git(ws, 'fetch', '-q', 'origin', 'main');
    }

    it('fast-forwards a clean behind-only checkout', async () => {
      await makeBehindByOne();
      expect((await getWorkspaceGitState(ws)).behind).toBe(1);

      const result = await pullWorkspaceFastForward(ws);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected pull to succeed');
      expect(result.state.behind).toBe(0);
      expect(readFileSync(join(ws, 'incoming.txt'), 'utf-8')).toBe('incoming\n');
      expect((await getWorkspaceGitState(ws)).behind).toBe(0);
    });

    it('refuses a dirty tree', async () => {
      await makeBehindByOne();
      writeFileSync(join(ws, 'scratch.txt'), 'wip\n');

      const result = await pullWorkspaceFastForward(ws);

      expect(result).toMatchObject({ ok: false, reason: 'dirty' });
      expect((await getWorkspaceGitState(ws)).behind).toBe(1);
    });

    it('refuses while a git operation is in flight', async () => {
      await makeBehindByOne();
      // A real MERGE_HEAD is exactly what git leaves behind mid-merge, and what
      // the quiescence probe reads.
      writeFileSync(join(ws, '.git', 'MERGE_HEAD'), `${git(ws, 'rev-parse', 'HEAD')}\n`);

      const result = await pullWorkspaceFastForward(ws);

      expect(result).toMatchObject({ ok: false, reason: 'operation-in-progress' });
    });

    it('refuses a diverged branch instead of merging it', async () => {
      git(ws, 'checkout', '-q', '-b', 'feature/diverge');
      git(ws, 'push', '-q', '-u', 'origin', 'feature/diverge');

      git(seed, 'fetch', '-q', 'origin');
      git(seed, 'checkout', '-q', '-b', 'feature/diverge', 'origin/feature/diverge');
      commit(seed, 'theirs.txt', 'theirs\n', 'their commit');
      git(seed, 'push', '-q', 'origin', 'feature/diverge');

      commit(ws, 'mine.txt', 'mine\n', 'my commit');
      git(ws, 'fetch', '-q', 'origin', 'feature/diverge');

      const result = await pullWorkspaceFastForward(ws);

      expect(result).toMatchObject({ ok: false, reason: 'not-fast-forward' });
      expect(existsSync(join(ws, 'theirs.txt'))).toBe(false);
    });

    it('refuses a branch with no upstream', async () => {
      git(ws, 'checkout', '-q', '-b', 'no-upstream');

      const result = await pullWorkspaceFastForward(ws);

      expect(result).toMatchObject({ ok: false, reason: 'no-upstream' });
    });

    it('refuses a detached HEAD', async () => {
      git(ws, 'checkout', '-q', '--detach', git(ws, 'rev-parse', 'HEAD'));

      const result = await pullWorkspaceFastForward(ws);

      expect(result).toMatchObject({ ok: false, reason: 'detached' });
    });

    it('returns refusals rather than throwing', async () => {
      git(ws, 'checkout', '-q', '-b', 'no-upstream');

      await expect(pullWorkspaceFastForward(ws)).resolves.toMatchObject({ ok: false });
    });
  });
});

// Review cycle 3 (non-blocking finding): countDirtyFiles used to map a failed
// `git status` to zero, so a checkout whose status could not be read would sail
// past the dirty-tree refusal that guards the pull.
describe('dirty-status failures fail closed', () => {
  let root: string;
  let notARepo: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-3331-dirty-fail-'));
    notARepo = join(root, 'plain-dir');
    execFileSync('mkdir', ['-p', notARepo]);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports dirtyFiles as null — not zero — when the status cannot be read', async () => {
    const state = await getWorkspaceGitState(notARepo);

    // Zero would render as "clean" and claim something never established.
    expect(state.dirtyFiles).toBeNull();
  });

  it('reports ahead/behind as null when the comparison probe fails', async () => {
    const state = await getWorkspaceGitState(notARepo);

    // 0/0 would render as "up to date" about a comparison that never ran.
    expect(state.ahead).toBeNull();
    expect(state.behind).toBeNull();
  });

  it('reports a requested fetch that failed instead of implying fresh counts', async () => {
    const state = await getWorkspaceGitState(notARepo, { fetch: true });

    expect(state.fetchFailed).toBe(true);
    expect(state.fetchedAt).toBeNull();
  });

  it('does not flag fetchFailed when no fetch was requested', async () => {
    const state = await getWorkspaceGitState(notARepo);

    expect(state.fetchFailed).toBe(false);
  });

  it('refuses the pull when the working-tree status cannot be read', async () => {
    // A directory that is not a git repository makes every git command fail,
    // which is the same shape as an unreadable index or overflowed output.
    const result = await pullWorkspaceFastForward(notARepo);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    // Detached is checked first and is itself a refusal, so the pull never
    // proceeds; what matters is that no code path reaches `git pull`.
    expect(['detached', 'dirty', 'no-upstream']).toContain(result.reason);
  });

  it('counts a rename as one dirty entry, not two', async () => {
    const repo = join(root, 'repo');
    execFileSync('git', ['init', '-q', '-b', 'main', repo], { encoding: 'utf-8' });
    configureIdentity(repo);
    commit(repo, 'original.txt', 'contents\n', 'init');
    git(repo, 'mv', 'original.txt', 'renamed.txt');

    const state = await getWorkspaceGitState(repo);

    expect(state.dirtyFiles).toBe(1);
  });

  it('reports a clean readable tree as zero, distinct from unknown', async () => {
    const repo = join(root, 'clean-repo');
    execFileSync('git', ['init', '-q', '-b', 'main', repo], { encoding: 'utf-8' });
    configureIdentity(repo);
    commit(repo, 'file.txt', 'contents\n', 'init');

    const state = await getWorkspaceGitState(repo);

    expect(state.dirtyFiles).toBe(0);
  });
});
