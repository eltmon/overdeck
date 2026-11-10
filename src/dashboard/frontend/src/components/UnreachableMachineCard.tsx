/**
 * UnreachableMachineCard — the "Can't reach" Needs-you card (PAN-5111 WI-10).
 *
 * Never the generic DecisionRow: there is no agent to answer. This machine
 * could not fetch a linked machine's Needs-You, so that machine may have items
 * waiting that this list cannot show. The card goes away on its own when a
 * fetch succeeds, the link is removed, or no fetch has failed for an hour.
 */
import { formatRelativeTime } from '../lib/dashboard-utils';
import { openSettingsSection } from '../lib/settingsSection';
import type { Decision } from '../lib/useDecisions';
import styles from './styles/decisions.module.css';

export function UnreachableMachineCard({ decision }: { decision: Decision }) {
  const row = decision.unreachableMachine;
  if (!row) return null;
  return (
    <div className={styles.row} data-testid="unreachable-machine-card" data-decision-id={decision.id}>
      <div className={styles.rowMain}>
        <div className={styles.rowTop}>
          <span className={styles.badge}>{decision.label}</span>
        </div>
        <p className={styles.prompt}>{`Can't reach ${row.label}; it may have items waiting.`}</p>
        <p className={styles.meta}>{`${row.reason} · since ${formatRelativeTime(row.since)}`}</p>
      </div>
      <button type="button" className={styles.answer} onClick={() => openSettingsSection('anywhere')}>
        Open Machines
      </button>
    </div>
  );
}
