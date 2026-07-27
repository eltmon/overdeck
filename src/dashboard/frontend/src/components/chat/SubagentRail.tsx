import { useCallback, useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { Conversation } from '../CommandDeck/ConversationList';
import { MessagesTimeline } from './MessagesTimeline';
import type { SubagentSummary } from './chat-types';
import { useSubagentTranscript } from './useConversationMessagesStream';

interface SubagentRailProps {
  conversation: Conversation;
  subagents: SubagentSummary[];
  resolvedTheme?: 'light' | 'dark';
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

export function SubagentRail({ conversation, subagents, resolvedTheme }: SubagentRailProps) {
  const [selectedAgentId, setSelectedAgentId] = useState(readSelectedSubagent);
  const selected = subagents.find((subagent) => subagent.agentId === selectedAgentId) ?? null;
  const transcript = useSubagentTranscript(conversation, selected?.agentId ?? null);

  useEffect(() => {
    const onPopState = () => setSelectedAgentId(readSelectedSubagent());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const select = useCallback((agentId: string) => {
    updateSelectedSubagent(agentId);
    setSelectedAgentId(agentId);
  }, []);
  const close = useCallback(() => {
    updateSelectedSubagent(null);
    setSelectedAgentId(null);
  }, []);

  if (subagents.length === 0) return null;

  return (
    <aside
      aria-label="Conversation subagents"
      className={`flex min-h-0 min-w-0 shrink-0 flex-col border-l border-border bg-card ${selected ? 'w-[min(44rem,45vw)]' : 'w-64'}`}
    >
      {selected ? (
        <>
          <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {selected.agentType} <span className="text-muted-foreground">· {selected.description}</span>
            </span>
            <button
              type="button"
              aria-label="Close subagent transcript"
              className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={close}
            >
              <X size={16} />
            </button>
          </header>
          <div className="min-h-0 min-w-0 flex-1">
            {transcript.isLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin text-primary" />
                Loading transcript…
              </div>
            ) : transcript.isError ? (
              <div className="flex h-full items-center justify-center px-4 text-sm text-destructive-foreground">
                Couldn&apos;t load this subagent transcript.
              </div>
            ) : (
              <MessagesTimeline
                messages={transcript.data?.messages ?? []}
                workLog={transcript.data?.workLog ?? []}
                streaming={transcript.data?.streaming ?? selected.status === 'running'}
                conversationName={`${conversation.name}:${selected.agentId}`}
                cwd={conversation.cwd}
                issueId={conversation.issueId}
                resolvedTheme={resolvedTheme}
              />
            )}
          </div>
        </>
      ) : (
        <>
          <header className="flex h-11 shrink-0 items-center border-b border-border px-3 text-xs font-medium text-muted-foreground">
            Subagents
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {subagents.map((subagent) => (
              <button
                key={subagent.agentId}
                type="button"
                className="flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left transition-colors hover:bg-accent"
                onClick={() => select(subagent.agentId)}
              >
                <span
                  aria-label={subagent.status}
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${subagent.status === 'running' ? 'bg-primary' : 'bg-muted-foreground/40'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">{subagent.agentType}</span>
                  <span className="block truncate text-xs text-muted-foreground">{subagent.description}</span>
                </span>
                {subagent.spawnDepth > 1 && (
                  <span className="rounded-sm border border-border bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
                    depth {subagent.spawnDepth}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
