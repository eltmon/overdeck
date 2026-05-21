/**
 * Per-project WAL Writer
 *
 * After each cost event is written, appends the event to a per-project
 * JSONL file at <events_repo>/.pan/events/ISSUE-ID.jsonl.
 *
 * These git-tracked files allow multi-developer cost sync via `pan sync-costs`.
 */

import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import { listProjects } from '../projects.js';
import { extractPrefix } from '../issue-id.js';
import { FsError } from '../errors.js';
import type { CostEvent } from './events.js';

const DEFAULT_EVENTS_SUBDIR = '.pan/events';

/**
 * Resolve the directory where WAL files for a given issue should be written.
 * Returns null if no matching project is found.
 */
export function resolveWalDir(issueId: string): string | null {
  const projects = listProjects();

  // Find which project this issueId belongs to.
  // Match by issue prefix (e.g. "PAN" in "PAN-335") against project key or name.
  const issuePrefix = extractPrefix(issueId);
  if (!issuePrefix) return null;

  for (const { key, config } of projects) {
    const projectKey = key.toUpperCase();
    const projectName = config.name?.toUpperCase();

    if (projectKey === issuePrefix || projectName === issuePrefix) {
      const repoPath = config.events_repo ?? config.path;
      const eventsSubdir = config.events_path ?? DEFAULT_EVENTS_SUBDIR;
      return join(repoPath, eventsSubdir);
    }
  }

  return null;
}

/**
 * Append a cost event to the per-project WAL file.
 *
 * The WAL file path is: <events_dir>/<ISSUE-ID>.jsonl
 *
 * Returns true if the event was written, false if no matching project was found.
 * Never throws — WAL writes are best-effort.
 */
export function appendToWal(event: CostEvent): boolean {
  try {
    const walDir = resolveWalDir(event.issueId);
    if (!walDir) return false;

    if (!existsSync(walDir)) {
      mkdirSync(walDir, { recursive: true });
    }

    const walFile = join(walDir, `${event.issueId.toUpperCase()}.jsonl`);
    const line = JSON.stringify(event) + '\n';
    appendFileSync(walFile, line, 'utf-8');
    return true;
  } catch (err) {
    // Best-effort — log but don't fail the caller
    console.error(`[wal] Failed to write WAL for ${event.issueId}:`, err);
    return false;
  }
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect variant of appendToWal. Failures surface as typed FsError on the
 * error channel; the sync variant swallows errors and returns false. Effect
 * callers that need to distinguish "no matching project" from "write failed"
 * should prefer this variant.
 */
export const appendToWalEffect = (
  event: CostEvent,
): Effect.Effect<boolean, FsError> =>
  Effect.try({
    try: () => {
      const walDir = resolveWalDir(event.issueId);
      if (!walDir) return false;

      if (!existsSync(walDir)) {
        mkdirSync(walDir, { recursive: true });
      }

      const walFile = join(walDir, `${event.issueId.toUpperCase()}.jsonl`);
      const line = JSON.stringify(event) + '\n';
      appendFileSync(walFile, line, 'utf-8');
      return true;
    },
    catch: (cause) => new FsError({ path: event.issueId, operation: 'appendToWal', cause }),
  });
