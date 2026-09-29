import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { passphraseRemoveCommand, passphraseSetCommand } from '../../../../src/cli/commands/vault/passphrase.js';
import { setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { joinCommand } from '../../../../src/cli/commands/vault/join.js';
import { GENERATED_PASSPHRASE_PREFIX } from '../../../../src/cli/commands/vault/shared.js';
import { VAULT_OFF_MESSAGE } from '../../../../src/lib/vault/config.js';
import { PASSPHRASE_LENGTH_MESSAGE, unwrapVaultKey } from '../../../../src/lib/vault/keywrap.js';
import { Fixture, captureIo, runCli } from './helpers.js';

const PASSPHRASE = 'quiet harbor lantern 42 mosaic';
const OTHER_PASSPHRASE = 'amber tundra violin 17 orchard';

describe('pan vault passphrase set / remove', () => {
  let fx: Fixture;
  let vaultRoot: string;
  let url: string;
  let keyPath: string;
  let slotPath: string;
  let phrase: string;

  function file(name: string, content: string): string {
    const path = join(fx.root, name);
    writeFileSync(path, content);
    return path;
  }

  beforeEach(async () => {
    fx = new Fixture();
    vaultRoot = join(fx.root, 'vault-dir');
    url = `dir:${vaultRoot}`;
    slotPath = join(vaultRoot, 'objects', 'keywrap', 'v1');
    const { overdeckHome } = fx.useMachine('a');
    keyPath = join(overdeckHome, 'vault', 'key');
    const io = captureIo();
    expect(await runCli(() => setupCommand(url, {}, io))).toBe(0);
    phrase = io.stdout.find((line) => line.trim().split(' ').length === 24)!.trim();
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('set --passphrase-file stores a keywrap that unwraps to the vault key', async () => {
    const io = captureIo();
    expect(await runCli(() => passphraseSetCommand({ passphraseFile: file('p.txt', `${PASSPHRASE}\n`) }, io))).toBe(0);
    expect(io.stdout).toEqual([`Passphrase unlock is on for ${url}. New machines can join with the passphrase; the recovery phrase still works.`]);
    const unwrapped = await unwrapVaultKey(readFileSync(slotPath), PASSPHRASE);
    expect(unwrapped!.equals(readFileSync(keyPath))).toBe(true);
  });

  it('set refuses a 12-character passphrase and writes nothing', async () => {
    const io = captureIo();
    expect(await runCli(() => passphraseSetCommand({ passphraseFile: file('short.txt', 'twelve chars\n') }, io))).toBe(1);
    expect(io.stderr).toEqual([PASSPHRASE_LENGTH_MESSAGE]);
    expect(existsSync(slotPath)).toBe(false);
  });

  it('set refuses --passphrase-file together with --generate', async () => {
    const io = captureIo();
    expect(await runCli(() => passphraseSetCommand({ passphraseFile: file('p.txt', PASSPHRASE), generate: true }, io))).toBe(1);
    expect(io.stderr).toEqual(['Use either --passphrase-file or --generate, not both.']);
    expect(existsSync(slotPath)).toBe(false);
  });

  it('set --generate prints one six-word passphrase that unwraps the stored object', async () => {
    const io = captureIo();
    expect(await runCli(() => passphraseSetCommand({ generate: true }, io))).toBe(0);
    const lines = io.stdout.filter((line) => line.startsWith(GENERATED_PASSPHRASE_PREFIX));
    expect(lines).toHaveLength(1);
    const generated = lines[0]!.slice(GENERATED_PASSPHRASE_PREFIX.length);
    expect(generated.split(' ')).toHaveLength(6);
    expect((await unwrapVaultKey(readFileSync(slotPath), generated))!.equals(readFileSync(keyPath))).toBe(true);
  });

  it('a prompted empty answer generates a passphrase; a typed one is stored as typed', async () => {
    const generatedIo = captureIo({ isTTY: true, answers: [''] });
    expect(await runCli(() => passphraseSetCommand({}, generatedIo))).toBe(0);
    const generated = generatedIo.stdout.find((line) => line.startsWith(GENERATED_PASSPHRASE_PREFIX))!.slice(GENERATED_PASSPHRASE_PREFIX.length);
    expect((await unwrapVaultKey(readFileSync(slotPath), generated))!.equals(readFileSync(keyPath))).toBe(true);

    const typedIo = captureIo({ isTTY: true, answers: [PASSPHRASE] });
    expect(await runCli(() => passphraseSetCommand({}, typedIo))).toBe(0);
    expect(typedIo.stdout.some((line) => line.startsWith(GENERATED_PASSPHRASE_PREFIX))).toBe(false);
    expect((await unwrapVaultKey(readFileSync(slotPath), PASSPHRASE))!.equals(readFileSync(keyPath))).toBe(true);
  });

  it('a second set replaces the object and never changes the vault key', async () => {
    const keyBefore = readFileSync(keyPath);
    await runCli(() => passphraseSetCommand({ passphraseFile: file('a.txt', PASSPHRASE) }, captureIo()));
    expect(await runCli(() => passphraseSetCommand({ passphraseFile: file('b.txt', OTHER_PASSPHRASE) }, captureIo()))).toBe(0);
    const blob = readFileSync(slotPath);
    expect(await unwrapVaultKey(blob, PASSPHRASE)).toBeNull();
    expect((await unwrapVaultKey(blob, OTHER_PASSPHRASE))!.equals(keyBefore)).toBe(true);
    expect(readFileSync(keyPath).equals(keyBefore)).toBe(true);
  });

  it('ac5: remove deletes the object and a new machine still joins with the recovery phrase', async () => {
    await runCli(() => passphraseSetCommand({ passphraseFile: file('p.txt', PASSPHRASE) }, captureIo()));
    expect(existsSync(slotPath)).toBe(true);
    const io = captureIo();
    expect(await runCli(() => passphraseRemoveCommand({}, io))).toBe(0);
    expect(io.stdout).toEqual([`Passphrase unlock is off for ${url}. New machines need the recovery phrase.`]);
    expect(existsSync(slotPath)).toBe(false);
    // Removing again is harmless.
    expect(await runCli(() => passphraseRemoveCommand({}, captureIo()))).toBe(0);

    const keyA = readFileSync(keyPath);
    const { overdeckHome: homeB } = fx.useMachine('b');
    const joinIo = captureIo();
    expect(await runCli(() => joinCommand(url, { phraseFile: file('phrase.txt', `${phrase}\n`) }, joinIo))).toBe(0);
    expect(readFileSync(join(homeB, 'vault', 'key')).equals(keyA)).toBe(true);
  });

  it('with no backend configured, set prints the vault-off message and exits 0', async () => {
    fx.useMachine('fresh');
    const io = captureIo();
    expect(await runCli(() => passphraseSetCommand({ passphraseFile: file('p.txt', PASSPHRASE) }, io))).toBe(0);
    expect(io.stdout).toEqual([VAULT_OFF_MESSAGE]);
  });
});
