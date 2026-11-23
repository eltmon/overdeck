/**
 * PAN-5604 — gate on agent pending input (AUQ, operator decisions, proposed plans).
 *
 * `held` is a frozen copy of the agent pending-input lists, or null when settled. It starts held with
 * empty lists, so the localStorage snapshot cache (which can carry long-answered questions) never
 * shows. EventRouter's bootstrap() holds it immediately before syncSnapshot(snapshot) and settles it
 * after the post-snapshot replay, so a question the replay clears is never shown. Holding an
 * already-held gate keeps the earlier copy. Conversation pending input is not gated.
 */
import { create } from 'zustand'
import type { AgentSnapshot } from '@overdeck/contracts'
import {
  selectAgentsWithPendingAskUserQuestion,
  selectAgentsWithPendingProposedPlan,
  useDashboardStore,
} from './store'

export interface PendingAgentInputs {
  agentsWithAskUserQuestion: AgentSnapshot[]
  agentsWithProposedPlan: AgentSnapshot[]
}

const NO_AGENTS: AgentSnapshot[] = []
export const NOTHING_SETTLED: PendingAgentInputs = {
  agentsWithAskUserQuestion: NO_AGENTS,
  agentsWithProposedPlan: NO_AGENTS,
}

interface AgentPendingInputGate {
  held: PendingAgentInputs | null
}

export const useAgentPendingInputGate = create<AgentPendingInputGate>(() => ({ held: NOTHING_SETTLED }))

export function holdAgentPendingInput(): void {
  if (useAgentPendingInputGate.getState().held) return
  const state = useDashboardStore.getState()
  useAgentPendingInputGate.setState({
    held: {
      agentsWithAskUserQuestion: selectAgentsWithPendingAskUserQuestion(state),
      agentsWithProposedPlan: selectAgentsWithPendingProposedPlan(state),
    },
  })
}

export function settleAgentPendingInput(): void {
  useAgentPendingInputGate.setState({ held: null })
}
