/**
 * Shared plumbing for the `pan vault` verbs (PAN-2609).
 *
 * Every verb resolves its config, key and store through `openVault`, prints
 * through an injectable `CliIo` so tests can capture output, and stays inside
 * `src/lib/vault/**` plus Node built-ins (NFR-7, P-14).
 *
 * `openVault` verifies the key against the vault header and hands back a
 * `KeyGuardedStore` (PAN-4333), so every verb that writes refuses once the
 * machine's key was retired by a rotation.
 */
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { exitCli } from '../../exit.js';
import { VAULT_OFF_MESSAGE } from '../../../lib/vault/config.js';
import { checkPassphraseStrength, generatePassphrase } from '../../../lib/vault/keywrap.js';
import { DIR_BACKEND_PREFIX, openVaultContext, storeForBackend, type OpenVault } from '../../../lib/vault/open.js';

export { DIR_BACKEND_PREFIX, storeForBackend, type OpenVault };

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  exit(code: number): Promise<never>;
  /** Read one line from the user (a TTY prompt or piped stdin). */
  readLine(prompt: string): Promise<string>;
  isTTY: boolean;
}

export const defaultIo: CliIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  exit: (code) => exitCli(code),
  readLine: (prompt) => new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdin.isTTY ? process.stdout : undefined });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  }),
  isTTY: Boolean(process.stdin.isTTY),
};

export const ROTATION_UNFINISHED_MESSAGE = 'A vault key rotation started on this machine has not finished. Run: pan vault rotate-key';

/**
 * Resolve config, key and store. Returns null (after printing
 * `VAULT_OFF_MESSAGE` unless `quiet`) when no backend is configured.
 *
 * Exits 1 while a key rotation started here is unfinished, and when the key
 * does not open the vault header. With `quiet` (the Stop hook) both return
 * null without output instead.
 */
export async function openVault(io: CliIo, options: { quiet?: boolean } = {}): Promise<OpenVault | null> {
  const opened = await openVaultContext();
  switch (opened.status) {
    case 'open':
      return opened.vault;
    case 'off':
      if (!options.quiet) io.out(VAULT_OFF_MESSAGE);
      return null;
    case 'rotation-pending':
      if (options.quiet) return null;
      io.err(ROTATION_UNFINISHED_MESSAGE);
      return io.exit(1);
    case 'key-missing':
      if (!options.quiet) io.err(`Session Vault backend is set to ${opened.backend} but the key file is missing. Run: pan vault join ${opened.backend}`);
      return null;
    case 'key-mismatch':
      if (options.quiet) return null;
      io.err(`This machine's vault key does not open ${opened.backend}. If the key was rotated on another machine, run: pan vault join ${opened.backend}`);
      return io.exit(1);
  }
}

export async function readPhrase(io: CliIo, phraseFile?: string): Promise<string> {
  if (phraseFile) return (await readFile(phraseFile, 'utf8')).trim();
  return (await io.readLine('Recovery phrase (24 words): ')).trim();
}

/** Read a vault passphrase from a file (whole file, trailing newline dropped) or one prompted line. */
export async function readPassphrase(io: CliIo, prompt: string, passphraseFile?: string): Promise<string> {
  if (passphraseFile) return (await readFile(passphraseFile, 'utf8')).replace(/\r?\n$/, '');
  return io.readLine(prompt);
}

export const GENERATED_PASSPHRASE_PREFIX = 'Vault passphrase (shown only now): ';

/**
 * Pick a new passphrase for `passphrase set`: from a file, generated, or
 * prompted (an empty answer generates one). A file or typed passphrase must
 * pass the strength check; a generated one always does.
 */
export async function choosePassphrase(
  io: CliIo,
  options: { passphraseFile?: string; generate?: boolean },
): Promise<{ passphrase: string; generated: boolean } | { error: string }> {
  let passphrase = '';
  if (options.passphraseFile) passphrase = await readPassphrase(io, '', options.passphraseFile);
  else if (!options.generate) passphrase = await readPassphrase(io, 'New vault passphrase (16+ characters, Enter for a generated one): ');
  if (!options.passphraseFile && passphrase.trim() === '') return { passphrase: generatePassphrase(), generated: true };
  const strength = checkPassphraseStrength(passphrase);
  return strength.ok ? { passphrase, generated: false } : { error: strength.message };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
