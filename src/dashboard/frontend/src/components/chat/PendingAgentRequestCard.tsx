/**
 * The pinned agent-request card at the top of an owner's chrome (PAN-5541
 * WI-6/WI-6b, D6/D7).
 *
 * A pending `request_secret` or `link_machine` parks the owning conversation
 * or agent until the operator answers. Rather than make the operator hunt
 * for the Decisions panel, each owner's own surface renders the same
 * `AgentRequestCard` pinned at the top: `ConversationPanel` for a
 * conversation owner (both its conversation and terminal views), and
 * `DrawerAgentSession`/`SessionPanel` for an agent owner. Reusing
 * `usePendingAgentRequestDecisions`'s shared `['agent-requests']` query key
 * adds no new polling (NFR-2).
 */
import { AgentRequestCard } from '../AgentRequestCard';
import type { Decision } from '../../lib/useDecisions';
import { usePendingAgentRequestDecisions } from '../../lib/useDecisions';

export type AgentRequestOwner = { kind: 'conversation'; name: string } | { kind: 'agent'; id: string };

/** D7: a conversation owner matches by exact name; an agent owner matches by case-insensitive id. */
export function isOwnedBy(request: NonNullable<Decision['agentRequest']>, owner: AgentRequestOwner): boolean {
  if (owner.kind === 'conversation') return request.agentKind === 'conversation' && request.agentId === owner.name;
  return request.agentKind === 'agent' && request.agentId.toLowerCase() === owner.id.toLowerCase();
}

export function PendingAgentRequestCards({ owner }: { owner: AgentRequestOwner }) {
  const { decisions } = usePendingAgentRequestDecisions();
  const owned = decisions.filter((decision) => decision.agentRequest && isOwnedBy(decision.agentRequest, owner));
  if (owned.length === 0) return null;
  return (
    <div data-testid="pinned-agent-requests">
      {owned.map((decision) => (
        <AgentRequestCard key={decision.id} decision={decision} />
      ))}
    </div>
  );
}
