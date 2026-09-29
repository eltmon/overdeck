import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listCommand } from '../../../../src/cli/commands/vault/list.js';
import { saveCommand } from '../../../../src/cli/commands/vault/save.js';
import { setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { ROTATION_UNFINISHED_MESSAGE, openVault } from '../../../../src/cli/commands/vault/shared.js';
import { statusCommand } from '../../../../src/cli/commands/vault/status.js';
import { syncCommand } from '../../../../src/cli/commands/vault/sync.js';
import { HEADER_REF_NAME, encryptRef, newVaultHeader, type VaultHeader } from '../../../../src/lib/vault/format.js';
import { createVaultKey, deriveSubkeys } from '../../../../src/lib/vault/identity.js';
import { KeyGuardedStore } from '../../../../src/lib/vault/keyring.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
import { initGitVault } from '../../../../src/lib/vault/store/git.js';
import type { VaultStore } from '../../../../src/lib/vault/store/types.js';
import { Fixture, captureIo, git, runCli } from './helpers.js';

const SESSION = 'ok000000-0000-4000-8000-000000000000';
const ROTATED_AT = '2026-09-29T12:00:00.000Z';
const RETIRED = (backend: string) =>
  `This machine's vault key was retired by a key rotation. Run: pan vault join ${backend} with the new recovery phrase or passphrase.`;
const MISMATCH = (backend: string) =>
  `This machine's vault key does not open ${backend}. If the key was rotated on another machine, run: pan vault join ${backend}`;

function user(text: string, cwd: string): string {
  return JSON.stringify({ type: 'user', sessionId: SESSION, cwd, message: { role: 'user', content: text } });
}

/** What a rotation does to the header: re-seal it under another key, the old key in its ring. */
async function rewriteHeader(store: VaultStore, retiredKey: Buffer, nextKey: Buffer): Promise<void> {
  const current = (await store.readRef(HEADER_REF_NAME))!;
  const header: VaultHeader = { ...newVaultHeader(new Date(0)), rotatedAt: ROTATED_AT, keyRing: [retiredKey.toString('base64')] };
  expect(await store.casRef(HEADER_REF_NAME, current.version, await encryptRef(HEADER_REF_NAME, header, deriveSubkeys(nextKey)))).toBe('ok');
}

describe('openVault key guard (PAN-4333)', () => {
  let fx: Fixture;
  let cwd: string;
  let nativePath: string;

  beforeEach(() => {
    fx = new Fixture();
    cwd = join(fx.root, 'repo');
    mkdirSync(cwd, { recursive: true });
    nativePath = join(fx.root, `${SESSION}.jsonl`);
    writeFileSync(nativePath, `${user('the first prompt', cwd)}\n`);
  });

  afterEach(() => {
    fx.cleanup();
  });

  async function setupDir(): Promise<{ url: string; target: string; overdeckHome: string }> {
    const target = join(fx.root, 'vault-dir');
    const url = `dir:${target}`;
    const { overdeckHome } = fx.useMachine('a');
    expect(await runCli(() => setupCommand(url, {}, captureIo()))).toBe(0);
    return { url, target, overdeckHome };
  }

  it('open.ac1: openVault on a machine whose key no longer opens the header exits 1 with the join hint', async () => {
    const { url, target, overdeckHome } = await setupDir();
    const opened = (await openVault(captureIo()))!;
    expect(opened.store).toBeInstanceOf(KeyGuardedStore);
    expect(opened.rotatedAt).toBeNull();
    expect(opened.keys.previous).toEqual([]);

    const key = readFileSync(join(overdeckHome, 'vault', 'key'));
    const nextKey = createVaultKey();
    await rewriteHeader(await DirVaultStore.open(target), key, nextKey);

    for (const verb of [
      (io: ReturnType<typeof captureIo>) => statusCommand({}, io),
      (io: ReturnType<typeof captureIo>) => listCommand({}, io),
      (io: ReturnType<typeof captureIo>) => syncCommand({}, io),
      (io: ReturnType<typeof captureIo>) => saveCommand(nativePath, {}, io),
    ]) {
      const io = captureIo();
      expect(await runCli(() => verb(io))).toBe(1);
      expect(io.stderr).toEqual([MISMATCH(url)]);
      expect(io.stdout).toEqual([]);
    }
    // The Stop hook stays silent and never fails the harness.
    const hook = captureIo();
    const hookInput = JSON.stringify({ session_id: SESSION, transcript_path: nativePath });
    expect(await runCli(() => saveCommand(undefined, { hook: true }, hook, { stdin: async () => hookInput }))).toBe(0);
    expect([...hook.stdout, ...hook.stderr]).toEqual([]);

    // With the new key in place the vault opens again, ring loaded.
    writeFileSync(join(overdeckHome, 'vault', 'key'), nextKey);
    const reopened = (await openVault(captureIo()))!;
    expect(reopened.rotatedAt).toBe(ROTATED_AT);
    expect(reopened.keys.previous).toEqual([deriveSubkeys(key)]);
  });

  it('open.ac2: key.next present exits 1 with the unfinished-rotation message, and save --hook exits 0 with no output', async () => {
    const { target, overdeckHome } = await setupDir();
    writeFileSync(join(overdeckHome, 'vault', 'key.next'), createVaultKey());
    const refsBefore = await (await DirVaultStore.open(target)).listRefs('');

    const status = captureIo();
    expect(await runCli(() => statusCommand({}, status))).toBe(1);
    expect(status.stderr).toEqual([ROTATION_UNFINISHED_MESSAGE]);
    expect(status.stderr).toEqual(['A vault key rotation started on this machine has not finished. Run: pan vault rotate-key']);
    expect(status.stdout).toEqual([]);
    const save = captureIo();
    expect(await runCli(() => saveCommand(nativePath, {}, save))).toBe(1);
    expect(save.stderr).toEqual([ROTATION_UNFINISHED_MESSAGE]);

    const hook = captureIo();
    const hookInput = JSON.stringify({ session_id: SESSION, transcript_path: nativePath });
    expect(await runCli(() => saveCommand(undefined, { hook: true }, hook, { stdin: async () => hookInput }))).toBe(0);
    expect([...hook.stdout, ...hook.stderr]).toEqual([]);
    expect(await (await DirVaultStore.open(target)).listRefs('')).toEqual(refsBefore);
  });

  it('open.ac3: on a git fixture, a stale machine whose clone predates the header change runs pan vault save, exits 1 with the retired-key message, and the bare remote gains no commit', async () => {
    const remote = fx.bareRepo();
    const { overdeckHome } = fx.useMachine('a');
    expect(await runCli(() => setupCommand(remote, {}, captureIo()))).toBe(0);
    expect(await runCli(() => saveCommand(nativePath, {}, captureIo()))).toBe(0);
    const key = readFileSync(join(overdeckHome, 'vault', 'key'));

    // Another machine replaces the header through its own clone.
    await rewriteHeader(await initGitVault(remote, join(fx.root, 'other-clone', 'git')), key, createVaultKey());
    const commits = git(remote, 'rev-list', '--count', 'main').trim();
    const head = git(remote, 'rev-parse', 'main').trim();

    appendFileSync(nativePath, `${user('written after the rotation', cwd)}\n`);
    const save = captureIo();
    expect(await runCli(() => saveCommand(nativePath, {}, save))).toBe(1);
    expect(save.stdout).toEqual([`${SESSION}.jsonl: error: ${RETIRED(remote)}`]);
    expect(git(remote, 'rev-list', '--count', 'main').trim()).toBe(commits);
    expect(git(remote, 'rev-parse', 'main').trim()).toBe(head);
    expect(git(join(overdeckHome, 'vault', 'git'), 'rev-list', '--count', 'origin/main..HEAD').trim()).toBe('0');

    // The clone now shows the new header, so the next verb is refused at the door.
    const sync = captureIo();
    expect(await runCli(() => syncCommand({}, sync))).toBe(1);
    expect(sync.stderr).toEqual([MISMATCH(remote)]);
    expect(git(remote, 'rev-parse', 'main').trim()).toBe(head);
  });

  it('pan vault sync on a stale clone prints the retired-key message and exits 1', async () => {
    const remote = fx.bareRepo();
    const { overdeckHome } = fx.useMachine('a');
    expect(await runCli(() => setupCommand(remote, {}, captureIo()))).toBe(0);
    const key = readFileSync(join(overdeckHome, 'vault', 'key'));
    await rewriteHeader(await initGitVault(remote, join(fx.root, 'other-clone', 'git')), key, createVaultKey());
    const head = git(remote, 'rev-parse', 'main').trim();

    const sync = captureIo();
    expect(await runCli(() => syncCommand({}, sync))).toBe(1);
    expect(sync.stderr).toEqual([RETIRED(remote)]);
    expect(sync.stdout).toEqual([]);
    expect(git(remote, 'rev-parse', 'main').trim()).toBe(head);
  });

  it('open.ac4: status prints Key rotated and exits 0 with an m/ ref sealed under an unknown key present', async () => {
    const { target, overdeckHome } = await setupDir();
    expect(await runCli(() => syncCommand({}, captureIo()))).toBe(0);
    const raw = await DirVaultStore.open(target);
    const junk = `m/${'0'.repeat(40)}`;
    const unknown = deriveSubkeys(createVaultKey());
    await raw.casRef(junk, null, await encryptRef(junk, { v: 1, type: 'machine', environmentId: 'ghost', label: 'ghost', updatedAt: ROTATED_AT }, unknown));

    const never = captureIo();
    expect(await runCli(() => statusCommand({}, never))).toBe(0);
    expect(never.stdout).toContain('Key rotated:    never');
    expect(never.stdout.indexOf('Key rotated:    never')).toBe(never.stdout.findIndex((line) => line.startsWith('Backend:')) + 1);
    expect(never.stdout.some((line) => line.includes('ghost'))).toBe(false);
    expect(never.stdout.filter((line) => line.includes('last sync'))).toHaveLength(1);
    const neverJson = captureIo();
    expect(await runCli(() => statusCommand({ json: true }, neverJson))).toBe(0);
    expect(JSON.parse(neverJson.stdout.join('\n'))).toMatchObject({ keyRotatedAt: null, machines: [expect.objectContaining({ label: expect.any(String) })] });

    // Sync counts the same ref instead of failing.
    const sync = captureIo();
    expect(await runCli(() => syncCommand({}, sync))).toBe(0);
    expect(sync.stdout[0]).toMatch(/; 1 unreadable ref\(s\)\.$/);

    // The same key, a header that records a rotation.
    const key = readFileSync(join(overdeckHome, 'vault', 'key'));
    const current = (await raw.readRef(HEADER_REF_NAME))!;
    const rotated: VaultHeader = { ...newVaultHeader(new Date(0)), rotatedAt: ROTATED_AT, keyRing: [createVaultKey().toString('base64')] };
    await raw.casRef(HEADER_REF_NAME, current.version, await encryptRef(HEADER_REF_NAME, rotated, deriveSubkeys(key)));
    const after = captureIo();
    expect(await runCli(() => statusCommand({}, after))).toBe(0);
    expect(after.stdout).toContain(`Key rotated:    ${ROTATED_AT}`);
    const afterJson = captureIo();
    expect(await runCli(() => statusCommand({ json: true }, afterJson))).toBe(0);
    expect(JSON.parse(afterJson.stdout.join('\n')).keyRotatedAt).toBe(ROTATED_AT);
    expect(existsSync(join(overdeckHome, 'vault', 'key.next'))).toBe(false);
  });
});
