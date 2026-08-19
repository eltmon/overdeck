/**
 * PAN-3090 — narrative feed for the simple issue page.
 *
 * Renders the selected agent's transcript the way the simple persona needs it:
 * the machine kickoff prompt is a one-line system entry (raw text behind a
 * disclosure), assistant messages are prose clamped at a preview length with
 * "Read more", tool calls are quiet one-line actions, and a live row carries
 * the single state color (amber = waiting on the human, blue = working).
 *
 * Data comes from the same conversation-messages cache the operator
 * transcript uses — the stream for harnesses that push, the 2s HTTP poll for
 * claude-code agent sessions — via the shared agentToConversation projection.
 * Copy comes from SIMPLE_STRINGS; no internal jargon (copy-lint enforced).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, MessageSquareText, Send, Wrench } from 'lucide-react';
import type { AgentSnapshot } from '@overdeck/contracts';
import type { Issue } from '../../types';
import { agentToConversation, isEndedAgent } from '../../lib/agentConversation';
import {
  conversationMessagesQueryKey,
  useConversationMessagesStream,
} from '../chat/useConversationMessagesStream';
import { fetchMessages } from '../chat/ConversationPanel';
import { ChatMarkdown } from '../chat/ChatMarkdown';
import { buildSimpleFeedEntries, type SimpleFeedEntry } from '../../lib/simple/feedEntries';
import { getPendingToolEntry, getPhaseLabel, getWorkingPhase } from '../../lib/workingPhase';
import { SIMPLE_STRINGS } from '../../lib/simple/strings';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import type { NeedsYouReason, UserFacingState } from '../../lib/simple/userFacingState';
import { cn } from '../../lib/utils';

const S = SIMPLE_STRINGS.issue;

interface SimpleActivityFeedProps {
  issue: Issue;
  agents: readonly AgentSnapshot[];
  /** The resolved agent to show (the page renders the empty state when there is none). */
  agent: AgentSnapshot;
  onSelectAgent: (agentId: string) => void;
  state: UserFacingState;
  /** Why it needs you — decides what the paused live row says. */
  needsYouReason?: NeedsYouReason | null;
}

export function SimpleActivityFeed({ issue, agents, agent, onSelectAgent, state, needsYouReason }: SimpleActivityFeedProps) {
  const conversation = useMemo(() => agentToConversation(agent), [agent]);
  const { enabled: streamEnabled } = useConversationMessagesStream(conversation);
  const queryClient = useQueryClient();

  const queryKey = useMemo(() => conversationMessagesQueryKey(conversation.name), [conversation.name]);
  const live = !isEndedAgent(agent);
  const { data: messagesData } = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const fetched = await fetchMessages(conversation.name, signal, agent.id);
      if (streamEnabled) {
        const cached = queryClient.getQueryData<typeof fetched>(queryKey);
        if (cached && cached.messages.length >= fetched.messages.length) return cached;
      }
      return fetched;
    },
    enabled: !streamEnabled,
    refetchInterval: streamEnabled ? false : live ? 2000 : false,
  });

  const messages = useMemo(() => messagesData?.messages ?? [], [messagesData]);
  const workLog = useMemo(() => messagesData?.workLog ?? [], [messagesData]);

  const entries = useMemo(
    () => buildSimpleFeedEntries({ messages, workLog, issueTitle: issue.title }),
    [messages, workLog, issue.title],
  );

  // Auto-follow: stick to the newest entry only while the viewer is at the bottom.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const running = live && (agent.status === 'running' || agent.status === 'starting');
  const waiting = state === 'needs-you';

  return (
    <div>
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-sm font-medium">{S.feedTitle}</h2>
        {waiting ? (
          <span className="flex items-center gap-1.5 text-[11px] text-warning-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" /> {S.waitingOnYou}
          </span>
        ) : running ? (
          <span className="flex items-center gap-1.5 text-[11px] text-info-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" /> {S.liveLabel}
          </span>
        ) : null}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {roleLabel(agent.role)} agent · <span className="font-mono">{agent.id.replace(/^agent-/, '')}</span>
        </span>
      </div>

      {agents.length > 1 && (
        <div className="mt-2 inline-flex overflow-hidden rounded-lg border border-input">
          {agents.map((candidate) => (
            <button
              key={candidate.id}
              onClick={() => onSelectAgent(candidate.id)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                candidate.id === agent.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {roleLabel(candidate.role)}
            </button>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="mt-2.5 max-h-[470px] overflow-y-auto border-t border-border"
      >
        {entries.map((entry) => (
          <FeedRow key={entry.id} entry={entry} />
        ))}
        <LiveRow state={state} needsYouReason={needsYouReason} running={running} messages={messages} workLog={workLog} />
      </div>
    </div>
  );
}

function roleLabel(role: string | null | undefined): string {
  if (!role) return 'Agent';
  return `${role[0]!.toUpperCase()}${role.slice(1)}`;
}

/* ── Rows ─────────────────────────────────────────────────────────────── */

function FeedRow({ entry }: { entry: SimpleFeedEntry }) {
  const [expanded, setExpanded] = useState(false);
  const when = (
    <span className="mt-0.5 flex-none text-[11px] text-muted-foreground">{formatRelativeTime(entry.createdAt, new Date())}</span>
  );

  if (entry.kind === 'system') {
    return (
      <div className="flex gap-2.5 border-b border-border px-0.5 py-2.5">
        <span className="mt-0.5 w-4 flex-none text-muted-foreground"><Flag size={13} /></span>
        <div className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
          {entry.text}
          <details className="mt-1">
            <summary className="cursor-pointer text-[11.5px] underline underline-offset-2">{S.rawPromptDisclosure}</summary>
            <pre className="mt-2 max-h-[180px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-accent p-2.5 font-mono text-[11.5px] leading-relaxed">
              {entry.raw}
            </pre>
          </details>
        </div>
        {when}
      </div>
    );
  }

  if (entry.kind === 'say') {
    return (
      <div className="flex gap-2.5 border-b border-border px-0.5 py-2.5">
        <span className="mt-0.5 w-4 flex-none text-muted-foreground"><MessageSquareText size={13} /></span>
        <div className="min-w-0 flex-1 text-[13.5px]">
          {expanded ? <ChatMarkdown text={entry.full} /> : entry.preview}
          {entry.clamp && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="ml-1.5 text-[11.5px] text-info-foreground"
            >
              {expanded ? S.showLess : S.readMore}
            </button>
          )}
        </div>
        {when}
      </div>
    );
  }

  if (entry.kind === 'action') {
    return (
      <div className="flex gap-2.5 border-b border-border px-0.5 py-2.5">
        <span className="mt-0.5 w-4 flex-none text-muted-foreground"><Wrench size={13} /></span>
        <div className={cn('min-w-0 flex-1 truncate text-[13px]', entry.failed ? 'text-destructive-foreground' : 'text-muted-foreground')}>
          {entry.text}
        </div>
        {when}
      </div>
    );
  }

  // reply — a message delivered to the agent. Attribution stays neutral:
  // operator typing and machine feedback are indistinguishable at this layer.
  return (
    <div className="flex gap-2.5 border-b border-border px-0.5 py-2.5">
      <span className="mt-0.5 w-4 flex-none text-muted-foreground"><Send size={13} /></span>
      <div className="min-w-0 flex-1 text-[13px]">
        <span className="mr-1.5 text-[11px] text-muted-foreground">{S.sentToAgent}</span>
        <span className={cn(!expanded && 'line-clamp-3')}>{entry.text}</span>
        {entry.text.length > 280 && (
          <button onClick={() => setExpanded((v) => !v)} className="ml-1.5 text-[11.5px] text-info-foreground">
            {expanded ? S.showLess : S.readMore}
          </button>
        )}
      </div>
      {when}
    </div>
  );
}

function LiveRow({ state, needsYouReason, running, messages, workLog }: {
  state: UserFacingState;
  needsYouReason?: NeedsYouReason | null;
  running: boolean;
  messages: Parameters<typeof getWorkingPhase>[0];
  workLog: Parameters<typeof getWorkingPhase>[1];
}) {
  if (state === 'needs-you') {
    return (
      <div className="flex gap-2.5 px-0.5 py-2.5">
        <span className="mt-1.5 w-4 flex-none text-center text-[10px] text-warning">●</span>
        <div className="flex-1 text-[13px] text-warning-foreground">
          {needsYouReason === 'start-work' ? S.pausedToStart : S.pausedWaiting}
        </div>
        <span className="mt-0.5 flex-none text-[11px] text-muted-foreground">now</span>
      </div>
    );
  }
  if (running) {
    const phase = getWorkingPhase(messages, workLog);
    const label = getPhaseLabel(phase, getPendingToolEntry(workLog));
    return (
      <div className="flex gap-2.5 px-0.5 py-2.5">
        <span className="mt-1.5 w-4 flex-none text-center text-[10px] text-info">●</span>
        <div className="flex-1 text-[13px] text-info-foreground">{label}</div>
        <span className="mt-0.5 flex-none text-[11px] text-muted-foreground">now</span>
      </div>
    );
  }
  if (state === 'ready') {
    return (
      <div className="flex gap-2.5 px-0.5 py-2.5">
        <span className="mt-1.5 w-4 flex-none text-center text-[10px] text-success">●</span>
        <div className="flex-1 text-[13px] text-success-foreground">{S.readyLiveRow}</div>
      </div>
    );
  }
  return null;
}
