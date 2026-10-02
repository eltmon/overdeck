import styles from '../CommandDeck/styles/command-deck.module.css';
import type { Conversation } from '../CommandDeck/ConversationList';
import { useConversationMutations } from '../CommandDeck/useConversationMutations';
import { useHandoffNoticeStore } from './continueOnDevice/handoffNoticeStore';

const BUTTON = 'rounded-[var(--radius-sm)] border border-border px-2 py-0.5 text-[12px] hover:bg-accent';

/**
 * PAN-4455 FR-13, D-15: after this browser handed a live conversation off to
 * the Session Vault, new messages typed here would be saved as a separate copy.
 * The notice says so until the operator keeps working here or stops the session.
 */
export function HandoffNotice({ conversation, at }: { conversation: Conversation; at: string }) {
  const clear = useHandoffNoticeStore((state) => state.clear);
  const mutations = useConversationMutations(conversation.name, () => {});
  const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className={styles.composerBox} role="status" data-testid="handoff-notice">
      <p>{`Handed off at ${time}. New messages here will be saved as a separate copy.`}</p>
      <p className="flex gap-2">
        <button type="button" className={BUTTON} onClick={() => clear(conversation.name)}>
          Keep working here
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={() => {
            mutations.stop(conversation.name);
            clear(conversation.name);
          }}
        >
          Stop this session
        </button>
      </p>
    </div>
  );
}
