/**
 * AwaitingInputIndicator — the one uniform "this agent/conversation is waiting
 * on you" affordance (PAN-1520). A pulsing triangle-exclamation used everywhere
 * a blocking surface is open: kanban card, Command Deck row, conversation /
 * session header, fleet card. Tooltip names which kind(s) are waiting.
 *
 * Before this, each surface re-implemented its own dot/triangle + kind→label
 * map, and they had drifted. This is the single visual source of truth; the
 * label text comes from lib/pendingInput.
 */
import { TriangleAlert } from 'lucide-react';
import { describePendingInput } from '../lib/pendingInput';

interface AwaitingInputIndicatorProps {
  /** The active blocking-surface kinds (askUserQuestion, permissionRequest, …). */
  kinds?: ReadonlyArray<string>;
  /** Pixel size of the icon. Defaults to 14. */
  size?: number;
  /** Optional click handler — when provided, renders as a button (re-open). */
  onClick?: () => void;
  className?: string;
}

export function AwaitingInputIndicator({ kinds, size = 14, onClick, className }: AwaitingInputIndicatorProps) {
  const label = describePendingInput(kinds);
  const icon = (
    <TriangleAlert
      size={size}
      className={`text-amber-500 ${onClick ? '' : 'animate-pulse'} ${className ?? ''}`}
      aria-hidden="true"
    />
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        className="inline-flex items-center justify-center rounded p-0.5 text-amber-500 transition-colors hover:bg-amber-500/15"
      >
        {icon}
      </button>
    );
  }

  return (
    <span title={label} aria-label={label} style={{ display: 'inline-flex' }}>
      {icon}
    </span>
  );
}
