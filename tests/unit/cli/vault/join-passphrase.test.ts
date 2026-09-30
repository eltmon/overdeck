import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PASSPHRASE_KEY_RETIRED_MESSAGE, PHRASE_MISMATCH_MESSAGE, joinCommand } from '../../../../src/cli/commands/vault/join.js';
import { listCommand } from '../../../../src/cli/commands/vault/list.js';
import { saveCommand } from '../../../../src/cli/commands/vault/save.js';
import { setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { syncCommand } from '../../../../src/cli/commands/vault/sync.js';
import { readVaultConfig } from '../../../../src/lib/vault/config.js';
import { readSessionRecord, refName, type SessionRecord } from '../../../../src/lib/vault/format.js';
import { deriveSubkeys, keyToPhrase } from '../../../../src/lib/vault/identity.js';
import { PASSPHRASE_MISMATCH_MESSAGE } from '../../../../src/lib/vault/keywrap.js';
import { listOwned, readListCache } from '../../../../src/lib/vault/local-index.js';
import { clearNextKey, rotateVaultKey } from '../../../../src/lib/vault/rotate.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
import { GitVaultStore } from '../../../../src/lib/vault/store/git.js';
import { KEYWRAP_OBJECT_NAME } from '../../../../src/lib/vault/store/types.js';
import { Fixture, captureIo, git, runCli, type CapturedIo } from './helpers.js';

const SESSION = 'jp000000-0000-4000-8000-000000000000';
const PASSPHRASE = 'quiet harbor lantern 42 mosaic';
const TITLE = 'the passphrase-joined title';

function user(text: string, cwd: string): string {
  return JSON.stringify({ type: 'user', sessionId: SESSION, cwd, message: { role: 'user', content: text } });
}
function assistant(text: string, cwd: string): string {
  return JSON.stringify({ type: 'assistant', sessionId: SESSION, cwd, message: { role: 'assistant', content: [{ type: 'text', text }] } });
}

/** A captured io whose readLine records every prompt and answers from `answers` in order. */
function promptingIo(answers: string[]): CapturedIo & { prompts: string[] } {
  const io = captureIo({ isTTY: true }) as CapturedIo & { prompts: string[] };
  io.prompts = [];
  io.readLine = async (prompt) => {
    io.prompts.push(prompt);
    return answers.shift() ?? '';
  };
  return io;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe.each(['dir', 'git'] as const)('pan vault join with a passphrase (%s backend)', (backend) => {
  let fx: Fixture;
  let url: string;
  let target: string;
  let phrase: string;
  let keyA: Buffer;

  function file(name: string, content: string): string {
    const path = join(fx.root, name);
    writeFileSync(path, content);
    return path;
  }

  /** Every file the backend holds: the dir tree, or every blob on the bare remote's main. */
  function backendBlobs(): Buffer[] {
    if (backend === 'dir') return filesUnder(target).map((path) => readFileSync(path));
    return git(target, 'ls-tree', '-r', '--name-only', 'main').trim().split('\n').map((path) =>
      execFileSync('git', ['cat-file', 'blob', `main:${path}`], { cwd: target }));
  }

  beforeEach(async () => {
    fx = new Fixture();
    if (backend === 'dir') {
      target = join(fx.root, 'vault-dir');
      url = `dir:${target}`;
    } else {
      target = fx.bareRepo();
      url = target;
    }
    const cwd = join(fx.root, 'repo');
    mkdirSync(cwd, { recursive: true });
    const { overdeckHome } = fx.useMachine('a');
    const setupIo = captureIo();
    expect(await runCli(() => setupCommand(url, { passphraseFile: file('p.txt', `${PASSPHRASE}\n`) }, setupIo))).toBe(0);
    phrase = setupIo.stdout.find((line) => line.trim().split(' ').length === 24)!.trim();
    keyA = readFileSync(join(overdeckHome, 'vault', 'key'));
    const nativePath = join(fx.root, `${SESSION}.jsonl`);
    writeFileSync(nativePath, `${user(TITLE, cwd)}\n${assistant('a reply', cwd)}\n`);
    expect(await runCli(() => saveCommand(nativePath, {}, captureIo()))).toBe(0);
    expect(await runCli(() => syncCommand({}, captureIo()))).toBe(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fx.cleanup();
  });

  it('ac1: a new machine joins with the passphrase, is never asked for the phrase, and lists the saved record', async () => {
    const { overdeckHome } = fx.useMachine('b');
    const io = promptingIo([PASSPHRASE]);
    expect(await runCli(() => joinCommand(url, {}, io))).toBe(0);
    expect(io.prompts).toHaveLength(1);
    expect(io.prompts.some((prompt) => prompt.includes('Recovery phrase'))).toBe(false);
    expect(readFileSync(join(overdeckHome, 'vault', 'key')).equals(keyA)).toBe(true);
    const list = captureIo();
    expect(await runCli(() => listCommand({}, list))).toBe(0);
    expect(list.stdout.some((line) => line.includes(TITLE))).toBe(true);
  });

  it('ac1: --passphrase-file joins without any prompt', async () => {
    const { overdeckHome } = fx.useMachine('b');
    const io = promptingIo([]);
    expect(await runCli(() => joinCommand(url, { passphraseFile: file('p.txt', PASSPHRASE) }, io))).toBe(0);
    expect(io.prompts).toEqual([]);
    expect(readFileSync(join(overdeckHome, 'vault', 'key')).equals(keyA)).toBe(true);
  });

  it('ac2: a wrong passphrase writes nothing and reads nothing but the keywrap', async () => {
    const { overdeckHome } = fx.useMachine('b');
    const methods = ['getObject', 'readRef', 'casRef', 'putObjects', 'putSlot', 'listRefs', 'hasObjects', 'refresh'] as const;
    const spies = Object.fromEntries(methods.map((method) => [method, vi.spyOn(DirVaultStore.prototype, method)]));
    const remoteMainBefore = backend === 'git' ? git(target, 'rev-parse', 'main').trim() : null;

    const io = promptingIo(['a wrong passphrase entirely']);
    expect(await runCli(() => joinCommand(url, {}, io))).toBe(1);
    expect(io.stderr).toEqual([PASSPHRASE_MISMATCH_MESSAGE]);
    expect(existsSync(join(overdeckHome, 'vault', 'key'))).toBe(false);
    expect((await readVaultConfig()).backend).toBeUndefined();

    if (backend === 'dir') {
      expect(spies.getObject!.mock.calls).toEqual([[KEYWRAP_OBJECT_NAME]]);
      for (const method of methods.filter((name) => name !== 'getObject')) expect(spies[method]).not.toHaveBeenCalled();
    } else {
      expect(existsSync(join(overdeckHome, 'vault', 'git'))).toBe(false);
      expect(git(target, 'rev-parse', 'main').trim()).toBe(remoteMainBefore);
    }
  });

  it('an empty passphrase answer falls back to the recovery phrase', async () => {
    const { overdeckHome } = fx.useMachine('b');
    const io = promptingIo(['', phrase]);
    expect(await runCli(() => joinCommand(url, {}, io))).toBe(0);
    expect(io.prompts).toHaveLength(2);
    expect(io.prompts[1]).toContain('Recovery phrase');
    expect(readFileSync(join(overdeckHome, 'vault', 'key')).equals(keyA)).toBe(true);
  });

  it('refuses --phrase-file together with --passphrase-file', async () => {
    fx.useMachine('b');
    const io = captureIo();
    expect(await runCli(() => joinCommand(url, { phraseFile: file('ph.txt', phrase), passphraseFile: file('p.txt', PASSPHRASE) }, io))).toBe(1);
    expect(io.stderr).toEqual(['Use either --phrase-file or --passphrase-file, not both.']);
  });

  it('ac4: the backend holds neither the key nor the passphrase, and the keywrap has exactly eight fields', async () => {
    fx.useMachine('b');
    expect(await runCli(() => joinCommand(url, {}, promptingIo([PASSPHRASE])))).toBe(0);
    const needles = [
      keyA,
      Buffer.from(keyA.toString('hex'), 'utf8'),
      Buffer.from(keyA.toString('base64'), 'utf8'),
      Buffer.from(PASSPHRASE, 'utf8'),
    ];
    const blobs = backendBlobs();
    expect(blobs.length).toBeGreaterThan(3);
    for (const blob of blobs) {
      for (const needle of needles) expect(blob.includes(needle)).toBe(false);
    }
    const keywrap = backend === 'dir'
      ? readFileSync(join(target, 'objects', 'keywrap', 'v1'), 'utf8')
      : git(target, 'cat-file', 'blob', 'main:objects/keywrap/v1');
    expect(Object.keys(JSON.parse(keywrap)).sort()).toEqual(['N', 'ct', 'kdf', 'nonce', 'p', 'r', 'salt', 'v']);
  });
});

describe('pan vault join --passphrase-file on a vault without a keywrap', () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = new Fixture();
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('exits 1 with the recovery-phrase hint and removes the clone it created', async () => {
    const remote = fx.bareRepo();
    fx.useMachine('a');
    expect(await runCli(() => setupCommand(remote, { passphrase: false }, captureIo()))).toBe(0);
    const { overdeckHome } = fx.useMachine('b');
    const passphraseFile = join(fx.root, 'p.txt');
    writeFileSync(passphraseFile, PASSPHRASE);
    const io = captureIo();
    expect(await runCli(() => joinCommand(remote, { passphraseFile }, io))).toBe(1);
    expect(io.stderr).toEqual([`This vault has no passphrase set. Use the recovery phrase: pan vault join ${remote} --phrase-file <path>`]);
    expect(existsSync(join(overdeckHome, 'vault', 'git'))).toBe(false);
    expect(existsSync(join(overdeckHome, 'vault', 'key'))).toBe(false);
  });
});

describe('join after rotation', () => {
  let fx: Fixture;
  let remote: string;
  let cwd: string;
  let oldPhrase: string;
  let homeA: string;
  let homeB: string;
  let nativeB: string;

  function file(name: string, content: string): string {
    const path = join(fx.root, name);
    writeFileSync(path, content);
    return path;
  }

  /** Machine A replaces the vault key, as `pan vault rotate-key` does; returns the new key. */
  async function rotateOnA(keywrap?: Uint8Array | null): Promise<Buffer> {
    fx.useMachine('a');
    const store = await GitVaultStore.open(join(homeA, 'vault', 'git'));
    const { newKey } = await rotateVaultKey({ store, currentKey: readFileSync(join(homeA, 'vault', 'key')), keywrap });
    await clearNextKey();
    return newKey;
  }

  beforeEach(async () => {
    fx = new Fixture();
    remote = fx.bareRepo();
    cwd = join(fx.root, 'repo');
    mkdirSync(cwd, { recursive: true });
    homeA = fx.useMachine('a').overdeckHome;
    const setupIo = captureIo();
    expect(await runCli(() => setupCommand(remote, { passphraseFile: file('p.txt', `${PASSPHRASE}\n`) }, setupIo))).toBe(0);
    oldPhrase = setupIo.stdout.find((line) => line.trim().split(' ').length === 24)!.trim();

    homeB = fx.useMachine('b').overdeckHome;
    expect(await runCli(() => joinCommand(remote, { phraseFile: file('old-phrase.txt', oldPhrase) }, captureIo()))).toBe(0);
    nativeB = join(fx.root, `${SESSION}.jsonl`);
    writeFileSync(nativeB, `${user(TITLE, cwd)}\n${assistant('a reply', cwd)}\n`);
    expect(await runCli(() => saveCommand(nativeB, {}, captureIo()))).toBe(0);
    expect(await runCli(() => syncCommand({}, captureIo()))).toBe(0);
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('rejoin.ac1: a stale machine joins with the new phrase file, keeps its local index, and its next save appends to the renamed record', async () => {
    const newKey = await rotateOnA(null);
    fx.useMachine('b');
    const ownedBefore = await listOwned();
    const cacheBefore = await readListCache();
    const vaultId = ownedBefore[nativeB]!.vaultId;

    // Stale, B is refused.
    appendFileSync(nativeB, `${user('written after the rotation', cwd)}\n`);
    const refused = captureIo();
    expect(await runCli(() => saveCommand(nativeB, {}, refused))).toBe(1);
    expect(refused.stdout.join('\n')).toContain("This machine's vault key was retired by a key rotation.");

    const joinIo = captureIo();
    expect(await runCli(() => joinCommand(remote, { phraseFile: file('new-phrase.txt', keyToPhrase(newKey)) }, joinIo))).toBe(0);
    expect(joinIo.stderr).toEqual([]);
    expect(readFileSync(join(homeB, 'vault', 'key')).equals(newKey)).toBe(true);
    // The index entry survives; join's own sync already settled the line B wrote while it was refused.
    const ownedAfter = await listOwned();
    expect(Object.keys(ownedAfter)).toEqual(Object.keys(ownedBefore));
    expect(ownedAfter[nativeB]).toMatchObject({ vaultId, harness: 'claude-code', tail: { lineCount: 3 } });
    expect((await readListCache()).map((row) => row.vaultId)).toEqual(cacheBefore.map((row) => row.vaultId));

    appendFileSync(nativeB, `${user('written after the re-join', cwd)}\n`);
    const save = captureIo();
    expect(await runCli(() => saveCommand(nativeB, {}, save))).toBe(0);
    expect(save.stdout).toEqual([expect.stringMatching(new RegExp(`: appended 1 line \\(vault ${vaultId.slice(0, 8)}, version 3\\)`))]);

    const keys = deriveSubkeys(newKey);
    const name = refName('record', vaultId, keys.K_ref);
    const blob = execFileSync('git', ['cat-file', 'blob', `main:refs/${name}`], { cwd: remote });
    const record = (await readSessionRecord(name, blob, keys)) as SessionRecord;
    expect(record.vaultId).toBe(vaultId);
    expect(record.settlements.map((entry) => entry.lines)).toEqual([2, 3, 4]);
    expect(record.log).toHaveLength(3);
  });

  it('rejoin.ac2: the old phrase prints the FR-12 message and writes nothing', async () => {
    // The keywrap is left as it was: it still wraps the retired key.
    await rotateOnA();
    const head = git(remote, 'rev-parse', 'main').trim();
    fx.useMachine('b');
    const keyBefore = readFileSync(join(homeB, 'vault', 'key'));

    const byPhrase = captureIo();
    expect(await runCli(() => joinCommand(remote, { phraseFile: file('old-phrase.txt', oldPhrase) }, byPhrase))).toBe(1);
    expect(byPhrase.stderr).toEqual([PHRASE_MISMATCH_MESSAGE]);
    expect(byPhrase.stderr).toEqual(['The recovery phrase does not match this vault. If the vault key was rotated, use the new recovery phrase or passphrase.']);

    const byPassphrase = captureIo();
    expect(await runCli(() => joinCommand(remote, { passphraseFile: file('p.txt', PASSPHRASE) }, byPassphrase))).toBe(1);
    expect(byPassphrase.stderr).toEqual([PASSPHRASE_KEY_RETIRED_MESSAGE]);
    expect(byPassphrase.stderr).toEqual(['The passphrase unlocked a key this vault no longer uses. The vault key was rotated; use the new recovery phrase, or finish the rotation with pan vault rotate-key on the machine that started it.']);

    expect(readFileSync(join(homeB, 'vault', 'key')).equals(keyBefore)).toBe(true);
    expect(existsSync(join(homeB, 'vault', 'git'))).toBe(true);
    expect(git(remote, 'rev-parse', 'main').trim()).toBe(head);

    // A machine that never joined gets the same answer and keeps nothing.
    const { overdeckHome: homeC } = fx.useMachine('c');
    const fresh = captureIo();
    expect(await runCli(() => joinCommand(remote, { phraseFile: file('old-phrase.txt', oldPhrase) }, fresh))).toBe(1);
    expect(fresh.stderr).toEqual([PHRASE_MISMATCH_MESSAGE]);
    expect(existsSync(join(homeC, 'vault', 'key'))).toBe(false);
    expect(existsSync(join(homeC, 'vault', 'git'))).toBe(false);
  });

  it('rejoin.ac3: an untracked object left in the stale clone is gone after join and is never pushed', async () => {
    fx.useMachine('b');
    const cloneB = join(homeB, 'vault', 'git');
    const stray = 'ab' + 'c'.repeat(38);
    await (await GitVaultStore.open(cloneB)).putObjects([{ id: stray, bytes: Buffer.from('sealed under the retired key') }]);
    expect(existsSync(join(cloneB, 'objects', 'ab', stray))).toBe(true);

    const newKey = await rotateOnA(null);
    fx.useMachine('b');
    expect(await runCli(() => joinCommand(remote, { phraseFile: file('new-phrase.txt', keyToPhrase(newKey)) }, captureIo()))).toBe(0);
    expect(existsSync(join(cloneB, 'objects', 'ab', stray))).toBe(false);

    appendFileSync(nativeB, `${user('after the re-join', cwd)}\n`);
    expect(await runCli(() => saveCommand(nativeB, {}, captureIo()))).toBe(0);
    expect(await runCli(() => syncCommand({}, captureIo()))).toBe(0);
    expect(git(remote, 'log', '--all', '--name-only', '--format=')).not.toContain(stray);
    expect(git(remote, 'ls-tree', '-r', '--name-only', 'main')).not.toContain(stray);
  });
});
