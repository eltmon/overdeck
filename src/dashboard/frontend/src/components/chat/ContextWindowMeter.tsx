/**
 * ContextWindowMeter — compact circular ring showing context-window usage,
 * placed next to the send button in the composer toolbar.
 *
 * Ported visually from t3code's apps/web/src/components/chat/ContextWindowMeter.tsx
 * so future updates port cleanly. Differences from upstream:
 *
 *   - Data: t3code threads `ContextWindowSnapshot` from an activity stream
 *     event; we adapt our server-side `ContextUsage` payload via
 *     `toContextWindowSnapshot()` in lib/contextWindow.ts. Field names match.
 *   - Hover detail: t3code wraps the trigger in `<Popover>`/`<PopoverPopup>`
 *     to show a multi-line detail block. We don't have shared popover
 *     primitives yet — using native `title` (single-line tooltip) for now.
 *     When a Popover primitive lands, swap the wrapper without touching the
 *     SVG / data path.
 *   - Tone coloring: we tint the progress stroke green/yellow/red based on
 *     usage (<50 / 50–80 / >80). Upstream uses a single muted color. Keep
 *     this divergence; it's a deliberate extension.
 *
 * Geometry mirrors upstream exactly: 24×24 svg, viewBox 0 0 24 24, radius
 * 9.75, two stroke-3 circles, -rotate-90 to start the arc at 12 o'clock.
 */

import type { ContextWindowSnapshot } from '../../lib/contextWindow';
import { formatContextWindowTokens } from '../../lib/contextWindow';
import styles from './ContextWindowMeter.module.css';

interface ContextWindowMeterProps {
  usage: ContextWindowSnapshot | null;
}

type UsageTone = 'low' | 'medium' | 'high';

function getUsageTone(usedPercentage: number): UsageTone {
  if (usedPercentage < 50) return 'low';
  if (usedPercentage <= 80) return 'medium';
  return 'high';
}

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, '')}%`;
  }
  return `${Math.round(value)}%`;
}

const RADIUS = 9.75;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ContextWindowMeter({ usage }: ContextWindowMeterProps) {
  if (!usage) return null;

  const normalizedPercentage =
    usage.usedPercentage !== null ? Math.max(0, Math.min(100, usage.usedPercentage)) : 0;
  const tone = getUsageTone(normalizedPercentage);
  const dashOffset = CIRCUMFERENCE - (normalizedPercentage / 100) * CIRCUMFERENCE;
  const formattedPercent = formatPercentage(usage.usedPercentage);

  // Single-line title until a Popover primitive exists. Keep the same content
  // t3code surfaces in its popover so the swap is mechanical later.
  const titleLines: string[] = [];
  if (usage.maxTokens !== null && formattedPercent) {
    titleLines.push(
      `${formattedPercent} · ${formatContextWindowTokens(usage.usedTokens)}/${formatContextWindowTokens(usage.maxTokens)} context used`,
    );
  } else {
    titleLines.push(`${formatContextWindowTokens(usage.usedTokens)} tokens used so far`);
  }
  const title = titleLines.join(' · ');

  // Inner label: percentage when we know the window, raw token count
  // otherwise. Same fallback chain t3code uses.
  const innerLabel =
    usage.usedPercentage !== null
      ? `${Math.round(usage.usedPercentage)}`
      : formatContextWindowTokens(usage.usedTokens);

  const ariaLabel =
    usage.maxTokens !== null && formattedPercent
      ? `Context window ${formattedPercent} used`
      : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used`;

  return (
    <button
      type="button"
      className={`${styles.root} ${styles[`tone_${tone}`]}`}
      title={title}
      aria-label={ariaLabel}
      data-testid="context-window-meter"
      data-tone={tone}
    >
      <span className={styles.ring}>
        <svg
          viewBox="0 0 24 24"
          className={styles.ringSvg}
          aria-hidden="true"
          data-testid="context-window-meter-ring"
        >
          <circle
            cx="12"
            cy="12"
            r={RADIUS}
            fill="none"
            className={styles.ringTrack}
            strokeWidth="3"
          />
          <circle
            cx="12"
            cy="12"
            r={RADIUS}
            fill="none"
            className={styles.ringProgress}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            data-testid="context-window-meter-progress"
          />
        </svg>
        <span className={styles.ringInner} data-testid="context-window-meter-label">
          {innerLabel}
        </span>
      </span>
    </button>
  );
}

// Backwards-compatible re-export of the format helper.
export { formatContextWindowTokens as formatCompactCount };
