import { Circle } from 'lucide-react';
import type { Conversation } from '../../CommandDeck/ConversationList';
import { ConversationMachineChip } from '../ConversationMachineBanner';
import { ConversationBranchMeta } from '../ConversationBranchMeta';
import type { HeaderChanges } from './headerChanges';
import styles from '../../CommandDeck/styles/command-deck.module.css';

export interface ConversationStatusLineProps {
  conversation: Conversation;
  status: { color: string; label: string; hollow: boolean };
  /** The phone app (PAN-4837): hide what its phone token cannot do. */
  native: boolean;
  /** Change data inside a Stage, else null (D1-7); the status-line parts that use it land with WI-8. */
  changes?: HeaderChanges | null;
}

/** Row 2 of the conversation header — read-only metadata. */
export function ConversationStatusLine({ conversation, status }: ConversationStatusLineProps) {
  return (
    <div className={styles.conversationMetaRow}>
      <span className={styles.conversationTerminalStatus}>
        <Circle size={7} style={{ fill: status.hollow ? 'transparent' : status.color, color: status.color }} />
        {status.label}
      </span>
      <ConversationBranchMeta conversation={conversation} />
      <ConversationMachineChip conversation={conversation} />
      {conversation.totalCost !== undefined && conversation.totalCost > 0 && (
        <>
          <span className={styles.conversationMetaSep} aria-hidden>·</span>
          <span className={styles.featureCost}>
            {conversation.totalCost < 0.01 ? '<$0.01' : `$${conversation.totalCost.toFixed(2)}`}
          </span>
        </>
      )}
    </div>
  );
}
