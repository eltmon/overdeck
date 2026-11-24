/**
 * Cloister Specialist Runtime Status
 *
 * Resolves specialist session state, token usage, and startup status.
 */

import { existsSync } from 'fs';
import { basename } from 'path';
import { readLatestIndexedSessionId } from '../session-history.js';
import { getAllSessionFiles, parseClaudeSession } from '../cost-parsers/jsonl-parser.js';
import { isAlive } from '../agents/liveness.js';
import { getAgentState } from '../agents/agent-state-read.js';
import {
  getAllSpecialists,
  getSpecialistMetadata,
  getTmuxSessionName,
  type LegacySpecialistRuntimeStatus,
  type SpecialistAgentName,
} from './specialists-registry.js';

function readRecordedClaudeSessionId(tmuxSession: string): string | null {
  return readLatestIndexedSessionId(tmuxSession);
}

/**
 * Check if a legacy specialist has a recorded Claude session.
 *
 * @param name - Specialist name
 * @returns True if the specialist has a recorded session id in its agent directory
 */
export function isInitialized(name: SpecialistAgentName): boolean {
  return readRecordedClaudeSessionId(getTmuxSessionName(name)) !== null;
}

/**
 * Get the state of a specialist from recorded agent metadata.
 *
 * Note: This only checks whether a recorded Claude session exists, not if it's actually running.
 * Use getSpecialistStatus() for runtime state.
 *
 * @param name - Specialist name
 * @returns Specialist state
 */
export function getSpecialistState(
  name: SpecialistAgentName
): Exclude<LegacySpecialistRuntimeStatus['state'], 'active'> {
  return isInitialized(name) ? 'sleeping' : 'uninitialized';
}

/**
 * Find JSONL file for a session ID
 *
 * Searches through Claude Code project directories to find the JSONL file.
 *
 * @param sessionId - Session ID to find
 * @returns Path to JSONL file or null if not found
 */
export function findSessionFile(sessionId: string): string | null {
  try {
    const allFiles = getAllSessionFiles();

    for (const file of allFiles) {
      const fileSessionId = basename(file, '.jsonl');
      if (fileSessionId === sessionId) {
        return file;
      }
    }
  } catch {
    // Session files not available
  }

  return null;
}

/**
 * Count context tokens for a specialist session
 *
 * Reads the JSONL file for the specialist's session and sums all token usage.
 * This gives an approximate count of context size.
 *
 * @param name - Specialist name
 * @returns Total token count or null if session not found
 */
export function countContextTokens(name: SpecialistAgentName): number | null {
  const sessionId = readRecordedClaudeSessionId(getTmuxSessionName(name));

  if (!sessionId) {
    return null;
  }

  const sessionFile = findSessionFile(sessionId);

  if (!sessionFile) {
    return null;
  }

  const sessionUsage = parseClaudeSession(sessionFile);

  if (!sessionUsage) {
    return null;
  }

  // Sum all token types for total context
  return (
    sessionUsage.usage.inputTokens +
    sessionUsage.usage.outputTokens +
    (sessionUsage.usage.cacheReadTokens || 0) +
    (sessionUsage.usage.cacheWriteTokens || 0)
  );
}

/**
 * PAN-5652: a specialist session's state, from the liveness oracle (both
 * backends; tmux has-session alone is false for every Herdr agent).
 *
 * The oracle looks for the agent's recorded harness and assumes claude-code
 * when none is recorded. Specialist state does not record one, so a live pane
 * whose claude-code process is missing (`runtime-missing`) is `running` when
 * no harness is recorded: the pane holds a process the probe cannot name. A
 * probe that cannot answer is `unknown`, never `stopped`.
 */
export async function specialistSessionState(session: string): Promise<'running' | 'stopped' | 'unknown'> {
  const verdict = await isAlive(session);
  if (verdict.alive) return 'running';
  if (verdict.reason === 'runtime-indeterminate') return 'unknown';
  if (verdict.reason === 'runtime-missing' && !getAgentState(session)?.harness) return 'running';
  return 'stopped';
}

/**
 * Check if a specialist is currently running
 *
 * @param name - Specialist name
 * @param projectKey - Optional project key for per-project specialists
 * @returns True if the specialist's session is running (see `specialistSessionState`)
 */
export async function isRunning(name: SpecialistAgentName, projectKey?: string): Promise<boolean> {
  try {
    return (await specialistSessionState(getTmuxSessionName(name, projectKey))) === 'running';
  } catch {
    return false;
  }
}

/**
 * Get complete status for a specialist
 *
 * Combines metadata, session info, and runtime state (PAN-80: uses hook-based state).
 *
 * @param name - Specialist name
 * @param projectKey - Optional project key for per-project specialists
 * @returns Complete specialist status
 */
export async function getSpecialistStatus(
  name: SpecialistAgentName,
  projectKey?: string
): Promise<LegacySpecialistRuntimeStatus> {
  const metadata = getSpecialistMetadata(name) || {
    name,
    displayName: name,
    description: '',
    enabled: false,
    autoWake: false,
  };

  const sessionId = readRecordedClaudeSessionId(getTmuxSessionName(name, projectKey));
  const running = await isRunning(name, projectKey);
  const contextTokens = countContextTokens(name);

  // Determine state from hook-based runtime state (PAN-80)
  const { getAgentRuntimeStateSync } = await import('../agents.js');
  const tmuxSession = getTmuxSessionName(name, projectKey);
  const runtimeState = getAgentRuntimeStateSync(tmuxSession);

  let state: LegacySpecialistRuntimeStatus['state'];
  if (runtimeState) {
    // Map runtime state to specialist state
    switch (runtimeState.state) {
      case 'active':
        state = 'active';
        break;
      case 'idle':
        state = 'sleeping'; // Idle = at prompt waiting
        break;
      case 'suspended':
        state = 'sleeping'; // Suspended = session saved, not running
        break;
      case 'uninitialized':
      default:
        state = 'uninitialized';
        break;
    }
  } else {
    // Fallback if no runtime state available
    if (running && sessionId) {
      state = 'sleeping';
    } else if (sessionId) {
      state = 'sleeping';
    } else {
      state = 'uninitialized';
    }
  }

  return {
    ...metadata,
    sessionId: sessionId || undefined,
    contextTokens: contextTokens || undefined,
    state,
    isRunning: running,
    tmuxSession: getTmuxSessionName(name, projectKey),
    currentIssue: running ? runtimeState?.currentIssue : undefined,
  };
}

/**
 * Get status for all specialists
 *
 * @returns Array of specialist statuses
 */
export async function getAllSpecialistStatus(): Promise<LegacySpecialistRuntimeStatus[]> {
  const specialists = getAllSpecialists();
  return Promise.all(specialists.map((metadata) => getSpecialistStatus(metadata.name)));
}


/**
 * Initialize all enabled but uninitialized specialists
 *
 * Called during Cloister startup to ensure specialists are ready.
 *
 * @returns Promise with array of initialization results
 */
export async function initializeEnabledSpecialists(): Promise<Array<{
  name: SpecialistAgentName;
  success: boolean;
  message: string;
}>> {
  const enabled = getAllSpecialists().filter((specialist) => specialist.enabled);
  const results: Array<{ name: SpecialistAgentName; success: boolean; message: string }> = [];

  for (const specialist of enabled) {
    results.push({
      name: specialist.name,
      success: true,
      message: 'Legacy global specialist initialization removed; role flows spawn agents on demand.',
    });
  }

  return results;
}
