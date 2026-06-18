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
import { access, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'path';
import { Effect } from 'effect';
import { AGENTS_DIR } from './paths.js';
import { listSessionNames } from './tmux.js';
import { parseIssueIdSync } from './issue-id.js';
import { FsError } from './errors.js';

export const CLOSED_ISSUE_AGENT_DIR_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

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
  if (parseIssueIdSync(suffix) !== null) return true;

  // Specialist directories: agent-<issueId>-<role> or agent-<issueId>-<role>-<subRole>
  // e.g. agent-pan-457-review-correctness, agent-pan-457-test, agent-pan-457-ship
  // Also work agents with slots: agent-pan-457-1
  const parts = suffix.split('-');
  for (let i = 2; i <= parts.length; i++) {
    const candidate = parts.slice(0, i).join('-');
    if (parseIssueIdSync(candidate) !== null) {
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
  if (parseIssueIdSync(issueId) === null) return null;

  return issueId;
}

export function getAgentDirectoryIssueId(name: string): string | null {
  const match = name.match(/^(?:agent|planning)-(.+)$/);
  if (!match) return null;

  const suffix = match[1]!;
  if (suffix !== suffix.toLowerCase()) return null;

  const direct = parseIssueIdSync(suffix);
  if (direct) return direct.raw.toUpperCase();

  const parts = suffix.split('-');
  for (let i = 1; i <= parts.length; i++) {
    const candidate = parts.slice(0, i).join('-');
    const parsed = parseIssueIdSync(candidate);
    if (parsed) return parsed.raw.toUpperCase();
  }

  return null;
}

export interface OrphanedAgentDir {
  name: string;
  path: string;
  hasRunningSession: boolean;
}

async function findOrphanedAgentDirsPromise(
  agentsDir: string = AGENTS_DIR,
): Promise<OrphanedAgentDir[]> {
  if (!existsSync(agentsDir)) {
    return [];
  }

  const entries = readdirSync(agentsDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const sessionNames = await Effect.runPromise(listSessionNames());
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

async function cleanupAgentDirectoriesPromise(options: {
  dryRun?: boolean;
  force?: boolean;
  agentsDir?: string;
} = {}): Promise<CleanupResult> {
  const { dryRun = false, force = false, agentsDir = AGENTS_DIR } = options;

  const orphaned = await Effect.runPromise(findOrphanedAgentDirs(agentsDir));
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

type IssueReadSourceState = {
  identifier?: unknown;
  id?: unknown;
  status?: unknown;
  state?: unknown;
  canonicalStatus?: unknown;
  rawTrackerState?: unknown;
  completedAt?: unknown;
  closedAt?: unknown;
};

type AgentStateIssue = {
  issueId?: unknown;
};

export interface ClosedIssueAgentDir {
  name: string;
  path: string;
  issueId: string;
  closedAt: string;
  ageMs: number;
  hasRunningSession: boolean;
  hasStateFile: boolean;
  containsJsonl: boolean;
}

export interface ClosedIssueAgentCleanupResult {
  removed: string[];
  protected: string[];
  wouldRemove: string[];
  totalCandidates: number;
}

function normalizeIssueId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = parseIssueIdSync(trimmed);
  return (parsed?.raw ?? trimmed).toUpperCase();
}

function isClosedIssueState(issue: IssueReadSourceState): boolean {
  const state = String(issue.state ?? '').toLowerCase();
  const status = String(issue.status ?? '').toLowerCase();
  const canonicalStatus = String(issue.canonicalStatus ?? '').toLowerCase();
  const rawTrackerState = String(issue.rawTrackerState ?? '').toLowerCase();
  return Boolean(
    issue.completedAt ||
    issue.closedAt ||
    state === 'closed' ||
    status === 'done' ||
    status === 'closed' ||
    status === 'cancelled' ||
    status === 'canceled' ||
    status === 'completed' ||
    canonicalStatus === 'done' ||
    canonicalStatus === 'closed' ||
    canonicalStatus === 'cancelled' ||
    canonicalStatus === 'canceled' ||
    canonicalStatus === 'completed' ||
    rawTrackerState === 'closed' ||
    rawTrackerState === 'done' ||
    rawTrackerState === 'completed',
  );
}

function getClosedIssueTimes(issues: unknown[]): Map<string, number> {
  const closed = new Map<string, number>();
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') continue;
    const item = issue as IssueReadSourceState;
    const issueId = normalizeIssueId(item.identifier) ?? normalizeIssueId(item.id);
    if (!issueId || !isClosedIssueState(item)) continue;

    const closedTimestamp = item.completedAt ?? item.closedAt;
    if (typeof closedTimestamp !== 'string') continue;

    const closedAtMs = Date.parse(closedTimestamp);
    if (!Number.isFinite(closedAtMs)) continue;
    closed.set(issueId, closedAtMs);
  }
  return closed;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readAgentStateIssueId(dirPath: string): Promise<string | null> {
  try {
    const raw = await readFile(join(dirPath, 'state.json'), 'utf8');
    const parsed = JSON.parse(raw) as AgentStateIssue;
    return normalizeIssueId(parsed.issueId);
  } catch {
    return null;
  }
}

async function directoryContainsJsonl(dirPath: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isFile() && entry.name.endsWith('.jsonl')) return true;
    if (entry.isDirectory() && await directoryContainsJsonl(entryPath)) return true;
  }

  return false;
}

async function findClosedIssueAgentDirsPromise(options: {
  issues: unknown[];
  agentsDir?: string;
  nowMs?: number;
  graceMs?: number;
}): Promise<ClosedIssueAgentDir[]> {
  const agentsDir = options.agentsDir ?? AGENTS_DIR;
  const nowMs = options.nowMs ?? Date.now();
  const graceMs = options.graceMs ?? CLOSED_ISSUE_AGENT_DIR_GRACE_MS;
  const closedIssueTimes = getClosedIssueTimes(options.issues);
  if (closedIssueTimes.size === 0 || !await pathExists(agentsDir)) return [];

  const sessionNames = await Effect.runPromise(listSessionNames());
  const sessionSet = new Set(sessionNames);
  const entries = await readdir(agentsDir, { withFileTypes: true });
  const candidates: ClosedIssueAgentDir[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirPath = join(agentsDir, entry.name);
    const stateIssueId = await readAgentStateIssueId(dirPath);
    const issueId = stateIssueId ?? getAgentDirectoryIssueId(entry.name);
    if (!issueId) continue;

    const closedAtMs = closedIssueTimes.get(issueId);
    if (closedAtMs === undefined) continue;

    const ageMs = nowMs - closedAtMs;
    if (ageMs <= graceMs) continue;

    candidates.push({
      name: entry.name,
      path: dirPath,
      issueId,
      closedAt: new Date(closedAtMs).toISOString(),
      ageMs,
      hasRunningSession: sessionSet.has(entry.name),
      hasStateFile: await pathExists(join(dirPath, 'state.json')),
      containsJsonl: await directoryContainsJsonl(dirPath),
    });
  }

  return candidates;
}

async function cleanupClosedIssueAgentDirectoriesPromise(options: {
  issues: unknown[];
  dryRun?: boolean;
  force?: boolean;
  agentsDir?: string;
  nowMs?: number;
  graceMs?: number;
}): Promise<ClosedIssueAgentCleanupResult> {
  const candidates = await findClosedIssueAgentDirsPromise(options);
  const protectedDirs = candidates.filter((dir) => dir.hasRunningSession || dir.containsJsonl);
  const removable = candidates.filter((dir) => !dir.hasRunningSession && !dir.containsJsonl);
  const result: ClosedIssueAgentCleanupResult = {
    removed: [],
    protected: protectedDirs.map((dir) => dir.name),
    wouldRemove: [],
    totalCandidates: candidates.length,
  };

  if (options.dryRun) {
    result.wouldRemove = removable.map((dir) => dir.name);
    return result;
  }

  if (!options.force) {
    // Startup owns the non-interactive cleanup path; CLI callers should use dry-run.
  }

  for (const dir of removable) {
    try {
      await rm(dir.path, { recursive: true, force: true });
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
export const findOrphanedAgentDirs = (
  agentsDir: string = AGENTS_DIR,
): Effect.Effect<readonly OrphanedAgentDir[], FsError> =>
  Effect.tryPromise({
    try: () => findOrphanedAgentDirsPromise(agentsDir),
    catch: (cause) =>
      new FsError({ path: agentsDir, operation: 'findOrphanedAgentDirs', cause }),
  });

/**
 * Effect-native variant of cleanupAgentDirectories. Fails with FsError if the
 * orphan scan fails. Individual rm failures are still swallowed internally so
 * a partial cleanup is the worst case (matches the Promise contract).
 */
export const cleanupAgentDirectories = (options: {
  dryRun?: boolean;
  force?: boolean;
  agentsDir?: string;
} = {}): Effect.Effect<CleanupResult, FsError> =>
  Effect.tryPromise({
    try: () => cleanupAgentDirectoriesPromise(options),
    catch: (cause) =>
      new FsError({
        path: options.agentsDir ?? AGENTS_DIR,
        operation: 'cleanupAgentDirectories',
        cause,
      }),
  });

export const findClosedIssueAgentDirs = (options: {
  issues: unknown[];
  agentsDir?: string;
  nowMs?: number;
  graceMs?: number;
}): Effect.Effect<readonly ClosedIssueAgentDir[], FsError> =>
  Effect.tryPromise({
    try: () => findClosedIssueAgentDirsPromise(options),
    catch: (cause) =>
      new FsError({
        path: options.agentsDir ?? AGENTS_DIR,
        operation: 'findClosedIssueAgentDirs',
        cause,
      }),
  });

export const cleanupClosedIssueAgentDirectories = (options: {
  issues: unknown[];
  dryRun?: boolean;
  force?: boolean;
  agentsDir?: string;
  nowMs?: number;
  graceMs?: number;
}): Effect.Effect<ClosedIssueAgentCleanupResult, FsError> =>
  Effect.tryPromise({
    try: () => cleanupClosedIssueAgentDirectoriesPromise(options),
    catch: (cause) =>
      new FsError({
        path: options.agentsDir ?? AGENTS_DIR,
        operation: 'cleanupClosedIssueAgentDirectories',
        cause,
      }),
  });
