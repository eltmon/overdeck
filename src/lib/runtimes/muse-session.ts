/** Muse Code 1.0.2 durable sessions, isolated by Overdeck agent identity. */

/**
 * Sync twins (PAN-3958). Each `…Sync` function below has an async twin and exists only because
 * these callers run in synchronous contexts (sync functions, sync callbacks, or dependency slots typed
 * as sync) and cannot await:
 * - `resolveMuseSessionPathSync` (async: `resolveMuseSessionPath`): src/lib/agents/recovery.ts:107,
 *   src/lib/runtimes/muse.ts:25.
 * Do not add new synchronous callers; server-reachable code uses the async variants.
 */
import { readdir, stat } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { getOverdeckHome } from '../paths.js';

export function museDataHome(agentId: string, agentsRoot = join(getOverdeckHome(), 'agents')): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) throw new Error('Invalid Muse agent identity');
  return join(agentsRoot, agentId, 'muse-data');
}

export function museSessionsRoot(agentId: string, agentsRoot?: string): string {
  return join(museDataHome(agentId, agentsRoot), 'muse', 'sessions');
}

export function museSessionId(path: string): string {
  return basename(dirname(path));
}

/** Only root logs at YYYY/MM/DD/UUID/session.jsonl; never select a subagent. */
export async function listMuseSessionPaths(agentId: string, agentsRoot?: string): Promise<string[]> {
  let dirs = [museSessionsRoot(agentId, agentsRoot)];
  for (let depth = 0; depth < 4; depth++) {
    const children = await Promise.all(dirs.map(async dir => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      return entries.filter(entry => entry.isDirectory()).map(entry => join(dir, entry.name));
    }));
    dirs = children.flat();
  }
  const logs = await Promise.all(dirs.map(async dir => {
    const path = join(dir, 'session.jsonl');
    const info = await stat(path).catch(() => null);
    return info?.isFile() ? { path, id: basename(dir) } : null;
  }));
  // UUIDv7 order is creation order; activity in an older session must not steal resume.
  return logs.filter(log => log !== null).sort((a, b) => b.id.localeCompare(a.id)).map(log => log.path);
}

export async function resolveMuseSessionPath(agentId: string, agentsRoot?: string): Promise<string | null> {
  return (await listMuseSessionPaths(agentId, agentsRoot))[0] ?? null;
}

/** Legacy runtime introspection interface is synchronous; server resolvers use the async door above. */
export function resolveMuseSessionPathSync(agentId: string): string | null {
  let dirs = [museSessionsRoot(agentId)];
  for (let depth = 0; depth < 4; depth++) {
    dirs = dirs.flatMap(dir => {
      try {
        return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(dir, entry.name));
      } catch { return []; }
    });
  }
  return dirs.sort((a, b) => basename(b).localeCompare(basename(a))).map(dir => join(dir, 'session.jsonl')).find(path => {
    try { return statSync(path).isFile(); } catch { return false; }
  }) ?? null;
}
