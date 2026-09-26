/**
 * PAN-3917 W9: whoever writes a `.pan/` artifact commits it. A commit that
 * fails must say so and must leave the index the way it found it — the verbs
 * above this helper turn a failure into a non-zero exit.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { commitPlanArtifacts, pushPlanArtifacts } from'../../../../src/lib/overdeck/plan-artifact-commit.js';

let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function write(rel: string, content: string): void {
  const path = join(repo, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'plan-artifact-commit-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@overdeck.local');
  git('config', 'user.name', 'Overdeck Test');
  git('config', 'commit.gpgsign', 'false');
  write('README.md', 'seed\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: seed');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** A hook that refuses every commit, so the failure path is exercised for real. */
function refuseCommits(): void {
  const hook = join(repo, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\necho "pre-commit refused"\nexit 1\n', 'utf8');
  chmodSync(hook, 0o755);
}

describe('commitPlanArtifacts', () => {
  it('commits the artifacts it was given', async () => {
    write('.pan/continues/PAN-1.xbrief.json', '{}\n');

    const result = await commitPlanArtifacts({ cwd: repo, paths: ['.pan/continues'], message: 'chore(workspace): x' });

    expect(result).toMatchObject({ committed: true });
    expect(git('show', '--name-only', '--format=', 'HEAD')).toContain('.pan/continues/PAN-1.xbrief.json');
  });

  it('reports an already-committed artifact as nothing to commit', async () => {
    write('.pan/continues/PAN-1.xbrief.json', '{}\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'chore(workspace): earlier');

    const result = await commitPlanArtifacts({ cwd: repo, paths: ['.pan/continues'], message: 'chore(workspace): x' });
    expect(result).toEqual({ committed: false, reason: 'nothing to commit' });
  });

  it('reports the failure and unstages only what it staged', async () => {
    write('unrelated.txt', 'operator work\n');
    git('add', '--', 'unrelated.txt');
    write('.pan/continues/PAN-1.xbrief.json', '{}\n');
    refuseCommits();

    const result = await commitPlanArtifacts({ cwd: repo, paths: ['.pan/continues'], message: 'chore(workspace): x' });

    expect(result.committed).toBe(false);
    const staged = git('diff', '--cached', '--name-only');
    expect(staged).not.toContain('.pan/continues');
    expect(staged).toContain('unrelated.txt');
  });
});

/**
 * PAN-3923: the backlog sequence is committed on the plan home's main and must
 * reach origin. Real git against a local bare remote, so nothing leaves the
 * machine and the replay plumbing is exercised for real.
 */
describe('pushPlanArtifacts', () => {
  let root: string;
  let origin: string;
  let home: string;
  let other: string;

  const at = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

  function configure(cwd: string): void {
    at(cwd, 'config', 'user.email', 'test@overdeck.local');
    at(cwd, 'config', 'user.name', 'Overdeck Test');
    at(cwd, 'config', 'commit.gpgsign', 'false');
    at(cwd, 'config', 'core.hooksPath', join(cwd, '.git', 'hooks'));
  }

  function commitFile(cwd: string, rel: string, content: string, message: string): void {
    const path = join(cwd, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
    at(cwd, 'add', '--', rel);
    at(cwd, 'commit', '-q', '-m', message);
  }

  function writeUntracked(cwd: string, rel: string, content: string): void {
    const path = join(cwd, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }

  function clone(name: string): string {
    const dir = join(root, name);
    at(root, 'clone', '-q', origin, dir);
    configure(dir);
    return dir;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'plan-artifact-push-'));
    origin = join(root, 'origin.git');
    at(root, 'init', '-q', '--bare', '-b', 'main', origin);
    const seed = join(root, 'seed');
    at(root, 'init', '-q', '-b', 'main', seed);
    configure(seed);
    commitFile(seed, 'src/app.ts', 'export {};\n', 'chore: seed');
    commitFile(seed, '.pan/backlog/sequence.md', 'pass 0\n', 'chore(workspace): backlog sequence');
    at(seed, 'push', '-q', origin, 'main');
    home = clone('home');
    other = clone('other');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const originMain = (): string => at(origin, 'rev-parse', 'main');

  it('pushes a sequence commit that fast-forwards origin', async () => {
    commitFile(home, '.pan/backlog/sequence.md', 'pass 1\n', 'chore(workspace): backlog sequence');
    const head = at(home, 'rev-parse', 'HEAD');

    const result = await pushPlanArtifacts(home);

    expect(result).toEqual({ pushed: true, sha: head, rebased: false });
    expect(originMain()).toBe(head);
  });

  it('replays the sequence commits onto a moved origin, pushes, and keeps uncommitted work', async () => {
    commitFile(other, 'src/app.ts', 'export const moved = true;\n', 'feat: land elsewhere');
    at(other, 'push', '-q', 'origin', 'main');
    const moved = originMain();

    commitFile(home, '.pan/backlog/sequence.md', 'pass 1\n', 'chore(workspace): backlog sequence');
    commitFile(home, '.pan/backlog/sequence.md', 'pass 2\n', 'chore(workspace): backlog sequence');
    writeFileSync(join(home, '.pan', 'backlog', 'draft.md'), 'untracked\n', 'utf8');

    const result = await pushPlanArtifacts(home);

    expect(result).toMatchObject({ pushed: true, rebased: true });
    expect(result.pushed && result.warning).toBeFalsy();
    const tip = originMain();
    expect(at(origin, 'rev-list', '--count', `${moved}..${tip}`)).toBe('2');
    expect(at(origin, 'show', `${tip}:.pan/backlog/sequence.md`)).toBe('pass 2');
    expect(at(origin, 'show', `${tip}:src/app.ts`)).toBe('export const moved = true;');
    expect(at(origin, 'log', '-1', '--format=%s', tip)).toBe('chore(workspace): backlog sequence');
    // The checkout follows origin and keeps what the operator had not committed.
    expect(at(home, 'rev-parse', 'HEAD')).toBe(tip);
    expect(at(home, 'status', '--porcelain', '--', '.pan/backlog/draft.md')).toContain('??');
  });

  it('keeps an uncommitted edit to a tracked file across the replay', async () => {
    commitFile(other, 'src/app.ts', 'export const moved = true;\n', 'feat: land elsewhere');
    at(other, 'push', '-q', 'origin', 'main');
    commitFile(home, '.pan/backlog/sequence.md', 'pass 1\n', 'chore(workspace): backlog sequence');
    commitFile(home, '.pan/specs/spec.json', '{}\n', 'chore(workspace): spec');
    writeFileSync(join(home, '.pan', 'specs', 'spec.json'), '{"dirty":true}\n', 'utf8');

    const result = await pushPlanArtifacts(home);

    expect(result).toMatchObject({ pushed: true, rebased: true });
    expect(at(home, 'rev-parse', 'HEAD')).toBe(originMain());
    expect(at(home, 'diff', '--name-only')).toBe('.pan/specs/spec.json');
  });

  it('refuses to push when local main carries a commit outside .pan/', async () => {
    const before = originMain();
    commitFile(home, 'src/app.ts', 'export const local = 1;\n', 'feat: unpushed operator work');
    commitFile(home, '.pan/backlog/sequence.md', 'pass 1\n', 'chore(workspace): backlog sequence');
    const head = at(home, 'rev-parse', 'HEAD');

    const result = await pushPlanArtifacts(home);

    expect(result).toMatchObject({ pushed: false, skipped: false });
    expect(!result.pushed && result.reason).toContain('src/app.ts');
    expect(originMain()).toBe(before);
    expect(at(home, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('warns instead of forcing when the replay conflicts', async () => {
    commitFile(other, '.pan/backlog/sequence.md', 'pass from elsewhere\n', 'chore(workspace): backlog sequence');
    at(other, 'push', '-q', 'origin', 'main');
    const before = originMain();
    commitFile(home, '.pan/backlog/sequence.md', 'pass 1\n', 'chore(workspace): backlog sequence');
    const head = at(home, 'rev-parse', 'HEAD');

    const result = await pushPlanArtifacts(home);

    expect(result).toMatchObject({ pushed: false, skipped: false });
    expect(!result.pushed && result.reason).toContain('conflicts');
    expect(originMain()).toBe(before);
    expect(at(home, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('reports a push the hooks refuse', async () => {
    const hook = join(home, '.git', 'hooks', 'pre-push');
    writeFileSync(hook, '#!/bin/sh\necho "pre-push refused" >&2\nexit 1\n', 'utf8');
    chmodSync(hook, 0o755);
    const before = originMain();
    commitFile(home, '.pan/backlog/sequence.md', 'pass 1\n', 'chore(workspace): backlog sequence');

    const result = await pushPlanArtifacts(home);

    expect(result).toMatchObject({ pushed: false, skipped: false });
    expect(!result.pushed && result.reason).toMatch(/could not push/);
    expect(originMain()).toBe(before);
  });

  it('skips a branch with no upstream', async () => {
    at(home, 'checkout', '-q', '-b', 'local-only');
    commitFile(home, '.pan/backlog/sequence.md', 'pass 1\n', 'chore(workspace): backlog sequence');

    const result = await pushPlanArtifacts(home);

    expect(result).toEqual({ pushed: false, skipped: true, reason: 'local-only has no upstream' });
  });

  /**
   * PAN-4224: a plan-artifact commit can land on origin under a different sha
   * (another checkout's push replayed the same patch, or a PR squash-merged
   * it) while this checkout still holds its own copy plus a genuinely new
   * commit. Replaying blindly by two-dot range would duplicate the landed
   * patch; cherry-pick equivalence must drop it and replay only the new one.
   */
  it('replays only the commit origin lacks when an earlier commit already landed under a different sha', async () => {
    commitFile(other, '.pan/backlog/sequence.md', 'pass 1\n', 'chore(workspace): backlog sequence (squashed)');
    at(other, 'push', '-q', 'origin', 'main');
    const landed = originMain();

    commitFile(home, '.pan/backlog/sequence.md', 'pass 1\n', 'chore(workspace): backlog sequence');
    commitFile(home, '.pan/backlog/sequence.md', 'pass 2\n', 'chore(workspace): backlog sequence');

    const result = await pushPlanArtifacts(home);

    expect(result).toMatchObject({ pushed: true, rebased: true });
    const tip = originMain();
    expect(at(origin, 'rev-list', '--count', `${landed}..${tip}`)).toBe('1');
    expect(at(origin, 'show', '--name-only', '--format=', tip)).toContain('.pan/backlog/sequence.md');
    expect(at(origin, 'show', `${tip}:.pan/backlog/sequence.md`)).toBe('pass 2');
    expect(at(home, 'rev-parse', 'HEAD')).toBe(tip);
  });

  it('self-heals when every local commit already landed on origin under a different sha', async () => {
    commitFile(other, '.pan/backlog/sequence.md', 'pass 1\n', 'chore(workspace): backlog sequence (squashed)');
    at(other, 'push', '-q', 'origin', 'main');
    const landed = originMain();

    commitFile(home, '.pan/backlog/sequence.md', 'pass 1\n', 'chore(workspace): backlog sequence');

    const result = await pushPlanArtifacts(home);

    expect(result).toMatchObject({ pushed: false, skipped: true });
    expect(!result.pushed && result.reason).toContain('already on');
    expect(originMain()).toBe(landed);
    expect(at(home, 'rev-parse', 'HEAD')).toBe(landed);
  });

  it('refuses when local main holds a merge commit over origin', async () => {
    commitFile(other, '.pan/notes/note.md', 'from other\n', 'chore(workspace): note');
    at(other, 'push', '-q', 'origin', 'main');
    const before = originMain();

    commitFile(home, '.pan/backlog/sequence.md', 'pass 1\n', 'chore(workspace): backlog sequence');
    at(home, 'fetch', '-q', 'origin');
    at(home, 'merge', '-q', 'origin/main', '--no-edit');

    const result = await pushPlanArtifacts(home);

    expect(result).toMatchObject({ pushed: false, skipped: false });
    expect(!result.pushed && result.reason).toContain('merge commits');
    expect(originMain()).toBe(before);
  });

  /**
   * PAN-4224: `reset --keep` refuses to move onto a tip that would newly
   * track a path already sitting untracked in the working tree — e.g. a
   * planning-promotion draft origin gained through a merge the checkout
   * never staged. When the untracked bytes already match what's now
   * tracked, the collision is just cleared out of the way.
   */
  it('clears an identical untracked collision before moving onto the pushed tip', async () => {
    const content = '{"issue":"PAN-1"}\n';
    commitFile(other, '.pan/continues/PAN-1.xbrief.json', content, 'chore(workspace): continue PAN-1');
    at(other, 'push', '-q', 'origin', 'main');

    commitFile(home, '.pan/backlog/sequence.md', 'pass 1\n', 'chore(workspace): backlog sequence');
    writeUntracked(home, '.pan/continues/PAN-1.xbrief.json', content);

    const result = await pushPlanArtifacts(home);

    expect(result).toMatchObject({ pushed: true, rebased: true });
    expect(result.pushed && result.backedUp).toBeFalsy();
    const tip = originMain();
    expect(at(home, 'rev-parse', 'HEAD')).toBe(tip);
    expect(at(home, 'ls-files', '--', '.pan/continues/PAN-1.xbrief.json')).toContain('PAN-1.xbrief.json');
    expect(at(home, 'status', '--porcelain', '--', '.pan/continues/PAN-1.xbrief.json')).toBe('');
    const backupsDir = join(home, '.overdeck', 'plan-artifact-backups');
    if (existsSync(backupsDir)) {
      expect(readdirSync(backupsDir).filter((entry) => entry !== '.gitignore')).toEqual([]);
    }
  });

  it('backs up a differing untracked collision and reports it', async () => {
    const originContent = '{"issue":"PAN-1","from":"origin"}\n';
    const localContent = '{"issue":"PAN-1","from":"local"}\n';
    commitFile(other, '.pan/continues/PAN-1.xbrief.json', originContent, 'chore(workspace): continue PAN-1');
    at(other, 'push', '-q', 'origin', 'main');

    commitFile(home, '.pan/backlog/sequence.md', 'pass 1\n', 'chore(workspace): backlog sequence');
    writeUntracked(home, '.pan/continues/PAN-1.xbrief.json', localContent);

    const result = await pushPlanArtifacts(home);

    expect(result).toMatchObject({ pushed: true, rebased: true });
    const backedUp = result.pushed ? result.backedUp : undefined;
    expect(backedUp).toHaveLength(1);
    expect(backedUp?.[0]?.path).toBe('.pan/continues/PAN-1.xbrief.json');
    expect(readFileSync(backedUp![0].backup, 'utf8')).toBe(localContent);
    expect(at(home, 'rev-parse', 'HEAD')).toBe(originMain());
    expect(at(home, 'status', '--porcelain')).not.toContain('plan-artifact-backups');
  });

  it('restores the untracked collision unchanged when the move fails', async () => {
    commitFile(home, '.pan/state.md', 'v0\n', 'chore(workspace): state');
    at(home, 'push', '-q', 'origin', 'main');
    at(other, 'pull', '-q', 'origin', 'main');

    const content = '{"issue":"PAN-1"}\n';
    commitFile(other, '.pan/state.md', 'v1-remote\n', 'chore(workspace): state update');
    commitFile(other, '.pan/continues/PAN-1.xbrief.json', content, 'chore(workspace): continue PAN-1');
    at(other, 'push', '-q', 'origin', 'main');

    writeFileSync(join(home, '.pan', 'state.md'), 'v1-local\n', 'utf8');
    writeUntracked(home, '.pan/continues/PAN-1.xbrief.json', content);
    commitFile(home, '.pan/backlog/sequence.md', 'pass 1\n', 'chore(workspace): backlog sequence');
    const head = at(home, 'rev-parse', 'HEAD');

    const result = await pushPlanArtifacts(home);

    expect(result).toMatchObject({ pushed: true, rebased: true });
    expect(result.pushed && result.warning).toContain('could not move');
    expect(at(home, 'rev-parse', 'HEAD')).toBe(head);
    expect(readFileSync(join(home, '.pan', 'continues', 'PAN-1.xbrief.json'), 'utf8')).toBe(content);
    expect(at(home, 'status', '--porcelain', '--', '.pan/continues/PAN-1.xbrief.json')).toContain('??');
    expect(readFileSync(join(home, '.pan', 'state.md'), 'utf8')).toBe('v1-local\n');
  });
});
