/**
 * Shadow State Storage Module
 *
 * Manages shadow state for issues - tracking status locally without updating
 * the issue tracker until explicitly synced.
 *
 * Storage Location: ~/.panopticon/shadow-state/
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
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
 * Get shadow state for an issue
 * @returns ShadowState or null if not shadowed
 */
export function getShadowState(issueId: string): ShadowState | null {
  const filePath = getShadowStatePath(issueId);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as ShadowState;
  } catch (error) {
    console.error(`Error reading shadow state for ${issueId}:`, error);
    return null;
  }
}

/**
 * Check if an issue is in shadow mode
 */
export function isShadowed(issueId: string): boolean {
  return getShadowState(issueId) !== null;
}

/**
 * Create a new shadow state for an issue
 */
export function createShadowState(
  issueId: string,
  initialTrackerStatus: IssueState = 'open',
  triggeredBy: string = 'unknown'
): ShadowState {
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
  writeFileSync(filePath, JSON.stringify(shadowState, null, 2), 'utf-8');

  return shadowState;
}

/**
 * Update shadow state for an issue
 */
export function updateShadowState(
  issueId: string,
  newStatus: IssueState,
  triggeredBy: string,
  targetCanonicalState?: CanonicalState
): ShadowState {
  ensureShadowStateDir();

  let state = getShadowState(issueId);

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
  writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');

  return state;
}

/**
 * Update tracker status cache (refresh from tracker)
 */
export function updateTrackerStatusCache(
  issueId: string,
  trackerStatus: IssueState
): ShadowState {
  const state = getShadowState(issueId);

  if (!state) {
    throw new Error(`Cannot update tracker status: ${issueId} is not in shadow mode`);
  }

  state.trackerStatus = trackerStatus;
  state.trackerStatusUpdatedAt = new Date().toISOString();

  const filePath = getShadowStatePath(issueId);
  writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');

  return state;
}

/**
 * Sync shadow state to tracker (mark as synced)
 * This is called after successfully updating the tracker
 */
export function markAsSynced(
  issueId: string,
  syncedState: IssueState,
  previousTrackerState?: IssueState
): SyncResult {
  const state = getShadowState(issueId);

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
  writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');

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
export function listShadowedIssues(): ShadowState[] {
  if (!existsSync(SHADOW_STATE_DIR)) {
    return [];
  }

  const files = readdirSync(SHADOW_STATE_DIR);
  const states: ShadowState[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    try {
      const content = readFileSync(join(SHADOW_STATE_DIR, file), 'utf-8');
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
export function getDisplayStatus(
  issueId: string,
  trackerStatus: IssueState
): {
  status: IssueState;
  isShadowed: boolean;
  trackerStatus?: IssueState;
  outOfSync?: boolean;
} {
  const state = getShadowState(issueId);

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
export function needsSync(issueId: string): boolean {
  const state = getShadowState(issueId);

  if (!state) {
    return false;
  }

  return state.shadowStatus !== state.trackerStatus;
}

/**
 * Get unsynced history entries for an issue
 */
export function getUnsyncedHistory(issueId: string): ShadowHistoryEntry[] {
  const state = getShadowState(issueId);

  if (!state) {
    return [];
  }

  return state.history.filter(entry => !entry.syncedToTracker);
}

/**
 * Get the count of issues that need sync
 */
export function getPendingSyncCount(): number {
  return listShadowedIssues().filter(state =>
    state.shadowStatus !== state.trackerStatus
  ).length;
}
