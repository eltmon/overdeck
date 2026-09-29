/**
 * Session Vault exclusions (PAN-2609, PRD decision P-11).
 *
 * A conversation is excluded when its cwd is under a path in `exclude.paths`
 * (path-segment aware, so `/a/b` covers `/a/b/c` but not `/a/bc`), its cwd's
 * git origin is in `exclude.origins`, or its native session id or `vaultId` is
 * in `exclude.sessions`. `addExclusion` / `removeExclusion` update
 * `vault/config.json` through `config.ts`. Imports only Node built-ins and
 * sibling vault modules.
 */
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { readVaultConfig, writeVaultConfig, type VaultConfig, type VaultExclude } from './config.js';

export type ExclusionKind = keyof VaultExclude;

export interface ExclusionSubject {
  cwd?: string | null;
  gitOrigin?: string | null;
  nativeSessionId?: string | null;
  vaultId?: string | null;
}

/** True when `child` equals `parent` or lives inside it, comparing whole path segments. */
export function isPathUnder(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  if (rel === '') return true;
  if (isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

/** Decide whether `subject` is excluded by `exclude`. Pure. */
export function isExcluded(subject: ExclusionSubject, exclude: VaultExclude): boolean {
  if (subject.cwd && exclude.paths.some((path) => isPathUnder(subject.cwd!, path))) return true;
  if (subject.gitOrigin && exclude.origins.includes(subject.gitOrigin)) return true;
  if (subject.nativeSessionId && exclude.sessions.includes(subject.nativeSessionId)) return true;
  if (subject.vaultId && exclude.sessions.includes(subject.vaultId)) return true;
  return false;
}

/** Add one entry to `exclude.<kind>` in vault/config.json. Idempotent. */
export async function addExclusion(kind: ExclusionKind, entry: string): Promise<VaultConfig> {
  const value = kind === 'paths' ? resolve(entry) : entry;
  const config = await readVaultConfig();
  const list = config.exclude[kind];
  if (list.includes(value)) return config;
  return writeVaultConfig({ exclude: { ...config.exclude, [kind]: [...list, value] } });
}

/** Remove one entry from `exclude.<kind>` in vault/config.json. Idempotent. */
export async function removeExclusion(kind: ExclusionKind, entry: string): Promise<VaultConfig> {
  const value = kind === 'paths' ? resolve(entry) : entry;
  const config = await readVaultConfig();
  const list = config.exclude[kind];
  if (!list.includes(value)) return config;
  return writeVaultConfig({
    exclude: { ...config.exclude, [kind]: list.filter((existing) => existing !== value) },
  });
}
