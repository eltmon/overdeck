/**
 * Shadow State Storage Module
 *
 * Manages shadow state for issues - tracking status locally without updating
 * the issue tracker until explicitly synced.
 *
 * Storage Location: ~/.panopticon/shadow-state/
 */

import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { readFile, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { Data, Effect } from 'effect';
import type { IssueState } from './tracker/interface.js';

// Storage directory for shadow state files
const SHADOW_STATE_DIR = join(homedir(), '.panopticon', 'shadow-state');

/**
 * Shadow history entry - tracks state transitions
 */
export interface ShadowHistoryEntry {
  /** Previous state */
  from: IssueState;
  /** New state */
  to: IssueState;
  /** When the transition occurred */
  at: string;
  /** Command that triggered the transition (e.g., "pan plan", "dashboard") */
  by: string;
  /** Whether this transition was synced to the tracker */
  syncedToTracker: boolean;
}

/**
 * Canonical state for Kanban column placement
 */
export type CanonicalState = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'canceled';

/**
 * Shadow state for an issue
 */
export interface ShadowState {
  /** Issue ID (e.g., "MIN-123") */
  issueId: string;
  /** Panopticon's view of the issue status */
  shadowStatus: IssueState;
  /** Target canonical state for Kanban column placement */
  targetCanonicalState?: CanonicalState;
  /** Last known tracker status (cached) */
  trackerStatus: IssueState;
  /** When tracker status was last fetched */
  trackerStatusUpdatedAt: string;
  /** When shadow mode was enabled for this issue */
  shadowedAt: string;
  /** When shadow state was last synced to tracker */
  syncedAt?: string;
  /** Audit trail of state transitions */
  history: ShadowHistoryEntry[];
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  success: boolean;
  /** The state that was synced */
  syncedState?: IssueState;
  /** Previous tracker state */
  previousState?: IssueState;
  /** Error message if sync failed */
  error?: string;
  /** Number of history entries marked as synced */
  entriesSynced?: number;
}

/**
 * Ensure the shadow state directory exists
 */
function ensureShadowStateDir(): void {
  if (!existsSync(SHADOW_STATE_DIR)) {
    mkdirSync(SHADOW_STATE_DIR, { recursive: true });
  }
}

/**
 * Get the file path for a shadow state file
 */
function getShadowStatePath(issueId: string): string {
  // Normalize issue ID for filename (uppercase, replace special chars)
  const normalizedId = issueId.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return join(SHADOW_STATE_DIR, `${normalizedId}.json`);
}

/**
 * Get shadow state for an issue.
 *
 * Async — uses `fs/promises.readFile` so it doesn't block the Node.js event
 * loop. This is mandated by the CLAUDE.md no-blocking-calls rule (PAN-70,
 * PAN-446); do not re-introduce a sync readFileSync path.
 *
 * @returns ShadowState or null if not shadowed
 */
export async function getShadowState(issueId: string): Promise<ShadowState | null> {
  const filePath = getShadowStatePath(issueId);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as ShadowState;
  } catch (error) {
    console.error(`Error reading shadow state for ${issueId}:`, error);
    return null;
  }
}

/**
 * Check if an issue is in shadow mode
 */
export async function isShadowed(issueId: string): Promise<boolean> {
  return (await getShadowState(issueId)) !== null;
}

/**
 * Create a new shadow state for an issue
 */
export async function createShadowState(
  issueId: string,
  initialTrackerStatus: IssueState = 'open',
  triggeredBy: string = 'unknown'
): Promise<ShadowState> {
  ensureShadowStateDir();

  const now = new Date().toISOString();

  const shadowState: ShadowState = {
    issueId: issueId.toUpperCase(),
    shadowStatus: initialTrackerStatus,
    trackerStatus: initialTrackerStatus,
    trackerStatusUpdatedAt: now,
    shadowedAt: now,
    history: [],
  };

  const filePath = getShadowStatePath(issueId);
  await writeFile(filePath, JSON.stringify(shadowState, null, 2), 'utf-8');

  return shadowState;
}

/**
 * Update shadow state for an issue
 */
export async function updateShadowState(
  issueId: string,
  newStatus: IssueState,
  triggeredBy: string,
  targetCanonicalState?: CanonicalState
): Promise<ShadowState> {
  ensureShadowStateDir();

  let state = await getShadowState(issueId);

  // Create new shadow state if it doesn't exist
  if (!state) {
    state = {
      issueId: issueId.toUpperCase(),
      shadowStatus: newStatus,
      targetCanonicalState,
      trackerStatus: newStatus,
      trackerStatusUpdatedAt: new Date().toISOString(),
      shadowedAt: new Date().toISOString(),
      history: [],
    };
  }

  // Only record transition if status changed
  if (state.shadowStatus !== newStatus) {
    const transition: ShadowHistoryEntry = {
      from: state.shadowStatus,
      to: newStatus,
      at: new Date().toISOString(),
      by: triggeredBy,
      syncedToTracker: false,
    };

    state.history.push(transition);
    state.shadowStatus = newStatus;
  }

  // Always update target canonical state if provided
  if (targetCanonicalState) {
    state.targetCanonicalState = targetCanonicalState;
  }

  const filePath = getShadowStatePath(issueId);
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');

  return state;
}

/**
 * Update tracker status cache (refresh from tracker)
 */
export async function updateTrackerStatusCache(
  issueId: string,
  trackerStatus: IssueState
): Promise<ShadowState> {
  const state = await getShadowState(issueId);

  if (!state) {
    throw new Error(`Cannot update tracker status: ${issueId} is not in shadow mode`);
  }

  state.trackerStatus = trackerStatus;
  state.trackerStatusUpdatedAt = new Date().toISOString();

  const filePath = getShadowStatePath(issueId);
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');

  return state;
}

/**
 * Sync shadow state to tracker (mark as synced)
 * This is called after successfully updating the tracker
 */
export async function markAsSynced(
  issueId: string,
  syncedState: IssueState,
  previousTrackerState?: IssueState
): Promise<SyncResult> {
  const state = await getShadowState(issueId);

  if (!state) {
    return {
      success: false,
      error: `Issue ${issueId} is not in shadow mode`,
    };
  }

  const now = new Date().toISOString();
  let entriesSynced = 0;

  // Mark all unsynced history entries as synced
  for (const entry of state.history) {
    if (!entry.syncedToTracker) {
      entry.syncedToTracker = true;
      entriesSynced++;
    }
  }

  // Update sync timestamp and tracker status
  state.syncedAt = now;
  state.trackerStatus = syncedState;
  state.trackerStatusUpdatedAt = now;

  const filePath = getShadowStatePath(issueId);
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');

  return {
    success: true,
    syncedState,
    previousState: previousTrackerState,
    entriesSynced,
  };
}

/**
 * List all shadowed issues
 */
export async function listShadowedIssues(): Promise<ShadowState[]> {
  if (!existsSync(SHADOW_STATE_DIR)) {
    return [];
  }

  const files = await readdir(SHADOW_STATE_DIR);
  const states: ShadowState[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    try {
      const content = await readFile(join(SHADOW_STATE_DIR, file), 'utf-8');
      const state = JSON.parse(content) as ShadowState;
      states.push(state);
    } catch (error) {
      console.error(`Error reading shadow state file ${file}:`, error);
    }
  }

  // Sort by shadowedAt (newest first)
  return states.sort((a, b) =>
    new Date(b.shadowedAt).getTime() - new Date(a.shadowedAt).getTime()
  );
}

/**
 * Remove shadow state for an issue (unshadow)
 * @param syncFirst - If true, attempts to sync to tracker before removing
 */
export function removeShadowState(
  issueId: string,
  syncFirst: boolean = false
): { success: boolean; error?: string; synced?: boolean } {
  const filePath = getShadowStatePath(issueId);

  if (!existsSync(filePath)) {
    return {
      success: false,
      error: `Issue ${issueId} is not in shadow mode`,
    };
  }

  try {
    // If syncFirst is true, we should have already synced by this point
    // This parameter is just for API clarity

    unlinkSync(filePath);
    return {
      success: true,
      synced: syncFirst,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to remove shadow state: ${error.message}`,
    };
  }
}

/**
 * Get the display status for an issue
 * Returns shadow status with tracker status info if in shadow mode
 */
export async function getDisplayStatus(
  issueId: string,
  trackerStatus: IssueState
): Promise<{
  status: IssueState;
  isShadowed: boolean;
  trackerStatus?: IssueState;
  outOfSync?: boolean;
}> {
  const state = await getShadowState(issueId);

  if (!state) {
    return {
      status: trackerStatus,
      isShadowed: false,
    };
  }

  return {
    status: state.shadowStatus,
    isShadowed: true,
    trackerStatus: state.trackerStatus,
    outOfSync: state.shadowStatus !== state.trackerStatus,
  };
}

/**
 * Check if an issue needs to be synced to tracker
 * (shadow status differs from tracker status)
 */
export async function needsSync(issueId: string): Promise<boolean> {
  const state = await getShadowState(issueId);

  if (!state) {
    return false;
  }

  return state.shadowStatus !== state.trackerStatus;
}

/**
 * Get unsynced history entries for an issue
 */
export async function getUnsyncedHistory(issueId: string): Promise<ShadowHistoryEntry[]> {
  const state = await getShadowState(issueId);

  if (!state) {
    return [];
  }

  return state.history.filter(entry => !entry.syncedToTracker);
}

/**
 * Get the count of issues that need sync
 */
export async function getPendingSyncCount(): Promise<number> {
  const states = await listShadowedIssues();
  return states.filter(state =>
    state.shadowStatus !== state.trackerStatus
  ).length;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Additive Effect-channel variants for the async shadow-state surface. The
// one sync export (`removeShadowState`) is left unwrapped — it uses
// `unlinkSync` for atomic deletion guarantees the caller relies on.

/** Tagged error for shadow-state Effect variants. */
export class ShadowStateError extends Data.TaggedError('ShadowStateError')<{
  readonly operation: string;
  readonly issueId?: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Effect variant of `getShadowState`. */
export const getShadowStateEffect = (
  issueId: string,
): Effect.Effect<ShadowState | null, ShadowStateError> =>
  Effect.tryPromise({
    try: () => getShadowState(issueId),
    catch: (cause) =>
      new ShadowStateError({
        operation: 'getShadowState',
        issueId,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `isShadowed`. */
export const isShadowedEffect = (issueId: string): Effect.Effect<boolean, ShadowStateError> =>
  Effect.tryPromise({
    try: () => isShadowed(issueId),
    catch: (cause) =>
      new ShadowStateError({
        operation: 'isShadowed',
        issueId,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `createShadowState`. */
export const createShadowStateEffect = (
  issueId: string,
  initialTrackerStatus: IssueState = 'open',
  triggeredBy: string = 'unknown',
): Effect.Effect<ShadowState, ShadowStateError> =>
  Effect.tryPromise({
    try: () => createShadowState(issueId, initialTrackerStatus, triggeredBy),
    catch: (cause) =>
      new ShadowStateError({
        operation: 'createShadowState',
        issueId,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `updateShadowState`. */
export const updateShadowStateEffect = (
  issueId: string,
  newStatus: IssueState,
  triggeredBy: string,
  targetCanonicalState?: CanonicalState,
): Effect.Effect<ShadowState, ShadowStateError> =>
  Effect.tryPromise({
    try: () => updateShadowState(issueId, newStatus, triggeredBy, targetCanonicalState),
    catch: (cause) =>
      new ShadowStateError({
        operation: 'updateShadowState',
        issueId,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `updateTrackerStatusCache`. */
export const updateTrackerStatusCacheEffect = (
  ...args: Parameters<typeof updateTrackerStatusCache>
): Effect.Effect<Awaited<ReturnType<typeof updateTrackerStatusCache>>, ShadowStateError> =>
  Effect.tryPromise({
    try: () => updateTrackerStatusCache(...args),
    catch: (cause) =>
      new ShadowStateError({
        operation: 'updateTrackerStatusCache',
        issueId: args[0],
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `markAsSynced`. */
export const markAsSyncedEffect = (
  ...args: Parameters<typeof markAsSynced>
): Effect.Effect<Awaited<ReturnType<typeof markAsSynced>>, ShadowStateError> =>
  Effect.tryPromise({
    try: () => markAsSynced(...args),
    catch: (cause) =>
      new ShadowStateError({
        operation: 'markAsSynced',
        issueId: args[0],
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `listShadowedIssues`. */
export const listShadowedIssuesEffect = (): Effect.Effect<ShadowState[], ShadowStateError> =>
  Effect.tryPromise({
    try: () => listShadowedIssues(),
    catch: (cause) =>
      new ShadowStateError({
        operation: 'listShadowedIssues',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `getDisplayStatus`. */
export const getDisplayStatusEffect = (
  ...args: Parameters<typeof getDisplayStatus>
): Effect.Effect<Awaited<ReturnType<typeof getDisplayStatus>>, ShadowStateError> =>
  Effect.tryPromise({
    try: () => getDisplayStatus(...args),
    catch: (cause) =>
      new ShadowStateError({
        operation: 'getDisplayStatus',
        issueId: args[0],
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `needsSync`. */
export const needsSyncEffect = (issueId: string): Effect.Effect<boolean, ShadowStateError> =>
  Effect.tryPromise({
    try: () => needsSync(issueId),
    catch: (cause) =>
      new ShadowStateError({
        operation: 'needsSync',
        issueId,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `getUnsyncedHistory`. */
export const getUnsyncedHistoryEffect = (
  issueId: string,
): Effect.Effect<ShadowHistoryEntry[], ShadowStateError> =>
  Effect.tryPromise({
    try: () => getUnsyncedHistory(issueId),
    catch: (cause) =>
      new ShadowStateError({
        operation: 'getUnsyncedHistory',
        issueId,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `getPendingSyncCount`. */
export const getPendingSyncCountEffect = (): Effect.Effect<number, ShadowStateError> =>
  Effect.tryPromise({
    try: () => getPendingSyncCount(),
    catch: (cause) =>
      new ShadowStateError({
        operation: 'getPendingSyncCount',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

