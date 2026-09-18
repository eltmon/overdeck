/**
 * ShipProgress (PAN-2499 WI-3, re-pointed by PAN-3917) — the merge gate.
 *
 * The merge door writes no record, so this shows what the forge says: whether
 * the PR is open, whether its checks are green, whether it is mergeable, and
 * whether it merged.
 *
 * compact=true  → rail row: icon + "Ship" + one line (used in FeatureItem).
 * compact=false → cockpit/console: status badge and PR facts.
 */
import { CircleCheck, CircleDot, CircleX } from 'lucide-react';
import type { IssueShipModel } from './types';
import cockpitStyles from '../Stage/cockpit/shipTab.module.css';
import railStyles from '../CommandDeck/styles/command-deck.module.css';

interface ShipProgressProps {
  ship: IssueShipModel;
  compact?: boolean;
  onClick?: () => void;
}

function summary(ship: IssueShipModel): string {
  if (ship.status === 'merged') return 'Merged to main';
  if (ship.status === 'ready') return 'Approved, green, and mergeable';
  if (!ship.prUrl) return 'No pull request yet';
  return ship.blockerReason ?? 'Waiting on the forge';
}

export function ShipProgress({ ship, compact = false, onClick }: ShipProgressProps) {
  const merged = ship.status === 'merged';
  const ready = ship.status === 'ready';
  const blocked = ship.checks === 'red' || ship.mergeable === false;

  if (compact) {
    // The rail row is only interesting once the forge has something to say.
    if (!merged && !ready && !blocked) return null;

    return (
      <div className={railStyles.sessionList} data-section="ship-progress-compact">
        <button
          type="button"
          className={railStyles.sessionNode}
          onClick={onClick}
          title="The merge gate for this issue — click to open its cockpit"
          data-testid="ship-door-row"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {merged ? (
            <CircleCheck size={12} style={{ color: 'var(--success)', flexShrink: 0 }} />
          ) : blocked ? (
            <CircleX size={12} style={{ color: 'var(--destructive)', flexShrink: 0 }} />
          ) : (
            <CircleDot size={12} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
          )}
          <span style={{ fontSize: 12, fontWeight: 500 }}>Ship</span>
          <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{summary(ship)}</span>
        </button>
      </div>
    );
  }

  return (
    <div className={cockpitStyles.wrap} data-section="ship-progress-full">
      <div className={cockpitStyles.header}>
        <span className={cockpitStyles.title}>Ship — merge gate</span>
        <span
          data-ship-status={ship.status}
          className={`${cockpitStyles.badge} ${merged ? cockpitStyles.ok : blocked ? cockpitStyles.bad : cockpitStyles.idle}`}
        >
          {ship.status}
        </span>
      </div>

      <dl className={cockpitStyles.steps} data-section="ship-progress-facts">
        <div className={cockpitStyles.step} data-step-key="pr">
          <span className={cockpitStyles.stepLabel}>Pull request</span>
          <span className={cockpitStyles.stepLabel}>
            {ship.prUrl
              ? <a href={ship.prUrl} target="_blank" rel="noreferrer">#{ship.prNumber ?? '—'}</a>
              : 'none'}
          </span>
        </div>
        <div className={cockpitStyles.step} data-step-key="checks" data-step-state={ship.checks ?? 'pending'}>
          <span className={cockpitStyles.stepLabel}>Checks</span>
          <span className={cockpitStyles.stepLabel}>{ship.checks ?? '—'}</span>
        </div>
        <div className={cockpitStyles.step} data-step-key="mergeable">
          <span className={cockpitStyles.stepLabel}>Mergeable</span>
          <span className={cockpitStyles.stepLabel}>
            {ship.mergeable === undefined ? '—' : ship.mergeable ? 'yes' : 'no'}
          </span>
        </div>
      </dl>

      <p className={cockpitStyles.empty} data-section="ship-progress-summary">{summary(ship)}</p>
    </div>
  );
}
