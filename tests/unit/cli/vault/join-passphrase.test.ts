import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { joinCommand } from '../../../../src/cli/commands/vault/join.js';
import { listCommand } from '../../../../src/cli/commands/vault/list.js';
import { saveCommand } from '../../../../src/cli/commands/vault/save.js';
import { setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { syncCommand } from '../../../../src/cli/commands/vault/sync.js';
import { readVaultConfig } from '../../../../src/lib/vault/config.js';
import { PASSPHRASE_MISMATCH_MESSAGE } from '../../../../src/lib/vault/keywrap.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
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
