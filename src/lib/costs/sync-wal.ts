/**
 * WAL Import — scan project repos and import cost events into panopticon.db
 *
 * Called:
 * - On `pan up` (after startup) to pick up events written by other developers
 * - By `pan sync-costs` CLI command for on-demand sync
 */

import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { Effect } from 'effect';
import { listProjectsSync } from '../projects.js';
import { insertCostEvents } from '../database/cost-events-db.js';
import { FsError } from '../errors.js';
import type { CostEvent } from './events.js';

const DEFAULT_EVENTS_SUBDIR = '.pan/events';

export interface SyncResult {
  /** Total events imported across all projects */
  imported: number;
  /** Total duplicates skipped (already in DB) */
  duplicates: number;
  /** Files processed */
  filesScanned: number;
  /** Per-project breakdown */
  byProject: Record<string, { imported: number; duplicates: number; files: number }>;
  /** Any errors encountered (non-fatal) */
  errors: string[];
}async function syncWalFromAllProjectsPromise(): Promise<SyncResult> {
  const result: SyncResult = {
    imported: 0,
    duplicates: 0,
    filesScanned: 0,
    byProject: {},
    errors: [],
  };

  const projects = listProjectsSync();

  for (const { key, config } of projects) {
    const repoPath = config.events_repo ?? config.path;
    const eventsSubdir = config.events_path ?? DEFAULT_EVENTS_SUBDIR;
    const eventsDir = join(repoPath, eventsSubdir);

    if (!existsSync(eventsDir)) continue;

    const projectStats = { imported: 0, duplicates: 0, files: 0 };

    let files: string[];
    try {
      files = (await readdir(eventsDir)).filter(f => f.endsWith('.jsonl'));
    } catch (err) {
      result.errors.push(`${key}: failed to read events dir: ${err}`);
      continue;
    }

    for (const file of files) {
      const filePath = join(eventsDir, file);
      const events = await parseWalFile(filePath, result.errors);
      if (events.length === 0) continue;

      try {
        const { inserted, duplicates } = insertCostEvents(events, filePath);
        projectStats.imported += inserted;
        projectStats.duplicates += duplicates;
        projectStats.files++;
        result.filesScanned++;
      } catch (err) {
        result.errors.push(`${key}/${file}: import failed: ${err}`);
      }
    }

    if (projectStats.files > 0 || projectStats.imported > 0) {
      result.byProject[key] = projectStats;
      result.imported += projectStats.imported;
      result.duplicates += projectStats.duplicates;
    }
  }

  return result;
}async function syncWalFromDirPromise(eventsDir: string): Promise<{ imported: number; duplicates: number; files: number; errors: string[] }> {
  const stats = { imported: 0, duplicates: 0, files: 0, errors: [] as string[] };

  if (!existsSync(eventsDir)) return stats;

  let files: string[];
  try {
    files = (await readdir(eventsDir)).filter(f => f.endsWith('.jsonl'));
  } catch (err) {
    stats.errors.push(`Failed to read dir ${eventsDir}: ${err}`);
    return stats;
  }

  for (const file of files) {
    const filePath = join(eventsDir, file);
    const events = await parseWalFile(filePath, stats.errors);
    if (events.length === 0) continue;

    try {
      const { inserted, duplicates } = insertCostEvents(events, filePath);
      stats.imported += inserted;
      stats.duplicates += duplicates;
      stats.files++;
    } catch (err) {
      stats.errors.push(`${file}: import failed: ${err}`);
    }
  }

  return stats;
}

// ============== Helpers ==============

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect variant of syncWalFromAllProjects. The underlying impl already
 * collects per-file errors in `result.errors` rather than throwing, so the
 * Effect channel only sees catastrophic failures (e.g. listProjects throwing).
 */
export const syncWalFromAllProjects = (): Effect.Effect<SyncResult, FsError> =>
  Effect.tryPromise({
    try: () => syncWalFromAllProjectsPromise(),
    catch: (cause) => new FsError({ path: '<all projects>', operation: 'syncWalFromAllProjects', cause }),
  });

/** Effect variant of syncWalFromDir. */
export const syncWalFromDir = (
  eventsDir: string,
): Effect.Effect<{ imported: number; duplicates: number; files: number; errors: string[] }, FsError> =>
  Effect.tryPromise({
    try: () => syncWalFromDirPromise(eventsDir),
    catch: (cause) => new FsError({ path: eventsDir, operation: 'syncWalFromDir', cause }),
  });

async function parseWalFile(filePath: string, errors: string[]): Promise<CostEvent[]> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    errors.push(`Failed to read ${filePath}: ${err}`);
    return [];
  }

  const events: CostEvent[] = [];
  const lines = content.split('\n').filter(l => l.trim());

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as CostEvent;
      // Basic validation
      if (event.ts && event.agentId && event.issueId && event.model) {
        events.push(event);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}
