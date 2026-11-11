/**
 * DiskAlertCard — the disk alert's own Needs-you card (PAN-5093 WI-6).
 *
 * Never the generic DecisionRow: there is no agent to Answer, and the
 * "Blocking work" hint ("An agent has stopped") would be false here — disk
 * space is freed on the machine itself, not by answering a question.
 */
import type { Decision } from '../lib/useDecisions';
import styles from './styles/decisions.module.css';

const GIB = 1024 ** 3;

function formatGib(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} GiB`;
}

/** The watched directory is almost always `~/.overdeck`; show it that way when it is. */
function displayPath(path: string): string {
  return path.endsWith('/.overdeck') ? '~/.overdeck' : path;
}

function openResources(): void {
  window.history.pushState(null, '', '/resources');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function DiskAlertCard({ decision }: { decision: Decision }) {
  const snapshot = decision.diskAlert;
  if (!snapshot) return null;

  const critical = snapshot.level === 'critical';
  const thresholdGib = formatGib(critical ? snapshot.criticalBytes : snapshot.warningBytes);
  const freeLine = snapshot.availableBytes !== null && snapshot.totalBytes !== null
    ? `${formatGib(snapshot.availableBytes)} free of ${formatGib(snapshot.totalBytes)} on ${displayPath(snapshot.path)} — `
      + `${critical ? 'critical' : 'alert'} below ${thresholdGib}`
    : `Free space unknown on ${displayPath(snapshot.path)}`;

  return (
    <div
      className={`${styles.row} ${critical ? styles.rowBlocking : ''}`}
      data-testid="disk-alert-card"
      data-decision-id={decision.id}
      data-blocking={critical ? 'true' : undefined}
    >
      <div className={styles.rowMain}>
        <div className={styles.rowTop}>
          <span className={`${styles.badge} ${critical ? styles.badgeBlocking : ''}`}>{decision.label}</span>
        </div>
        <p className={styles.prompt}>{freeLine}</p>
        {snapshot.measuring && <p className={styles.meta}>Measuring space holders…</p>}
        {snapshot.holders?.incomplete && <p className={styles.meta}>Some sizes timed out.</p>}
        {snapshot.holders && snapshot.holders.holders.length > 0 && (
          <ul className={styles.holderList}>
            {snapshot.holders.holders.map((holder) => (
              <li key={holder.label} className={styles.holderRow}>
                <span>{holder.label}</span>
                <span className={styles.mono}>{formatGib(holder.bytes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className={styles.answer} onClick={openResources}>
        Open Resources
      </button>
    </div>
  );
}
