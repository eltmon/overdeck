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
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { exitCli } from '../../exit.js';
import { VAULT_OFF_MESSAGE, readVaultConfig, vaultDir, type VaultConfig } from '../../../lib/vault/config.js';
import { loadVaultKey, type VaultSubkeys } from '../../../lib/vault/identity.js';
import { VaultKeyMismatchError, openKeyring } from '../../../lib/vault/keyring.js';
import { checkPassphraseStrength, generatePassphrase } from '../../../lib/vault/keywrap.js';
import { DirVaultStore } from '../../../lib/vault/store/dir.js';
import { GitVaultStore, gitVaultCloneDir } from '../../../lib/vault/store/git.js';
import type { VaultStore } from '../../../lib/vault/store/types.js';

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

export interface OpenVault {
  config: VaultConfig;
  /** Sub-keys of the verified key; `previous` holds the key ring. */
  keys: VaultSubkeys;
  /** Guarded: every ref write asserts the header version the key was verified against. */
  store: VaultStore;
  /** When the vault key was last rotated; null before the first rotation. */
  rotatedAt: string | null;
}

export const ROTATION_UNFINISHED_MESSAGE = 'A vault key rotation started on this machine has not finished. Run: pan vault rotate-key';

async function rotationPending(): Promise<boolean> {
  try {
    await stat(join(vaultDir(), 'key.next'));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Backends prefixed `dir:` are local directories (tests, NAS); anything else is a git remote. */
export const DIR_BACKEND_PREFIX = 'dir:';

export async function storeForBackend(backend: string, cloneDir = gitVaultCloneDir()): Promise<VaultStore> {
  if (backend.startsWith(DIR_BACKEND_PREFIX)) return DirVaultStore.open(backend.slice(DIR_BACKEND_PREFIX.length));
  return GitVaultStore.open(cloneDir);
}

/**
 * Resolve config, key and store. Returns null (after printing
 * `VAULT_OFF_MESSAGE` unless `quiet`) when no backend is configured.
 *
 * Exits 1 while a key rotation started here is unfinished, and when the key
 * does not open the vault header. With `quiet` (the Stop hook) both return
 * null without output instead.
 */
export async function openVault(io: CliIo, options: { quiet?: boolean } = {}): Promise<OpenVault | null> {
  const config = await readVaultConfig();
  if (!config.backend) {
    if (!options.quiet) io.out(VAULT_OFF_MESSAGE);
    return null;
  }
  if (await rotationPending()) {
    if (options.quiet) return null;
    io.err(ROTATION_UNFINISHED_MESSAGE);
    return io.exit(1);
  }
  const key = await loadVaultKey();
  if (!key) {
    if (!options.quiet) io.err(`Session Vault backend is set to ${config.backend} but the key file is missing. Run: pan vault join ${config.backend}`);
    return null;
  }
  const store = await storeForBackend(config.backend);
  try {
    const opened = await openKeyring(store, key, { backend: config.backend });
    return { config, keys: opened.keys, store: opened.store, rotatedAt: opened.rotatedAt };
  } catch (error) {
    if (!(error instanceof VaultKeyMismatchError)) throw error;
    if (options.quiet) return null;
    io.err(`This machine's vault key does not open ${config.backend}. If the key was rotated on another machine, run: pan vault join ${config.backend}`);
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
