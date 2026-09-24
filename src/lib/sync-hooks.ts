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

import {
  hashFile,
  pruneStaleManifestEntries,
  readManifest,
  setManifestEntry,
  writeManifest,
} from './manifest.js';
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
  /** Previously synced hooks whose source was deleted, removed from the bin dir. */
  pruned: string[];
  /** Previously synced hooks whose source was deleted but were edited on disk; kept. */
  keptModified: string[];
}

/**
 * Records which files in ~/.overdeck/bin/ `syncHooks()` wrote (PAN-3881), so a
 * hook deleted from `sync-sources/hooks/` is removed on the next sync without
 * ever touching a file sync did not write.
 */
function hooksManifestPath(): string {
  return join(BIN_DIR, '.overdeck-manifest.json');
}

/**
 * Plan hooks sync (checks what would be updated)
 */
export function planHooksSync(): HookItem[] {
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
      status = hashFile(sourcePath) === hashFile(targetPath) ? 'current' : 'updated';
    }

    hooks.push({ name: script.name, sourcePath, targetPath, status });
  }

  return hooks;
}

/**
 * Sync hooks (copy scripts to ~/.overdeck/bin/)
 */
export function syncHooks(): HooksSyncResult {
  const result: HooksSyncResult = {
    synced: [],
    errors: [],
    changed: [],
    unchanged: [],
    sourceRoot: SYNC_SOURCES.hooks,
    pruned: [],
    keptModified: [],
  };

  // Ensure bin directory exists
  mkdirSync(BIN_DIR, { recursive: true });

  const manifestPath = hooksManifestPath();
  const manifest = readManifest(manifestPath);
  const plan = planHooksSync();

  for (const hook of plan) {
    try {
      copyFileSync(hook.sourcePath, hook.targetPath);
      chmodSync(hook.targetPath, 0o755); // Make executable
      setManifestEntry(manifest, hook.name, hashFile(hook.targetPath), 'overdeck');
      result.synced.push(hook.name);
      if (hook.status === 'current') result.unchanged.push(hook.name);
      else result.changed.push(hook.name);
    } catch (error) {
      result.errors.push(`${hook.name}: ${error}`);
    }
  }

  // Remove hooks this sync wrote earlier whose source is gone. Only manifest
  // entries are candidates, and a copy edited since it was written is kept.
  // An unreadable sources dir yields an empty plan; never treat that as
  // "every hook was deleted".
  if (existsSync(SYNC_SOURCES.hooks)) {
    try {
      const prune = pruneStaleManifestEntries(BIN_DIR, manifest, new Set(plan.map((hook) => hook.name)));
      result.pruned.push(...prune.pruned);
      result.keptModified.push(...prune.keptModified);
    } catch (error) {
      result.errors.push(`prune: ${error}`);
    }
  }

  try {
    writeManifest(manifestPath, manifest);
  } catch (error) {
    result.errors.push(`manifest: ${error}`);
  }

  return result;
}
