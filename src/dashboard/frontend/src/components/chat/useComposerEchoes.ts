import { useEffect } from 'react';
import type { ChatMessage, SubagentSummary } from './chat-types';
import { useComposerStore, useConversationOptimistic, useConversationFailed } from '../../lib/composerStore';
import { TURN_STALL_MS } from '../../lib/workingPhase';

/**
 * A display delay alone cannot prove delivery failed, even across compaction
 * boundaries — so an accepted bubble only ever moves to the not-found outbox
 * after it stays unmatched for TURN_STALL_MS AND the conversation is not
 * streaming (a message queued behind a long tool call is legitimately
 * unrendered until consumed) (PAN-4247).
 */
export function useComposerEchoes(
  conversationName: string,
  messages: ChatMessage[],
  subagents: SubagentSummary[] = [],
  streaming = false,
) {
  const optimistic = useConversationOptimistic(conversationName);
  const failed = useConversationFailed(conversationName);
  const reconcile = useComposerStore((state) => state.reconcileEchoes);
  const markUnknown = useComposerStore((state) => state.markDeliveryUnknown);
  const markNotFoundInTranscript = useComposerStore((state) => state.markNotFoundInTranscript);
  useEffect(() => {
    reconcile(conversationName, messages, subagents);
  }, [conversationName, messages, subagents, optimistic, failed, reconcile]);
  useEffect(() => {
    // A held message (PAN-4278) is waiting on purpose, not stalled.
    const pending = optimistic.find((message) => !message.acknowledged && message.deliveryState !== 'unknown' && message.deliveryState !== 'held');
    if (!pending) return;
    const timer = setTimeout(() => markUnknown(conversationName, pending.id),
      Math.max(0, Date.parse(pending.createdAt) + TURN_STALL_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [conversationName, optimistic, markUnknown]);
  // A message queued behind a long tool call is legitimately unrendered until
  // consumed — gate on `streaming` so a busy conversation never mislabels a
  // message that's simply waiting its turn (PAN-4247).
  useEffect(() => {
    if (streaming) return;
    const pending = optimistic.find((message) => message.acknowledged && message.deliveryState === 'accepted');
    if (!pending) return;
    const timer = setTimeout(() => markNotFoundInTranscript(conversationName, pending.id),
      Math.max(0, Date.parse(pending.createdAt) + TURN_STALL_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [conversationName, optimistic, streaming, markNotFoundInTranscript]);
  return optimistic;
}
