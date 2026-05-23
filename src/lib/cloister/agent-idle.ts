import { getAgentRuntimeStateSync } from '../agents.js';

export function isAgentIdleForNudge(agentId: string, staleActiveThresholdMs = 5 * 60 * 1000): boolean {
  const runtimeState = getAgentRuntimeStateSync(agentId);
  if (!runtimeState) {
    console.log(`[deacon] ${agentId}: no runtime.json — skipping (hook not yet fired)`);
    return false;
  }
  if (runtimeState.state === 'suspended' || runtimeState.state === 'stopped') return false;
  if (runtimeState.state === 'idle') return true;
  if (runtimeState.state !== 'uninitialized') return false;
  const ageMs = Date.now() - new Date(runtimeState.lastActivity).getTime();
  return ageMs > staleActiveThresholdMs;
}
