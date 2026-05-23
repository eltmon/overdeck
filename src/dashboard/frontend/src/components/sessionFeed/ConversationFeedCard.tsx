import { MessageCircle } from 'lucide-react';
import { ProviderIcon } from '../chat/ProviderIcons';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import type { ConversationSessionFeedEntry } from './types';

interface ConversationFeedCardProps {
  entry: ConversationSessionFeedEntry;
  onSelect: (entryId: string) => void;
  now?: Date;
}

type AgentState = 'active' | 'waiting' | 'idle';

const STATUS_DOT_COLORS: Record<AgentState, string> = {
  active: 'bg-success',
  waiting: 'bg-warning',
  idle: 'bg-muted-foreground/60',
};

const AGENT_LABELS: Record<string, string> = {
  claude_code: 'Claude Code',
  pi: 'Pi',
  unknown: 'Unknown',
};

const AGENT_ICON_PROVIDER: Record<string, string> = {
  claude_code: 'anthropic',
  pi: 'pi',
  unknown: 'unknown',
};

export function ConversationFeedCard({ entry, onSelect, now = new Date() }: ConversationFeedCardProps) {
  const agentState = readAgentState(entry);
  const agentLabel = AGENT_LABELS[entry.agent] ?? entry.agent;
  const iconProvider = AGENT_ICON_PROVIDER[entry.agent] ?? entry.agent;

  return (
    <button
      type="button"
      className="w-full rounded-lg border border-border bg-card p-2.5 text-left text-xs transition-colors hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
      onClick={() => onSelect(entry.id)}
    >
      <div className="flex items-start gap-2">
        <span data-testid="conversation-feed-agent-icon" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
          <ProviderIcon provider={iconProvider} label={agentLabel} className="h-4 w-4" />
        </span>
        <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_COLORS[agentState]}`} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="max-w-[120px] truncate font-medium text-foreground">{agentLabel}</span>
            <time dateTime={entry.lastMessageDate} className="shrink-0 text-[10px] text-muted-foreground">
              {formatRelativeTime(entry.lastMessageDate, now)}
            </time>
          </div>
          <p className="mt-1 line-clamp-2 text-muted-foreground">{entry.lastMessageSnippet}</p>
          {(entry.messageCount !== undefined || (entry.threadLabel && entry.threadIsPrimary === false)) && (
            <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
              {entry.messageCount !== undefined && (
                <span className="inline-flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" aria-hidden="true" />
                  {entry.messageCount}
                </span>
              )}
              {entry.threadLabel && entry.threadIsPrimary === false && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {entry.threadLabel}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function readAgentState(entry: ConversationSessionFeedEntry): AgentState {
  const state = (entry as ConversationSessionFeedEntry & { agentState?: AgentState }).agentState;
  return state === 'active' || state === 'waiting' || state === 'idle' ? state : 'idle';
}
