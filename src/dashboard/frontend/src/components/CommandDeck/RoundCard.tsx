import { useState } from 'react';

/**
 * <RoundCard round active onClick /> — 140-wide mini card for a review round.
 *
 * - Shows round number, verdict, finding count, duration, cost.
 * - Active rounds get the kf-round-active sweep animation (anim-round-active utility).
 * - Click is optional; cursor changes to pointer when handler provided.
 */

export type RoundVerdict = 'pending' | 'passed' | 'failed' | 'running';

export interface RoundData {
  round: number;
  verdict: RoundVerdict;
  findings?: number;
  duration?: number | null;
  cost?: number | null;
}

interface RoundCardProps {
  round: RoundData;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}

const VERDICT_COLOR: Record<RoundVerdict, string> = {
  pending: 'var(--muted-foreground)',
  passed: 'var(--success)',
  failed: 'var(--destructive)',
  running: 'var(--primary)',
};

const VERDICT_LABEL: Record<RoundVerdict, string> = {
  pending: 'Pending',
  passed: 'Passed',
  failed: 'Failed',
  running: 'Running',
};

function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function fmtCost(cost: number | null | undefined): string {
  if (cost == null) return '—';
  return `$${cost.toFixed(2)}`;
}

export function RoundCard({ round, active = false, onClick, className }: RoundCardProps) {
  const [hover, setHover] = useState(false);
  const verdictColor = VERDICT_COLOR[round.verdict];
  const interactive = !!onClick;
  const baseClass = active ? 'anim-round-active' : '';

  return (
    <div
      data-testid="round-card"
      data-round={round.round}
      data-verdict={round.verdict}
      data-active={active || undefined}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={[baseClass, className].filter(Boolean).join(' ')}
      style={{
        width: 140,
        padding: '8px 10px',
        borderRadius: 8,
        border: `1px solid ${active ? verdictColor : 'var(--border)'}`,
        background: active ? undefined : hover ? 'var(--accent)' : 'var(--card)',
        cursor: interactive ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontSize: 12,
        lineHeight: 1.3,
        color: 'var(--foreground)',
        transition: 'background 150ms ease-out, border-color 150ms ease-out',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontWeight: 600 }}>Round {round.round}</span>
        <span
          style={{
            color: verdictColor,
            fontWeight: 600,
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {VERDICT_LABEL[round.verdict]}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          color: 'var(--muted-foreground)',
          fontSize: 11,
        }}
      >
        {typeof round.findings === 'number' && (
          <span data-testid="round-card-findings">{round.findings} finding{round.findings === 1 ? '' : 's'}</span>
        )}
        <span data-testid="round-card-duration">{fmtDuration(round.duration)}</span>
        <span data-testid="round-card-cost">{fmtCost(round.cost)}</span>
      </div>
    </div>
  );
}
