/** PAN-4446 WI-1: `setupVault()` performs `pan vault setup`'s state changes without printing or exiting. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readVaultConfig } from '../../../../src/lib/vault/config.js';
import { setupVault, type SetupCreated } from '../../../../src/lib/vault/setup-core.js';
import { gitVaultCloneDir } from '../../../../src/lib/vault/store/git.js';
import { Fixture, git } from '../../cli/vault/helpers.js';

const WORD = /^[a-z]+$/;

function remoteCommitCount(remote: string): number {
  return git(remote, 'rev-list', '--all').split('\n').filter(Boolean).length;
}

describe('setupVault (PAN-4446 WI-1)', () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = new Fixture();
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('ac1: an empty bare remote returns created with a 24-word recovery phrase and writes the key and config', async () => {
    const remote = fx.bareRepo();
    const { overdeckHome } = fx.useMachine('a');
    const result = await setupVault({ url: remote, passphrase: { mode: 'none' } });
    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    const words = result.recoveryPhrase!.split(' ');
    expect(words).toHaveLength(24);
    expect(words.every((word) => WORD.test(word))).toBe(true);
    expect(result.backend).toBe(remote);
    expect(result.passphrase).toEqual({ stored: false, error: null });
    expect(existsSync(join(overdeckHome, 'vault', 'key'))).toBe(true);
    expect((await readVaultConfig()).backend).toBe(remote);
  });

  it('ac1: { mode: generate } returns a 6-word generated passphrase and stores objects/keywrap/v1 on the remote', async () => {
    const remote = fx.bareRepo();
    fx.useMachine('a');
    const result = await setupVault({ url: remote, passphrase: { mode: 'generate' } });
    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    expect(result.recoveryPhrase!.split(' ')).toHaveLength(24);
    expect(result.passphrase.stored).toBe(true);
    const generated = result.passphrase.stored ? result.passphrase.generated : null;
    expect(generated!.split(' ')).toHaveLength(6);
    expect(git(remote, 'ls-tree', '-r', '--name-only', 'main').split('\n')).toContain('objects/keywrap/v1');
  });

  it('ac2: a direct 12-character custom passphrase returns weak-passphrase and creates no key and no remote commit', async () => {
    const remote = fx.bareRepo();
    const { overdeckHome } = fx.useMachine('a');
    const result = await setupVault({ url: remote, passphrase: { mode: 'custom', value: 'abcdefghijkl' } });
    expect(result).toMatchObject({ status: 'error', code: 'weak-passphrase' });
    expect(existsSync(join(overdeckHome, 'vault', 'key'))).toBe(false);
    expect(remoteCommitCount(remote)).toBe(0);
  });

  it('ac3: a remote that is already a vault for another key returns foreign-vault and leaves no key and no clone', async () => {
    const remote = fx.bareRepo();
    fx.useMachine('a');
    expect((await setupVault({ url: remote, passphrase: { mode: 'none' } })).status).toBe('created');

    const { overdeckHome } = fx.useMachine('b');
    const result = await setupVault({ url: remote, passphrase: { mode: 'none' } });
    expect(result).toEqual({
      status: 'error',
      code: 'foreign-vault',
      message: `${remote} is already a vault protected by another key. Run: pan vault join ${remote}`,
    });
    expect(existsSync(join(overdeckHome, 'vault', 'key'))).toBe(false);
    expect(existsSync(gitVaultCloneDir())).toBe(false);
  });

  it('ac1: the callback receives the same recovery phrase the result returns', async () => {
    const remote = fx.bareRepo();
    fx.useMachine('a');
    const seen: SetupCreated[] = [];
    const result = await setupVault({
      url: remote,
      passphrase: async (created) => {
        seen.push(created);
        return { mode: 'none' };
      },
    });
    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    expect(seen).toEqual([{ recoveryPhrase: result.recoveryPhrase, machine: result.machine, backend: remote }]);
  });

  it('ac4: an existing vault/key with no configured backend returns recoveryPhrase null and never calls the callback', async () => {
    const first = fx.bareRepo();
    const { overdeckHome } = fx.useMachine('a');
    expect((await setupVault({ url: first, passphrase: { mode: 'none' } })).status).toBe('created');
    rmSync(join(overdeckHome, 'vault', 'config.json'), { force: true });
    rmSync(gitVaultCloneDir(), { recursive: true, force: true });

    const second = fx.bareRepo('second.git');
    const callback = vi.fn(async () => ({ mode: 'none' as const }));
    const result = await setupVault({ url: second, passphrase: callback });
    expect(result).toMatchObject({ status: 'created', backend: second, recoveryPhrase: null, passphrase: { stored: false, error: null } });
    expect(callback).not.toHaveBeenCalled();
  });
});
