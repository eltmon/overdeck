/**
 * PAN-5604 — agent pending input (AUQ, operator decisions, proposed plans) as the UI may show it:
 * the frozen copy while the agent pending-input gate is held (empty at page load, the pre-reconnect
 * lists during a reconnect), the live store once it settles. See lib/agentPendingInputGate.ts.
 * Conversation pending input comes from a live HTTP poll and is not gated here.
 */
import { useAgentPendingInputGate, type PendingAgentInputs } from '../../lib/agentPendingInputGate';
import {
  selectAgentsWithPendingAskUserQuestion,
  selectAgentsWithPendingProposedPlan,
  useDashboardStore,
} from '../../lib/store';

export function useLivePendingAgentInputs(): PendingAgentInputs {
  const held = useAgentPendingInputGate((s) => s.held);
  const asking = useDashboardStore(selectAgentsWithPendingAskUserQuestion);
  const planning = useDashboardStore(selectAgentsWithPendingProposedPlan);
  return held ?? { agentsWithAskUserQuestion: asking, agentsWithProposedPlan: planning };
}
