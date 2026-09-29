import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { passphraseSetCommand } from '../../../../src/cli/commands/vault/passphrase.js';
import {
  ROTATE_CONFIRM_PROMPT,
  ROTATE_KEY_MISMATCH_MESSAGE,
  rotateKeyCommand,
} from '../../../../src/cli/commands/vault/rotate-key.js';
import { saveCommand } from '../../../../src/cli/commands/vault/save.js';
import { setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { GENERATED_PASSPHRASE_PREFIX } from '../../../../src/cli/commands/vault/shared.js';
import { statusCommand } from '../../../../src/cli/commands/vault/status.js';
import { syncCommand } from '../../../../src/cli/commands/vault/sync.js';
import { VAULT_OFF_MESSAGE } from '../../../../src/lib/vault/config.js';
import { createVaultKey, phraseToKey } from '../../../../src/lib/vault/identity.js';
import { PASSPHRASE_LATER_HINT, PASSPHRASE_LENGTH_MESSAGE, unwrapVaultKey } from '../../../../src/lib/vault/keywrap.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
import { Fixture, captureIo, runCli, type CapturedIo } from './helpers.js';

const SESSION = 'rk000000-0000-4000-8000-000000000000';
const PASSPHRASE = 'quiet harbor lantern 42 mosaic';
const OTHER_PASSPHRASE = 'amber tundra violin 17 orchard';

function user(text: string, cwd: string): string {
  return JSON.stringify({ type: 'user', sessionId: SESSION, cwd, message: { role: 'user', content: text } });
}

function printedPhrase(io: CapturedIo): string {
  return io.stdout.find((line) => line.trim().split(' ').length === 24)!.trim();
}

describe('pan vault rotate-key', () => {
  let fx: Fixture;
  let vaultRoot: string;
  let url: string;
  let keyPath: string;
  let nextKeyPath: string;
  let slotPath: string;
  let oldKey: Buffer;

  function file(name: string, content: string): string {
    const path = join(fx.root, name);
    writeFileSync(path, content);
    return path;
  }

  async function backendState(): Promise<{ refs: Array<{ name: string; version: string }>; slot: Buffer | null }> {
    const store = await DirVaultStore.open(vaultRoot);
    return { refs: await store.listRefs(''), slot: existsSync(slotPath) ? readFileSync(slotPath) : null };
  }

  beforeEach(async () => {
    fx = new Fixture();
    vaultRoot = join(fx.root, 'vault-dir');
    url = `dir:${vaultRoot}`;
    slotPath = join(vaultRoot, 'objects', 'keywrap', 'v1');
    const { overdeckHome } = fx.useMachine('a');
    keyPath = join(overdeckHome, 'vault', 'key');
    nextKeyPath = join(overdeckHome, 'vault', 'key.next');
    expect(await runCli(() => setupCommand(url, {}, captureIo()))).toBe(0);
    oldKey = readFileSync(keyPath);
    const cwd = join(fx.root, 'repo');
    mkdirSync(cwd, { recursive: true });
    const nativePath = join(fx.root, `${SESSION}.jsonl`);
    writeFileSync(nativePath, `${user('a conversation saved before the rotation', cwd)}\n`);
    expect(await runCli(() => saveCommand(nativePath, {}, captureIo()))).toBe(0);
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('cli.ac1: --yes --no-passphrase rotates, prints 24 words that decode to the new key file, and deletes keywrap/v1', async () => {
    expect(await runCli(() => passphraseSetCommand({ passphraseFile: file('p.txt', PASSPHRASE) }, captureIo()))).toBe(0);
    expect(existsSync(slotPath)).toBe(true);

    const io = captureIo();
    expect(await runCli(() => rotateKeyCommand({ yes: true, passphrase: false }, io))).toBe(0);
    const newKey = readFileSync(keyPath);
    expect(newKey.equals(oldKey)).toBe(false);
    expect(phraseToKey(printedPhrase(io)).equals(newKey)).toBe(true);
    expect(existsSync(slotPath)).toBe(false);
    expect(io.stderr).toEqual([]);
    expect(io.stdout).toEqual([
      `Vault key rotated for ${url}: 1 conversation(s) and 1 machine(s) re-encrypted.`,
      '',
      'Write down your NEW recovery phrase. It is shown only now:',
      '',
      `  ${printedPhrase(io)}`,
      '',
      `The old recovery phrase no longer opens this vault. On every other machine run: pan vault join ${url}`,
      'Passphrase unlock is off.',
    ]);

    // The rotating machine keeps working with the new key.
    const status = captureIo();
    expect(await runCli(() => statusCommand({ json: true }, status))).toBe(0);
    expect(JSON.parse(status.stdout.join('\n')).keyRotatedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    const sync = captureIo();
    expect(await runCli(() => syncCommand({}, sync))).toBe(0);
    expect(sync.stdout[0]).toMatch(/1 record listed; 1 machine; 2 ref\(s\) under retired keys\.$/);
  });

  it('cli.ac2: non-TTY without --yes exits 1 and the backend refs are unchanged', async () => {
    const before = await backendState();
    const io = captureIo();
    expect(await runCli(() => rotateKeyCommand({}, io))).toBe(1);
    expect(io.stderr).toEqual(['Pass --yes to rotate the vault key without a prompt.']);
    expect(io.stdout).toEqual([]);
    expect(await backendState()).toEqual(before);
    expect(readFileSync(keyPath).equals(oldKey)).toBe(true);
    expect(existsSync(nextKeyPath)).toBe(false);
  });

  it('on a TTY the prompt decides: anything but y or yes changes nothing, yes rotates', async () => {
    const before = await backendState();
    const declined = captureIo({ isTTY: true, answers: ['no'] });
    const prompts: string[] = [];
    const readLine = declined.readLine;
    declined.readLine = async (prompt) => {
      prompts.push(prompt);
      return readLine(prompt);
    };
    expect(await runCli(() => rotateKeyCommand({}, declined))).toBe(0);
    expect(prompts).toEqual([ROTATE_CONFIRM_PROMPT]);
    expect(prompts[0]).toBe('Rotate the vault key? Every other machine must re-join with the new recovery phrase or passphrase. [y/N] ');
    expect(declined.stdout).toEqual(['Nothing was changed.']);
    expect(await backendState()).toEqual(before);
    expect(existsSync(nextKeyPath)).toBe(false);

    const accepted = captureIo({ isTTY: true, answers: [' YES '] });
    expect(await runCli(() => rotateKeyCommand({}, accepted))).toBe(0);
    expect(phraseToKey(printedPhrase(accepted)).equals(readFileSync(keyPath))).toBe(true);
    expect(accepted.stdout.at(-1)).toBe(PASSPHRASE_LATER_HINT);
    expect(existsSync(slotPath)).toBe(false);
  });

  it('cli.ac3: a vault with a keywrap and no passphrase flag off a TTY exits 1 before any write', async () => {
    expect(await runCli(() => passphraseSetCommand({ passphraseFile: file('p.txt', PASSPHRASE) }, captureIo()))).toBe(0);
    const before = await backendState();
    const io = captureIo();
    expect(await runCli(() => rotateKeyCommand({ yes: true }, io))).toBe(1);
    expect(io.stderr).toEqual(['This vault has a passphrase. Pass --passphrase-file <path>, --generate-passphrase or --no-passphrase.']);
    expect(await backendState()).toEqual(before);
    expect(readFileSync(keyPath).equals(oldKey)).toBe(true);
    expect(existsSync(nextKeyPath)).toBe(false);
  });

  it('refuses a flag conflict and a weak passphrase file before key.next exists', async () => {
    const before = await backendState();
    const conflict = captureIo();
    expect(await runCli(() => rotateKeyCommand({ yes: true, passphraseFile: file('p.txt', PASSPHRASE), generatePassphrase: true }, conflict))).toBe(1);
    expect(conflict.stderr).toEqual(['Use either --passphrase-file or --generate-passphrase, not both.']);
    const weak = captureIo();
    expect(await runCli(() => rotateKeyCommand({ yes: true, passphraseFile: file('short.txt', 'twelve chars\n') }, weak))).toBe(1);
    expect(weak.stderr).toEqual([PASSPHRASE_LENGTH_MESSAGE]);
    expect(await backendState()).toEqual(before);
    expect(existsSync(nextKeyPath)).toBe(false);
  });

  it('cli.ac4: --generate-passphrase publishes a keywrap that unwraps to the new key with the printed passphrase', async () => {
    const io = captureIo();
    expect(await runCli(() => rotateKeyCommand({ yes: true, generatePassphrase: true }, io))).toBe(0);
    const line = io.stdout.find((entry) => entry.startsWith(GENERATED_PASSPHRASE_PREFIX))!;
    const passphrase = line.slice(GENERATED_PASSPHRASE_PREFIX.length);
    expect(passphrase.split(' ')).toHaveLength(6);
    expect(io.stdout.at(-2)).toBe('Passphrase unlock now uses the new key.');
    const newKey = readFileSync(keyPath);
    expect((await unwrapVaultKey(readFileSync(slotPath), passphrase))!.equals(newKey)).toBe(true);
    expect(existsSync(nextKeyPath)).toBe(false);
  });

  it('--passphrase-file replaces a keywrap of the old key with one of the new key', async () => {
    expect(await runCli(() => passphraseSetCommand({ passphraseFile: file('p.txt', PASSPHRASE) }, captureIo()))).toBe(0);
    const io = captureIo();
    expect(await runCli(() => rotateKeyCommand({ yes: true, passphraseFile: file('q.txt', `${OTHER_PASSPHRASE}\n`) }, io))).toBe(0);
    expect(io.stdout.at(-1)).toBe('Passphrase unlock now uses the new key.');
    const wrap = readFileSync(slotPath);
    expect((await unwrapVaultKey(wrap, OTHER_PASSPHRASE))!.equals(readFileSync(keyPath))).toBe(true);
    expect(await unwrapVaultKey(wrap, PASSPHRASE)).toBeNull();
  });

  it('cli.ac5: key.next is gone after a successful run', async () => {
    const io = captureIo();
    expect(await runCli(() => rotateKeyCommand({ yes: true }, io))).toBe(0);
    expect(existsSync(nextKeyPath)).toBe(false);
    expect(io.stdout.at(-1)).toBe(PASSPHRASE_LATER_HINT);
  });

  it('a pending key.next resumes without --yes or a prompt and prints the phrase of that key', async () => {
    const pending = createVaultKey();
    writeFileSync(nextKeyPath, pending, { mode: 0o600 });
    const io = captureIo();
    expect(await runCli(() => rotateKeyCommand({}, io))).toBe(0);
    expect(readFileSync(keyPath).equals(pending)).toBe(true);
    expect(phraseToKey(printedPhrase(io)).equals(pending)).toBe(true);
    expect(existsSync(nextKeyPath)).toBe(false);
  });

  it('a key that does not open the vault is refused and leaves no pending rotation', async () => {
    writeFileSync(keyPath, createVaultKey(), { mode: 0o600 });
    const before = await backendState();
    const io = captureIo();
    expect(await runCli(() => rotateKeyCommand({ yes: true }, io))).toBe(1);
    expect(io.stderr).toEqual([ROTATE_KEY_MISMATCH_MESSAGE]);
    expect(await backendState()).toEqual(before);
    expect(existsSync(nextKeyPath)).toBe(false);
  });

  it('with the vault off it prints the off message and exits 0', async () => {
    fx.useMachine('off');
    const io = captureIo();
    expect(await runCli(() => rotateKeyCommand({ yes: true }, io))).toBe(0);
    expect(io.stdout).toEqual([VAULT_OFF_MESSAGE]);
  });
});
