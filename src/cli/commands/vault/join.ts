/**
 * pan vault join <git-url>
 *
 * Join an existing vault from a second machine (FR-1, P-2, P-3): the user
 * enters the 24-word recovery phrase, the header ref proves it decrypts, and
 * only then are the key and backend written. A wrong phrase writes nothing.
 */
import { rm } from 'node:fs/promises';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { readVaultConfig, writeVaultConfig } from '../../../lib/vault/config.js';
import { HEADER_REF_NAME, readVaultHeader, VaultAuthenticationError } from '../../../lib/vault/format.js';
import { deriveSubkeys, phraseToKey, saveVaultKey } from '../../../lib/vault/identity.js';
import { DirVaultStore } from '../../../lib/vault/store/dir.js';
import { GitVaultStore, gitVaultCloneDir, initGitVault } from '../../../lib/vault/store/git.js';
import { VaultOfflineError, type VaultStore } from '../../../lib/vault/store/types.js';
import { syncOnce } from '../../../lib/vault/sync.js';
import { DIR_BACKEND_PREFIX, defaultIo, readPhrase, type CliIo } from './shared.js';

export const PHRASE_MISMATCH_MESSAGE = 'The recovery phrase does not match this vault.';

export interface JoinOptions {
  phraseFile?: string;
}

export async function joinCommand(url: string, options: JoinOptions = {}, io: CliIo = defaultIo): Promise<void> {
  const config = await readVaultConfig();
  if (config.backend && config.backend !== url) {
    io.err(`Session Vault is already enabled with backend ${config.backend}.`);
    return io.exit(1);
  }
  let key: Buffer;
  try {
    key = phraseToKey(await readPhrase(io, options.phraseFile));
  } catch (error) {
    io.err((error as Error).message);
    return io.exit(1);
  }
  const keys = deriveSubkeys(key);

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

  const header = await store.readRef(HEADER_REF_NAME);
  let matches = false;
  if (header) {
    try {
      matches = (await readVaultHeader(header.value, keys)) !== null;
    } catch (error) {
      if (!(error instanceof VaultAuthenticationError)) throw error;
    }
  }
  if (!matches) {
    io.err(header ? PHRASE_MISMATCH_MESSAGE : `${url} is not a Session Vault yet. Run: pan vault setup ${url}`);
    if (createdClone) await rm(gitVaultCloneDir(), { recursive: true, force: true });
    return io.exit(1);
  }

  await saveVaultKey(key);
  await writeVaultConfig({ backend: url });
  const me = await ensureEnvironmentIdentity();
  const report = await syncOnce({ store, keys });
  io.out(`Joined the Session Vault at ${url} as ${me.label} (${me.environmentId}).`);
  io.out(report.offline ? 'The backend was unreachable during the first sync; run pan vault sync later.' : `${report.records} saved conversation(s) listed.`);
}
