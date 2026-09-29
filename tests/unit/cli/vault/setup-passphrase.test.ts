import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { GENERATED_PASSPHRASE_PREFIX } from '../../../../src/cli/commands/vault/shared.js';
import { readVaultConfig } from '../../../../src/lib/vault/config.js';
import { PASSPHRASE_LATER_HINT, PASSPHRASE_LENGTH_MESSAGE, unwrapVaultKey } from '../../../../src/lib/vault/keywrap.js';
import { Fixture, captureIo, git, runCli } from './helpers.js';

const SUGGESTED = /^Also unlock with a passphrase on new machines\. Suggested: (.+)$/;

describe('pan vault setup passphrase offer', () => {
  let fx: Fixture;
  let remote: string;
  let overdeckHome: string;

  beforeEach(() => {
    fx = new Fixture();
    remote = fx.bareRepo();
    ({ overdeckHome } = fx.useMachine('a'));
  });

  afterEach(() => {
    fx.cleanup();
  });

  function remoteKeywrap(): Buffer | null {
    try {
      return Buffer.from(git(remote, 'cat-file', 'blob', 'main:objects/keywrap/v1'), 'utf8');
    } catch {
      return null;
    }
  }

  function vaultKey(): Buffer {
    return readFileSync(join(overdeckHome, 'vault', 'key'));
  }

  it('ac3: a 12-character --passphrase-file is refused before anything is created', async () => {
    const passphraseFile = join(fx.root, 'short.txt');
    writeFileSync(passphraseFile, 'twelve chars\n');
    const io = captureIo();
    expect(await runCli(() => setupCommand(remote, { passphraseFile }, io))).toBe(1);
    expect(io.stderr).toEqual([PASSPHRASE_LENGTH_MESSAGE]);
    expect(existsSync(join(overdeckHome, 'vault', 'key'))).toBe(false);
    expect(existsSync(join(overdeckHome, 'vault', 'git'))).toBe(false);
    expect((await readVaultConfig()).backend).toBeUndefined();
    expect(() => git(remote, 'rev-parse', '--verify', 'main')).toThrow();
  });

  it('--passphrase-file together with --generate-passphrase is refused before anything is created', async () => {
    const passphraseFile = join(fx.root, 'p.txt');
    writeFileSync(passphraseFile, 'quiet harbor lantern 42 mosaic');
    const io = captureIo();
    expect(await runCli(() => setupCommand(remote, { passphraseFile, generatePassphrase: true }, io))).toBe(1);
    expect(io.stderr).toEqual(['Use either --passphrase-file or --generate-passphrase, not both.']);
    expect(existsSync(join(overdeckHome, 'vault', 'key'))).toBe(false);
  });

  it('--passphrase-file stores a keywrap that unwraps with that passphrase', async () => {
    const passphraseFile = join(fx.root, 'p.txt');
    writeFileSync(passphraseFile, 'quiet harbor lantern 42 mosaic\n');
    const io = captureIo();
    expect(await runCli(() => setupCommand(remote, { passphraseFile }, io))).toBe(0);
    expect((await unwrapVaultKey(remoteKeywrap()!, 'quiet harbor lantern 42 mosaic'))!.equals(vaultKey())).toBe(true);
    expect(io.stdout.some((line) => line.startsWith(GENERATED_PASSPHRASE_PREFIX))).toBe(false);
  });

  it('--generate-passphrase prints the phrase and one generated passphrase, and pushes the keywrap', async () => {
    const io = captureIo();
    expect(await runCli(() => setupCommand(remote, { generatePassphrase: true }, io))).toBe(0);
    expect(io.stdout.filter((line) => line.trim().split(' ').length === 24)).toHaveLength(1);
    const lines = io.stdout.filter((line) => line.startsWith(GENERATED_PASSPHRASE_PREFIX));
    expect(lines).toHaveLength(1);
    const generated = lines[0]!.slice(GENERATED_PASSPHRASE_PREFIX.length);
    expect(generated.split(' ')).toHaveLength(6);
    expect(git(remote, 'ls-tree', '-r', '--name-only', 'main').split('\n')).toContain('objects/keywrap/v1');
    expect((await unwrapVaultKey(remoteKeywrap()!, generated))!.equals(vaultKey())).toBe(true);
  });

  it('on a TTY an empty answer stores the suggested passphrase', async () => {
    const io = captureIo({ isTTY: true, answers: [''] });
    expect(await runCli(() => setupCommand(remote, {}, io))).toBe(0);
    const suggested = io.stdout.map((line) => SUGGESTED.exec(line)?.[1]).find(Boolean)!;
    expect(suggested.split(' ')).toHaveLength(6);
    expect((await unwrapVaultKey(remoteKeywrap()!, suggested))!.equals(vaultKey())).toBe(true);
  });

  it('on a TTY a short answer is refused once and "skip" stores nothing', async () => {
    const io = captureIo({ isTTY: true, answers: ['short', 'skip'] });
    expect(await runCli(() => setupCommand(remote, {}, io))).toBe(0);
    expect(io.stderr.filter((line) => line === PASSPHRASE_LENGTH_MESSAGE)).toHaveLength(1);
    expect(remoteKeywrap()).toBeNull();
  });

  it('non-TTY without flags prints the later hint and stores nothing', async () => {
    const io = captureIo();
    expect(await runCli(() => setupCommand(remote, {}, io))).toBe(0);
    expect(io.stdout).toContain(PASSPHRASE_LATER_HINT);
    expect(remoteKeywrap()).toBeNull();
  });

  it('--no-passphrase prints no hint and stores nothing', async () => {
    const io = captureIo({ isTTY: true });
    expect(await runCli(() => setupCommand(remote, { passphrase: false }, io))).toBe(0);
    expect(io.stdout).not.toContain(PASSPHRASE_LATER_HINT);
    expect(io.stdout.some((line) => SUGGESTED.test(line))).toBe(false);
    expect(remoteKeywrap()).toBeNull();
  });
});
