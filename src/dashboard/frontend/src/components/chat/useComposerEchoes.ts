import { useEffect } from 'react';
import type { ChatMessage } from './chat-types';
import { useComposerStore, useConversationOptimistic, useConversationFailed } from '../../lib/composerStore';
import { TURN_STALL_MS } from '../../lib/workingPhase';

/** A display delay cannot prove delivery failed, even across compaction boundaries. */
export function useComposerEchoes(conversationName: string, messages: ChatMessage[]) {
  const optimistic = useConversationOptimistic(conversationName);
  const failed = useConversationFailed(conversationName);
  const reconcile = useComposerStore((state) => state.reconcileEchoes);
  const markUnknown = useComposerStore((state) => state.markDeliveryUnknown);
  useEffect(() => {
    reconcile(conversationName, messages);
  }, [conversationName, messages, optimistic, failed, reconcile]);
  useEffect(() => {
    const pending = optimistic.find((message) => !message.acknowledged && message.deliveryState !== 'unknown');
    if (!pending) return;
    const timer = setTimeout(() => markUnknown(conversationName, pending.id),
      Math.max(0, Date.parse(pending.createdAt) + TURN_STALL_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [conversationName, optimistic, markUnknown]);
  return optimistic;
}
