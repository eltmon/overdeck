/**
 * pan vault setup <git-url>
 *
 * Enable the Session Vault against the user's own remote (FR-1, P-1..P-4).
 * Creates the vault key, initializes the remote (or checks it is a vault for
 * this key), writes the encrypted header, records this machine's identity,
 * stores the backend URL and prints the 24-word recovery phrase exactly once.
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { readVaultConfig, vaultDir, writeVaultConfig } from '../../../lib/vault/config.js';
import { HEADER_REF_NAME, encryptRef, newVaultHeader, readVaultHeader, VaultAuthenticationError } from '../../../lib/vault/format.js';
import { createVaultKey, deriveSubkeys, keyToPhrase, loadVaultKey, saveVaultKey } from '../../../lib/vault/identity.js';
import { DirVaultStore } from '../../../lib/vault/store/dir.js';
import { GitVaultStore, gitVaultCloneDir, initGitVault } from '../../../lib/vault/store/git.js';
import { VaultOfflineError, type VaultStore } from '../../../lib/vault/store/types.js';
import { syncOnce } from '../../../lib/vault/sync.js';
import { DIR_BACKEND_PREFIX, defaultIo, type CliIo } from './shared.js';

export const KEY_LOSS_WARNING =
  'Anyone with these words can read your vault. Losing every device and these words loses the vault.';

export interface SetupOptions {
  hooks?: boolean;
}

const execFileAsync = promisify(execFile);

async function openOrInitStore(url: string): Promise<VaultStore> {
  if (url.startsWith(DIR_BACKEND_PREFIX)) return DirVaultStore.open(url.slice(DIR_BACKEND_PREFIX.length));
  const cloneDir = gitVaultCloneDir();
  let existing: GitVaultStore | null = null;
  try {
    existing = await GitVaultStore.open(cloneDir);
  } catch {
    existing = null;
  }
  if (!existing) return initGitVault(url, cloneDir);
  const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: cloneDir, encoding: 'utf8' });
  if (stdout.trim() !== url) {
    throw new Error(`The vault clone at ${cloneDir} tracks ${stdout.trim()}, not ${url}. Remove it or run pan vault setup with that URL.`);
  }
  return existing;
}

export async function setupCommand(url: string, options: SetupOptions = {}, io: CliIo = defaultIo): Promise<void> {
  const config = await readVaultConfig();
  if (config.backend && config.backend !== url) {
    io.err(`Session Vault is already enabled with backend ${config.backend}. Run pan vault status, or remove that backend from vault/config.json first.`);
    return io.exit(1);
  }
  const existingKey = await loadVaultKey();
  if (config.backend === url && existingKey) {
    io.out(`Session Vault is already set up with ${url}. The recovery phrase is shown only at setup.`);
    if (options.hooks) await installHooks(io);
    return;
  }

  const key = existingKey ?? createVaultKey();
  const keys = deriveSubkeys(key);
  let store: VaultStore;
  try {
    store = await openOrInitStore(url);
  } catch (error) {
    if (error instanceof VaultOfflineError) {
      io.err(`Could not reach ${url}: ${error.message}`);
      return io.exit(1);
    }
    io.err((error as Error).message);
    return io.exit(1);
  }

  // Save the key BEFORE the header reaches the remote: a crash in between must
  // never leave a vault locked by a key that was neither stored nor shown.
  if (!existingKey) await saveVaultKey(key);
  const forgetNewKey = async (): Promise<void> => {
    if (!existingKey) await rm(join(vaultDir(), 'key'), { force: true });
  };

  const header = await store.readRef(HEADER_REF_NAME);
  if (header) {
    try {
      const value = await readVaultHeader(header.value, keys);
      if (!value) throw new Error('header is not a vault header');
    } catch (error) {
      if (!(error instanceof VaultAuthenticationError) && !(error instanceof Error)) throw error;
      io.err(`${url} is already a vault protected by another key. Run: pan vault join ${url}`);
      await forgetNewKey();
      if (!existingKey && !url.startsWith(DIR_BACKEND_PREFIX)) await rm(gitVaultCloneDir(), { recursive: true, force: true });
      return io.exit(1);
    }
  } else {
    const outcome = await store.casRef(HEADER_REF_NAME, null, await encryptRef(HEADER_REF_NAME, newVaultHeader(), keys));
    if (outcome !== 'ok') {
      io.err(`Another machine initialized ${url} first. Run: pan vault join ${url}`);
      await forgetNewKey();
      return io.exit(1);
    }
  }

  const me = await ensureEnvironmentIdentity();
  await writeVaultConfig({ backend: url });
  // Register this machine (m/ ref) and prime the list cache.
  await syncOnce({ store, keys });

  io.out(`Session Vault enabled for ${me.label} (${me.environmentId}) with backend ${url}.`);
  if (!existingKey) {
    io.out('');
    io.out('Write down your recovery phrase. It is shown only now:');
    io.out('');
    io.out(`  ${keyToPhrase(key)}`);
    io.out('');
    io.out(KEY_LOSS_WARNING);
  }
  if (options.hooks) await installHooks(io);
}

async function installHooks(io: CliIo): Promise<void> {
  const { installVaultStopHook } = await import('./hooks.js');
  await installVaultStopHook(io);
}
