/**
 * ShipProgress (PAN-2499 WI-3) — shared merge-door progress indicator.
 *
 * compact=true  → rail row: icon + "Ship" + current step (used in FeatureItem).
 * compact=false → cockpit/console: status badge, step indicator, live log stream.
 */
import { Circle, CircleCheck, CircleX, Loader2 } from 'lucide-react';
import type { IssueShipModel } from './types';
import cockpitStyles from '../Stage/cockpit/shipTab.module.css';
import railStyles from '../CommandDeck/styles/command-deck.module.css';

interface ShipProgressProps {
  ship: IssueShipModel;
  compact?: boolean;
  onClick?: () => void;
}

export const SHIP_STEPS: Array<{ key: string; label: string; matches: string[] }> = [
  { key: 'rebasing', label: 'Rebase onto main', matches: ['rebasing'] },
  { key: 'verifying', label: 'Verify (quality gates)', matches: ['verifying', 'validating-pr'] },
  { key: 'squash-merging', label: 'Merge PR', matches: ['squash-merging', 'merging'] },
  { key: 'post-merge-cleanup', label: 'Post-merge cleanup', matches: ['post-merge-cleanup'] },
];

function stepIndex(step: string | null | undefined): number {
  if (!step) return -1;
  return SHIP_STEPS.findIndex((s) => s.matches.includes(step));
}

function currentStepLabel(ship: IssueShipModel): string {
  const idx = stepIndex(ship.mergeStep);
  if (idx >= 0) return SHIP_STEPS[idx]!.label;
  return ship.mergeStep ?? ship.status;
}

export function ShipProgress({ ship, compact = false, onClick }: ShipProgressProps) {
  const { status, mergeStep, log } = ship;
  const active = status === 'merging' || status === 'verifying';
  const failed = status === 'failed';
  const merged = status === 'merged';
  const current = stepIndex(mergeStep);
  const lines = log?.lines ?? [];

  if (compact) {
    // The rail row is only interesting while the door is working or terminal.
    if (!active && !merged && !failed) return null;

    return (
      <div className={railStyles.sessionList} data-section="ship-progress-compact">
        <button
          type="button"
          className={railStyles.sessionNode}
          onClick={onClick}
          title="The merge door is working this issue — click to open its cockpit (Ship tab shows the live log)"
          data-testid="ship-door-row"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {merged ? (
            <CircleCheck size={12} style={{ color: 'var(--success)', flexShrink: 0 }} />
          ) : failed ? (
            <CircleX size={12} style={{ color: 'var(--destructive)', flexShrink: 0 }} />
          ) : (
            <Loader2 size={12} className={railStyles.spinning} style={{ color: 'var(--primary)', flexShrink: 0 }} />
          )}
          <span style={{ fontSize: 12, fontWeight: 500 }}>Ship</span>
          <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{currentStepLabel(ship)}</span>
        </button>
      </div>
    );
  }

  return (
    <div className={cockpitStyles.wrap} data-section="ship-progress-full">
      <div className={cockpitStyles.header}>
        <span className={cockpitStyles.title}>Ship — merge door</span>
        <span
          className={`${cockpitStyles.badge} ${
            merged ? cockpitStyles.ok : failed ? cockpitStyles.bad : active ? cockpitStyles.run : cockpitStyles.idle
          }`}
        >
          {merged ? 'merged' : failed ? 'failed' : active ? status : status ?? 'idle'}
        </span>
      </div>

      <div className={cockpitStyles.steps} data-section="ship-progress-steps">
        {SHIP_STEPS.map((s, i) => {
          const done = merged ? true : current > i;
          const isCurrent = !merged && current === i;
          let stepState: 'done' | 'current' | 'pending' = 'pending';
          if (done) stepState = 'done';
          else if (isCurrent) stepState = 'current';

          return (
            <div
              key={s.key}
              className={cockpitStyles.step}
              data-section="ship-progress-step"
              data-step-key={s.key}
              data-step-state={stepState}
            >
              <span className={cockpitStyles.stepIcon}>
                {done ? (
                  <CircleCheck size={13} className={cockpitStyles.okIcon} />
                ) : isCurrent && failed ? (
                  <CircleX size={13} className={cockpitStyles.badIcon} />
                ) : isCurrent && active ? (
                  <Loader2 size={13} className={cockpitStyles.spin} />
                ) : (
                  <Circle size={13} className={cockpitStyles.idleIcon} />
                )}
              </span>
              <span className={`${cockpitStyles.stepLabel} ${isCurrent ? cockpitStyles.stepCurrent : ''}`}>
                {s.label}
              </span>
              {i < SHIP_STEPS.length - 1 ? <span className={cockpitStyles.stepBar} /> : null}
            </div>
          );
        })}
      </div>

      <div className={cockpitStyles.log} data-section="ship-progress-log">
        {lines.length === 0 ? (
          <div className={cockpitStyles.empty}>
            {active
              ? 'Waiting for door output…'
              : 'No ship activity yet this session. Logs appear here live when a merge runs (the merge door is server-side — rebase, quality gates, PR merge, cleanup).'}
          </div>
        ) : (
          lines.map((e, i) => (
            <div key={i} className={cockpitStyles.logLine}>
              <span className={cockpitStyles.logTs}>{e.ts.slice(11, 19)}</span>
              <span className={cockpitStyles.logText}>{e.line}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
