/**
 * DrawerAgentSession — wires the IssueDrawer's Conversation and Terminal tabs
 * to a real agent session.
 *
 * The drawer is issue-scoped, so it picks one of the issue's agents (defaulting
 * to the active work agent) and renders either its JSONL transcript
 * (`<ConversationPanel>`) or its live tmux terminal (`<XTerminal>`). When the
 * issue has more than one agent — e.g. a swarm — a compact picker lets the user
 * switch between sessions; the selection is owned by `<IssueDrawer>` so it
 * survives a Conversation ⇄ Terminal tab switch.
 *
 * A work agent's `id` is both its tmux session name and its session-file key,
 * so a `Conversation` can be synthesized from the `Agent` alone — the same
 * shape `SessionPanel` synthesizes from a `SessionNode`.
 */

import { useMemo } from 'react';

import { ConversationPanel } from '../chat/ConversationPanel';
import type { Conversation } from '../CommandDeck/ConversationList';
import { XTerminal } from '../XTerminal';
import type { Agent } from '../../types';

const ENDED_AGENT_STATUSES = new Set<Agent['status']>(['stopped', 'dead', 'failed']);

function isEndedAgent(agent: Agent): boolean {
  return ENDED_AGENT_STATUSES.has(agent.status);
}

/**
 * Pick the agent the drawer should show by default: the active work agent,
 * then any work agent, then any active agent, then whatever exists.
 */
export function pickDefaultDrawerAgent(agents: readonly Agent[]): Agent | null {
  const live = agents.filter((agent) => !isEndedAgent(agent));
  return (
    live.find((agent) => agent.role === 'work')
    ?? agents.find((agent) => agent.role === 'work')
    ?? live[0]
    ?? agents[0]
    ?? null
  );
}

/** Synthesize a Conversation from an Agent so ConversationPanel can render it. */
function agentToConversation(agent: Agent): Conversation {
  const ended = isEndedAgent(agent);
  return {
    id: -1,
    name: agent.id,
    tmuxSession: agent.id,
    status: ended ? 'ended' : 'active',
    cwd: agent.workspace ?? '',
    issueId: agent.issueId ?? null,
    createdAt: agent.startedAt,
    // ConversationPanel reads `!sessionAlive && !endedAt` as "still spawning"
    // and shows a "Starting…" placeholder over the transcript — an ended agent
    // must report a non-null endedAt, so fall back to lastActivity/startedAt.
    endedAt: ended ? (agent.lastActivity ?? agent.startedAt) : null,
    lastAttachedAt: null,
    sessionAlive: !ended,
    sessionFile: agent.id,
    model: agent.model,
    harness: agent.harness ?? null,
  };
}

function agentOptionLabel(agent: Agent): string {
  const role = agent.role ? `${agent.role[0]!.toUpperCase()}${agent.role.slice(1)}` : 'Agent';
  return `${role} · ${agent.id}`;
}

interface DrawerAgentSessionProps {
  view: 'conversation' | 'terminal';
  agents: readonly Agent[];
  /** The agent to display — resolved by IssueDrawer, shared across both tabs. */
  agentId: string | null;
  onSelectAgent: (agentId: string) => void;
}

export function DrawerAgentSession({ view, agents, agentId, onSelectAgent }: DrawerAgentSessionProps) {
  const testId = `drawer-tab-panel-${view}`;

  const agent = useMemo(
    () => agents.find((candidate) => candidate.id === agentId) ?? null,
    [agents, agentId],
  );
  const conversation = useMemo(() => (agent ? agentToConversation(agent) : null), [agent]);

  if (!agent || !conversation) {
    return (
      <div
        data-testid={testId}
        className="rounded-[var(--radius)] border border-dashed border-border bg-card/60 p-[18px]"
      >
        <div className="mb-[8px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {view === 'conversation' ? 'Conversation' : 'Terminal'}
        </div>
        <p className="text-[13px] leading-6 text-muted-foreground">
          No agent session for this issue yet. The {view === 'conversation' ? 'transcript' : 'live terminal'} appears here once an agent starts.
        </p>
      </div>
    );
  }

  return (
    <div data-testid={testId} className="flex min-h-0 flex-1 flex-col gap-[10px]">
      {agents.length > 1 && (
        <div className="flex shrink-0 items-center gap-[8px]">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Agent
          </span>
          <select
            value={agent.id}
            onChange={(event) => onSelectAgent(event.target.value)}
            aria-label="Select agent session"
            className="rounded-[var(--radius-sm)] border border-border bg-card px-[8px] py-[4px] text-[12px] text-foreground"
          >
            {agents.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {agentOptionLabel(candidate)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden rounded-[var(--radius)] border border-border">
        {view === 'conversation' ? (
          <ConversationPanel
            key={agent.id}
            conversation={conversation}
            viewMode="conversation"
            embedded
            agentId={agent.id}
          />
        ) : isEndedAgent(agent) ? (
          <div className="flex h-full items-center justify-center p-[18px] text-[13px] text-muted-foreground">
            Session ended — no live terminal to attach.
          </div>
        ) : (
          <XTerminal key={agent.id} sessionName={agent.id} />
        )}
      </div>
    </div>
  );
}
