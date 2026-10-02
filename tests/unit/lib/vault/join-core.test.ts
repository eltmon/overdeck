/** PAN-4446 WI-2: `joinVault()` performs `pan vault join`'s state changes without printing or exiting. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readVaultConfig } from '../../../../src/lib/vault/config.js';
import { NO_PASSPHRASE_MESSAGE, joinVault } from '../../../../src/lib/vault/join-core.js';
import { PASSPHRASE_MISMATCH_MESSAGE } from '../../../../src/lib/vault/keywrap.js';
import { setupVault, type SetupPassphrase } from '../../../../src/lib/vault/setup-core.js';
import { gitVaultCloneDir } from '../../../../src/lib/vault/store/git.js';
import { Fixture } from '../../cli/vault/helpers.js';

const PASSPHRASE = 'quiet harbor lantern 42 mosaic';

describe('joinVault (PAN-4446 WI-2)', () => {
  let fx: Fixture;
  let remote: string;

  beforeEach(() => {
    fx = new Fixture();
    remote = fx.bareRepo();
  });

  afterEach(() => {
    fx.cleanup();
  });

  /** Set up the vault on machine `a`, then switch to machine `b`. */
  async function setUpOnA(passphrase: SetupPassphrase): Promise<{ overdeckHome: string }> {
    fx.useMachine('a');
    expect((await setupVault({ url: remote, passphrase })).status).toBe('created');
    return fx.useMachine('b');
  }

  it('ac1: a direct passphrase joins and writes vault/key', async () => {
    const { overdeckHome } = await setUpOnA({ mode: 'custom', value: PASSPHRASE });
    const result = await joinVault({ url: remote, secret: { kind: 'passphrase', value: PASSPHRASE } });
    expect(result).toMatchObject({ status: 'joined', backend: remote, via: 'passphrase', offline: false, records: 0 });
    expect(existsSync(join(overdeckHome, 'vault', 'key'))).toBe(true);
    expect((await readVaultConfig()).backend).toBe(remote);
  });

  it('ac2: a direct wrong passphrase returns wrong-passphrase, writes no vault/key and leaves no clone', async () => {
    const { overdeckHome } = await setUpOnA({ mode: 'custom', value: PASSPHRASE });
    const result = await joinVault({ url: remote, secret: { kind: 'passphrase', value: 'wrong harbor lantern 43 mosaic' } });
    expect(result).toEqual({ status: 'error', code: 'wrong-passphrase', message: PASSPHRASE_MISMATCH_MESSAGE });
    expect(existsSync(join(overdeckHome, 'vault', 'key'))).toBe(false);
    expect(existsSync(gitVaultCloneDir())).toBe(false);
  });

  it('ac3: a direct passphrase against a vault with no keywrap returns no-passphrase', async () => {
    await setUpOnA({ mode: 'none' });
    const result = await joinVault({ url: remote, secret: { kind: 'passphrase', value: PASSPHRASE } });
    expect(result).toEqual({ status: 'error', code: 'no-passphrase', message: NO_PASSPHRASE_MESSAGE });
    expect(existsSync(gitVaultCloneDir())).toBe(false);
  });

  it('ac4: a direct malformed phrase returns bad-phrase and creates no clone directory', async () => {
    await setUpOnA({ mode: 'none' });
    const result = await joinVault({ url: remote, secret: { kind: 'phrase', value: 'not a recovery phrase' } });
    expect(result).toMatchObject({ status: 'error', code: 'bad-phrase' });
    expect(existsSync(gitVaultCloneDir())).toBe(false);
  });

  it('ac5: a callback returning fail returns aborted with its message and removes the clone it created', async () => {
    const { overdeckHome } = await setUpOnA({ mode: 'none' });
    let seenState: string | null = null;
    let cloneExisted = false;
    const result = await joinVault({
      url: remote,
      secret: async (state) => {
        seenState = state;
        cloneExisted = existsSync(gitVaultCloneDir());
        return { kind: 'fail', message: 'x' };
      },
    });
    expect(result).toEqual({ status: 'error', code: 'aborted', message: 'x' });
    expect(seenState).toBe('absent');
    expect(cloneExisted).toBe(true);
    expect(existsSync(gitVaultCloneDir())).toBe(false);
    expect(existsSync(join(overdeckHome, 'vault', 'key'))).toBe(false);
  });
});
