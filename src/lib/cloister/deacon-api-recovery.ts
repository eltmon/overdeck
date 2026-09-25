import { deliverAgentMessage } from '../agents/delivery.js';
import { isIdle } from '../agents/liveness.js';
import { captureLiveAgentPaneText, listLiveAgentPanes } from '../terminal-backends/inventory.js';

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
  // PAN-3948: Claude Code prints "API Error: Connection lost mid-response. The
  // response above may be incomplete." when the stream drops mid-turn, then
  // sits at the prompt. Match the prefix only: the full sentence can wrap in a
  // narrow pane capture.
  'API Error: Connection lost mid-response',
  '529 Overloaded',
  '502 Bad Gateway',
  '503 Service Unavailable',
];

/**
 * Cooldown between API-error recovery nudges per agent.
 * Prevents spamming agents that are hitting persistent errors.
 */
const API_ERROR_RECOVERY_COOLDOWN_MS = 5 * 60_000; // 5 minutes

/**
 * PAN-3948: how long an agent's work activity (runtime mirror + transcript
 * heartbeat, via liveness.ts `isIdle`) must be stale before a provider error in
 * its pane counts as the reason it stopped. The `❯` input box shows while a
 * turn is in flight too, and an old error stays in the last 100 lines after
 * the agent resumed, so pane text alone cannot tell a wedged agent from a
 * working one. Two patrol ticks (the patrol runs every 60s).
 */
const API_ERROR_IDLE_THRESHOLD_MS = 2 * 60_000;

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

  // PAN-3917: read the SELECTED backend's inventory — not just registered work
  // agents, because specialist/planning sessions aren't always in the agents
  // registry, and not a tmux census, because under Herdr there isn't one.
  const panes = await listLiveAgentPanes();
  if (panes === null) return actions;

  const agentPanes = panes.filter(
    pane => pane.agentId.startsWith('agent-')
      || pane.agentId.startsWith('specialist-')
      || pane.agentId.startsWith('planning-'),
  );

  for (const pane of agentPanes) {
    const recovery = apiErrorRecoveryState.get(pane.agentId);
    if (recovery && (now - recovery.lastAttempt) < API_ERROR_RECOVERY_COOLDOWN_MS) continue;
    // Never nudge a working agent: only one whose work activity has gone stale.
    if (!isIdle(pane.agentId, API_ERROR_IDLE_THRESHOLD_MS, now)) continue;

    const paneOutput = await captureLiveAgentPaneText(pane, 100);
    if (!paneOutput?.trim()) continue;
    if (!paneOutput.includes('❯')) continue; // only nudge a session sitting idle at the prompt

    const hasApiError = API_ERROR_PATTERNS.some(pattern => paneOutput.includes(pattern));
    if (!hasApiError) continue;

    try {
      await deliverAgentMessage(pane.agentId, CONTINUE_MSG, 'deacon-lite:checkApiErrorAgents');
      apiErrorRecoveryState.set(pane.agentId, { lastAttempt: now });
      actions.push(`checkApiErrorAgents: nudged ${pane.agentId} to retry after a provider error`);
    } catch (err) {
      console.error(`[deacon-lite] Failed to nudge ${pane.agentId} for API error retry:`, err);
    }
  }

  return actions;
}
