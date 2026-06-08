import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Stream } from 'effect';
import { WS_METHODS } from '@panctl/contracts';
import { getTransport, type PanRpcProtocolClient } from '../../lib/wsTransport';
import type { Conversation } from '../CommandDeck/ConversationList';
import type { ChatMessage, CompactBoundary, ContextUsage, ConversationEvent, ProposedPlan, WorkLogEntry } from './chat-types';

export const conversationMessagesQueryKey = (name: string) => ['conversation-messages', name] as const;


function mergeById<T extends { id: string }>(previous: T[], next: T[]): T[] {
  if (next.length === 0) return previous;
  if (previous.length === 0) return next;

  if (next.length === 1 && previous[previous.length - 1]?.id === next[0]!.id) {
    return [...previous.slice(0, -1), next[0]!];
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
  return {
    ...previous,
    messages: isSnapshot
      ? event.messages
      : mergeById(previous?.messages ?? [], event.messages),
    workLog: isSnapshot
      ? event.workLog
      : mergeById(previous?.workLog ?? [], event.workLog),
    streaming: event.streaming,
    proposedPlan: event.proposedPlan ?? previous?.proposedPlan,
    compactBoundaries: isSnapshot
      ? event.compactBoundaries
      : mergeById(previous?.compactBoundaries ?? [], event.compactBoundaries ?? []),
    contextUsage: 'contextUsage' in event ? event.contextUsage : previous?.contextUsage,
    discovering: false,
  };
}

export function shouldStreamConversationMessages(conversation: Pick<Conversation, 'harness' | 'sessionAlive'>): boolean {
  return conversation.sessionAlive && (conversation.harness === 'claude-code' || conversation.harness == null);
}

export function useConversationMessagesStream(conversation: Pick<Conversation, 'name' | 'harness' | 'sessionAlive'>): boolean {
  const queryClient = useQueryClient();
  const enabled = shouldStreamConversationMessages(conversation);

  useEffect(() => {
    if (!enabled) return;

    const queryKey = conversationMessagesQueryKey(conversation.name);
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
