import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Stream } from 'effect';
import { getHarnessBehavior, WS_METHODS } from '@overdeck/contracts';
import { getTransport, type PanRpcProtocolClient } from '../../lib/wsTransport';
import type { Conversation } from '../CommandDeck/ConversationList';
import type { ChatMessage, CompactBoundary, ContextUsage, ConversationEvent, ProposedPlan, WorkLogEntry } from './chat-types';

export const conversationMessagesQueryKey = (name: string) => ['conversation-messages', name] as const;


function allSequencesAfter<T extends { sequence?: number }>(sequence: number, items: T[]): boolean {
  let lastSequence = sequence;
  for (const item of items) {
    if (typeof item.sequence !== 'number' || item.sequence <= lastSequence) return false;
    lastSequence = item.sequence;
  }
  return true;
}

function mergeById<T extends { id: string; sequence?: number }>(previous: T[], next: T[]): T[] {
  if (next.length === 0) return previous;
  if (previous.length === 0) return next;

  const previousLast = previous[previous.length - 1]!;
  const nextFirst = next[0]!;

  if (nextFirst.id === previousLast.id) {
    const replaced = [...previous.slice(0, -1), nextFirst];
    const rest = next.slice(1);
    if (rest.length === 0) return replaced;
    if (typeof nextFirst.sequence === 'number' && allSequencesAfter(nextFirst.sequence, rest)) {
      return [...replaced, ...rest];
    }
  } else if (typeof previousLast.sequence === 'number' && allSequencesAfter(previousLast.sequence, next)) {
    return [...previous, ...next];
  }

  const existingIds = new Set(previous.map((item) => item.id));
  if (next.every((item) => !existingIds.has(item.id))) {
    return [...previous, ...next];
  }

  const merged = new Map<string, T>();
  for (const item of previous) merged.set(item.id, item);
  for (const item of next) merged.set(item.id, item);
  return Array.from(merged.values());
}

interface ConversationMessagesCache {
  messages: ChatMessage[];
  workLog: WorkLogEntry[];
  streaming: boolean;
  discovering?: boolean;
  totalCost?: number;
  proposedPlan?: ProposedPlan;
  compactBoundaries?: CompactBoundary[];
  compacting?: boolean;
  contextUsage?: ContextUsage | null;
}

export function applyConversationMessagesEvent(
  previous: ConversationMessagesCache | undefined,
  event: ConversationEvent,
): ConversationMessagesCache {
  if (event.kind === 'discovering') {
    if (previous?.discovering) return previous;
    return {
      messages: previous?.messages ?? [],
      workLog: previous?.workLog ?? [],
      streaming: previous?.streaming ?? true,
      ...previous,
      discovering: true,
    };
  }

  // Claude Code JSONL writes complete message/tool records per line, not raw
  // provider token chunks. The first event is a full snapshot; subsequent live
  // events are message/tool deltas from appended JSONL bytes. Merge deltas
  // locally so the hot path does not ship the full transcript on every append.
  const isSnapshot = event.snapshot !== false;
  // A snapshot is meant to be the authoritative full transcript, but the server
  // can transiently emit an empty/partial snapshot (WS reconnect, session
  // re-resolve, or a brief read failure) that would blank or truncate a
  // populated conversation mid-view ("How can I help you?" / only-last-parts).
  // Live Claude transcripts are append-only — compaction is recorded as
  // boundaries, not message removal — so never let a snapshot SHRINK what we
  // already have; merge instead, preserving history while still adopting any
  // new records the snapshot carries.
  const snapshotShrinks =
    isSnapshot && event.messages.length < (previous?.messages.length ?? 0);
  const replaceFromSnapshot = isSnapshot && !snapshotShrinks;
  return {
    ...previous,
    messages: replaceFromSnapshot
      ? event.messages
      : mergeById(previous?.messages ?? [], event.messages),
    workLog: replaceFromSnapshot
      ? event.workLog
      : mergeById(previous?.workLog ?? [], event.workLog),
    streaming: event.streaming,
    proposedPlan: event.proposedPlan ?? previous?.proposedPlan,
    compactBoundaries: replaceFromSnapshot
      ? event.compactBoundaries
      : mergeById(previous?.compactBoundaries ?? [], event.compactBoundaries ?? []),
    contextUsage: 'contextUsage' in event ? event.contextUsage : previous?.contextUsage,
    discovering: false,
  };
}

export function shouldStreamConversationMessages(conversation: Pick<Conversation, 'name' | 'harness' | 'sessionAlive'> & { id?: number; endedAt?: string | null }): boolean {
  // Real DB conversations (id >= 0) stream for every transcript-backed harness
  // as soon as the row exists and the conversation has NOT ended. We intentionally
  // do NOT gate on `sessionAlive`: a freshly-created conversation reports
  // sessionAlive:false until its background spawn finishes, and gating here left
  // the feed frozen (no stream, no HTTP poll) until a full page reload. The server's
  // subscribe handler tolerates a not-yet-written session file (it polls until the
  // transcript appears, then emits the full snapshot), so subscribing early is safe
  // and self-heals the view the instant the runtime writes — no reload. Ended
  // conversations stay on the one-shot HTTP path (historical view; no live tail).
  // Claude Code uses the incremental JSONL stream; pi/codex use full snapshot
  // streams — polling those every 2s is visibly stale during fast turns.
  if (conversation.id !== undefined && conversation.id >= 0) {
    if (conversation.endedAt) return false;
    if (conversation.harness == null) return true;
    const behavior = getHarnessBehavior(conversation.harness);
    return behavior.supportsConversationStreaming || behavior.supportsPatchProjection;
  }
  // Synthetic agent sessions (id < 0 — work/planning/specialist SessionPanels)
  // have no conversations-table row and only stream while their session is live.
  // Only pi/codex stream here (PAN-1908): the server tails their transcript and
  // pushes snapshots. Claude work agents stay on the existing HTTP-poll path,
  // which already works — no need to add a server watcher for them.
  if (!conversation.sessionAlive) return false;
  const name = conversation.name ?? '';
  const isAgentSession = /^(agent-|planning-|specialist-)/.test(name);
  const streamable = getHarnessBehavior(conversation.harness).supportsConversationStreaming;
  return isAgentSession && streamable;
}

export function useConversationMessagesStream(conversation: Pick<Conversation, 'name' | 'harness' | 'sessionAlive'> & { id?: number; endedAt?: string | null }): boolean {
  const queryClient = useQueryClient();
  const enabled = shouldStreamConversationMessages(conversation);

  useEffect(() => {
    if (!enabled) return;

    const queryKey = conversationMessagesQueryKey(conversation.name);
    void queryClient.cancelQueries({ queryKey });
    const unsubscribe = getTransport().subscribe(
      (client) =>
        (client as PanRpcProtocolClient)[WS_METHODS.subscribeConversationMessages]({ conversationName: conversation.name }) as Stream.Stream<ConversationEvent, Error>,
      (event) => {
        queryClient.setQueryData<ConversationMessagesCache>(queryKey, (previous) =>
          applyConversationMessagesEvent(previous, event));
      },
    );

    return () => {
      unsubscribe();
    };
  }, [conversation.name, enabled, queryClient]);

  return enabled;
}
