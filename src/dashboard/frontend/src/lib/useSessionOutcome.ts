/**
 * Store-reading hooks for `sessionOutcome.ts` (PAN-4290).
 *
 * `deriveSessionOutcome` is pure; these hooks are the only place that reads
 * the dashboard store to feed it. No new query, endpoint, polling loop, or
 * store slice — facts come from `useDerivedIssueState` and `agentsById`,
 * which the store already maintains.
 */

import type { SessionNode } from '@overdeck/contracts';
import {
  deriveSessionOutcome,
  outcomeFactsFromAgent,
  outcomeFactsFromSessionNode,
  type SessionOutcome,
  type SessionOutcomeAgent,
} from './sessionOutcome';
import { useDashboardStore, useDerivedIssueState } from './store';

// Deliberately not `isEndedAgent`/`SessionAgent` from `./agentConversation` —
// that module imports `Conversation` from `ConversationList.tsx`, upstream
// of `AgentStepRow.tsx` in the ProjectTree chain; importing it here (this
// module is pulled in by AgentStepRow.tsx via useSessionNodeOutcome) would
// close a circular dependency. Mirrors agentConversation.ts's own check.
const ENDED_AGENT_STATUSES = new Set(['stopped', 'dead', 'failed']);
function isEndedAgent(agent: SessionOutcomeAgent): boolean {
  return ENDED_AGENT_STATUSES.has(agent.status);
}

/** Outcome for an ended SessionNode; null while the session is not ended. */
export function useSessionNodeOutcome(node: SessionNode, issueId: string | null | undefined): SessionOutcome | null {
  const derived = useDerivedIssueState(issueId ? issueId.toUpperCase() : issueId);
  const agent = useDashboardStore((s) => s.agentsById[node.sessionId]);
  if (node.presence !== 'ended') return null;
  return deriveSessionOutcome(outcomeFactsFromSessionNode(node, derived, agent));
}

/** Outcome for an ended drawer agent; null while the agent is not ended. */
export function useAgentSessionOutcome(agent: SessionOutcomeAgent | null): SessionOutcome | null {
  const issueId = agent?.issueId?.toUpperCase();
  const derived = useDerivedIssueState(issueId);
  const snapshot = useDashboardStore((s) => (agent ? s.agentsById[agent.id] : undefined));
  if (!agent || !isEndedAgent(agent)) return null;
  return deriveSessionOutcome(outcomeFactsFromAgent({ ...agent, stoppedByUser: snapshot?.stoppedByUser, paused: snapshot?.paused }, derived));
}
