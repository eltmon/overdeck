/**
 * PAN-4278 — release composer messages held behind a permission prompt.
 *
 * The composer route answers 409 `permission-pending` while a conversation's
 * pane shows a permission prompt, and the composer keeps that message as a
 * 'held' bubble. This hook watches the pending-input feed: once a feed read
 * NEWER than the hold shows no on-screen (answerable) pendingPermission for
 * the conversation, it resends the held messages. Requiring a newer read keeps a stale feed from releasing — and
 * re-holding — in a loop. Held bubbles live in memory only: a page reload
 * drops them.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchConversationPendingInput } from '../../lib/useDecisions';
import { useComposerStore } from '../../lib/composerStore';

export function useHeldMessageRelease(): void {
  const { data: rows = [], dataUpdatedAt } = useQuery({
    queryKey: ['conv-ask-user-question'],
    queryFn: ({ signal }) => fetchConversationPendingInput(signal),
    refetchInterval: 4000,
  });
  const byConversation = useComposerStore((s) => s.byConversation);
  const releaseHeld = useComposerStore((s) => s.releaseHeld);

  useEffect(() => {
    // Only a prompt on screen blocks (Decision 11): a registry-only entry
    // (answerable: false) can be stale — no hook clears a main-thread Deny — and
    // the server re-holds with a second 409 if the prompt really is back.
    const blocked = new Set(
      (Array.isArray(rows) ? rows : []).filter((row) => row.pendingPermission?.answerable).map((row) => row.name),
    );
    for (const [conversationName, slice] of Object.entries(byConversation)) {
      const held = slice.optimistic.filter((message) => message.deliveryState === 'held');
      if (held.length === 0 || blocked.has(conversationName)) continue;
      const newestHold = Math.max(...held.map((message) => message.heldAt ?? 0));
      if (dataUpdatedAt <= newestHold) continue;
      void releaseHeld(conversationName);
    }
  }, [byConversation, dataUpdatedAt, releaseHeld, rows]);
}
