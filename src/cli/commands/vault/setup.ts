/**
 * pan vault setup <git-url>
 *
 * Enable the Session Vault against the user's own remote (FR-1, P-1..P-4).
 * Creates the vault key, initializes the remote (or checks it is a vault for
 * this key), writes the encrypted header, records this machine's identity,
 * stores the backend URL and prints the 24-word recovery phrase exactly once.
 * Then it offers passphrase unlock (PAN-4328): the key wrapped under a
 * passphrase as `keywrap/v1`, so a new machine can join without the 24 words.
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { readVaultConfig, vaultDir, writeVaultConfig } from '../../../lib/vault/config.js';
import { HEADER_REF_NAME, encryptRef, newVaultHeader, readVaultHeader, VaultAuthenticationError } from '../../../lib/vault/format.js';
import { createVaultKey, deriveSubkeys, keyToPhrase, loadVaultKey, saveVaultKey } from '../../../lib/vault/identity.js';
import { PASSPHRASE_LATER_HINT, checkPassphraseStrength, generatePassphrase, wrapVaultKey } from '../../../lib/vault/keywrap.js';
import { DirVaultStore } from '../../../lib/vault/store/dir.js';
import { GitVaultStore, gitVaultCloneDir, initGitVault } from '../../../lib/vault/store/git.js';
import { KEYWRAP_OBJECT_NAME, VaultOfflineError, type VaultStore } from '../../../lib/vault/store/types.js';
import { syncOnce } from '../../../lib/vault/sync.js';
import { DIR_BACKEND_PREFIX, GENERATED_PASSPHRASE_PREFIX, defaultIo, readPassphrase, type CliIo } from './shared.js';

export const KEY_LOSS_WARNING =
  'Anyone with these words can read your vault. Losing every device and these words loses the vault.';

export interface SetupOptions {
  hooks?: boolean;
  passphraseFile?: string;
  generatePassphrase?: boolean;
  /** Commander's `--no-passphrase` sets this to false. */
  passphrase?: boolean;
}

const PASSPHRASE_PROMPT_ATTEMPTS = 3;

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
  // Validate a passphrase file before anything is created, so a weak one
  // never leaves a half-set-up vault behind.
  if (options.passphraseFile && options.generatePassphrase) {
    io.err('Use either --passphrase-file or --generate-passphrase, not both.');
    return io.exit(1);
  }
  let filePassphrase: string | null = null;
  if (options.passphraseFile) {
    filePassphrase = await readPassphrase(io, '', options.passphraseFile);
    const strength = checkPassphraseStrength(filePassphrase);
    if (!strength.ok) {
      io.err(strength.message);
      return io.exit(1);
    }
  }

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
    await offerPassphrase(io, store, key, options, filePassphrase);
  }
  if (options.hooks) await installHooks(io);
}

/** Pick the passphrase for a new vault: a flag, a TTY prompt, or (non-TTY) just a hint. Null = none. */
async function choosePassphraseAtSetup(
  io: CliIo,
  options: SetupOptions,
  filePassphrase: string | null,
): Promise<{ passphrase: string; generated: boolean } | null> {
  if (options.passphrase === false) return null;
  if (filePassphrase !== null) return { passphrase: filePassphrase, generated: false };
  if (options.generatePassphrase) return { passphrase: generatePassphrase(), generated: true };
  if (!io.isTTY) {
    io.out(PASSPHRASE_LATER_HINT);
    return null;
  }
  const suggested = generatePassphrase();
  io.out('');
  io.out(`Also unlock with a passphrase on new machines. Suggested: ${suggested}`);
  for (let attempt = 0; attempt < PASSPHRASE_PROMPT_ATTEMPTS; attempt++) {
    const answer = await io.readLine('Press Enter to use the suggested passphrase, type your own (16+ characters), or type "skip": ');
    if (answer.trim() === '') return { passphrase: suggested, generated: false };
    if (answer.trim().toLowerCase() === 'skip') return null;
    const strength = checkPassphraseStrength(answer);
    if (strength.ok) return { passphrase: answer, generated: false };
    io.err(strength.message);
  }
  io.out(PASSPHRASE_LATER_HINT);
  return null;
}

async function offerPassphrase(
  io: CliIo,
  store: VaultStore,
  key: Buffer,
  options: SetupOptions,
  filePassphrase: string | null,
): Promise<void> {
  const chosen = await choosePassphraseAtSetup(io, options, filePassphrase);
  if (!chosen) return;
  try {
    await store.putSlot(KEYWRAP_OBJECT_NAME, await wrapVaultKey(key, chosen.passphrase));
  } catch (error) {
    if (!(error instanceof VaultOfflineError)) throw error;
    io.err(`Could not store the passphrase: ${error.message}. Run: pan vault passphrase set`);
    return;
  }
  if (chosen.generated) io.out(`${GENERATED_PASSPHRASE_PREFIX}${chosen.passphrase}`);
  io.out('Passphrase unlock is on: a new machine can join with the passphrase instead of the 24 words.');
}

async function installHooks(io: CliIo): Promise<void> {
  const { installVaultStopHook } = await import('./hooks.js');
  await installVaultStopHook(io);
}
