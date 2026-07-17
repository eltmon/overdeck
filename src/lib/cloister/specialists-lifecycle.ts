/**
 * Cloister Specialist Lifecycle
 *
 * Manages grace periods, completion signaling, and specialist termination.
 */

import { Effect } from 'effect';
import { killSession } from '../tmux.js';
import {
  getTmuxSessionName,
  loadRegistry,
  makeSpecialistRegistryKey,
  type SpecialistAgentName,
} from './specialists-registry.js';
import {
  getRunMetadata,
  setCurrentRun,
  updateRunMetadata,
  updateRunStatus,
} from './specialists.js';

/**
 * ===========================================================================
 * Ephemeral Lifecycle Management
 * ===========================================================================
 */

/**
 * Grace period state for a specialist
 */
export interface GracePeriodState {
  active: boolean;
  startedAt: string;
  duration: number; // milliseconds
  paused: boolean;
  pausedAt?: string;
  remainingTime?: number; // milliseconds when paused
}

const gracePeriodStates = new Map<string, GracePeriodState>();

/**
 * Task context interface for specialist tasks.
 */
export interface TaskContext {
  prUrl?: string;
  workspace?: string;
  branch?: string;
  filesChanged?: string[];
  reason?: string;
  targetModel?: string;
  additionalInstructions?: string;
  [key: string]: string | string[] | undefined;
}

/**
 * PAN-1048 R1: spawnEphemeralSpecialist removed.
 *
 * The function was the generic dispatcher that took an arbitrary
 * SpecialistAgentName ('review-agent' | 'test-agent' | 'merge-agent' |
 * 'inspect-agent' | …) and shelled out a launcher specific to each. Under
 * the role primitive, those flavours are first-class roles
 * (review/test/ship) plus a single work sub-role (inspect / inspect-deep).
 *
 * Replacements:
 * - Review/test/ship runs: spawnRun(issueId, role, opts) in src/lib/agents.ts.
 *   Reactive Cloister fires these on lifecycle transitions; the manual
 *   re-dispatch in routes/workspaces.ts also uses spawnRun.
 * - Inspect runs: spawnInspectAgent() in cloister/inspect-agent.ts owns
 *   its own minimal launcher path (single-bead-scoped, ephemeral).
 *
 * The specialist registry/run-log/grace-period machinery stays in this
 * file because the dashboard read-model and reset/init/grace endpoints
 * still consume it for legacy run history; nothing writes new entries
 * once the dispatcher is gone.
 */


/**
 * Start grace period for a specialist
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param duration - Grace period duration in milliseconds (default: 60000)
 */
export function startGracePeriod(
  projectKey: string,
  specialistType: SpecialistAgentName,
  duration: number = 60000
): void {
  const key = `${projectKey}-${specialistType}`;

  gracePeriodStates.set(key, {
    active: true,
    startedAt: new Date().toISOString(),
    duration,
    paused: false,
  });

  console.log(`[specialist] Grace period started for ${projectKey}/${specialistType} (${duration}ms)`);

  // Schedule termination after grace period
  setTimeout(() => {
    const state = gracePeriodStates.get(key);
    if (state && state.active && !state.paused) {
      terminateSpecialist(projectKey, specialistType);
    }
  }, duration);
}

/**
 * Pause grace period countdown
 */
export function pauseGracePeriod(projectKey: string, specialistType: SpecialistAgentName): boolean {
  const key = `${projectKey}-${specialistType}`;
  const state = gracePeriodStates.get(key);

  if (!state || !state.active) {
    return false;
  }

  const elapsed = Date.now() - new Date(state.startedAt).getTime();
  const remaining = state.duration - elapsed;

  state.paused = true;
  state.pausedAt = new Date().toISOString();
  state.remainingTime = remaining;

  gracePeriodStates.set(key, state);
  console.log(`[specialist] Grace period paused for ${projectKey}/${specialistType}`);

  return true;
}

/**
 * Resume grace period countdown
 */
export function resumeGracePeriod(projectKey: string, specialistType: SpecialistAgentName): boolean {
  const key = `${projectKey}-${specialistType}`;
  const state = gracePeriodStates.get(key);

  if (!state || !state.active || !state.paused) {
    return false;
  }

  state.paused = false;
  state.startedAt = new Date().toISOString();
  state.pausedAt = undefined;

  gracePeriodStates.set(key, state);
  console.log(`[specialist] Grace period resumed for ${projectKey}/${specialistType}`);

  // Schedule termination for remaining time
  setTimeout(() => {
    const currentState = gracePeriodStates.get(key);
    if (currentState && currentState.active && !currentState.paused) {
      terminateSpecialist(projectKey, specialistType);
    }
  }, state.remainingTime || 0);

  return true;
}

/**
 * Exit grace period immediately (terminate now)
 */
export function exitGracePeriod(projectKey: string, specialistType: SpecialistAgentName): void {
  const key = `${projectKey}-${specialistType}`;
  gracePeriodStates.delete(key);

  terminateSpecialist(projectKey, specialistType);
}

/**
 * Get grace period state
 */
export function getGracePeriodState(
  projectKey: string,
  specialistType: SpecialistAgentName
): GracePeriodState | null {
  const key = `${projectKey}-${specialistType}`;
  return gracePeriodStates.get(key) || null;
}

/**
 * Find the active registry key for (projectKey, specialistType).
 * Searches compound keys; falls back to plain specialistType key.
 * Returns undefined if nothing is currently active.
 */
export function findActiveRegistryKey(projectKey: string, specialistType: SpecialistAgentName): string | undefined {
  const registry = loadRegistry();
  const bucket = registry.projects[projectKey] ?? {};

  // Check compound keys first (new format: "type:issueId")
  const prefix = `${specialistType}:`;
  const activeCompound = Object.keys(bucket).find(k =>
    k.startsWith(prefix) && bucket[k].currentRun !== null
  );
  if (activeCompound) return activeCompound;

  // Check legacy plain key
  if (bucket[specialistType]?.currentRun !== null) return specialistType;

  // Return most recently touched key even if not active
  const allMatching = Object.keys(bucket).filter(k =>
    k === specialistType || k.startsWith(prefix)
  ).sort((a, b) =>
    (bucket[b].lastRunAt ?? '').localeCompare(bucket[a].lastRunAt ?? '')
  );
  return allMatching[0];
}

/**
 * Signal that a specialist has completed its task
 *
 * This should be called when the specialist finishes its work.
 * It updates the run status and starts the grace period.
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param result - Task result
 * @param issueId - Optional: issue being handled (used to compute compound registry key)
 */
export async function signalSpecialistCompletion(
  projectKey: string,
  specialistType: SpecialistAgentName,
  result: {
    status: 'passed' | 'failed' | 'blocked';
    notes?: string;
  },
  issueId?: string
): Promise<void> {
  const registryKey = issueId
    ? makeSpecialistRegistryKey(specialistType, issueId)
    : (findActiveRegistryKey(projectKey, specialistType) ?? specialistType);
  const metadata = getRunMetadata(projectKey, registryKey);

  // Derive tmuxSession: use stored field when available, recompute as fallback
  const resolvedTmuxSession = metadata.tmuxSession ?? getTmuxSessionName(specialistType, projectKey, issueId);

  // Update status
  updateRunStatus(projectKey, registryKey, result.status);

  // Finalize log if there's a current run
  if (metadata.currentRun) {
    try {
      const { finalizeRunLogSync } = await import('./specialist-logs.js');
      finalizeRunLogSync(projectKey, specialistType, metadata.currentRun, {
        status: result.status,
        notes: result.notes,
      });
    } catch (error) {
      console.error(`[specialist] Failed to finalize log:`, error);
    }
  }

  // Completion means the run itself is over, even if the tmux session stays alive
  // during the grace period for inspection or manual termination.
  setCurrentRun(projectKey, registryKey, null);
  updateRunMetadata(projectKey, registryKey, { currentActivity: null });
  import('../agents.js')
    .then(({ saveAgentRuntimeState }) => {
      saveAgentRuntimeState(resolvedTmuxSession, {
        state: 'idle',
        lastActivity: new Date().toISOString(),
        currentIssue: undefined,
      });
    })
    .catch((error) => {
      console.error(`[specialist] Failed to mark ${projectKey}/${specialistType} idle:`, error);
    });

  // Start grace period (60 seconds)
  startGracePeriod(projectKey, specialistType, 60000);

  console.log(`[specialist] ${specialistType} completed for ${projectKey} (status: ${result.status})`);
}

/**
 * Terminate a specialist session
 *
 * Kills the tmux session, finalizes logs, and schedules digest generation.
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 */
export async function terminateSpecialist(
  projectKey: string,
  specialistType: SpecialistAgentName,
  issueId?: string
): Promise<void> {
  const registryKey = issueId
    ? makeSpecialistRegistryKey(specialistType, issueId)
    : (findActiveRegistryKey(projectKey, specialistType) ?? specialistType);
  const metadata = getRunMetadata(projectKey, registryKey);

  // Derive tmuxSession: use stored field, or recompute
  const tmuxSession = metadata.tmuxSession ?? getTmuxSessionName(specialistType, projectKey, issueId);

  try {
    // Kill tmux session
    await Effect.runPromise(killSession(tmuxSession));
    console.log(`[specialist] Terminated ${projectKey}/${specialistType}`);
  } catch (error) {
    console.error(`[specialist] Failed to kill tmux session ${tmuxSession}:`, error);
  }

  // Finalize log if there's a current run
  if (metadata.currentRun) {
    const { finalizeRunLogSync } = await import('./specialist-logs.js');

    try {
      finalizeRunLogSync(projectKey, specialistType, metadata.currentRun, {
        status: metadata.lastRunStatus || 'incomplete',
        notes: 'Specialist terminated',
      });
    } catch (error) {
      console.error(`[specialist] Failed to finalize log:`, error);
    }

    // Clear current run
    setCurrentRun(projectKey, registryKey, null);
  }

  updateRunMetadata(projectKey, registryKey, { currentActivity: null });

  // Clear grace period state
  const key = `${projectKey}-${specialistType}`;
  gracePeriodStates.delete(key);

  // Update runtime state
  const { saveAgentRuntimeState } = await import('../agents.js');
  saveAgentRuntimeState(tmuxSession, {
    state: 'suspended',
    lastActivity: new Date().toISOString(),
  });

  // Schedule digest generation (async, fire-and-forget)
  const { scheduleDigestGeneration } = await import('./specialist-context.js');
  scheduleDigestGeneration(projectKey, specialistType);

  // Run log cleanup for this project/specialist (async, fire-and-forget)
  scheduleLogCleanup(projectKey, specialistType);
}

/**
 * Schedule log cleanup for a project's specialist (async, fire-and-forget)
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 */
function scheduleLogCleanup(projectKey: string, specialistType: SpecialistAgentName): void {
  // Run async without awaiting
  Promise.resolve().then(async () => {
    try {
      const { cleanupOldLogsSync } = await import('./specialist-logs.js');
      const { getSpecialistRetention } = await import('../projects.js');

      const retention = getSpecialistRetention(projectKey);
      const deleted = cleanupOldLogsSync(projectKey, specialistType, { maxDays: retention.max_days, maxRuns: retention.max_runs });

      if (deleted > 0) {
        console.log(`[specialist] Cleaned up ${deleted} old logs for ${projectKey}/${specialistType}`);
      }
    } catch (error) {
      console.error(`[specialist] Log cleanup failed for ${projectKey}/${specialistType}:`, error);
    }
  });
}
