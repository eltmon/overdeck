/**
 * Shared plumbing for the `pan vault` verbs (PAN-2609).
 *
 * Every verb resolves its config, key and store through `openVault`, prints
 * through an injectable `CliIo` so tests can capture output, and stays inside
 * `src/lib/vault/**` plus Node built-ins (NFR-7, P-14).
 */
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { exitCli } from '../../exit.js';
import { VAULT_OFF_MESSAGE, readVaultConfig, type VaultConfig } from '../../../lib/vault/config.js';
import { deriveSubkeys, loadVaultKey, type VaultSubkeys } from '../../../lib/vault/identity.js';
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
  keys: VaultSubkeys;
  store: VaultStore;
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
 */
export async function openVault(io: CliIo, options: { quiet?: boolean } = {}): Promise<OpenVault | null> {
  const config = await readVaultConfig();
  if (!config.backend) {
    if (!options.quiet) io.out(VAULT_OFF_MESSAGE);
    return null;
  }
  const key = await loadVaultKey();
  if (!key) {
    if (!options.quiet) io.err(`Session Vault backend is set to ${config.backend} but the key file is missing. Run: pan vault join ${config.backend}`);
    return null;
  }
  return { config, keys: deriveSubkeys(key), store: await storeForBackend(config.backend) };
}

export async function readPhrase(io: CliIo, phraseFile?: string): Promise<string> {
  if (phraseFile) return (await readFile(phraseFile, 'utf8')).trim();
  return (await io.readLine('Recovery phrase (24 words): ')).trim();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
