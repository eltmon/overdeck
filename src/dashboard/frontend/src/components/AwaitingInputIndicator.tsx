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
  // The pulse is the whole point of the affordance — it is what catches the eye
  // across the room. It must not be dropped just because the icon is clickable;
  // a clickable indicator is the one the operator most needs to notice.
  const icon = (
    <TriangleAlert
      size={size}
      className={`text-amber-500 animate-pulse ${className ?? ''}`}
      aria-hidden="true"
    />
  );

  if (onClick) {
    const reopenLabel = `${label} — click to answer`;
    return (
      <button
        type="button"
        onClick={(e) => {
          // Rows are themselves clickable (select/navigate); reopening the
          // dialog must not also trigger the row's own handler.
          e.stopPropagation();
          onClick();
        }}
        title={reopenLabel}
        aria-label={reopenLabel}
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
