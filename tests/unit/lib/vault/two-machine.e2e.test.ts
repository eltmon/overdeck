/**
 * PAN-2609 end-to-end: two machines (two HOME/OVERDECK_HOME pairs), no
 * dashboard, no pan install, one local bare git remote. Runs the built command
 * functions directly, then scans every byte in the bare repository for the
 * fixture's distinctive strings and asserts only git subprocesses ran.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'node:util';

// Record every child process the code under test starts. The wrapper keeps
// execFile's promisify.custom so promisified callers still get { stdout }.
const childProcessCalls = vi.hoisted(() => ({ commands: [] as string[] }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const { promisify: promisifyUtil } = await import('node:util');
  const record = (command: unknown) => { childProcessCalls.commands.push(String(command)); };
  const execFile = ((...args: Parameters<typeof actual.execFile>) => {
    record(args[0]);
    return (actual.execFile as (...inner: unknown[]) => unknown)(...args);
  }) as typeof actual.execFile;
  const custom = (actual.execFile as unknown as Record<symbol, (...inner: unknown[]) => unknown>)[promisifyUtil.custom];
  Object.defineProperty(execFile, promisifyUtil.custom, {
    value: (...args: unknown[]) => { record(args[0]); return custom(...args); },
  });
  const spawn = ((...args: Parameters<typeof actual.spawn>) => {
    record(args[0]);
    return (actual.spawn as (...inner: unknown[]) => unknown)(...args);
  }) as typeof actual.spawn;
  const execFileSync = ((...args: Parameters<typeof actual.execFileSync>) => {
    record(args[0]);
    return (actual.execFileSync as (...inner: unknown[]) => unknown)(...args);
  }) as typeof actual.execFileSync;
  return { ...actual, default: { ...actual, execFile, spawn, execFileSync }, execFile, spawn, execFileSync };
});

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adoptRecord } from '../../../../src/lib/vault/adopt.js';
import { evictCommand } from '../../../../src/cli/commands/vault/evict.js';
import { joinCommand } from '../../../../src/cli/commands/vault/join.js';
import { listCommand } from '../../../../src/cli/commands/vault/list.js';
import { restoreCommand } from '../../../../src/cli/commands/vault/restore.js';
import { resumeCommand } from '../../../../src/cli/commands/vault/resume.js';
import { saveCommand } from '../../../../src/cli/commands/vault/save.js';
import { setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { syncCommand } from '../../../../src/cli/commands/vault/sync.js';
import type { CliIo } from '../../../../src/cli/commands/vault/shared.js';
import { readEnvironmentIdentity, type EnvironmentIdentity } from '../../../../src/lib/environment-identity.js';
import { writeVaultConfig } from '../../../../src/lib/vault/config.js';
import { deriveSubkeys, loadVaultKey } from '../../../../src/lib/vault/identity.js';
import { listOwned, readListCache } from '../../../../src/lib/vault/local-index.js';
import { GitVaultStore } from '../../../../src/lib/vault/store/git.js';

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

interface Captured extends CliIo {
  stdout: string[];
  stderr: string[];
}

function io(): Captured {
  const captured: Captured = {
    stdout: [],
    stderr: [],
    isTTY: false,
    out: (line) => { captured.stdout.push(line); },
    err: (line) => { captured.stderr.push(line); },
    exit: async (code) => { throw new ExitSignal(code); },
    readLine: async () => '',
  };
  return captured;
}

async function run(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn();
    return 0;
  } catch (error) {
    if (error instanceof ExitSignal) return error.code;
    throw error;
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
}

const TITLE = 'Quokka-migrates-the-lighthouse-ledger';
const PROJECT = 'lighthouse-ledger-quokka';
const LINE_TEXT = 'the tide tables mention a purple heron at 04:17';
const SESSION = 'e2e00000-0000-4000-8000-000000000000';

describe('Session Vault two-machine end-to-end', () => {
  let root: string;
  let remote: string;
  let cwdA: string;
  let originalEnv: { home?: string; overdeck?: string };
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const connectSpy = vi.spyOn(net, 'connect');

  function useMachine(name: string): { home: string; overdeckHome: string } {
    const home = join(root, name);
    process.env.HOME = home;
    process.env.OVERDECK_HOME = join(home, '.overdeck');
    return { home, overdeckHome: join(home, '.overdeck') };
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-e2e-'));
    originalEnv = { home: process.env.HOME, overdeck: process.env.OVERDECK_HOME };
    remote = join(root, 'remote.git');
    git(root, 'init', '--quiet', '--bare', remote);
    cwdA = join(root, PROJECT);
    mkdirSync(cwdA, { recursive: true });
    childProcessCalls.commands.length = 0;
    fetchSpy.mockClear();
    connectSpy.mockClear();
  });

  afterEach(() => {
    if (originalEnv.home === undefined) delete process.env.HOME; else process.env.HOME = originalEnv.home;
    if (originalEnv.overdeck === undefined) delete process.env.OVERDECK_HOME; else process.env.OVERDECK_HOME = originalEnv.overdeck;
    rmSync(root, { recursive: true, force: true });
  });

  it('setup on A, join on B, save, sync, list, resume, concurrent adoption, plaintext scan, evict and restore', async () => {
    // --- A: setup, save a transcript with distinctive strings, sync ---
    const { overdeckHome: homeA } = useMachine('machine-a');
    const setupIo = io();
    expect(await run(() => setupCommand(remote, {}, setupIo))).toBe(0);
    const phrase = setupIo.stdout.find((line) => line.trim().split(' ').length === 24)!.trim();
    const a = (await readEnvironmentIdentity())!;
    const nativePath = join(root, 'a-transcripts', `${SESSION}.jsonl`);
    mkdirSync(join(root, 'a-transcripts'));
    const lines = [
      JSON.stringify({ type: 'user', sessionId: SESSION, cwd: cwdA, message: { role: 'user', content: TITLE } }),
      JSON.stringify({ type: 'assistant', sessionId: SESSION, cwd: cwdA, message: { role: 'assistant', model: 'claude-fable-5-1', content: [{ type: 'text', text: LINE_TEXT }] } }),
      JSON.stringify({ type: 'user', sessionId: SESSION, cwd: cwdA, message: { role: 'user', content: 'thanks' } }),
    ];
    writeFileSync(nativePath, `${lines.join('\n')}\n`);
    const originalBytes = readFileSync(nativePath);
    const saveIo = io();
    expect(await run(() => saveCommand(nativePath, {}, saveIo))).toBe(0);
    expect(saveIo.stdout[0]).toMatch(/appended 3 lines/);
    expect(await run(() => syncCommand({}, io()))).toBe(0);
    const vaultId = (await readListCache())[0]!.vaultId;

    // --- B: join, sync, list shows A's conversation owned by A (ac1) ---
    const { home: homeBUser } = useMachine('machine-b');
    const phraseFile = join(root, 'phrase.txt');
    writeFileSync(phraseFile, phrase);
    expect(await run(() => joinCommand(remote, { phraseFile }, io()))).toBe(0);
    expect(await run(() => syncCommand({}, io()))).toBe(0);
    const listIo = io();
    expect(await run(() => listCommand({}, listIo))).toBe(0);
    const row = listIo.stdout.find((line) => line.includes(TITLE))!;
    expect(row).toBeDefined();
    expect(row).toContain(a.label);
    expect(row).not.toContain('(this machine)');
    expect((await readListCache())[0]).toMatchObject({ vaultId, ownerLabel: a.label, ownerIsHere: false });

    // --- B: resume --no-launch materializes under ~/.claude/projects and takes ownership ---
    const cwdB = join(root, 'b-checkout');
    mkdirSync(cwdB);
    const resumeIo = io();
    expect(await run(() => resumeCommand(vaultId, { launch: false, cwd: cwdB }, resumeIo))).toBe(0);
    const command = resumeIo.stdout.find((line) => line.includes('claude --resume'))!;
    const newId = command.match(/claude --resume ([0-9a-f-]{36})/)![1]!;
    const projectsRoot = join(homeBUser, '.claude', 'projects');
    const projectDir = readdirSync(projectsRoot)[0]!;
    const materialized = readFileSync(join(projectsRoot, projectDir, `${newId}.jsonl`), 'utf8').split('\n').filter(Boolean);
    expect(materialized).toHaveLength(3);
    expect(materialized.map((line) => JSON.parse(line).cwd)).toEqual([cwdB, cwdB, cwdB]);
    expect(materialized[1]).toContain(LINE_TEXT);

    // --- concurrent adoption by two further machines yields exactly one owner ---
    const c: EnvironmentIdentity = { v: 1, environmentId: 'env-c', label: 'machine-c', createdAt: 'x' };
    const d: EnvironmentIdentity = { v: 1, environmentId: 'env-d', label: 'machine-d', createdAt: 'x' };
    const keysB = deriveSubkeys((await loadVaultKey())!);
    const storeB = await GitVaultStore.open(join(process.env.OVERDECK_HOME!, 'vault', 'git'));
    const [rc, rd] = await Promise.all([
      adoptRecord({ vaultId, store: storeB, keys: keysB, targetCwd: cwdB, identity: c, projectsRoot: join(root, 'proj-c') }),
      adoptRecord({ vaultId, store: storeB, keys: keysB, targetCwd: cwdB, identity: d, projectsRoot: join(root, 'proj-d') }),
    ]);
    expect([rc, rd].filter((result) => result.adopted)).toHaveLength(1);
    const loser = [rc, rd].find((result) => !result.adopted) as { alreadyContinuedOn: string };
    const winner = [rc, rd].find((result) => result.adopted) as { newSessionId: string };
    expect(loser.alreadyContinuedOn).toBe(winner.newSessionId ? (rc.adopted ? c.label : d.label) : '');
    expect(existsSync(join(root, rc.adopted ? 'proj-d' : 'proj-c'))).toBe(false);

    // --- ac2: no plaintext anywhere in the bare repository ---
    const objects = git(remote, 'cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)').trim().split('\n');
    expect(objects.length).toBeGreaterThan(5);
    const needles = [LINE_TEXT, TITLE, cwdA, PROJECT, SESSION, 'purple heron'];
    for (const entry of objects) {
      const [sha, type] = entry.split(' ') as [string, string];
      if (type !== 'blob' && type !== 'commit' && type !== 'tree') continue;
      const bytes = execFileSync('git', ['cat-file', type, sha], { cwd: remote, maxBuffer: 64 * 1024 * 1024 });
      const text = bytes.toString('latin1');
      for (const needle of needles) expect(text, `${type} ${sha} leaks ${needle}`).not.toContain(needle);
    }
    // Ref names are keyed HMACs, never ids.
    const tree = git(remote, 'ls-tree', '-r', '--name-only', 'main');
    expect(tree).not.toContain(vaultId);
    expect(tree).not.toContain(a.environmentId);

    // --- A: after B adopted, sync shows B as owner, A's bytes unchanged; evict review/confirm/restore (ac3) ---
    useMachine('machine-a');
    expect(await run(() => syncCommand({}, io()))).toBe(0);
    expect((await readListCache())[0]!.ownerIsHere).toBe(false);
    expect(readFileSync(nativePath).equals(originalBytes)).toBe(true);

    // Eviction is scoped to records this machine still owns, so save a second transcript on A.
    await writeVaultConfig({ evict: true });
    const evictPath = join(root, 'a-transcripts', 'ev000000-0000-4000-8000-000000000000.jsonl');
    writeFileSync(evictPath, `${JSON.stringify({ type: 'user', sessionId: 'ev000000-0000-4000-8000-000000000000', cwd: cwdA, message: { role: 'user', content: 'evict me' } })}\n`);
    expect(await run(() => saveCommand(evictPath, {}, io()))).toBe(0);
    const evictBytes = readFileSync(evictPath);
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(evictPath, old, old);
    const review = io();
    expect(await run(() => evictCommand({}, review))).toBe(0);
    expect(review.stdout.join('\n')).toContain(evictPath);
    expect(review.stdout.join('\n')).not.toContain(nativePath);
    const fingerprint = review.stdout.find((line) => line.startsWith('Fingerprint: '))!.slice('Fingerprint: '.length);
    expect(existsSync(evictPath)).toBe(true);
    expect(await run(() => evictCommand({ confirm: fingerprint }, io()))).toBe(0);
    expect(existsSync(evictPath)).toBe(false);
    expect(existsSync(nativePath)).toBe(true);
    const evictedId = (await listOwned())[evictPath]!.vaultId;
    const restoreIo = io();
    expect(await run(() => restoreCommand(evictedId, {}, restoreIo))).toBe(0);
    expect(readFileSync(evictPath).equals(evictBytes)).toBe(true);
    expect(existsSync(join(homeA, 'vault', 'eviction-batch.json'))).toBe(true);

    // --- ac4: no network, only git subprocesses ---
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(connectSpy).not.toHaveBeenCalled();
    expect(childProcessCalls.commands.length).toBeGreaterThan(0);
    expect(new Set(childProcessCalls.commands)).toEqual(new Set(['git']));
    void promisify;
  });
});
