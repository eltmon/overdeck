/**
 * The Agents Directory row's state badge (PAN-3920) — the row's one colored
 * signal, in the VerbBadge vocabulary (8%/32% tint, square-ish corners, never
 * a pill). Blue = a machine is working, amber = a human must answer, red =
 * stuck or broken, emerald = done; idle, stopped and remote stay neutral.
 * Running is never green.
 */
import { cn } from '../../../lib/utils';
import type { DirectoryDisplayState } from './directory-state';

const TONE: Record<DirectoryDisplayState, string> = {
  working: 'badge-bg-info badge-border-info text-info-foreground',
  blocked: 'badge-bg-warning badge-border-warning text-warning-foreground',
  stuck: 'badge-bg-destructive badge-border-destructive text-destructive-foreground',
  'api-error': 'badge-bg-destructive badge-border-destructive text-destructive-foreground',
  done: 'badge-bg-success badge-border-success text-success-foreground',
  idle: 'badge-bg-muted badge-border-muted text-muted-foreground',
  stopped: 'bg-transparent border-muted-foreground/40 text-muted-foreground',
  remote: 'bg-transparent border-muted-foreground/40 text-muted-foreground',
  'no-status': 'bg-transparent border-muted-foreground/40 text-muted-foreground',
};

const LABEL: Record<DirectoryDisplayState, string> = {
  working: 'working',
  blocked: 'blocked',
  stuck: 'stuck',
  'api-error': 'API error',
  done: 'done',
  idle: 'idle',
  stopped: 'stopped',
  remote: 'remote',
  'no-status': 'no status',
};

export function directoryStateLabel(state: DirectoryDisplayState, stuckHours?: number): string {
  return state === 'stuck' && stuckHours !== undefined ? `stuck · ${stuckHours}h` : LABEL[state];
}

export function DirectoryStateBadge({ state, stuckHours, className }: {
  state: DirectoryDisplayState;
  /** Whole hours since the stuck agent's last activity. */
  stuckHours?: number;
  className?: string;
}) {
  return (
    <span
      data-component="directory-state-badge"
      data-state={state}
      className={cn(
        'inline-flex shrink-0 items-center gap-[5px] rounded-[var(--radius-sm)] border px-[6px] py-[2px] text-[10px] font-medium uppercase leading-none tracking-[0.05em]',
        TONE[state],
        className,
      )}
    >
      {state === 'working' && <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-current pulse" />}
      {directoryStateLabel(state, stuckHours)}
    </span>
  );
}
