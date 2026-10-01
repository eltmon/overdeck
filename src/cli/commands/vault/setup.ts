/**
 * pan vault setup <git-url>
 *
 * Enable the Session Vault against the user's own remote (FR-1, P-1..P-4).
 * Creates the vault key, initializes the remote (or checks it is a vault for
 * this key), writes the encrypted header, records this machine's identity,
 * stores the backend URL and prints the 24-word recovery phrase exactly once.
 * Then it offers passphrase unlock (PAN-4328): the key wrapped under a
 * passphrase as `keywrap/v1`, so a new machine can join without the 24 words.
 *
 * The state changes live in `setupVault()` (`src/lib/vault/setup-core.ts`,
 * PAN-4446); this wrapper owns the flags, the prompts and every output line.
 */
import { PASSPHRASE_LATER_HINT, checkPassphraseStrength, generatePassphrase } from '../../../lib/vault/keywrap.js';
import { KEY_LOSS_WARNING, setupVault, type SetupPassphrase } from '../../../lib/vault/setup-core.js';
import { GENERATED_PASSPHRASE_PREFIX, defaultIo, readPassphrase, type CliIo } from './shared.js';

export { KEY_LOSS_WARNING };

export interface SetupOptions {
  hooks?: boolean;
  passphraseFile?: string;
  generatePassphrase?: boolean;
  /** Commander's `--no-passphrase` sets this to false. */
  passphrase?: boolean;
}

const PASSPHRASE_PROMPT_ATTEMPTS = 3;

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

  const result = await setupVault({
    url,
    // Called only for a new key, once the vault is live: print the phrase, then ask for a passphrase.
    passphrase: async ({ recoveryPhrase, machine }): Promise<SetupPassphrase> => {
      io.out(`Session Vault enabled for ${machine.label} (${machine.environmentId}) with backend ${url}.`);
      io.out('');
      io.out('Write down your recovery phrase. It is shown only now:');
      io.out('');
      io.out(`  ${recoveryPhrase}`);
      io.out('');
      io.out(KEY_LOSS_WARNING);
      const chosen = await choosePassphraseAtSetup(io, options, filePassphrase);
      if (!chosen) return { mode: 'none' };
      return chosen.generated ? { mode: 'generate' } : { mode: 'custom', value: chosen.passphrase };
    },
  });
  if (result.status === 'error') {
    io.err(result.message);
    return io.exit(1);
  }
  if (result.status === 'already-set-up') {
    io.out(`Session Vault is already set up with ${url}. The recovery phrase is shown only at setup.`);
    if (options.hooks) await installHooks(io);
    return;
  }
  if (result.recoveryPhrase === null) {
    io.out(`Session Vault enabled for ${result.machine.label} (${result.machine.environmentId}) with backend ${url}.`);
  } else if (result.passphrase.stored) {
    if (result.passphrase.generated) io.out(`${GENERATED_PASSPHRASE_PREFIX}${result.passphrase.generated}`);
    io.out('Passphrase unlock is on: a new machine can join with the passphrase instead of the 24 words.');
  } else if (result.passphrase.error) {
    io.err(`Could not store the passphrase: ${result.passphrase.error}. Run: pan vault passphrase set`);
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

async function installHooks(io: CliIo): Promise<void> {
  const { installVaultStopHook } = await import('./hooks.js');
  await installVaultStopHook(io);
}
