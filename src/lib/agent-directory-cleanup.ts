/**
 * Agent directory cleanup — identifies and removes orphaned legacy agent directories.
 *
 * Valid directories (preserved):
 *   - agent-<issueId>    — work agents (always preserved)
 *   - planning-<issueId> — planning agents (only preserved while tmux session is running)
 *
 * Legacy directories (eligible for cleanup when no tmux session is running):
 *   - conv-*             — old conversation directories (conversations now live in
 *                          ~/.panopticon/conversations/)
 *   - work-<issueId>, review-<issueId>, test-<issueId>, merge-<issueId>
 *   - agent-<number>, agent-agent-*, agent-* with uppercase prefix
 *   - specialist-*
 *   - Any other non-standard name
 */

import { existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import { AGENTS_DIR } from './paths.js';
import { listSessionNamesAsync } from './tmux.js';
import { parseIssueId } from './issue-id.js';
import { FsError } from './errors.js';

/**
 * Valid agent directory naming patterns.
 *
 * Standard issue IDs:  PREFIX-NUMBER  → normalized to lowercase with dash
 * Rally issue IDs:    PREFIX_NUMBER  → normalized to lowercase, no dash
 *
 * Examples of valid names:
 *   agent-pan-801, agent-min-215, agent-f29698
 *   planning-pan-801, planning-min-215
 *
 * Examples of legacy names (no longer created):
 *   agent-108, agent-MIN-791, agent-agent-pan-699, agent-pan-test-1
 *   work-pan-208, review-pan-646, test-pan-646, merge-pan-646
 *   conv-20260411-1125, specialist-panopticon-cli-test-agent
 */

/**
 * Check whether a directory name matches a valid work-agent directory pattern.
 *
 * Work-agent directories (agent-<issueId>) are always preserved.
 * Planning-agent directories are handled separately — they are only valid
 * while their tmux session is running.
 */
export function isValidAgentDirectoryName(name: string): boolean {
  const match = name.match(/^agent-(.+)$/);
  if (!match) return false;

  const suffix = match[1]!;
  // Current code always lowercases issue IDs before creating directories
  if (suffix !== suffix.toLowerCase()) return false;

  // Direct agent-<issueId> directories (work agents, role orchestrators without suffix)
  if (parseIssueId(suffix) !== null) return true;

  // Specialist directories: agent-<issueId>-<role> or agent-<issueId>-<role>-<subRole>
  // e.g. agent-pan-457-review-correctness, agent-pan-457-test, agent-pan-457-ship
  // Also work agents with slots: agent-pan-457-1
  const parts = suffix.split('-');
  for (let i = 2; i <= parts.length; i++) {
    const candidate = parts.slice(0, i).join('-');
    if (parseIssueId(candidate) !== null) {
      const remainder = parts.slice(i).join('-');
      if (remainder && /^[a-z0-9-]+$/.test(remainder)) return true;
    }
  }

  return false;
}

/**
 * Check whether a directory name is a legacy conv-* directory.
 *
 * Conversations now store state in ~/.panopticon/conversations/, so any
 * conv-* directory under ~/.panopticon/agents/ is legacy.
 */
export function isLegacyConversationDirectory(name: string): boolean {
  return name.startsWith('conv-');
}

/**
 * Extract the issue ID from a planning-* directory name.
 * Returns null if the name is not a planning directory or the issue ID is invalid.
 */
export function getPlanningIssueId(name: string): string | null {
  const match = name.match(/^planning-(.+)$/);
  if (!match) return null;

  const issueId = match[1]!;
  if (issueId !== issueId.toLowerCase()) return null;
  if (parseIssueId(issueId) === null) return null;

  return issueId;
}

export interface OrphanedAgentDir {
  name: string;
  path: string;
  hasRunningSession: boolean;
}

/**
 * Scan the agents directory and return all orphaned directories,
 * annotated with whether they have a running tmux session.
 *
 * Orphaned directories include:
 *   - All legacy naming patterns (work-*, review-*, test-*, merge-*, conv-*, etc.)
 *   - planning-* directories whose tmux session is no longer running
 *   - agent-* directories with invalid names (bare numeric, uppercase, doubled prefix, etc.)
 *
 * Preserved directories (never orphaned):
 *   - agent-* directories with valid issue IDs
 *   - planning-* directories with a running tmux session
 */
export async function findOrphanedAgentDirs(
  agentsDir: string = AGENTS_DIR,
): Promise<OrphanedAgentDir[]> {
  if (!existsSync(agentsDir)) {
    return [];
  }

  const entries = readdirSync(agentsDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const sessionNames = await listSessionNamesAsync();
  const sessionSet = new Set(sessionNames);

  const orphaned: OrphanedAgentDir[] = [];
  for (const name of dirs) {
    // Work-agent directories are always valid
    if (isValidAgentDirectoryName(name)) continue;

    // Planning directories are valid only while their tmux session is running
    const planningIssueId = getPlanningIssueId(name);
    if (planningIssueId !== null) {
      if (sessionSet.has(name)) continue; // running session — preserve
      // No running session — orphaned
    }

    const dirPath = join(agentsDir, name);
    orphaned.push({
      name,
      path: dirPath,
      hasRunningSession: sessionSet.has(name),
    });
  }

  return orphaned;
}

export interface CleanupResult {
  /** Directories that were removed */
  removed: string[];
  /** Directories skipped because a tmux session is still running */
  protected: string[];
  /** Directories that would be removed (dry run) */
  wouldRemove: string[];
  /** Total orphaned directories found */
  totalOrphaned: number;
}

/**
 * Clean up orphaned (non-standard or stale) agent directories.
 *
 * Safety guarantees:
 *   - Directories with a running tmux session are NEVER touched.
 *   - Valid agent-<issueId> directories are NEVER touched.
 *   - planning-<issueId> directories are only touched when their tmux session
 *     is no longer running (stale planning state).
 *   - In dry-run mode, no filesystem changes are made.
 *
 * @param options.dryRun     Preview what would be removed without deleting anything.
 * @param options.force      Skip interactive confirmation (useful in scripts).
 * @param options.agentsDir  Override the default ~/.panopticon/agents/ path.
 */
export async function cleanupAgentDirectories(options: {
  dryRun?: boolean;
  force?: boolean;
  agentsDir?: string;
} = {}): Promise<CleanupResult> {
  const { dryRun = false, force = false, agentsDir = AGENTS_DIR } = options;

  const orphaned = await findOrphanedAgentDirs(agentsDir);
  const protectedDirs = orphaned.filter((d) => d.hasRunningSession);
  const removable = orphaned.filter((d) => !d.hasRunningSession);

  const result: CleanupResult = {
    removed: [],
    protected: protectedDirs.map((d) => d.name),
    wouldRemove: [],
    totalOrphaned: orphaned.length,
  };

  if (removable.length === 0) {
    return result;
  }

  if (dryRun) {
    result.wouldRemove = removable.map((d) => d.name);
    return result;
  }

  if (!force) {
    // Prompt for confirmation is handled by the CLI caller; this function
    // focuses on the actual cleanup logic.
  }

  for (const dir of removable) {
    try {
      rmSync(dir.path, { recursive: true, force: true });
      result.removed.push(dir.name);
    } catch {
      // Non-fatal — directory may have already been removed or permissions changed.
    }
  }

  return result;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect-native variant of findOrphanedAgentDirs. Fails with FsError if the
 * agents directory listing fails. The tmux listing is wrapped so listing
 * failures bubble up as FsError too (treats tmux as part of the filesystem
 * for purposes of this check).
 */
export const findOrphanedAgentDirsEffect = (
  agentsDir: string = AGENTS_DIR,
): Effect.Effect<readonly OrphanedAgentDir[], FsError> =>
  Effect.tryPromise({
    try: () => findOrphanedAgentDirs(agentsDir),
    catch: (cause) =>
      new FsError({ path: agentsDir, operation: 'findOrphanedAgentDirs', cause }),
  });

/**
 * Effect-native variant of cleanupAgentDirectories. Fails with FsError if the
 * orphan scan fails. Individual rm failures are still swallowed internally so
 * a partial cleanup is the worst case (matches the Promise contract).
 */
export const cleanupAgentDirectoriesEffect = (options: {
  dryRun?: boolean;
  force?: boolean;
  agentsDir?: string;
} = {}): Effect.Effect<CleanupResult, FsError> =>
  Effect.tryPromise({
    try: () => cleanupAgentDirectories(options),
    catch: (cause) =>
      new FsError({
        path: options.agentsDir ?? AGENTS_DIR,
        operation: 'cleanupAgentDirectories',
        cause,
      }),
  });
