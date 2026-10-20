/**
 * Composer props that keep identity across streamed deltas (PAN-4560).
 *
 * A streamed delta replaces the conversation's message array. `onSend` reads
 * the latest messages from a ref instead of closing over them, and the
 * context-window snapshot is rebuilt only when the usage object changes, so
 * the memoized `ComposerFooter` does not re-render on every delta.
 */
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { toContextWindowSnapshot } from '../../lib/contextWindow';
import type { useComposerStore } from '../../lib/composerStore';
import type { Conversation } from '../CommandDeck/ConversationList';
import type { ChatMessage, ContextUsage } from './chat-types';

type AddOptimistic = ReturnType<typeof useComposerStore.getState>['addOptimistic'];

interface StableComposerPropsOptions {
  conversation: Pick<Conversation, 'name' | 'contextUsage'>;
  data: { contextUsage?: ContextUsage | null } | undefined;
  serverMessages: ChatMessage[];
  addOptimistic: AddOptimistic;
}

export function useStableComposerProps({ conversation, data, serverMessages, addOptimistic }: StableComposerPropsOptions) {
  const latestServerMessages = useRef(serverMessages);
  useLayoutEffect(() => {
    latestServerMessages.current = serverMessages;
  });

  const onSend = useCallback((text: string, clientMessageId?: string) => {
    const messages = latestServerMessages.current;
    addOptimistic(conversation.name, text, messages.length, {
      clientMessageId, echoBaselineIds: messages.map((message) => message.id),
    });
  }, [addOptimistic, conversation.name]);

  // PAN-1523: ContextWindowMeter lives in the composer toolbar (matches
  // t3code's placement). The snapshot adapter normalizes the server's
  // `ContextUsage` shape into t3code's `ContextWindowSnapshot` so future
  // upstream changes port cleanly.
  const contextUsage = data?.contextUsage ?? conversation.contextUsage ?? null;
  const contextWindowUsage = useMemo(() => toContextWindowSnapshot(contextUsage), [contextUsage]);

  return { onSend, contextWindowUsage };
}
