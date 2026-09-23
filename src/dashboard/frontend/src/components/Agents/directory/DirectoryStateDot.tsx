/**
 * The Agents Directory row's only colored signal (PAN-3920 W6).
 * Blue = a machine is working, amber = a human must act, emerald = outcome;
 * idle, stopped and unknown stay neutral.
 */
import type { DirectoryEntryState } from '@overdeck/contracts';

import { cn } from '../../../lib/utils';

const DOT_CLASS: Record<DirectoryEntryState, string> = {
  working: 'bg-info',
  blocked: 'bg-warning',
  done: 'bg-success',
  idle: 'bg-muted-foreground',
  stopped: 'bg-muted-foreground/50',
  unknown: 'bg-muted-foreground/50',
};

export function DirectoryStateDot({ state, className }: { state: DirectoryEntryState; className?: string }) {
  return (
    <span
      role="img"
      aria-label={state}
      title={state}
      data-component="directory-state-dot"
      data-state={state}
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', DOT_CLASS[state], className)}
    />
  );
}
