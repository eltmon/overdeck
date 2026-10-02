import { Loader2, RefreshCw } from 'lucide-react';
import styles from '../CommandDeck/styles/command-deck.module.css';

/**
 * The "About this conversation" drawer beneath the conversation header: a
 * generated summary with a regenerate button. Extracted from ConversationPanel
 * (PAN-4455 D-20) so the panel stays within its file-size cap.
 */
export interface ConversationAboutDrawerProps {
  loading: boolean;
  error: boolean;
  summary: string | null;
  messageCount: number;
  refreshing: boolean;
  onRefresh: () => void;
}

export function ConversationAboutDrawer({ loading, error, summary, messageCount, refreshing, onRefresh }: ConversationAboutDrawerProps) {
  return (
    <div className={styles.conversationAboutDrawer}>
      {loading ? (
        <span className={styles.conversationAboutMuted}>
          <Loader2 size={12} className={styles.spinnerIcon} />
          Summarizing conversation…
        </span>
      ) : error ? (
        <span className={styles.conversationAboutMuted}>
          Couldn&apos;t load the conversation summary.
        </span>
      ) : summary ? (
        <>
          <p className={styles.conversationAboutText}>{summary}</p>
          <div className={styles.conversationAboutMeta}>
            <span>
              Summary of {messageCount}{' '}
              {messageCount === 1 ? 'message' : 'messages'}
            </span>
            <button
              className={styles.copyLinkButton}
              onClick={onRefresh}
              disabled={refreshing}
              title="Regenerate summary"
              aria-label="Regenerate conversation summary"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </>
      ) : (
        <span className={styles.conversationAboutMuted}>
          Not enough conversation yet to summarize.
        </span>
      )}
    </div>
  );
}
