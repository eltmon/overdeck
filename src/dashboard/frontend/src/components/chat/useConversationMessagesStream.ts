import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Stream } from 'effect';
import { WS_METHODS } from '@panctl/contracts';
import { getTransport, type PanRpcProtocolClient } from '../../lib/wsTransport';
import type { Conversation } from '../CommandDeck/ConversationList';
import type { ChatMessage, CompactBoundary, ContextUsage, ConversationEvent, ProposedPlan, WorkLogEntry } from './chat-types';

export const conversationMessagesQueryKey = (name: string) => ['conversation-messages', name] as const;

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

export function shouldStreamConversationMessages(conversation: Pick<Conversation, 'harness' | 'sessionAlive'>): boolean {
  return conversation.sessionAlive && conversation.harness === 'claude-code';
}

export function useConversationMessagesStream(conversation: Pick<Conversation, 'name' | 'harness' | 'sessionAlive'>): boolean {
  const queryClient = useQueryClient();
  const enabled = shouldStreamConversationMessages(conversation);

  useEffect(() => {
    if (!enabled) return;

    const queryKey = conversationMessagesQueryKey(conversation.name);
    const unsubscribe = getTransport().subscribe(
      (client) =>
        (client as PanRpcProtocolClient)[WS_METHODS.subscribeConversationMessages]({ name: conversation.name }) as unknown as Stream.Stream<ConversationEvent, Error>,
      (event) => {
        queryClient.setQueryData<ConversationMessagesCache>(queryKey, (previous) => {
          if (event.kind === 'discovering') {
            return {
              messages: previous?.messages ?? [],
              workLog: previous?.workLog ?? [],
              streaming: previous?.streaming ?? true,
              ...previous,
              discovering: true,
            };
          }

          // This is message-level streaming, not token-level streaming: Claude's
          // JSONL writes complete records per line and does not expose token
          // deltas here. WsTransport reconnects by creating a fresh subscription;
          // the server handler emits the full initial state from offset 0 again.
          return {
            ...previous,
            messages: event.messages,
            workLog: event.workLog,
            streaming: event.streaming,
            proposedPlan: event.proposedPlan,
            compactBoundaries: event.compactBoundaries,
            contextUsage: event.contextUsage,
            discovering: false,
          };
        });
      },
    );

    return () => {
      unsubscribe();
    };
  }, [conversation.name, enabled, queryClient]);

  return enabled;
}
