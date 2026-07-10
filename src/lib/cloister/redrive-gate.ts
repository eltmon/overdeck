/**
 * PAN-2543 shared autonomous re-drive gate.
 *
 * Recovery entry points classify agent gates, apply the intent policy, and
 * consult the cached memory verdict through this one function before acting.
 * Callers still reserve their role-specific concurrency slot after admission.
 */
import {
  decideResumeGate,
  getAgentResumeGateBlockReason,
  type AgentState,
  type ResumeGateContext,
  type ResumeGateDecision,
} from '../agents/agent-state.js';
import { getCachedMemoryVerdict } from './memory-verdict-cache.js';

export type RedriveGateDecision =
  | { decision: 'proceed'; gateDecision: Extract<ResumeGateDecision, { decision: 'proceed' }> }
  | { decision: 'defer'; reason: string; needsYou?: true };

export function decideAutonomousRedrive(
  state: Pick<AgentState, 'paused' | 'pausedReason' | 'yieldedByScheduler' | 'troubled' | 'troubledAt' | 'stoppedByUser' | 'consecutiveFailures'>,
  context: ResumeGateContext = {},
): RedriveGateDecision {
  const gateDecision = decideResumeGate(getAgentResumeGateBlockReason(state), 'autonomous', context);
  if (gateDecision.decision !== 'proceed') {
    return {
      decision: 'defer',
      reason: gateDecision.reason,
      ...(gateDecision.decision === 'block' && gateDecision.needsYou ? { needsYou: true } : {}),
    };
  }

  const memoryVerdict = getCachedMemoryVerdict();
  if (memoryVerdict && memoryVerdict.band !== 'ok') {
    return { decision: 'defer', reason: `memory pressure is ${memoryVerdict.band}` };
  }
  return { decision: 'proceed', gateDecision };
}
