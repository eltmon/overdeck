/**
 * HarnessUpdateCard — a failed background coding-agent CLI update in Needs you
 * (PAN-5108). Non-blocking and in the "System" group: no agent waits on it,
 * and Overdeck retries at the next daily check. It shows the error tail and
 * the command to update by hand; there is nothing to answer or open.
 */
import type { Decision } from '../lib/useDecisions';
import styles from './styles/decisions.module.css';

/** The card shows this much of the update output. */
const ERROR_TAIL_CHARS = 300;

export function HarnessUpdateCard({ decision }: { decision: Decision }) {
  const failure = decision.harnessUpdate;
  if (!failure) return null;
  const error = failure.error.trim();
  const errorTail = error.length > ERROR_TAIL_CHARS ? `…${error.slice(-ERROR_TAIL_CHARS)}` : error;

  return (
    <div className={styles.row} data-testid="harness-update-card" data-decision-id={decision.id}>
      <div className={styles.rowMain}>
        <div className={styles.rowTop}>
          <span className={styles.badge}>{decision.label}</span>
        </div>
        <p className={styles.prompt}>{errorTail}</p>
        <p className={styles.meta}>
          Overdeck retries at the next daily check. To update now, run:{' '}
          <code className={styles.mono}>{failure.command}</code>
        </p>
      </div>
    </div>
  );
}
