import type { CSSProperties } from 'react';
import type { GodViewActivityEvent } from '../../../hooks/useGodViewSocket';

export interface FeedTooltipAnchor {
  left: number;
  top: number;
}

interface FeedTooltipProps {
  event: GodViewActivityEvent;
  anchor: FeedTooltipAnchor;
}

export function FeedTooltip({ event, anchor }: FeedTooltipProps) {
  const style: CSSProperties = {
    left: Math.max(8, anchor.left - 288),
    top: Math.max(8, anchor.top),
  };

  return (
    <div
      role="tooltip"
      aria-label={`${event.issueId} activity details`}
      className="fixed z-50 w-[280px] pointer-events-none rounded-xl border border-white/10 bg-[#0d1220]/95 p-3 shadow-2xl backdrop-blur-md"
      style={style}
    >
      <div className="flex items-center gap-2">
        <strong className="gv-mono text-xs" style={{ color: 'var(--gv-blue)' }}>{event.issueId}</strong>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--gv-text-secondary)' }}>
          {event.source}
        </span>
      </div>
      <p className="mt-2 whitespace-normal break-words text-[11px] leading-relaxed" style={{ color: 'var(--gv-text-primary)' }}>
        {event.message}
      </p>
      <time dateTime={event.timestamp} className="mt-2 block text-[9px] gv-mono" style={{ color: 'var(--gv-text-dim)' }}>
        {new Date(event.timestamp).toLocaleString()}
      </time>
    </div>
  );
}
