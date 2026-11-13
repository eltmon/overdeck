/**
 * Shared viewer chrome (PAN-5188 D-9). Re-implements t3code's
 * fileSurfaceChrome.tsx exports (FileSurfaceNotice, FileSurfaceLoading,
 * FileSurfaceFailure, FileSurfaceAction) with Overdeck tokens and the shared
 * Tooltip. Notices stay muted unless a human must act (amber = warning).
 */
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

import { Tooltip, TooltipProvider } from '../../../shared/Tooltip';
import { cn } from '../../../../lib/utils';

export function ViewerNotice({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warning' }) {
  return (
    <div
      role="status"
      className={cn(
        'shrink-0 border-b px-3 py-1.5 text-[11px]',
        tone === 'warning'
          ? 'badge-bg-warning badge-border-warning text-warning-foreground'
          : 'border-border bg-card text-muted-foreground',
      )}
    >
      {children}
    </div>
  );
}

export function ViewerLoading({ label = 'Loading file' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground"
    >
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}

export function ViewerFailure({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-xs leading-relaxed"
    >
      <p className="text-destructive">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

/**
 * An icon button with a tooltip. `pressed` makes it a toggle (aria-pressed),
 * matching t3code's FileSurfaceAction. It carries its own TooltipProvider
 * because the dashboard mounts none at the root.
 */
export function ViewerAction({
  label,
  onClick,
  icon,
  pressed,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip content={label} side="bottom">
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1.5 text-muted-foreground',
            'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:pointer-events-none disabled:opacity-50',
            pressed ? 'bg-muted text-foreground' : '',
          )}
        >
          {icon ?? label}
        </button>
      </Tooltip>
    </TooltipProvider>
  );
}
