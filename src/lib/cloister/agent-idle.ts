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

export function isAgentIdleForNudge(
  agentId: string,
  staleActiveThresholdMs = 5 * 60 * 1000,
  now = Date.now(),
): boolean {
  const runtimeState = getAgentRuntimeStateSync(agentId);
  const effectiveLastActivityMs = getAgentEffectiveLastActivityMs(agentId);
  if (!runtimeState) {
    if (effectiveLastActivityMs === null) {
      console.log(`[deacon] ${agentId}: no runtime.json — skipping (hook not yet fired)`);
      return false;
    }
    return now - effectiveLastActivityMs > staleActiveThresholdMs;
  }
  if (runtimeState.state === 'suspended' || runtimeState.state === 'stopped') return false;
  // A human-blocked agent is not idle work — never nudge it.
  if (runtimeState.state === 'waiting-on-human') return false;
  if (runtimeState.state === 'idle') return true;

  // 'active' or 'uninitialized': the activity mirror is only trustworthy while
  // it is fresh. A STALE 'active' mirror means the activity hooks (including the
  // Stop hook) stopped firing — e.g. the agent ended its turn but the Stop hook
  // never updated the mirror to 'idle' (PAN-1574: the agent sat 'active' for 36h
  // after ending its turn, invisible to every idle-nudge patrol). In that case
  // fall back to an age-based idle judgment so recovery can act. A genuinely
  // working agent emits tool-activity events continuously and stays fresh, so it
  // is not affected.
  const lastActivityMs = effectiveLastActivityMs ?? new Date(runtimeState.lastActivity).getTime();
  const ageMs = now - lastActivityMs;
  return ageMs > staleActiveThresholdMs;
}
