/**
 * Shared agent → synthetic Conversation projection.
 *
 * A work agent's `id` is both its tmux session name and its session-file key,
 * so a `Conversation` can be synthesized from the agent record alone — the
 * same shape `SessionPanel` synthesizes from a `SessionNode`. Extracted from
 * DrawerAgentSession (PAN-3090) so the drawer and the simple-mode narrative
 * feed stream the same transcript the same way and never drift.
 */
import type { Conversation } from '../components/CommandDeck/ConversationList';

const ENDED_AGENT_STATUSES = new Set<string>(['stopped', 'dead', 'failed']);

/**
 * The minimal agent shape a session pane needs. Both the read-model
 * AgentSnapshot (simple mode, peeks) and the REST Agent (drawer) satisfy it —
 * one conversation renderer over whichever projection the caller has.
 */
export interface SessionAgent {
  id: string;
  issueId?: string | null;
  status: string;
  role?: string | null;
  startedAt?: string | null;
  lastActivity?: string | null;
  workspace?: string | null;
  model?: string | null;
  harness?: string | null;
  runtime?: string | null;
}

export function isEndedAgent(agent: SessionAgent): boolean {
  return ENDED_AGENT_STATUSES.has(agent.status);
}

/** Synthesize a Conversation from an agent so ConversationPanel can render it. */
export function agentToConversation(agent: SessionAgent): Conversation {
  const ended = isEndedAgent(agent);
  return {
    id: -1,
    name: agent.id,
    tmuxSession: agent.id,
    status: ended ? 'ended' : 'active',
    cwd: agent.workspace ?? '',
    issueId: agent.issueId ?? null,
    createdAt: agent.startedAt ?? agent.lastActivity ?? '',
    // ConversationPanel reads `!sessionAlive && !endedAt` as "still spawning"
    // and shows a "Starting…" placeholder over the transcript — an ended agent
    // must report a non-null endedAt, so fall back to lastActivity/startedAt.
    endedAt: ended ? (agent.lastActivity ?? agent.startedAt ?? null) : null,
    lastAttachedAt: null,
    sessionAlive: !ended,
    sessionFile: agent.id,
    model: agent.model,
    // The agent snapshot carries the harness in `runtime` (claude-code|pi|codex);
    // fall back to runtime so the synthetic conversation is correctly tagged —
    // this drives the RPC terminal notice and pi/codex live streaming (PAN-1908).
    harness: ((agent.harness ?? agent.runtime) as Conversation['harness']) ?? null,
  };
}
