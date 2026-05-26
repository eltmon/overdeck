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
 *     for a multi-line block. We don't have shared popover primitives yet —
 *     using an inline, click-toggled detail panel anchored below the ring.
 *     Native `title` is also set so hover still gives a fast read.
 *   - Tone coloring: green/yellow/red tint on the progress stroke based on
 *     <50 / 50–80 / >80 usage. Upstream uses a single muted color.
 *
 * Geometry mirrors upstream exactly: 24×24 svg, viewBox 0 0 24 24, radius
 * 9.75, two stroke-3 circles, -rotate-90 to start the arc at 12 o'clock.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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

function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

const RADIUS = 9.75;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ContextWindowMeter({ usage }: ContextWindowMeterProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  // Close on outside click / Escape — the standard pattern until we have a
  // shared Popover primitive that handles this for us.
  useEffect(() => {
    if (!popoverOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setPopoverOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopoverOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [popoverOpen]);

  const togglePopover = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setPopoverOpen((open) => !open);
  }, []);

  if (!usage) return null;

  const normalizedPercentage =
    usage.usedPercentage !== null ? Math.max(0, Math.min(100, usage.usedPercentage)) : 0;
  const tone = getUsageTone(normalizedPercentage);
  const dashOffset = CIRCUMFERENCE - (normalizedPercentage / 100) * CIRCUMFERENCE;
  const formattedPercent = formatPercentage(usage.usedPercentage);

  // Single-line title for the hover affordance (fast read without clicking).
  // The click popover below carries the full breakdown.
  const title =
    usage.maxTokens !== null && formattedPercent
      ? `${formattedPercent} · ${formatContextWindowTokens(usage.usedTokens)}/${formatContextWindowTokens(usage.maxTokens)} context used · click for details`
      : `${formatContextWindowTokens(usage.usedTokens)} tokens used so far · click for details`;

  const innerLabel =
    usage.usedPercentage !== null
      ? `${Math.round(usage.usedPercentage)}`
      : formatContextWindowTokens(usage.usedTokens);

  const ariaLabel =
    usage.maxTokens !== null && formattedPercent
      ? `Context window ${formattedPercent} used — click to expand`
      : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used — click to expand`;

  const formattedLastTurn = formatTimestamp(usage.lastTurnAt);
  const showExtendedContextBadge =
    typeof usage.maxObservedInputTokens === 'number' &&
    usage.maxTokens !== null &&
    usage.maxTokens > 200_000;

  return (
    <span ref={wrapperRef} className={styles.wrapper}>
      <button
        type="button"
        className={`${styles.root} ${styles[`tone_${tone}`]}`}
        title={title}
        aria-label={ariaLabel}
        aria-expanded={popoverOpen}
        aria-haspopup="dialog"
        onClick={togglePopover}
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

      {popoverOpen && (
        <div className={styles.popover} role="dialog" aria-label="Context window detail" data-testid="context-window-meter-popover">
          <div className={styles.popoverHeader}>
            <span className={styles.popoverHeaderLabel}>Context window</span>
            {showExtendedContextBadge && (
              <span className={styles.popoverExtBadge} title="1M extended-context auto-detected from observed usage">
                1M mode
              </span>
            )}
          </div>

          <div className={styles.popoverPrimary}>
            {usage.maxTokens !== null && formattedPercent ? (
              <>
                <span className={styles.popoverPercent}>{formattedPercent}</span>
                <span className={styles.popoverFraction}>
                  {formatContextWindowTokens(usage.usedTokens)} / {formatContextWindowTokens(usage.maxTokens)}
                </span>
              </>
            ) : (
              <span className={styles.popoverFraction}>
                {formatContextWindowTokens(usage.usedTokens)} tokens
              </span>
            )}
          </div>

          {(usage.lastInputTokens !== undefined ||
            usage.lastCacheReadTokens !== undefined ||
            usage.lastCacheCreationTokens !== undefined) && (
            <dl className={styles.popoverGrid}>
              {usage.lastInputTokens !== undefined && (
                <>
                  <dt>Input</dt>
                  <dd>{formatContextWindowTokens(usage.lastInputTokens)}</dd>
                </>
              )}
              {usage.lastCacheReadTokens !== undefined && (
                <>
                  <dt>Cache read</dt>
                  <dd>{formatContextWindowTokens(usage.lastCacheReadTokens)}</dd>
                </>
              )}
              {usage.lastCacheCreationTokens !== undefined && (
                <>
                  <dt>Cache create</dt>
                  <dd>{formatContextWindowTokens(usage.lastCacheCreationTokens)}</dd>
                </>
              )}
              {usage.remainingTokens !== null && (
                <>
                  <dt>Remaining</dt>
                  <dd>{formatContextWindowTokens(usage.remainingTokens)}</dd>
                </>
              )}
            </dl>
          )}

          {(usage.lastModel || formattedLastTurn) && (
            <div className={styles.popoverFooter}>
              {usage.lastModel && (
                <div>
                  <span className={styles.popoverFooterLabel}>Last turn model</span>
                  <span className={styles.popoverFooterValue}>{usage.lastModel}</span>
                </div>
              )}
              {formattedLastTurn && (
                <div>
                  <span className={styles.popoverFooterLabel}>Last turn at</span>
                  <span className={styles.popoverFooterValue}>{formattedLastTurn}</span>
                </div>
              )}
            </div>
          )}

          <p className={styles.popoverNote}>
            Sourced from the last assistant turn's <code>usage</code> in the JSONL — matches Claude Code's terminal indicator.
          </p>
        </div>
      )}
    </span>
  );
}

// Backwards-compatible re-export of the format helper.
export { formatContextWindowTokens as formatCompactCount };
