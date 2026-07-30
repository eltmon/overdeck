/**
 * Distribution of hook scripts from `sync-sources/hooks/` to `~/.overdeck/bin/`.
 *
 * This is how a merged change to agent behavior actually reaches running
 * agents, so the plan reports per-file drift rather than assuming every copy
 * is an update: in PAN-3327 the CLI resolved into a frozen `pan reload`
 * generation, copied that snapshot's hooks over the identical stale files
 * already deployed, and reported success. The tree being distributed is chosen
 * by `resolveSyncSourcesRoot()` in `paths.ts`; the counts here say what moved.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

import { hashFileSync } from './manifest.js';
import { BIN_DIR, SYNC_SOURCES } from './paths.js';

/**
 * Hook item for sync planning
 */
export interface HookItem {
  name: string;
  sourcePath: string;
  targetPath: string;
  status: 'new' | 'updated' | 'current';
}

export interface HooksSyncResult {
  synced: string[];
  errors: string[];
  /** Hooks whose deployed copy differed from the source and was replaced. */
  changed: string[];
  /** Hooks that were already byte-identical on disk. */
  unchanged: string[];
  /** The tree the hooks were distributed from, for operator-facing output. */
  sourceRoot: string;
}

/**
 * Plan hooks sync (checks what would be updated)
 */
export function planHooksSyncSync(): HookItem[] {
  const hooks: HookItem[] = [];

  if (!existsSync(SYNC_SOURCES.hooks)) {
    return hooks;
  }

  // Sync hook scripts (no extension) and bundled JS scripts (.js)
  // Skip source files (.ts), shell helpers (.sh), and other non-hook files (.mjs)
  const scripts = readdirSync(SYNC_SOURCES.hooks, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.')
      && (!entry.name.includes('.') || entry.name.endsWith('.js')));

  for (const script of scripts) {
    const sourcePath = join(SYNC_SOURCES.hooks, script.name);
    const targetPath = join(BIN_DIR, script.name);

    let status: HookItem['status'] = 'new';

    if (existsSync(targetPath)) {
      status = hashFileSync(sourcePath) === hashFileSync(targetPath) ? 'current' : 'updated';
    }

    hooks.push({ name: script.name, sourcePath, targetPath, status });
  }

  return hooks;
}

/**
 * Sync hooks (copy scripts to ~/.overdeck/bin/)
 */
export function syncHooksSync(): HooksSyncResult {
  const result: HooksSyncResult = {
    synced: [],
    errors: [],
    changed: [],
    unchanged: [],
    sourceRoot: SYNC_SOURCES.hooks,
  };

  // Ensure bin directory exists
  mkdirSync(BIN_DIR, { recursive: true });

  for (const hook of planHooksSyncSync()) {
    try {
      copyFileSync(hook.sourcePath, hook.targetPath);
      chmodSync(hook.targetPath, 0o755); // Make executable
      result.synced.push(hook.name);
      if (hook.status === 'current') result.unchanged.push(hook.name);
      else result.changed.push(hook.name);
    } catch (error) {
      result.errors.push(`${hook.name}: ${error}`);
    }
  }

  return result;
}
