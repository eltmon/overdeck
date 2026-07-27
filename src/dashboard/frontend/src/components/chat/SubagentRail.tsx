import { useCallback, useEffect, useState } from 'react';
import type { Conversation } from '../CommandDeck/ConversationList';
import type { SubagentSummary } from './chat-types';

interface SubagentRailProps {
  conversation: Conversation;
  subagents: SubagentSummary[];
  /** Currently selected subagent, or null while the main agent is shown. */
  selectedAgentId: string | null;
}

function readSelectedSubagent(): string | null {
  return new URLSearchParams(window.location.search).get('subagent');
}

export function updateSelectedSubagent(agentId: string | null): void {
  const searchParams = new URLSearchParams(window.location.search);
  if (agentId) searchParams.set('subagent', agentId);
  else searchParams.delete('subagent');
  const query = searchParams.toString();
  window.history.pushState({}, '', query ? `${window.location.pathname}?${query}` : window.location.pathname);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * URL-backed selection (`?subagent=<id>`) shared by the rail and the conversation
 * body: the rail highlights the row, the body swaps to that agent's transcript.
 * `updateSelectedSubagent` dispatches popstate so every reader re-syncs.
 */
export function useSubagentSelection(subagents: readonly SubagentSummary[]) {
  const [selectedAgentId, setSelectedAgentId] = useState(readSelectedSubagent);
  useEffect(() => {
    const onPopState = () => setSelectedAgentId(readSelectedSubagent());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const clearSelection = useCallback(() => updateSelectedSubagent(null), []);
  const selectedSubagent = subagents.find((subagent) => subagent.agentId === selectedAgentId) ?? null;
  return { selectedAgentId, selectedSubagent, clearSelection };
}

export function SubagentRail({ conversation, subagents, selectedAgentId }: SubagentRailProps) {
  const select = useCallback((agentId: string | null) => updateSelectedSubagent(agentId), []);

  if (subagents.length === 0) return null;

  return (
    <aside
      aria-label="Conversation agents"
      className="flex min-h-0 w-64 min-w-0 shrink-0 flex-col border-l border-border bg-card"
    >
      <header className="flex h-11 shrink-0 items-center border-b border-border px-3 text-xs font-medium text-muted-foreground">
        Agents
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AgentRow
          label="Main agent"
          description={conversation.title ?? conversation.name}
          status={conversation.sessionAlive ? 'running' : 'done'}
          selected={selectedAgentId === null}
          onClick={() => select(null)}
        />
        {subagents.map((subagent) => (
          <AgentRow
            key={subagent.agentId}
            label={subagent.agentType}
            description={subagent.description}
            status={subagent.status}
            depth={subagent.spawnDepth}
            selected={selectedAgentId === subagent.agentId}
            onClick={() => select(subagent.agentId)}
          />
        ))}
      </div>
    </aside>
  );
}

interface AgentRowProps {
  label: string;
  description: string;
  status: 'running' | 'done';
  depth?: number;
  selected: boolean;
  onClick: () => void;
}

function AgentRow({ label, description, status, depth, selected, onClick }: AgentRowProps) {
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      className={`flex w-full items-start gap-2 border-b border-l-2 border-b-border px-3 py-2 text-left transition-colors ${selected ? 'border-l-primary bg-accent' : 'border-l-transparent hover:bg-accent'}`}
      onClick={onClick}
    >
      <span
        aria-label={status}
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${status === 'running' ? 'bg-primary' : 'bg-muted-foreground/40'}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
      {depth !== undefined && depth > 1 && (
        <span className="rounded-sm border border-border bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
          depth {depth}
        </span>
      )}
    </button>
  );
}
