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
 *
 * Re-join after a key rotation (PAN-4333, D-10): on a machine already
 * configured for the same backend, join refreshes the existing clone, checks
 * the new key against the header, drops objects this machine wrote but never
 * published (they are sealed under the retired key), and replaces the key in
 * place. The local index and list cache are kept: vault ids survive a
 * rotation, so the next save continues each owned record under its new name.
 * A `key.next` left by a rotation this machine started and never committed is
 * removed: it belongs to the key that was just replaced.
 *
 * The state changes live in `joinVault()` (`src/lib/vault/join-core.ts`,
 * PAN-4446); this wrapper owns the flags, the prompts and every output line.
 */
import { readVaultConfig } from '../../../lib/vault/config.js';
import {
  PASSPHRASE_KEY_RETIRED_MESSAGE,
  PHRASE_MISMATCH_MESSAGE,
  joinVault,
  type JoinSecret,
  type KeywrapState,
} from '../../../lib/vault/join-core.js';
import { KEYWRAP_UNREADABLE_MESSAGE } from '../../../lib/vault/keywrap.js';
import { defaultIo, readPassphrase, readPhrase, type CliIo } from './shared.js';

export { PASSPHRASE_KEY_RETIRED_MESSAGE, PHRASE_MISMATCH_MESSAGE };

export interface JoinOptions {
  phraseFile?: string;
  passphraseFile?: string;
}

type PromptedSecret = JoinSecret | { kind: 'fail'; message: string };

/** Prompt for the 24-word recovery phrase; a read error stops the join. */
async function promptPhrase(io: CliIo): Promise<PromptedSecret> {
  try {
    return { kind: 'phrase', value: await readPhrase(io) };
  } catch (error) {
    return { kind: 'fail', message: (error as Error).message };
  }
}

/**
 * Ask for the passphrase when the backend holds a readable keywrap; otherwise,
 * or on an empty answer, fall back to the recovery phrase.
 */
async function promptSecret(url: string, io: CliIo, keywrap: KeywrapState, passphraseFile?: string): Promise<PromptedSecret> {
  if (keywrap === 'absent') {
    return passphraseFile
      ? { kind: 'fail', message: `This vault has no passphrase set. Use the recovery phrase: pan vault join ${url} --phrase-file <path>` }
      : promptPhrase(io);
  }
  if (keywrap === 'unreadable') {
    io.err(KEYWRAP_UNREADABLE_MESSAGE);
    return promptPhrase(io);
  }
  const passphrase = await readPassphrase(io, 'Vault passphrase (press Enter to use the recovery phrase instead): ', passphraseFile);
  if (passphrase.trim() === '') return promptPhrase(io);
  return { kind: 'passphrase', value: passphrase };
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
  // A phrase file is read here and parsed by the core before any backend access, as before PAN-4328.
  let secret: JoinSecret | ((keywrap: KeywrapState) => Promise<PromptedSecret>);
  if (options.phraseFile) {
    try {
      secret = { kind: 'phrase', value: await readPhrase(io, options.phraseFile) };
    } catch (error) {
      io.err((error as Error).message);
      return io.exit(1);
    }
  } else {
    secret = (keywrap) => promptSecret(url, io, keywrap, options.passphraseFile);
  }

  const result = await joinVault({ url, secret });
  if (result.status === 'error') {
    io.err(result.message);
    return io.exit(1);
  }
  io.out(`Joined the Session Vault at ${url} as ${result.machine.label} (${result.machine.environmentId}).`);
  io.out(result.offline ? 'The backend was unreachable during the first sync; run pan vault sync later.' : `${result.records} saved conversation(s) listed.`);
}
