import { getAgentRuntimeStateSync } from '../agents.js';
import { getRuntimeForAgent } from '../runtimes/index.js';
import { listPaneValuesSync } from '../tmux.js';

export function getAgentEffectiveLastActivityMs(agentId: string): number | null {
  const candidates: number[] = [];

  const runtimeState = getAgentRuntimeStateSync(agentId);
  const runtimeMs = runtimeState?.lastActivity ? new Date(runtimeState.lastActivity).getTime() : NaN;
  if (Number.isFinite(runtimeMs)) candidates.push(runtimeMs);

  try {
    const tmuxActivity = listPaneValuesSync(agentId, '#{window_activity}')
      .map((value) => Number.parseInt(value.trim(), 10) * 1000)
      .filter(Number.isFinite);
    candidates.push(...tmuxActivity);
  } catch {
    // tmux activity is best-effort; fall through to transcript/runtime sources.
  }

  try {
    const heartbeat = getRuntimeForAgent(agentId)?.getHeartbeat(agentId);
    if (heartbeat?.timestamp) {
      const heartbeatMs = heartbeat.timestamp.getTime();
      if (Number.isFinite(heartbeatMs)) candidates.push(heartbeatMs);
    }
  } catch {
    // Runtime transcript lookup is best-effort.
  }

  return candidates.length > 0 ? Math.max(...candidates) : null;
}

/**
 * PAN-3677: work-product activity only — the runtime mirror (hook-driven) plus
 * the transcript heartbeat, deliberately EXCLUDING tmux `window_activity`.
 * Claude Code repaints its spinner / background-task panel every second while a
 * turn is in flight, so `window_activity` stays fresh even when the provider
 * call is hung and no work is happening. A mid-turn wedge detector keyed on
 * {@link getAgentEffectiveLastActivityMs} (which takes the MAX) would never see
 * the PAN-3677 planning wedge — the hung sessions looked busy on the pane for
 * minutes while producing no tool calls, no transcript writes, and no hook
 * events. This signal goes stale exactly when real work stops.
 */
export function getAgentWorkActivityMs(agentId: string): number | null {
  const candidates: number[] = [];

  const runtimeState = getAgentRuntimeStateSync(agentId);
  const runtimeMs = runtimeState?.lastActivity ? new Date(runtimeState.lastActivity).getTime() : NaN;
  if (Number.isFinite(runtimeMs)) candidates.push(runtimeMs);

  try {
    const heartbeat = getRuntimeForAgent(agentId)?.getHeartbeat(agentId);
    if (heartbeat?.timestamp) {
      const heartbeatMs = heartbeat.timestamp.getTime();
      if (Number.isFinite(heartbeatMs)) candidates.push(heartbeatMs);
    }
  } catch {
    // Runtime transcript lookup is best-effort.
  }

  return candidates.length > 0 ? Math.max(...candidates) : null;
}

/**
 * Idle age based on work activity only (PAN-3846): the runtime mirror's
 * hook-driven timestamp plus the transcript heartbeat, never tmux pane repaints
 * and never the mirror's `idle` label. Returns null when no work-activity
 * signal exists at all. For log lines that report how long an agent has been
 * idle.
 */
export function getAgentIdleAgeMs(agentId: string, now = Date.now()): number | null {
  const runtimeState = getAgentRuntimeStateSync(agentId);
  const workActivityMs = getAgentWorkActivityMs(agentId)
    ?? (runtimeState?.lastActivity ? new Date(runtimeState.lastActivity).getTime() : null);
  return workActivityMs === null ? null : now - workActivityMs;
}

export function isAgentIdleForNudge(
  agentId: string,
  staleActiveThresholdMs = 5 * 60 * 1000,
  now = Date.now(),
): boolean {
  const runtimeState = getAgentRuntimeStateSync(agentId);
  const workActivityMs = getAgentWorkActivityMs(agentId);
  if (!runtimeState) {
    if (workActivityMs === null) {
      console.log(`[deacon] ${agentId}: no runtime.json — skipping (hook not yet fired)`);
      return false;
    }
    return now - workActivityMs > staleActiveThresholdMs;
  }
  if (runtimeState.state === 'suspended' || runtimeState.state === 'stopped') return false;
  // A human-blocked agent is not idle work — never nudge it.
  if (runtimeState.state === 'waiting-on-human') return false;
  // Idle is a fact about work activity, never about the mirror's label alone:
  // the Stop hook flips the mirror to 'idle' between every two turns, and a
  // stale 'active' mirror means the activity hooks stopped firing (PAN-1574).
  // Both labels reduce to the same question: how old is the last real work?
  const lastWorkMs = workActivityMs ?? new Date(runtimeState.lastActivity).getTime();
  return now - lastWorkMs > staleActiveThresholdMs;
}
