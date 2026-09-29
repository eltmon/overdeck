/**
 * pan vault rotate-key [--yes] [--passphrase-file <path> | --generate-passphrase | --no-passphrase]
 *
 * Replace the vault key after a device was lost (PAN-4333). Every record,
 * machine ref and the header are re-encrypted under a new key in one batch;
 * chunks written before stay readable through the header's key ring. The new
 * 24-word recovery phrase is printed once, and every other machine must
 * re-join with it (or with the passphrase).
 *
 * Every refusal (flag conflict, declined confirmation, weak passphrase, a
 * missing passphrase flag off a TTY, a key that does not open the vault, an
 * unreachable backend) happens before `vault/key.next` exists, so a refused
 * run leaves no pending rotation. Once `key.next` exists the run is resumable:
 * running the verb again finishes it with the same key.
 *
 * This verb opens the store itself: `openVault` refuses while `key.next`
 * exists, and rotation needs the unguarded store to rewrite the header.
 */
import { VAULT_OFF_MESSAGE, readVaultConfig } from '../../../lib/vault/config.js';
import { HEADER_REF_NAME, VaultAuthenticationError, readVaultHeader } from '../../../lib/vault/format.js';
import { createVaultKey, deriveSubkeys, keyToPhrase, loadVaultKey } from '../../../lib/vault/identity.js';
import { PASSPHRASE_LATER_HINT, checkPassphraseStrength, generatePassphrase, wrapVaultKey } from '../../../lib/vault/keywrap.js';
import {
  VaultRotationConflictError,
  clearNextKey,
  loadNextKey,
  rotateVaultKey,
  saveNextKey,
  type RotateResult,
} from '../../../lib/vault/rotate.js';
import { KEYWRAP_OBJECT_NAME, VaultOfflineError, type VaultRef, type VaultStore } from '../../../lib/vault/store/types.js';
import {
  GENERATED_PASSPHRASE_PREFIX,
  choosePassphrase,
  defaultIo,
  readPassphrase,
  storeForBackend,
  type CliIo,
} from './shared.js';

export interface RotateKeyOptions {
  yes?: boolean;
  passphraseFile?: string;
  generatePassphrase?: boolean;
  /** Commander's `--no-passphrase` sets this to false. */
  passphrase?: boolean;
}

export const ROTATE_CONFIRM_PROMPT =
  'Rotate the vault key? Every other machine must re-join with the new recovery phrase or passphrase. [y/N] ';
export const ROTATE_NEEDS_YES_MESSAGE = 'Pass --yes to rotate the vault key without a prompt.';
export const ROTATE_NEEDS_PASSPHRASE_FLAG_MESSAGE =
  'This vault has a passphrase. Pass --passphrase-file <path>, --generate-passphrase or --no-passphrase.';
export const ROTATE_KEY_MISMATCH_MESSAGE = 'The vault key on this machine does not open the vault; nothing was rotated.';

/** What happens to `keywrap/v1`: a new wrap under this passphrase, removal, or nothing. */
type KeywrapPlan = { passphrase: string; generated: boolean } | 'remove' | 'none';

async function opensHeader(header: VaultRef | null, key: Uint8Array): Promise<boolean> {
  if (header === null) return false;
  try {
    return (await readVaultHeader(header.value, deriveSubkeys(key))) !== null;
  } catch (error) {
    if (error instanceof VaultAuthenticationError) return false;
    throw error;
  }
}

async function planKeywrap(
  options: RotateKeyOptions,
  hasWrap: boolean,
  io: CliIo,
): Promise<KeywrapPlan | { error: string }> {
  if (options.passphrase === false) return hasWrap ? 'remove' : 'none';
  if (options.passphraseFile) {
    const passphrase = await readPassphrase(io, '', options.passphraseFile);
    const strength = checkPassphraseStrength(passphrase);
    return strength.ok ? { passphrase, generated: false } : { error: strength.message };
  }
  if (options.generatePassphrase) return { passphrase: generatePassphrase(), generated: true };
  if (!hasWrap) return 'none';
  if (!io.isTTY) return { error: ROTATE_NEEDS_PASSPHRASE_FLAG_MESSAGE };
  return choosePassphrase(io, {});
}

export async function rotateKeyCommand(options: RotateKeyOptions = {}, io: CliIo = defaultIo): Promise<void> {
  const config = await readVaultConfig();
  if (!config.backend) {
    io.out(VAULT_OFF_MESSAGE);
    return;
  }
  const { backend } = config;
  const key = await loadVaultKey();
  if (!key) {
    io.err(`Session Vault backend is set to ${backend} but the key file is missing. Run: pan vault join ${backend}`);
    return io.exit(1);
  }
  if (options.passphraseFile && options.generatePassphrase) {
    io.err('Use either --passphrase-file or --generate-passphrase, not both.');
    return io.exit(1);
  }
  const offline = async (): Promise<never> => {
    io.err(`Backend ${backend} is unreachable; nothing was rotated. Run pan vault rotate-key again.`);
    return io.exit(1);
  };

  const pending = await loadNextKey();
  const resumed = pending !== null;
  if (!resumed && !options.yes) {
    if (!io.isTTY) {
      io.err(ROTATE_NEEDS_YES_MESSAGE);
      return io.exit(1);
    }
    const answer = (await io.readLine(ROTATE_CONFIRM_PROMPT)).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      io.out('Nothing was changed.');
      return;
    }
  }

  let store: VaultStore;
  let hasWrap: boolean;
  try {
    store = await storeForBackend(backend);
    await store.refresh();
    const header = await store.readRef(HEADER_REF_NAME);
    if (!(await opensHeader(header, key)) && !(pending !== null && (await opensHeader(header, pending)))) {
      io.err(ROTATE_KEY_MISMATCH_MESSAGE);
      return io.exit(1);
    }
    hasWrap = (await store.getObject(KEYWRAP_OBJECT_NAME)) !== null;
  } catch (error) {
    if (error instanceof VaultOfflineError) return offline();
    throw error;
  }

  const plan = await planKeywrap(options, hasWrap, io);
  if (typeof plan === 'object' && 'error' in plan) {
    io.err(plan.error);
    return io.exit(1);
  }

  // From here on the run is resumable: key.next holds the new key.
  const newKey = pending ?? createVaultKey();
  if (pending === null) await saveNextKey(newKey);
  const keywrap = plan === 'none' ? undefined : plan === 'remove' ? null : await wrapVaultKey(newKey, plan.passphrase);

  let result: RotateResult;
  try {
    result = await rotateVaultKey({ store, currentKey: key, keywrap });
  } catch (error) {
    if (error instanceof VaultOfflineError) return offline();
    if (error instanceof VaultRotationConflictError) {
      io.err(error.message);
      return io.exit(1);
    }
    throw error;
  }

  io.out(`Vault key rotated for ${backend}: ${result.records} conversation(s) and ${result.machines} machine(s) re-encrypted.`);
  io.out('');
  io.out('Write down your NEW recovery phrase. It is shown only now:');
  io.out('');
  io.out(`  ${keyToPhrase(result.newKey)}`);
  io.out('');
  io.out(`The old recovery phrase no longer opens this vault. On every other machine run: pan vault join ${backend}`);
  if (typeof plan === 'object') {
    io.out('Passphrase unlock now uses the new key.');
    if (plan.generated) io.out(`${GENERATED_PASSPHRASE_PREFIX}${plan.passphrase}`);
  } else if (options.passphrase === false) {
    io.out('Passphrase unlock is off.');
  } else {
    io.out(PASSPHRASE_LATER_HINT);
  }
  await clearNextKey();
}
