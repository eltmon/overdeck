/**
 * PAN-4596: the panel view for an ended `--hold` successor whose kickoff was
 * never sent. Shows what the conversation waits for (focus, working
 * directory, handoff doc, the kickoff itself) and offers Start and Archive.
 * Start POSTs the kickoff door, which relaunches an ended session before it
 * delivers the kickoff. There is no Resume: a resume would start the agent
 * with a resume contract instead of its kickoff and leave the kickoff held.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { HeldKickoffConflictError, startHeldKickoff } from './heldKickoff';
import styles from '../CommandDeck/styles/command-deck.module.css';

export interface HeldHandoffViewProps {
  conversationName: string;
  kickoffText: string;
  focus?: string;
  cwd: string;
  handoffDocPath?: string | null;
  /** forkError of a failed previous Start (D4); omitted otherwise. */
  startError?: string | null;
  onStarted: () => void;
  onArchive?: () => void;
  archivePending?: boolean;
}

export function HeldHandoffView({
  conversationName,
  kickoffText,
  focus,
  cwd,
  handoffDocPath,
  startError,
  onStarted,
  onArchive,
  archivePending,
}: HeldHandoffViewProps) {
  const [starting, setStarting] = useState(false);

  const handleStart = async () => {
    setStarting(true);
    try {
      await startHeldKickoff(conversationName);
      onStarted();
    } catch (err) {
      if (err instanceof HeldKickoffConflictError) {
        toast.info('This handoff was already started');
        onStarted();
      } else {
        toast.error(err instanceof Error ? err.message : String(err), { duration: 8000 });
      }
    } finally {
      setStarting(false);
    }
  };

  const openHandoffDoc = () => {
    window.open(`/api/conversations/${encodeURIComponent(conversationName)}/handoff-doc`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className={styles.conversationEmptyState} data-testid="held-handoff-view">
      <p className={styles.conversationEmptyStateTitle}>Held handoff — kickoff not sent</p>
      <p className={styles.conversationEmptyStateSubtitle}>
        This conversation was created with <code>pan handoff --hold</code>. Its kickoff has not been sent. Start sends it
        and relaunches the session if it ended.
      </p>
      {focus && <p className={styles.conversationEmptyStateSubtitle}>Focus: {focus}</p>}
      <p className={styles.conversationEmptyStateSubtitle}>
        Working directory: <code>{cwd}</code>
      </p>
      {handoffDocPath && (
        <p className={styles.conversationEmptyStateSubtitle}>
          Handoff doc: <code>{handoffDocPath}</code>{' '}
          <button type="button" className={styles.conversationArchiveBtnLarge} onClick={openHandoffDoc}>
            Open handoff doc
          </button>
        </p>
      )}
      {startError && (
        <p className={styles.conversationEmptyStateSubtitle} style={{ color: 'var(--warning)' }}>
          The last start failed: {startError}
        </p>
      )}
      <details style={{ marginTop: 8, maxWidth: '100%' }}>
        <summary>Show the kickoff</summary>
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', textAlign: 'left' }}>{kickoffText}</pre>
      </details>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button
          type="button"
          className={styles.conversationArchiveBtnLarge}
          onClick={() => { void handleStart(); }}
          disabled={starting}
        >
          {starting ? 'Starting…' : 'Start'}
        </button>
        {onArchive && (
          <button type="button" className={styles.conversationArchiveBtnLarge} onClick={() => onArchive()} disabled={archivePending}>
            {archivePending ? 'Archiving…' : 'Archive'}
          </button>
        )}
      </div>
    </div>
  );
}

/** PAN-4596: the kickoff lookup failed, so the panel cannot tell whether an ended empty conversation is held. */
export function HeldKickoffLookupFailedView({ onRetry, onArchive, archivePending }: { onRetry: () => void; onArchive?: () => void; archivePending?: boolean }) {
  return (
    <div className={styles.conversationEmptyState} data-testid="held-kickoff-lookup-failed">
      <p className={styles.conversationEmptyStateTitle} style={{ color: 'var(--warning)' }}>
        ⚠ Couldn&apos;t check whether this conversation is waiting to start
      </p>
      <p className={styles.conversationEmptyStateSubtitle}>The kickoff lookup failed. Retry to check again.</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button type="button" className={styles.conversationArchiveBtnLarge} onClick={onRetry}>
          Retry
        </button>
        {onArchive && (
          <button type="button" className={styles.conversationArchiveBtnLarge} onClick={() => onArchive()} disabled={archivePending}>
            {archivePending ? 'Archiving…' : 'Archive'}
          </button>
        )}
      </div>
    </div>
  );
}
