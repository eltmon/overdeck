/**
 * Session Vault configuration (PAN-2609, PRD decision P-1).
 *
 * The vault keeps its own config file at `${OVERDECK_HOME}/vault/config.json`
 * (mode 0600, atomic temp-file + rename write). It deliberately does not use
 * `~/.overdeck/config.yaml` or `src/lib/config-yaml/**`: that loader pulls in the
 * whole settings schema, and the standalone `pan vault` CLI must stay light
 * (NFR-7). Imports only Node built-ins and `../paths.js`.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOverdeckHome } from '../paths.js';

export const VAULT_CONFIG_FILENAME = 'config.json';

/** Printed by every verb except `setup` and `join` when no backend is configured (AC-1). */
export const VAULT_OFF_MESSAGE = 'Session Vault is off. Run: pan vault setup <git-url>';

export interface VaultExclude {
  paths: string[];
  origins: string[];
  sessions: string[];
}

export interface VaultConfig {
  /** Backend URL. Absent means the vault is off. */
  backend?: string;
  exclude: VaultExclude;
  syncIntervalSec: number;
  debounceSec: number;
  evict: boolean;
  liveQuietMinutes: number;
  maxChunkBytes: number;
}

export const VAULT_CONFIG_DEFAULTS: Readonly<Omit<VaultConfig, 'backend'>> = {
  exclude: { paths: [], origins: [], sessions: [] },
  syncIntervalSec: 300,
  debounceSec: 30,
  evict: false,
  liveQuietMinutes: 30,
  maxChunkBytes: 64 * 1024 * 1024,
};

/** `${OVERDECK_HOME}/vault`, resolved on every call so tests can swap OVERDECK_HOME. */
export function vaultDir(): string {
  return join(getOverdeckHome(), 'vault');
}

export function vaultConfigPath(): string {
  return join(vaultDir(), VAULT_CONFIG_FILENAME);
}

function defaultConfig(): VaultConfig {
  return {
    exclude: {
      paths: [...VAULT_CONFIG_DEFAULTS.exclude.paths],
      origins: [...VAULT_CONFIG_DEFAULTS.exclude.origins],
      sessions: [...VAULT_CONFIG_DEFAULTS.exclude.sessions],
    },
    syncIntervalSec: VAULT_CONFIG_DEFAULTS.syncIntervalSec,
    debounceSec: VAULT_CONFIG_DEFAULTS.debounceSec,
    evict: VAULT_CONFIG_DEFAULTS.evict,
    liveQuietMinutes: VAULT_CONFIG_DEFAULTS.liveQuietMinutes,
    maxChunkBytes: VAULT_CONFIG_DEFAULTS.maxChunkBytes,
  };
}

function stringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? [...(value as string[])]
    : [...fallback];
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Fill every missing or malformed key with its P-1 default. */
function withDefaults(raw: unknown): VaultConfig {
  const config = defaultConfig();
  if (typeof raw !== 'object' || raw === null) return config;
  const record = raw as Record<string, unknown>;
  if (typeof record.backend === 'string' && record.backend.length > 0) {
    config.backend = record.backend;
  }
  const exclude =
    typeof record.exclude === 'object' && record.exclude !== null
      ? (record.exclude as Record<string, unknown>)
      : {};
  config.exclude = {
    paths: stringArray(exclude.paths, config.exclude.paths),
    origins: stringArray(exclude.origins, config.exclude.origins),
    sessions: stringArray(exclude.sessions, config.exclude.sessions),
  };
  config.syncIntervalSec = finiteNumber(record.syncIntervalSec, config.syncIntervalSec);
  config.debounceSec = finiteNumber(record.debounceSec, config.debounceSec);
  config.evict = typeof record.evict === 'boolean' ? record.evict : config.evict;
  config.liveQuietMinutes = finiteNumber(record.liveQuietMinutes, config.liveQuietMinutes);
  config.maxChunkBytes = finiteNumber(record.maxChunkBytes, config.maxChunkBytes);
  return config;
}

/**
 * Read the vault config. A missing file yields every default. A file that
 * exists but is not valid JSON throws an Error naming the path.
 */
export async function readVaultConfig(): Promise<VaultConfig> {
  const path = vaultConfigPath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultConfig();
    throw new Error(`Cannot read vault config ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Vault config ${path} is not valid JSON: ${(error as Error).message}`);
  }
  return withDefaults(parsed);
}

/**
 * Write the vault config atomically (temp file in the same directory, then
 * rename) with mode 0600. Missing keys in `patch` are filled from the current
 * file, then from the P-1 defaults. Returns the persisted config.
 */
export async function writeVaultConfig(patch: Partial<VaultConfig>): Promise<VaultConfig> {
  const current = await readVaultConfig();
  const next = withDefaults({ ...current, ...patch });
  const dir = vaultDir();
  const target = vaultConfigPath();
  const temp = join(dir, `${VAULT_CONFIG_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return next;
}

/** False when no backend is configured; every verb except `setup` and `join` then stops. */
export async function isVaultEnabled(): Promise<boolean> {
  const config = await readVaultConfig();
  return typeof config.backend === 'string' && config.backend.length > 0;
}
