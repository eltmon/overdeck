/**
 * Cloister Specialist Runtime Status
 *
 * Resolves specialist session state, token usage, and startup status.
 */

import { readFileSync, existsSync } from 'fs';
import { basename, join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { AGENTS_DIR } from '../paths.js';
import { getAllSessionFilesSync, parseClaudeSessionSync } from '../cost-parsers/jsonl-parser.js';
import { listPaneValues, sessionExists } from '../tmux.js';
import {
  getAllSpecialists,
  getSpecialistMetadata,
  getTmuxSessionName,
  type LegacySpecialistRuntimeStatus,
  type SpecialistAgentName,
} from './specialists-registry.js';

const execAsync = promisify(exec);

function readRecordedClaudeSessionId(tmuxSession: string): string | null {
  const sessionFile = join(AGENTS_DIR, tmuxSession, 'session.id');
  if (!existsSync(sessionFile)) return null;
  try {
    const sessionId = readFileSync(sessionFile, 'utf-8').trim();
    return sessionId || null;
  } catch {
    return null;
  }
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
    const allFiles = getAllSessionFilesSync();

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

  const sessionUsage = parseClaudeSessionSync(sessionFile);

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
 * Check if a specialist is currently running in tmux
 *
 * @param name - Specialist name
 * @param projectKey - Optional project key for per-project specialists
 * @returns True if specialist has an active tmux session
 */
export async function isRunning(name: SpecialistAgentName, projectKey?: string): Promise<boolean> {
  const tmuxSession = getTmuxSessionName(name, projectKey);

  try {
    const exists = await Effect.runPromise(sessionExists(tmuxSession));
    if (!exists) return false;
    // Session exists — but check if the pane actually has a running process.
    // When Claude Code crashes, the pane's process exits but the tmux session persists,
    // making has-session return success even though nothing is running.
    const panePid = (await Effect.runPromise(listPaneValues(tmuxSession, '#{pane_pid}')))[0]?.trim() ?? '';
    if (!panePid) return false;
    // Check if the pane's process has any child processes (Claude Code / bash)
    const { stdout: children } = await execAsync(
      `ps --ppid ${panePid} --no-headers 2>/dev/null || echo ""`,
      { encoding: 'utf-8' }
    );
    return children.trim().length > 0;
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
