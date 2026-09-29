/**
 * pan vault passphrase set|remove (PAN-4328).
 *
 * `set` wraps the vault key under a passphrase and stores it on the backend
 * as the reserved slot `keywrap/v1`, so `pan vault join` on a new machine can
 * ask for the passphrase instead of the 24-word recovery phrase. `remove`
 * deletes the slot. The vault key never changes, so the recovery phrase keeps
 * working either way.
 */
import { loadVaultKey } from '../../../lib/vault/identity.js';
import { wrapVaultKey } from '../../../lib/vault/keywrap.js';
import { KEYWRAP_OBJECT_NAME, VaultOfflineError } from '../../../lib/vault/store/types.js';
import { GENERATED_PASSPHRASE_PREFIX, choosePassphrase, defaultIo, openVault, type CliIo } from './shared.js';

export interface PassphraseSetOptions {
  passphraseFile?: string;
  generate?: boolean;
}

function offlineMessage(backend: string | undefined): string {
  return `Backend ${backend} is unreachable; nothing was changed. Try again later.`;
}

export async function passphraseSetCommand(options: PassphraseSetOptions = {}, io: CliIo = defaultIo): Promise<void> {
  if (options.passphraseFile && options.generate) {
    io.err('Use either --passphrase-file or --generate, not both.');
    return io.exit(1);
  }
  const vault = await openVault(io);
  if (!vault) return;
  const { backend } = vault.config;
  const chosen = await choosePassphrase(io, options);
  if ('error' in chosen) {
    io.err(chosen.error);
    return io.exit(1);
  }
  const key = await loadVaultKey();
  if (!key) throw new Error('The vault key file disappeared while setting the passphrase');
  try {
    await vault.store.putSlot(KEYWRAP_OBJECT_NAME, await wrapVaultKey(key, chosen.passphrase));
  } catch (error) {
    if (!(error instanceof VaultOfflineError)) throw error;
    io.err(offlineMessage(backend));
    return io.exit(1);
  }
  if (chosen.generated) io.out(`${GENERATED_PASSPHRASE_PREFIX}${chosen.passphrase}`);
  io.out(`Passphrase unlock is on for ${backend}. New machines can join with the passphrase; the recovery phrase still works.`);
}

export async function passphraseRemoveCommand(_options: Record<string, never> = {}, io: CliIo = defaultIo): Promise<void> {
  const vault = await openVault(io);
  if (!vault) return;
  const { backend } = vault.config;
  try {
    await vault.store.putSlot(KEYWRAP_OBJECT_NAME, null);
  } catch (error) {
    if (!(error instanceof VaultOfflineError)) throw error;
    io.err(offlineMessage(backend));
    return io.exit(1);
  }
  io.out(`Passphrase unlock is off for ${backend}. New machines need the recovery phrase.`);
}
