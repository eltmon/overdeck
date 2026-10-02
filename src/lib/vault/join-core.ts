/**
 * joinVault(): the state changes behind `pan vault join` (PAN-4446 WI-2).
 *
 * Opens or clones the backend, gets the vault key from the passphrase keywrap
 * (`keywrap/v1`, PAN-4328) or the 24-word recovery phrase, checks it opens the
 * header, then saves the key and backend and syncs once. A wrong passphrase is
 * detected from the keywrap alone, so nothing else is read from the backend,
 * and a failed join writes nothing and removes a clone it created.
 *
 * Re-join after a key rotation (PAN-4333, D-10) and unlocking a machine whose
 * key is missing or retired are the same operation: objects this machine wrote
 * under a retired key and never published are dropped, the key is replaced in
 * place, and a leftover `key.next` is removed.
 *
 * Prints nothing and never exits: the CLI (`src/cli/commands/vault/join.ts`)
 * and the dashboard vault service both call it and render the tagged result.
 * Error messages are the CLI's exact strings (D-3).
 */
import { rm } from 'node:fs/promises';
import { ensureEnvironmentIdentity } from '../environment-identity.js';
import { readVaultConfig, writeVaultConfig } from './config.js';
import { HEADER_REF_NAME, readVaultHeader, VaultAuthenticationError } from './format.js';
import { deriveSubkeys, phraseToKey, saveVaultKey } from './identity.js';
import { KEYWRAP_UNREADABLE_MESSAGE, KeywrapFormatError, PASSPHRASE_MISMATCH_MESSAGE, parseKeywrap, unwrapVaultKey } from './keywrap.js';
import { DIR_BACKEND_PREFIX } from './open.js';
import { clearNextKey } from './rotate.js';
import { DirVaultStore } from './store/dir.js';
import { GitVaultStore, gitVaultCloneDir, initGitVault } from './store/git.js';
import { KEYWRAP_OBJECT_NAME, VaultOfflineError, type VaultStore } from './store/types.js';
import { syncOnce } from './sync.js';

export const PHRASE_MISMATCH_MESSAGE =
  'The recovery phrase does not match this vault. If the vault key was rotated, use the new recovery phrase or passphrase.';
export const PASSPHRASE_KEY_RETIRED_MESSAGE =
  'The passphrase unlocked a key this vault no longer uses. The vault key was rotated; use the new recovery phrase, or finish the rotation with pan vault rotate-key on the machine that started it.';
export const NO_PASSPHRASE_MESSAGE = 'This vault has no passphrase set. Use the recovery phrase.';

export type JoinSecret = { kind: 'passphrase'; value: string } | { kind: 'phrase'; value: string };
export type KeywrapState = 'present' | 'absent' | 'unreadable';

export interface JoinVaultInput {
  url: string;
  /**
   * A value (dashboard; a phrase is parsed before any backend access), or a callback
   * (CLI) called after the store is open, with the keywrap state. The callback may
   * return `{ kind: 'fail', message }` to stop; the core then removes a clone it created.
   */
  secret: JoinSecret | ((keywrap: KeywrapState) => Promise<JoinSecret | { kind: 'fail'; message: string }>);
}

export type JoinErrorCode =
  | 'other-backend'
  | 'bad-phrase'
  | 'unreachable'
  | 'store-error'
  | 'no-passphrase'
  | 'keywrap-unreadable'
  | 'wrong-passphrase'
  | 'not-a-vault'
  | 'key-retired'
  | 'phrase-mismatch'
  | 'aborted';

export type JoinVaultResult =
  | {
      status: 'joined';
      backend: string;
      machine: { label: string; environmentId: string };
      records: number;
      offline: boolean;
      via: 'passphrase' | 'phrase';
    }
  | { status: 'error'; code: JoinErrorCode; message: string };

type JoinError = Extract<JoinVaultResult, { status: 'error' }>;

function joinError(code: JoinErrorCode, message: string): JoinError {
  return { status: 'error', code, message };
}

function keyFromPhrase(phrase: string): Buffer | JoinError {
  try {
    return phraseToKey(phrase);
  } catch (error) {
    return joinError('bad-phrase', (error as Error).message);
  }
}

/** Read and classify the keywrap object; `wrapped` is set only when it parses. */
async function readKeywrap(store: VaultStore): Promise<{ state: KeywrapState; wrapped: Uint8Array | null }> {
  const wrapped = await store.getObject(KEYWRAP_OBJECT_NAME);
  if (!wrapped) return { state: 'absent', wrapped: null };
  try {
    parseKeywrap(wrapped);
  } catch (error) {
    if (!(error instanceof KeywrapFormatError)) throw error;
    return { state: 'unreadable', wrapped: null };
  }
  return { state: 'present', wrapped };
}

/** Turn a secret into the vault key. A passphrase unwraps the keywrap locally; nothing else is read. */
async function keyFromSecret(secret: JoinSecret, keywrap: { state: KeywrapState; wrapped: Uint8Array | null }): Promise<Buffer | JoinError> {
  if (secret.kind === 'phrase') return keyFromPhrase(secret.value);
  if (keywrap.state === 'absent') return joinError('no-passphrase', NO_PASSPHRASE_MESSAGE);
  if (!keywrap.wrapped) return joinError('keywrap-unreadable', KEYWRAP_UNREADABLE_MESSAGE);
  const key = await unwrapVaultKey(keywrap.wrapped, secret.value);
  return key ?? joinError('wrong-passphrase', PASSPHRASE_MISMATCH_MESSAGE);
}

export async function joinVault(input: JoinVaultInput): Promise<JoinVaultResult> {
  const { url, secret } = input;
  const config = await readVaultConfig();
  if (config.backend && config.backend !== url) {
    return joinError('other-backend', `Session Vault is already enabled with backend ${config.backend}.`);
  }
  // A direct phrase is parsed before any backend access, as before PAN-4328.
  let key: Buffer | null = null;
  if (typeof secret !== 'function' && secret.kind === 'phrase') {
    const parsed = keyFromPhrase(secret.value);
    if (!Buffer.isBuffer(parsed)) return parsed;
    key = parsed;
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
    if (error instanceof VaultOfflineError) return joinError('unreachable', `Could not reach ${url}: ${error.message}`);
    return joinError('store-error', (error as Error).message);
  }
  const fail = async (error: JoinError): Promise<JoinError> => {
    if (createdClone) await rm(gitVaultCloneDir(), { recursive: true, force: true });
    return error;
  };

  if (!createdClone && !url.startsWith(DIR_BACKEND_PREFIX)) {
    // An existing clone may predate the keywrap or a key rotation; offline, use the local view.
    await store.refresh().catch((error: unknown) => {
      if (!(error instanceof VaultOfflineError)) throw error;
    });
  }
  let fromPassphrase = false;
  if (!key) {
    const keywrap = await readKeywrap(store);
    const chosen = typeof secret === 'function' ? await secret(keywrap.state) : secret;
    if (chosen.kind === 'fail') return fail(joinError('aborted', chosen.message));
    const outcome = await keyFromSecret(chosen, keywrap);
    if (!Buffer.isBuffer(outcome)) return fail(outcome);
    key = outcome;
    fromPassphrase = chosen.kind === 'passphrase';
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
  if (!matches) {
    if (!header) return fail(joinError('not-a-vault', `${url} is not a Session Vault yet. Run: pan vault setup ${url}`));
    return fail(fromPassphrase ? joinError('key-retired', PASSPHRASE_KEY_RETIRED_MESSAGE) : joinError('phrase-mismatch', PHRASE_MISMATCH_MESSAGE));
  }

  // Objects this machine wrote under a retired key and never published must not reach the backend.
  await store.discardUnpublished();
  await saveVaultKey(key);
  // A pending rotation here started from the key this join replaces; it must not resume.
  await clearNextKey();
  await writeVaultConfig({ backend: url });
  const me = await ensureEnvironmentIdentity();
  const report = await syncOnce({ store, keys });
  return {
    status: 'joined',
    backend: url,
    machine: { label: me.label, environmentId: me.environmentId },
    records: report.records,
    offline: report.offline,
    via: fromPassphrase ? 'passphrase' : 'phrase',
  };
}
