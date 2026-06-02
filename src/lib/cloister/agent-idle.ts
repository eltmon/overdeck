import { getAgentRuntimeStateSync } from '../agents.js';

export function isAgentIdleForNudge(
  agentId: string,
  staleActiveThresholdMs = 5 * 60 * 1000,
  now = Date.now(),
): boolean {
  const runtimeState = getAgentRuntimeStateSync(agentId);
  if (!runtimeState) {
    console.log(`[deacon] ${agentId}: no runtime.json — skipping (hook not yet fired)`);
    return false;
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
  const ageMs = now - new Date(runtimeState.lastActivity).getTime();
  return ageMs > staleActiveThresholdMs;
}
