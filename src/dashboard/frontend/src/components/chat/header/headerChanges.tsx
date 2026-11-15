// The header's view of what a conversation changed (PAN-5291 D1-7, D1-8).
//
// Change data appears only inside a Stage: outside one there is no dock to
// open, so ConversationHeader mounts `StageHeaderChanges` only when the deck
// offers `openDock`. The query is the dock's own (`useConversationChanges`,
// scope 'conversation'), so the header, the Files tab dots and the Changes
// tab share one cache entry and one request.

import { useMemo, type ReactNode } from 'react';
import { FileDiff, Folder } from 'lucide-react';
import type { ConversationChanges } from '@overdeck/contracts';
import type { Conversation } from '../../CommandDeck/ConversationList';
import type { OpenDockInput } from '../../dock/workDockStore';
import { useConversationChanges } from '../../dock/useConversationChanges';
import { rootIdForConversation, useRootContext } from '../../explorer/rootForConversation';
import { currentPlatform, formatSpec } from '../../../lib/shortcuts/keys';
import styles from '../../CommandDeck/styles/command-deck.module.css';

export type HeaderTotals = ConversationChanges['totals'];

export interface HeaderChanges {
  /** null while the query loads, after it errors, or when the conversation cannot be queried. */
  totals: HeaderTotals | null;
  /** The deck's openDock (deck key bound). */
  openDock: (input: OpenDockInput) => void;
}

/** D1-8: the dock's own query, scope 'conversation'. */
export function useHeaderChanges(conversation: Conversation): HeaderTotals | null {
  const ctx = useRootContext();
  const rootId = useMemo(() => rootIdForConversation(conversation, ctx), [conversation, ctx]);
  // A synthetic row (id < 0) has no conversation row and the route 404s; a
  // linked or vault conversation is not on this machine's disk.
  const enabled = conversation.id >= 0 && conversation.origin !== 'linked' && conversation.origin !== 'vault';
  const { data } = useConversationChanges(conversation, 'conversation', { rootId, enabled });
  return enabled && data ? data.totals : null;
}

/** Mounted only inside a Stage (D1-7); renders `children(changes)`. */
export function StageHeaderChanges({
  conversation,
  openDock,
  children,
}: {
  conversation: Conversation;
  openDock: (input: OpenDockInput) => void;
  children: (changes: HeaderChanges) => ReactNode;
}) {
  const totals = useHeaderChanges(conversation);
  return <>{children({ totals, openDock })}</>;
}

/** The dock shortcut in keycap text, for the button titles (D1-13). */
function shortcutText(mac: string, other: string): string {
  const platform = currentPlatform();
  return formatSpec(platform === 'mac' ? mac : other, platform);
}

/** Changes `+a −d` and Files — they open the dock, they do not toggle it (D1-13, D1-14). */
export function HeaderDockButtons({ changes }: { changes: HeaderChanges }) {
  const { totals, openDock } = changes;
  const additions = totals?.additions ?? 0;
  const deletions = totals?.deletions ?? 0;
  const showNumbers = totals !== null && additions + deletions > 0;
  return (
    <>
      <button
        type="button"
        className={styles.conversationAboutToggle}
        onClick={() => openDock({ tab: 'changes', changesScope: 'conversation' })}
        title={`Show what this conversation changed (${shortcutText('Meta+Shift+G', 'Ctrl+Shift+G')})`}
        aria-label={showNumbers ? `Changes, ${additions} lines added, ${deletions} removed` : 'Changes'}
      >
        <FileDiff size={14} />
        <span>Changes</span>
        {showNumbers && (
          <span className="tabular-nums">
            <span className="text-success-foreground">+{additions}</span>{' '}
            <span className="text-destructive-foreground">{'−'}{deletions}</span>
          </span>
        )}
      </button>
      <button
        type="button"
        className={styles.conversationAboutToggle}
        onClick={() => openDock({ tab: 'files' })}
        title={`Show this conversation's files (${shortcutText('Meta+Shift+E', 'Ctrl+Shift+E')})`}
        aria-label="Files"
      >
        <Folder size={14} />
        <span>Files</span>
      </button>
    </>
  );
}
