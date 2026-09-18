import { Effect } from 'effect';
import { capturePane, listSessionNames } from '../tmux.js';
import { deliverAgentMessage } from '../agents/delivery.js';

// ============================================================================
// API Error Recovery (PAN-3917 W4: detect-and-resume-once only — the
// compaction/context-overflow/codex-auth/modal escalation ladder that used to
// live here is deleted along with the record plane it wrote to.)
// ============================================================================

/**
 * API error patterns that indicate transient server failures.
 * When an agent stops with one of these in its tmux output, it should
 * be nudged to retry rather than left idle.
 */
const API_ERROR_PATTERNS = [
  'API Error: The server had an error while processing your request',
  'API Error: Overloaded',
  'API Error: Rate limit',
  'API Error: Request was aborted',
  'API Error: Timed out',
  '529 Overloaded',
  '502 Bad Gateway',
  '503 Service Unavailable',
];

/**
 * Cooldown between API-error recovery nudges per agent.
 * Prevents spamming agents that are hitting persistent errors.
 */
const API_ERROR_RECOVERY_COOLDOWN_MS = 5 * 60_000; // 5 minutes

/** Track API-error recovery attempts per agent (in-memory only — no record write). */
const apiErrorRecoveryState: Map<string, { lastAttempt: number }> = new Map();

/** Test seam: clear the per-agent recovery cooldown between test cases. */
export function __resetApiErrorRecoveryStateForTests(): void {
  apiErrorRecoveryState.clear();
}

const CONTINUE_MSG =
  'You stopped due to a transient API error. This is a temporary server issue, not a problem with your work. Continue from where you left off. Do NOT start over — pick up exactly where you stopped.';

/**
 * Check for agents (work agents, specialists, planning) that stopped due
 * to transient API errors, and resume each one once (cooldown-gated).
 */
export async function checkApiErrorAgents(): Promise<string[]> {
  const actions: string[] = [];
  const now = Date.now();

  // Check all tmux sessions — not just registered work agents — because
  // specialist/planning sessions aren't always in the agents registry.
  let sessionNames: readonly string[];
  try {
    sessionNames = await Effect.runPromise(listSessionNames());
  } catch {
    return actions;
  }

  const agentSessions = sessionNames.filter(
    name => name.startsWith('agent-') || name.startsWith('specialist-') || name.startsWith('planning-'),
  );

  for (const sessionName of agentSessions) {
    const recovery = apiErrorRecoveryState.get(sessionName);
    if (recovery && (now - recovery.lastAttempt) < API_ERROR_RECOVERY_COOLDOWN_MS) continue;

    let tmuxOutput: string;
    try {
      tmuxOutput = await Effect.runPromise(capturePane(sessionName, 100));
    } catch {
      continue;
    }
    if (!tmuxOutput.trim()) continue;
    if (!tmuxOutput.includes('❯')) continue; // only nudge a session sitting idle at the prompt

    const hasApiError = API_ERROR_PATTERNS.some(pattern => tmuxOutput.includes(pattern));
    if (!hasApiError) continue;

    try {
      await deliverAgentMessage(sessionName, CONTINUE_MSG, 'deacon-lite:checkApiErrorAgents');
      apiErrorRecoveryState.set(sessionName, { lastAttempt: now });
      actions.push(`checkApiErrorAgents: nudged ${sessionName} to retry after a provider error`);
    } catch (err) {
      console.error(`[deacon-lite] Failed to nudge ${sessionName} for API error retry:`, err);
    }
  }

  return actions;
}
