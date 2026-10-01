/**
 * setupVault(): the state changes behind `pan vault setup` (PAN-4446 WI-1).
 *
 * Creates (or reuses) the vault key, initializes the remote or checks it is a
 * vault for this key, writes the encrypted header, records this machine's
 * identity, stores the backend URL and syncs once. A new key can then be
 * wrapped under a passphrase as `keywrap/v1` (PAN-4328).
 *
 * Prints nothing and never exits: the CLI (`src/cli/commands/vault/setup.ts`)
 * and the dashboard vault service both call it and render the tagged result.
 * Error messages are the CLI's exact strings (D-3).
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureEnvironmentIdentity } from '../environment-identity.js';
import { readVaultConfig, vaultDir, writeVaultConfig } from './config.js';
import { HEADER_REF_NAME, encryptRef, newVaultHeader, readVaultHeader, VaultAuthenticationError } from './format.js';
import { createVaultKey, deriveSubkeys, keyToPhrase, loadVaultKey, saveVaultKey } from './identity.js';
import { checkPassphraseStrength, generatePassphrase, wrapVaultKey } from './keywrap.js';
import { DIR_BACKEND_PREFIX } from './open.js';
import { DirVaultStore } from './store/dir.js';
import { GitVaultStore, gitVaultCloneDir, initGitVault } from './store/git.js';
import { KEYWRAP_OBJECT_NAME, VaultOfflineError, type VaultStore } from './store/types.js';
import { syncOnce } from './sync.js';

export const KEY_LOSS_WARNING =
  'Anyone with these words can read your vault. Losing every device and these words loses the vault.';

export type SetupPassphrase = { mode: 'generate' } | { mode: 'custom'; value: string } | { mode: 'none' };

export interface SetupCreated {
  recoveryPhrase: string;
  machine: { label: string; environmentId: string };
  backend: string;
}

export interface SetupVaultInput {
  url: string;
  /**
   * A value (dashboard), or a callback (CLI) called once, only when a new key was
   * created, after the vault is live and before the keywrap is stored.
   * A direct `custom` value is strength-checked before anything is created;
   * a callback's `custom` value is trusted (the CLI validated it).
   */
  passphrase: SetupPassphrase | ((created: SetupCreated) => Promise<SetupPassphrase>);
}

export type SetupErrorCode = 'weak-passphrase' | 'other-backend' | 'unreachable' | 'store-error' | 'foreign-vault' | 'race-lost';

export type SetupVaultResult =
  | {
      status: 'created';
      backend: string;
      machine: { label: string; environmentId: string };
      /** Null when an existing key file was reused (no phrase is shown, no passphrase offered). */
      recoveryPhrase: string | null;
      passphrase: { stored: true; generated: string | null } | { stored: false; error: string | null };
    }
  | { status: 'already-set-up'; backend: string }
  | { status: 'error'; code: SetupErrorCode; message: string };

const execFileAsync = promisify(execFile);

function setupError(code: SetupErrorCode, message: string): SetupVaultResult {
  return { status: 'error', code, message };
}

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

export async function setupVault(input: SetupVaultInput): Promise<SetupVaultResult> {
  const { url, passphrase } = input;
  // Validate a direct passphrase before anything is created, so a weak one
  // never leaves a half-set-up vault behind.
  if (typeof passphrase !== 'function' && passphrase.mode === 'custom') {
    const strength = checkPassphraseStrength(passphrase.value);
    if (!strength.ok) return setupError('weak-passphrase', strength.message);
  }

  const config = await readVaultConfig();
  if (config.backend && config.backend !== url) {
    return setupError(
      'other-backend',
      `Session Vault is already enabled with backend ${config.backend}. Run pan vault status, or remove that backend from vault/config.json first.`,
    );
  }
  const existingKey = await loadVaultKey();
  if (config.backend === url && existingKey) return { status: 'already-set-up', backend: url };

  const key = existingKey ?? createVaultKey();
  const keys = deriveSubkeys(key);
  let store: VaultStore;
  try {
    store = await openOrInitStore(url);
  } catch (error) {
    if (error instanceof VaultOfflineError) return setupError('unreachable', `Could not reach ${url}: ${error.message}`);
    return setupError('store-error', (error as Error).message);
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
      await forgetNewKey();
      if (!existingKey && !url.startsWith(DIR_BACKEND_PREFIX)) await rm(gitVaultCloneDir(), { recursive: true, force: true });
      return setupError('foreign-vault', `${url} is already a vault protected by another key. Run: pan vault join ${url}`);
    }
  } else {
    const outcome = await store.casRef(HEADER_REF_NAME, null, await encryptRef(HEADER_REF_NAME, newVaultHeader(), keys));
    if (outcome !== 'ok') {
      await forgetNewKey();
      return setupError('race-lost', `Another machine initialized ${url} first. Run: pan vault join ${url}`);
    }
  }

  const me = await ensureEnvironmentIdentity();
  const machine = { label: me.label, environmentId: me.environmentId };
  await writeVaultConfig({ backend: url });
  // Register this machine (m/ ref) and prime the list cache.
  await syncOnce({ store, keys });

  if (existingKey) {
    return { status: 'created', backend: url, machine, recoveryPhrase: null, passphrase: { stored: false, error: null } };
  }

  const recoveryPhrase = keyToPhrase(key);
  const chosen = typeof passphrase === 'function' ? await passphrase({ recoveryPhrase, machine, backend: url }) : passphrase;
  const created = { status: 'created' as const, backend: url, machine, recoveryPhrase };
  if (chosen.mode === 'none') return { ...created, passphrase: { stored: false, error: null } };
  const value = chosen.mode === 'generate' ? generatePassphrase() : chosen.value;
  const generated = chosen.mode === 'generate' ? value : null;
  try {
    await store.putSlot(KEYWRAP_OBJECT_NAME, await wrapVaultKey(key, value));
  } catch (error) {
    if (!(error instanceof VaultOfflineError)) throw error;
    return { ...created, passphrase: { stored: false, error: error.message } };
  }
  return { ...created, passphrase: { stored: true, generated } };
}
