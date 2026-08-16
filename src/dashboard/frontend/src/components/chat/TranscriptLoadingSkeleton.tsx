import styles from '../CommandDeck/styles/command-deck.module.css';

export function TranscriptLoadingSkeleton({ discovering }: { discovering: boolean }) {
  return (
    <div
      className={styles.conversationConnecting}
      role="status"
      aria-label={discovering ? 'Discovering conversation' : 'Loading conversation'}
    >
      <div className={styles.transcriptSkeleton} aria-hidden="true">
        <div className={styles.transcriptSkeletonAssistant}>
          <span className={styles.transcriptSkeletonAvatar} />
          <div className={styles.transcriptSkeletonLines}>
            <span className={styles.transcriptSkeletonLine} />
            <span className={styles.transcriptSkeletonLineShort} />
          </div>
        </div>
        <div className={styles.transcriptSkeletonUser}>
          <span className={styles.transcriptSkeletonBubble} />
        </div>
        <div className={styles.transcriptSkeletonAssistant}>
          <span className={styles.transcriptSkeletonAvatar} />
          <div className={styles.transcriptSkeletonLines}>
            <span className={styles.transcriptSkeletonLineMedium} />
            <span className={styles.transcriptSkeletonLineShort} />
          </div>
        </div>
        <div className={styles.transcriptSkeletonUser}>
          <span className={styles.transcriptSkeletonBubbleShort} />
        </div>
      </div>
      {discovering && <span>Discovering conversation…</span>}
    </div>
  );
}
