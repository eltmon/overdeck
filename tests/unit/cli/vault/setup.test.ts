import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEY_LOSS_WARNING, setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { PHRASE_MISMATCH_MESSAGE, joinCommand } from '../../../../src/cli/commands/vault/join.js';
import { statusCommand } from '../../../../src/cli/commands/vault/status.js';
import { VAULT_OFF_MESSAGE, readVaultConfig } from '../../../../src/lib/vault/config.js';
import { readEnvironmentIdentity } from '../../../../src/lib/environment-identity.js';
import { Fixture, captureIo, runCli } from './helpers.js';

const WORD = /^[a-z]+$/;

describe('pan vault setup / join / status', () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = new Fixture();
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('ac4: with no backend, status prints the vault-off message and exits 0', async () => {
    fx.useMachine('a');
    const io = captureIo();
    expect(await runCli(() => statusCommand({}, io))).toBe(0);
    expect(io.stdout).toEqual([VAULT_OFF_MESSAGE]);
    expect(io.stderr).toEqual([]);
  });

  it('ac1: setup prints 24 words and the warning once; a second status prints the backend and no phrase', async () => {
    const remote = fx.bareRepo();
    const { overdeckHome } = fx.useMachine('a');
    const io = captureIo();
    expect(await runCli(() => setupCommand(remote, {}, io))).toBe(0);
    const phraseLine = io.stdout.find((line) => line.trim().split(' ').length === 24);
    expect(phraseLine).toBeDefined();
    const words = phraseLine!.trim().split(' ');
    expect(words.every((word) => WORD.test(word))).toBe(true);
    expect(io.stdout.filter((line) => line === KEY_LOSS_WARNING)).toHaveLength(1);
    expect(io.stdout.filter((line) => line.trim().split(' ').length === 24)).toHaveLength(1);

    expect((await readVaultConfig()).backend).toBe(remote);
    expect(existsSync(join(overdeckHome, 'vault', 'key'))).toBe(true);
    expect(existsSync(join(overdeckHome, 'environment-id.json'))).toBe(true);
    expect(existsSync(join(overdeckHome, 'vault', 'git', 'VAULT-FORMAT'))).toBe(true);

    const status = captureIo();
    expect(await runCli(() => statusCommand({}, status))).toBe(0);
    const text = status.stdout.join('\n');
    expect(text).toContain(`Backend:        ${remote}`);
    expect(text).toContain('Owned records:  0');
    expect(status.stdout.some((line) => line.trim().split(' ').length === 24)).toBe(false);

    // Re-running setup with the same backend is idempotent and never re-prints the phrase.
    const again = captureIo();
    expect(await runCli(() => setupCommand(remote, {}, again))).toBe(0);
    expect(again.stdout.join('\n')).toContain('already set up');
    expect(again.stdout.some((line) => line.trim().split(' ').length === 24)).toBe(false);

    // A different backend is refused.
    const other = captureIo();
    expect(await runCli(() => setupCommand(fx.bareRepo('other.git'), {}, other))).toBe(1);
    expect(other.stderr[0]).toContain('already enabled');
  });

  it('ac2: join with the correct phrase saves the key and status lists both machines', async () => {
    const remote = fx.bareRepo();
    fx.useMachine('a');
    const setupIo = captureIo();
    await runCli(() => setupCommand(remote, {}, setupIo));
    const phrase = setupIo.stdout.find((line) => line.trim().split(' ').length === 24)!.trim();
    const a = (await readEnvironmentIdentity())!;

    const { overdeckHome: homeB } = fx.useMachine('b');
    const phraseFile = join(fx.root, 'phrase.txt');
    writeFileSync(phraseFile, `${phrase}\n`);
    const joinIo = captureIo();
    expect(await runCli(() => joinCommand(remote, { phraseFile }, joinIo))).toBe(0);
    expect(joinIo.stdout[0]).toContain('Joined the Session Vault');
    expect(existsSync(join(homeB, 'vault', 'key'))).toBe(true);
    expect((await readVaultConfig()).backend).toBe(remote);
    const b = (await readEnvironmentIdentity())!;
    expect(b.environmentId).not.toBe(a.environmentId);

    const status = captureIo();
    expect(await runCli(() => statusCommand({ json: true }, status))).toBe(0);
    const summary = JSON.parse(status.stdout.join('\n')) as { machines: Array<{ environmentId: string }>; lastSyncAt: string | null };
    expect(summary.machines.map((machine) => machine.environmentId).sort()).toEqual([a.environmentId, b.environmentId].sort());
    expect(summary.lastSyncAt).not.toBeNull();

    // The phrase read from a TTY prompt works the same way.
    const { overdeckHome: homeC } = fx.useMachine('c');
    const promptIo = captureIo({ isTTY: true, answers: [phrase.toUpperCase()] });
    expect(await runCli(() => joinCommand(remote, {}, promptIo))).toBe(0);
    expect(readFileSync(join(homeC, 'vault', 'key')).equals(readFileSync(join(homeB, 'vault', 'key')))).toBe(true);
  });

  it('ac3: a wrong phrase prints the mismatch message and writes no key file', async () => {
    const remote = fx.bareRepo();
    fx.useMachine('a');
    await runCli(() => setupCommand(remote, {}, captureIo()));

    const { overdeckHome } = fx.useMachine('b');
    const wrong = `${Array(23).fill('abandon').join(' ')} art`; // valid checksum, wrong key
    const io = captureIo({ answers: [wrong] });
    expect(await runCli(() => joinCommand(remote, {}, io))).toBe(1);
    expect(io.stderr).toEqual([PHRASE_MISMATCH_MESSAGE]);
    expect(existsSync(join(overdeckHome, 'vault', 'key'))).toBe(false);
    expect((await readVaultConfig()).backend).toBeUndefined();
    expect(existsSync(join(overdeckHome, 'vault', 'git'))).toBe(false);

    const garbage = captureIo({ answers: ['not a phrase'] });
    expect(await runCli(() => joinCommand(remote, {}, garbage))).toBe(1);
    expect(garbage.stderr[0]).toMatch(/24 words/);
  });

  it('setup refuses a remote that is already a vault for another key', async () => {
    const remote = fx.bareRepo();
    fx.useMachine('a');
    await runCli(() => setupCommand(remote, {}, captureIo()));
    const { overdeckHome } = fx.useMachine('b');
    const io = captureIo();
    expect(await runCli(() => setupCommand(remote, {}, io))).toBe(1);
    expect(io.stderr[0]).toContain('already a vault protected by another key');
    expect(existsSync(join(overdeckHome, 'vault', 'key'))).toBe(false);
    expect((await readVaultConfig()).backend).toBeUndefined();
  });
});
