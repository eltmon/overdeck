/**
 * pan vault join <git-url>
 *
 * Join an existing vault from a second machine (FR-1, P-2, P-3). When the
 * backend holds a passphrase keywrap (`keywrap/v1`, PAN-4328) the user is
 * asked for the passphrase first; an empty answer falls back to the 24-word
 * recovery phrase. A wrong passphrase is detected locally from the keywrap
 * alone, so nothing else is read from the backend. Either way the header ref
 * must decrypt before the key and backend are written, and a failed join
 * writes nothing.
 */
import { rm } from 'node:fs/promises';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { readVaultConfig, writeVaultConfig } from '../../../lib/vault/config.js';
import { HEADER_REF_NAME, readVaultHeader, VaultAuthenticationError } from '../../../lib/vault/format.js';
import { deriveSubkeys, phraseToKey, saveVaultKey } from '../../../lib/vault/identity.js';
import {
  KEYWRAP_UNREADABLE_MESSAGE,
  KeywrapFormatError,
  PASSPHRASE_MISMATCH_MESSAGE,
  parseKeywrap,
  unwrapVaultKey,
} from '../../../lib/vault/keywrap.js';
import { DirVaultStore } from '../../../lib/vault/store/dir.js';
import { GitVaultStore, gitVaultCloneDir, initGitVault } from '../../../lib/vault/store/git.js';
import { KEYWRAP_OBJECT_NAME, VaultOfflineError, type VaultStore } from '../../../lib/vault/store/types.js';
import { syncOnce } from '../../../lib/vault/sync.js';
import { DIR_BACKEND_PREFIX, defaultIo, readPassphrase, readPhrase, type CliIo } from './shared.js';

export const PHRASE_MISMATCH_MESSAGE = 'The recovery phrase does not match this vault.';

export interface JoinOptions {
  phraseFile?: string;
  passphraseFile?: string;
}

type KeyOutcome = { key: Buffer | null } | { error: string };

/**
 * Try the passphrase keywrap. `key: null` means fall back to the recovery
 * phrase (no keywrap, an unreadable one, or an empty answer).
 */
async function unlockWithPassphrase(url: string, store: VaultStore, io: CliIo, passphraseFile?: string): Promise<KeyOutcome> {
  const wrapped = await store.getObject(KEYWRAP_OBJECT_NAME);
  if (!wrapped) {
    return passphraseFile
      ? { error: `This vault has no passphrase set. Use the recovery phrase: pan vault join ${url} --phrase-file <path>` }
      : { key: null };
  }
  try {
    parseKeywrap(wrapped);
  } catch (error) {
    if (!(error instanceof KeywrapFormatError)) throw error;
    io.err(KEYWRAP_UNREADABLE_MESSAGE);
    return { key: null };
  }
  const passphrase = await readPassphrase(io, 'Vault passphrase (press Enter to use the recovery phrase instead): ', passphraseFile);
  if (passphrase.trim() === '') return { key: null };
  const key = await unwrapVaultKey(wrapped, passphrase);
  return key ? { key } : { error: PASSPHRASE_MISMATCH_MESSAGE };
}

export async function joinCommand(url: string, options: JoinOptions = {}, io: CliIo = defaultIo): Promise<void> {
  const config = await readVaultConfig();
  if (config.backend && config.backend !== url) {
    io.err(`Session Vault is already enabled with backend ${config.backend}.`);
    return io.exit(1);
  }
  if (options.phraseFile && options.passphraseFile) {
    io.err('Use either --phrase-file or --passphrase-file, not both.');
    return io.exit(1);
  }
  // A phrase file is parsed before any backend access, as before PAN-4328.
  let key: Buffer | null = null;
  if (options.phraseFile) {
    try {
      key = phraseToKey(await readPhrase(io, options.phraseFile));
    } catch (error) {
      io.err((error as Error).message);
      return io.exit(1);
    }
  }

  let store: VaultStore;
  let createdClone = false;
  try {
    if (url.startsWith(DIR_BACKEND_PREFIX)) {
      store = await DirVaultStore.open(url.slice(DIR_BACKEND_PREFIX.length));
    } else {
      try {
        store = await GitVaultStore.open(gitVaultCloneDir());
      } catch {
        store = await initGitVault(url, gitVaultCloneDir());
        createdClone = true;
      }
    }
  } catch (error) {
    io.err(error instanceof VaultOfflineError ? `Could not reach ${url}: ${error.message}` : (error as Error).message);
    return io.exit(1);
  }
  const fail = async (message: string): Promise<never> => {
    io.err(message);
    if (createdClone) await rm(gitVaultCloneDir(), { recursive: true, force: true });
    return io.exit(1);
  };

  if (!key) {
    if (!createdClone && !url.startsWith(DIR_BACKEND_PREFIX)) {
      // An existing clone may predate the keywrap; offline, use the local view.
      await store.refresh().catch((error: unknown) => {
        if (!(error instanceof VaultOfflineError)) throw error;
      });
    }
    const outcome = await unlockWithPassphrase(url, store, io, options.passphraseFile);
    if ('error' in outcome) return fail(outcome.error);
    key = outcome.key;
  }
  if (!key) {
    try {
      key = phraseToKey(await readPhrase(io));
    } catch (error) {
      return fail((error as Error).message);
    }
  }
  const keys = deriveSubkeys(key);

  const header = await store.readRef(HEADER_REF_NAME);
  let matches = false;
  if (header) {
    try {
      matches = (await readVaultHeader(header.value, keys)) !== null;
    } catch (error) {
      if (!(error instanceof VaultAuthenticationError)) throw error;
    }
  }
  if (!matches) return fail(header ? PHRASE_MISMATCH_MESSAGE : `${url} is not a Session Vault yet. Run: pan vault setup ${url}`);

  await saveVaultKey(key);
  await writeVaultConfig({ backend: url });
  const me = await ensureEnvironmentIdentity();
  const report = await syncOnce({ store, keys });
  io.out(`Joined the Session Vault at ${url} as ${me.label} (${me.environmentId}).`);
  io.out(report.offline ? 'The backend was unreachable during the first sync; run pan vault sync later.' : `${report.records} saved conversation(s) listed.`);
}
