/**
 * Boot seed for the read model's runtime map (PAN-4522).
 *
 * The read model used to boot with `agentRuntimeById: {}`, so every client that
 * connected after a restart saw each agent's spawn-time stamp until its next tool
 * beat. This replays each agent's retained runtime events through the shared
 * reducer so a live agent comes back with its real last-activity stamp.
 */
import { applyEvent, INITIAL_READ_MODEL_STATE } from '@overdeck/contracts';
import type { AgentRuntimeSnapshot, AgentSnapshot, DomainEvent, ReadModelState } from '@overdeck/contracts';
import type { StoredEvent } from '../event-store.js';

/** Every event type whose reducer case writes `agentRuntimeById`. */
export const RUNTIME_SEED_EVENT_TYPES: readonly string[] = [
  'agent.activity_changed', 'agent.thinking_started', 'agent.thinking_stopped',
  'agent.waiting_started', 'agent.waiting_cleared', 'agent.message_received',
  'agent.channel_reply', 'agent.model_set', 'agent.current_issue_set',
  'agent.context_saturation_changed', 'agent.resolution_changed',
  'agent.state_restored', 'agent.stopped', 'agent.heartbeat_dead',
];

/**
 * Replay stored runtime events into a runtime map for the agents in `agentsById`.
 * Each agent folds against its own scratch state and only its runtime entry is
 * kept: `agent.stopped` and `agent.heartbeat_dead` also rewrite agent rows, and a
 * later resume's `agent.status_changed` is not a runtime event, so their row
 * changes must not leak into the served agents.
 */
export function foldRuntimeSeed(
  events: readonly StoredEvent[],
  agentsById: Readonly<Record<string, AgentSnapshot>>,
): Record<string, AgentRuntimeSnapshot> {
  const byAgent = new Map<string, StoredEvent[]>();
  for (const event of events) {
    const agentId = (event.payload as { agentId?: unknown } | null)?.agentId;
    if (typeof agentId !== 'string' || !(agentId in agentsById)) continue;
    const list = byAgent.get(agentId) ?? [];
    list.push(event);
    byAgent.set(agentId, list);
  }
  const seeded: Record<string, AgentRuntimeSnapshot> = {};
  for (const [agentId, list] of byAgent) {
    let scratch: ReadModelState = {
      ...INITIAL_READ_MODEL_STATE,
      agentsById: { [agentId]: agentsById[agentId] },
      agentRuntimeById: {},
    };
    for (const event of [...list].sort((a, b) => a.sequence - b.sequence)) {
      scratch = applyEvent(scratch, event as unknown as DomainEvent);
    }
    const entry = scratch.agentRuntimeById[agentId];
    if (entry) seeded[agentId] = entry;
  }
  return seeded;
}
