/**
 * PAN-2908 · C-SIMPLE — shared simple-mode presentational parts.
 * Copy comes from SIMPLE_STRINGS / userFacingDisplay (copy-linted catalogs);
 * no internal jargon in this file (guarded by simple-copy-lint).
 */
import type { ReactNode } from 'react';
import { Check, CircleHelp, LoaderCircle, PauseCircle } from 'lucide-react';
import type { PhaseRailState } from '../../lib/simple/phases';
import { PHASES } from '../../lib/simple/phases';
import type { UserFacingDisplay, UserFacingState } from '../../lib/simple/userFacingState';
import { SIMPLE_STRINGS } from '../../lib/simple/strings';
import { useUiMode, type UiMode } from '../../lib/simple/uiMode';
import { cn } from '../../lib/utils';

/* ── Mode toggle (Simple | Advanced) ─────────────────────────────────── */
export function ModeToggle() {
  const mode = useUiMode((s) => s.mode);
  const setMode = useUiMode((s) => s.setMode);
  const options: { id: UiMode; label: string }[] = [
    { id: 'simple', label: SIMPLE_STRINGS.mode.simple },
    { id: 'advanced', label: SIMPLE_STRINGS.mode.advanced },
  ];
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-input">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => setMode(o.id)}
          className={cn(
            'px-3 py-1.5 text-xs font-medium transition-colors',
            mode === o.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Progress steps: Started → Writing code → Checking → Ready ───────── */
const STEP_INDEX_BY_STATE: Record<UserFacingState, number> = {
  'not-started': 0,
  working: 1,
  'needs-you': 1,
  ready: 3,
  done: 4,
};

export function StepsTrack({ state }: { state: UserFacingState }) {
  const steps = SIMPLE_STRINGS.issue.steps;
  const current = STEP_INDEX_BY_STATE[state];
  return (
    <div className="mt-5 flex" role="list">
      {steps.map((name, i) => {
        const done = i < current || state === 'done';
        const now = i === current && state !== 'done' && state !== 'ready';
        const last = i === steps.length - 1;
        return (
          <div key={name} role="listitem" className="relative flex-1 pt-3.5 text-center">
            <span
              className={cn(
                'absolute left-0 right-0 top-[5px] h-0.5',
                i === 0 && 'left-1/2',
                last && 'right-1/2',
                done || now ? 'bg-success' : 'bg-muted',
              )}
            />
            <span
              className={cn(
                'absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rounded-full border-2',
                done && 'border-transparent bg-success',
                now && 'border-transparent bg-info shadow-[0_0_0_3px] shadow-info/25',
                !done && !now && 'border-border bg-muted',
              )}
            />
            <span
              className={cn(
                'text-[11.5px]',
                done && 'text-success-foreground',
                now && 'font-medium text-foreground',
                !done && !now && 'text-muted-foreground',
              )}
            >
              {name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Status card ─────────────────────────────────────────────────────── */
const STATUS_TONE: Record<UserFacingState, { ring: string; iconBg: string; icon: ReactNode }> = {
  'not-started': {
    ring: 'border-border',
    iconBg: 'bg-muted text-muted-foreground',
    icon: <PauseCircle size={15} />,
  },
  working: {
    ring: 'border-info/30',
    iconBg: 'bg-info/10 text-info-foreground',
    icon: <LoaderCircle size={15} />,
  },
  'needs-you': {
    ring: 'border-warning/40',
    iconBg: 'bg-warning/10 text-warning-foreground',
    icon: <CircleHelp size={15} />,
  },
  ready: {
    ring: 'border-success/40',
    iconBg: 'bg-success/10 text-success-foreground',
    icon: <Check size={15} />,
  },
  done: {
    ring: 'border-border',
    iconBg: 'bg-success/10 text-success-foreground',
    icon: <Check size={15} />,
  },
};

export function StatusCard({ display, children }: { display: UserFacingDisplay; children?: ReactNode }) {
  const tone = STATUS_TONE[display.state];
  return (
    <div className={cn('mt-4 rounded-2xl border bg-card p-4 shadow-sm', tone.ring)}>
      <div className="flex items-center gap-3">
        <span className={cn('flex h-8 w-8 flex-none items-center justify-center rounded-full', tone.iconBg)}>
          {tone.icon}
        </span>
        <div>
          <div className="text-[15px] font-medium">{display.title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{display.sentence}</div>
        </div>
      </div>
      {children && <div className="mt-3.5 flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/* ── Thin progress bar ───────────────────────────────────────────────── */
export function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-accent" aria-label={`${completed} of ${total}`}>
      <div className="h-full rounded-full bg-info" style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ── Small buttons with simple-mode shapes ───────────────────────────── */
export function PrimaryButton({ children, onClick, disabled, tone = 'primary' }: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'success';
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-9 items-center rounded-lg px-4 text-[13.5px] font-medium text-white transition-opacity',
        tone === 'success' ? 'bg-success text-[#04120c]' : 'bg-primary text-primary-foreground',
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:opacity-90',
      )}
    >
      {children}
    </button>
  );
}

export function QuietButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-9 items-center rounded-lg border border-input px-4 text-[13.5px] font-medium text-muted-foreground transition-colors',
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/* Re-export rail type for page components. */
export type { PhaseRailState };
export { PHASES };
