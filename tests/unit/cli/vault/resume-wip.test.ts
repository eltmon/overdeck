import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { joinCommand } from '../../../../src/cli/commands/vault/join.js';
import { resumeCommand } from '../../../../src/cli/commands/vault/resume.js';
import { saveCommand } from '../../../../src/cli/commands/vault/save.js';
import { setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { syncCommand } from '../../../../src/cli/commands/vault/sync.js';
import { writeVaultConfig } from '../../../../src/lib/vault/config.js';
import { readListCache } from '../../../../src/lib/vault/local-index.js';
import { Fixture, captureIo, git, runCli } from './helpers.js';

const SESSION = 'rwip0000-0000-4000-8000-000000000000';
const EXCLUDED = new Set(['.git', 'plain.log']);

function snapshotTree(root: string, dir = root): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (dir === root && EXCLUDED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, snapshotTree(root, path));
    else {
      const exec = (statSync(path).mode & 0o111) !== 0 ? 'x' : '-';
      out[relative(root, path)] = `${exec}${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
    }
  }
  return out;
}

function indexHash(repo: string): string {
  const index = resolve(repo, git(repo, 'rev-parse', '--git-path', 'index').trim());
  return createHash('sha256').update(readFileSync(index)).digest('hex');
}

function status(repo: string): string {
  return git(repo, '--no-optional-locks', 'status', '--porcelain=v1', '--untracked-files=all');
}

describe('pan vault resume with a code snapshot', () => {
  let fx: Fixture;
  let vaultRemote: string;
  let project: string;
  let repoA: string;
  let phrase: string;
  let nativePath: string;

  beforeEach(async () => {
    fx = new Fixture();
    vaultRemote = fx.bareRepo('vault.git');
    project = fx.bareRepo('project.git');
    git(project, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    repoA = join(fx.root, 'repo-a');
    git(fx.root, 'init', '-q', '-b', 'main', repoA);
    configure(repoA);
    writeFileSync(join(repoA, '.gitignore'), '*.log\n');
    writeFileSync(join(repoA, 'mod.txt'), 'one\n');
    writeFileSync(join(repoA, 'del.txt'), 'delete me\n');
    git(repoA, 'add', '-A');
    git(repoA, 'commit', '-q', '-m', 'pushed');
    git(repoA, 'remote', 'add', 'origin', project);
    git(repoA, 'push', '-q', '-u', 'origin', 'main');

    fx.useMachine('a');
    const setupIo = captureIo();
    await runCli(() => setupCommand(vaultRemote, {}, setupIo));
    phrase = setupIo.stdout.find((line) => line.trim().split(' ').length === 24)!.trim();
    nativePath = join(fx.root, `${SESSION}.jsonl`);
    writeFileSync(
      nativePath,
      `${JSON.stringify({ type: 'user', sessionId: SESSION, cwd: repoA, message: { role: 'user', content: 'carry my code' } })}\n`,
    );
  });

  afterEach(() => {
    fx.cleanup();
  });

  function configure(repo: string): void {
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'config', 'user.email', 'test@example.invalid');
  }

  function makeDirty(): void {
    writeFileSync(join(repoA, 'unpushed.txt'), 'local commit\n');
    git(repoA, 'add', 'unpushed.txt');
    git(repoA, 'commit', '-q', '-m', 'unpushed');
    writeFileSync(join(repoA, 'staged.txt'), 'staged\n');
    git(repoA, 'add', 'staged.txt');
    writeFileSync(join(repoA, 'mod.txt'), 'one\ntwo\n');
    writeFileSync(join(repoA, 'untracked.txt'), 'untracked\n');
    unlinkSync(join(repoA, 'del.txt'));
    writeFileSync(join(repoA, 'bin.dat'), randomBytes(2048));
    writeFileSync(join(repoA, 'plain.log'), 'ignored\n');
  }

  /** Save on A (forced capture), sync, then switch to machine B with its own clone. */
  async function saveOnAThenJoinB(): Promise<{ vaultId: string; repoB: string; projectsRoot: string }> {
    const saved = captureIo();
    await runCli(() => saveCommand(nativePath, {}, saved));
    await runCli(() => syncCommand({}, captureIo()));
    const vaultId = (await readListCache())[0]!.vaultId;
    const { home } = fx.useMachine('b');
    const phraseFile = join(fx.root, 'phrase.txt');
    writeFileSync(phraseFile, phrase);
    await runCli(() => joinCommand(vaultRemote, { phraseFile }, captureIo()));
    const repoB = join(fx.root, 'repo-b');
    git(fx.root, 'clone', '-q', project, repoB);
    configure(repoB);
    return { vaultId, repoB, projectsRoot: join(home, '.claude', 'projects') };
  }

  it('AC-1: B gets A\'s working tree byte for byte at A\'s HEAD', async () => {
    makeDirty();
    const { vaultId, repoB, projectsRoot } = await saveOnAThenJoinB();
    const io = captureIo();
    expect(await runCli(() => resumeCommand(vaultId, { cwd: repoB, launch: false }, io, { projectsRoot }))).toBe(0);
    expect(io.stdout.some((line) => line.startsWith('Applied code snapshot from ') && line.endsWith(` at ${repoB}`))).toBe(true);
    expect(snapshotTree(repoB)).toEqual(snapshotTree(repoA));
    expect(existsSync(join(repoB, 'plain.log'))).toBe(false);
    expect(git(repoB, 'rev-parse', 'HEAD').trim()).toBe(git(repoA, 'rev-parse', 'HEAD').trim());
    expect(io.stdout.find((line) => line.includes('claude --resume'))!.startsWith(`cd ${repoB} &&`)).toBe(true);
  }, 60_000);

  it('a dirty B without a TTY refuses, names --worktree, and changes nothing', async () => {
    makeDirty();
    const { vaultId, repoB, projectsRoot } = await saveOnAThenJoinB();
    writeFileSync(join(repoB, 'mine.txt'), 'local work\n');
    const statusBefore = status(repoB);
    const indexBefore = indexHash(repoB);
    const io = captureIo({ isTTY: false });
    expect(await runCli(() => resumeCommand(vaultId, { cwd: repoB, launch: false }, io, { projectsRoot }))).toBe(1);
    expect(io.stderr.join('\n')).toContain('--worktree');
    expect(status(repoB)).toBe(statusBefore);
    expect(indexHash(repoB)).toBe(indexBefore);
    expect(existsSync(projectsRoot)).toBe(false);
    await runCli(() => syncCommand({}, captureIo()));
    expect((await readListCache())[0]!.ownerIsHere).toBe(false);
  }, 60_000);

  it('a dirty B with --worktree applies into the new worktree and launches there', async () => {
    makeDirty();
    const { vaultId, repoB, projectsRoot } = await saveOnAThenJoinB();
    writeFileSync(join(repoB, 'mine.txt'), 'local work\n');
    const statusBefore = status(repoB);
    const worktree = join(fx.root, 'b-worktree');
    const spawn = vi.fn(async () => 0);
    const io = captureIo();
    expect(await runCli(() => resumeCommand(vaultId, { cwd: repoB, worktree }, io, { projectsRoot, spawn }))).toBe(0);
    expect(snapshotTree(worktree)).toEqual(snapshotTree(repoA));
    expect(status(repoB)).toBe(statusBefore);
    expect(spawn).toHaveBeenCalledWith('claude', ['--resume', expect.stringMatching(/^[0-9a-f-]{36}$/)], worktree);
  }, 60_000);

  it('a dirty B at a TTY answering yes gets the default worktree', async () => {
    makeDirty();
    const { vaultId, repoB, projectsRoot } = await saveOnAThenJoinB();
    writeFileSync(join(repoB, 'mine.txt'), 'local work\n');
    const io = captureIo({ isTTY: true, answers: ['y'] });
    expect(await runCli(() => resumeCommand(vaultId, { cwd: repoB, launch: false }, io, { projectsRoot }))).toBe(0);
    const fallback = `${repoB}-vault-${vaultId.slice(0, 8)}`;
    expect(snapshotTree(fallback)).toEqual(snapshotTree(repoA));
    expect(io.stdout.find((line) => line.includes('claude --resume'))!.startsWith(`cd ${fallback} &&`)).toBe(true);
  }, 60_000);

  it('--no-code leaves the clean clone untouched and keeps the drift check', async () => {
    makeDirty();
    const { vaultId, repoB, projectsRoot } = await saveOnAThenJoinB();
    const before = snapshotTree(repoB);
    const cancelled = captureIo({ isTTY: false });
    expect(await runCli(() => resumeCommand(vaultId, { cwd: repoB, launch: false, code: false }, cancelled, { projectsRoot }))).toBe(1);
    expect(cancelled.stderr[0]).toContain('Cancelled');
    const io = captureIo();
    expect(await runCli(() => resumeCommand(vaultId, { cwd: repoB, launch: false, code: false, onDrift: 'continue' }, io, { projectsRoot }))).toBe(0);
    expect(snapshotTree(repoB)).toEqual(before);
    expect(io.stdout.some((line) => line.startsWith('Applied code snapshot'))).toBe(false);
  }, 60_000);

  it('a too-large latest entry is reported and the drift check runs', async () => {
    await writeVaultConfig({ wipMaxBytes: 10 });
    makeDirty();
    const { vaultId, repoB, projectsRoot } = await saveOnAThenJoinB();
    const io = captureIo();
    expect(await runCli(() => resumeCommand(vaultId, { cwd: repoB, launch: false, onDrift: 'continue' }, io, { projectsRoot }))).toBe(0);
    expect(io.stdout.join('\n')).toContain('No code snapshot: skipped (too-large');
    expect(existsSync(join(repoB, 'untracked.txt'))).toBe(false);
  }, 60_000);
});
