/**
 * PAN-4641 WI-13: above the composer while the conversation is stopped on a
 * usage limit — when it resets, and a button that queues the typed message on
 * the server to send then.
 */
import styles from '../CommandDeck/styles/command-deck.module.css';
import { limitWindowLabel, type ConversationLimitState } from './scheduledMessages';

const BUTTON = 'rounded-[var(--radius-sm)] border border-border px-2 py-0.5 text-[12px] hover:bg-accent';

export function LimitResetNotice({ limit, onSchedule, disabled }: {
  limit: ConversationLimitState | null;
  onSchedule: () => void;
  disabled?: boolean;
}) {
  if (!limit?.limited) return null;
  const label = limit.resetsAt
    ? `Your ${limitWindowLabel(limit.window)} resets at about ${new Date(limit.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}.`
    : 'This conversation hit a usage limit; the reset time is unknown.';
  return (
    <div className={styles.composerBox} role="status" data-testid="limit-reset-notice">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2 text-[13px]">
        <p className="text-muted-foreground">{label}</p>
        <button type="button" className={BUTTON} onClick={onSchedule} disabled={disabled}>
          Send when limits reset
        </button>
      </div>
    </div>
  );
}
