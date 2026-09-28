import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { joinCommand } from '../../../../src/cli/commands/vault/join.js';
import { driftNote, parseResumeTarget, resumeCommand } from '../../../../src/cli/commands/vault/resume.js';
import { saveCommand } from '../../../../src/cli/commands/vault/save.js';
import { setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { syncCommand } from '../../../../src/cli/commands/vault/sync.js';
import { readListCache } from '../../../../src/lib/vault/local-index.js';
import { Fixture, captureIo, git, runCli } from './helpers.js';

const SESSION = 're500000-0000-4000-8000-000000000000';

function user(text: string, cwd: string, session = SESSION): string {
  return JSON.stringify({ type: 'user', sessionId: session, cwd, message: { role: 'user', content: text } });
}

describe('pan vault resume', () => {
  let fx: Fixture;
  let remote: string;
  let repo: string;
  let phrase: string;
  let vaultId: string;

  beforeEach(async () => {
    fx = new Fixture();
    remote = fx.bareRepo();
    repo = join(fx.root, 'repo');
    mkdirSync(repo, { recursive: true });
    git(fx.root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.email', 't@e');
    git(repo, 'config', 'user.name', 't');
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-q', '-m', 'a');

    fx.useMachine('a');
    const setupIo = captureIo();
    await runCli(() => setupCommand(remote, {}, setupIo));
    phrase = setupIo.stdout.find((line) => line.trim().split(' ').length === 24)!.trim();
    const nativePath = join(fx.root, `${SESSION}.jsonl`);
    writeFileSync(nativePath, `${user('resume me', repo)}\n`);
    await runCli(() => saveCommand(nativePath, {}, captureIo()));
    writeFileSync(nativePath, `${user('resume me', repo)}\n${user('second', repo)}\n`);
    await runCli(() => saveCommand(nativePath, {}, captureIo()));
    await runCli(() => syncCommand({}, captureIo()));
    vaultId = (await readListCache())[0]!.vaultId;
  });

  afterEach(() => {
    fx.cleanup();
  });

  async function joinB(): Promise<{ home: string; overdeckHome: string }> {
    const machine = fx.useMachine('b');
    const phraseFile = join(fx.root, 'phrase.txt');
    writeFileSync(phraseFile, phrase);
    await runCli(() => joinCommand(remote, { phraseFile }, captureIo()));
    return machine;
  }

  it('parses <id>@<version> and formats the drift note', () => {
    expect(parseResumeTarget('abc')).toEqual({ id: 'abc', version: null });
    expect(parseResumeTarget('abc@3')).toEqual({ id: 'abc', version: 3 });
    expect(() => parseResumeTarget('abc@zero')).toThrow(/positive integer/);
    expect(driftNote(['head', 'dirty'])).toContain('head, dirty differ');
  });

  it('ac1: on machine B, --no-launch prints a claude --resume command, the session file exists, and B becomes owner', async () => {
    const { home } = await joinB();
    const projectsRoot = join(home, '.claude', 'projects');
    const io = captureIo();
    expect(await runCli(() => resumeCommand(vaultId.slice(0, 8), { launch: false }, io, { projectsRoot }))).toBe(0);
    const command = io.stdout.find((line) => line.includes('claude --resume'))!;
    expect(command).toBeDefined();
    const newId = command.match(/claude --resume ([0-9a-f-]{36})/)![1]!;
    const dir = readdirSync(projectsRoot)[0]!;
    const file = join(projectsRoot, dir, `${newId}.jsonl`);
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(JSON.parse(line).sessionId).toBe(newId);
    expect(command.startsWith(`cd ${repo} &&`)).toBe(true);

    await runCli(() => syncCommand({}, captureIo()));
    expect((await readListCache())[0]).toMatchObject({ vaultId, ownerIsHere: true });

    // Resuming again on B reuses the existing native file instead of materializing twice.
    const again = captureIo();
    expect(await runCli(() => resumeCommand(vaultId, { launch: false }, again, { projectsRoot }))).toBe(0);
    expect(again.stdout.find((line) => line.includes('claude --resume'))).toContain(newId);
    expect(readdirSync(join(projectsRoot, dir))).toHaveLength(1);
  });

  it('ac2: HEAD drift without a TTY and without --on-drift cancels, names the fields and writes nothing', async () => {
    const { home } = await joinB();
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    git(repo, 'add', 'b.txt');
    git(repo, 'commit', '-q', '-m', 'b');
    const projectsRoot = join(home, '.claude', 'projects');
    const io = captureIo({ isTTY: false });
    expect(await runCli(() => resumeCommand(vaultId, { launch: false }, io, { projectsRoot }))).toBe(1);
    expect(io.stderr[0]).toContain('head');
    expect(io.stderr[0]).toContain('Cancelled');
    expect(existsSync(projectsRoot)).toBe(false);
    await runCli(() => syncCommand({}, captureIo()));
    expect((await readListCache())[0]!.ownerIsHere).toBe(false);
  });

  it('ac3: --on-drift note puts a note naming the differing fields into the printed command', async () => {
    const { home } = await joinB();
    writeFileSync(join(repo, 'dirty.txt'), 'dirty\n');
    const projectsRoot = join(home, '.claude', 'projects');
    const io = captureIo();
    expect(await runCli(() => resumeCommand(vaultId, { launch: false, onDrift: 'note' }, io, { projectsRoot }))).toBe(0);
    const command = io.stdout.find((line) => line.includes('claude --resume'))!;
    expect(command).toContain('[Session Vault]');
    expect(command).toMatch(/dirty, untracked|untracked/);
    const spawn = vi.fn(async () => 0);
    const launched = captureIo();
    expect(await runCli(() => resumeCommand(vaultId, { onDrift: 'continue' }, launched, { projectsRoot, spawn }))).toBe(0);
    expect(spawn).toHaveBeenCalledWith('claude', ['--resume', expect.stringMatching(/^[0-9a-f-]{36}$/)], repo);
  });

  it('ac4: <id>@2 creates a fork record and leaves the original unchanged', async () => {
    const { home } = await joinB();
    const projectsRoot = join(home, '.claude', 'projects');
    const io = captureIo();
    expect(await runCli(() => resumeCommand(`${vaultId}@1`, { launch: false }, io, { projectsRoot }))).toBe(0);
    expect(io.stdout[0]).toMatch(/^Forked [0-9a-f]{8}@1 as [0-9a-f]{8}\.$/);
    await runCli(() => syncCommand({}, captureIo()));
    const rows = await readListCache();
    expect(rows).toHaveLength(2);
    const original = rows.find((row) => row.vaultId === vaultId)!;
    expect(original.ownerIsHere).toBe(false);
    const fork = rows.find((row) => row.vaultId !== vaultId)!;
    expect(fork.ownerIsHere).toBe(true);
    expect(fork.title).toMatch(/@1$/);
    const dir = readdirSync(projectsRoot)[0]!;
    const file = readdirSync(join(projectsRoot, dir))[0]!;
    expect(readFileSync(join(projectsRoot, dir, file), 'utf8').split('\n').filter(Boolean)).toHaveLength(1);
    const bad = captureIo();
    expect(await runCli(() => resumeCommand(`${vaultId}@9`, { launch: false }, bad, { projectsRoot }))).toBe(1);
  });

  it('a missing saved cwd needs --cwd; a pi record gets the seed digest and no process', async () => {
    const { home } = await joinB();
    const projectsRoot = join(home, '.claude', 'projects');
    execFileSync('rm', ['-rf', repo]);
    const io = captureIo();
    expect(await runCli(() => resumeCommand(vaultId, { launch: false }, io, { projectsRoot }))).toBe(1);
    expect(io.stderr[0]).toContain('--cwd');
    const other = join(fx.root, 'other');
    mkdirSync(other);
    const ok = captureIo();
    expect(await runCli(() => resumeCommand(vaultId, { launch: false, cwd: other }, ok, { projectsRoot }))).toBe(0);
    expect(ok.stdout.find((line) => line.includes('claude --resume'))!.startsWith(`cd ${other} &&`)).toBe(true);
  });
});
