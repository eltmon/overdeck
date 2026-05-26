/**
 * ContextWindowMeter — compact "how full is the context window" indicator,
 * placed next to the send button in the composer toolbar.
 *
 * Named, prop-shaped, and helper-aligned with t3code's
 * apps/web/src/components/chat/ContextWindowMeter.tsx so future visual or
 * data-shape updates can be ported with minimal rename churn. Differences:
 *
 *   - Server data shape is Panopticon's (`activeBytes` + tokens), wrapped
 *     into a t3code-shaped ContextWindowSnapshot by `toContextWindowSnapshot`.
 *   - Visual is Panopticon's existing compact bar+percent (auto-collapses
 *     to a colored dot in cramped headers via container queries); t3code's
 *     circular ring requires the Popover/PopoverPopup primitives we don't
 *     have here. The data plumbing is identical; the renderer is ours.
 *
 * When upstream t3code adds a field (e.g. `compactsAutomatically`,
 * `totalProcessedTokens`), add it to `ContextWindowSnapshot` in
 * `lib/contextWindow.ts` and surface it in the tooltip/title here.
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
  return `${Math.round(value)}%`;
}

export function ContextWindowMeter({ usage }: ContextWindowMeterProps) {
  if (!usage) return null;

  const normalizedPercentage =
    usage.usedPercentage !== null ? Math.max(0, Math.min(100, usage.usedPercentage)) : 0;
  const tone = getUsageTone(normalizedPercentage);
  const formattedTokens = formatContextWindowTokens(usage.usedTokens);
  const formattedWindow = formatContextWindowTokens(usage.maxTokens);
  const formattedPercent = formatPercentage(usage.usedPercentage);

  const title =
    usage.maxTokens !== null && formattedPercent
      ? `${usage.usedTokens.toLocaleString()} active tokens (${formattedPercent}) of ${usage.maxTokens.toLocaleString()} context used`
      : `${usage.usedTokens.toLocaleString()} active tokens`;

  const toneClass = styles[`tone_${tone}`];

  return (
    <div
      className={`${styles.root} ${toneClass}`}
      title={title}
      aria-label={title}
      data-testid="context-window-meter"
      data-tone={tone}
    >
      <span className={styles.sizeText} data-testid="context-window-meter-size">
        {formattedTokens}
      </span>
      {formattedPercent && (
        <span className={styles.percentText} data-testid="context-window-meter-percent">
          {formattedPercent}
        </span>
      )}
      <span
        className={styles.barTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(normalizedPercentage)}
        aria-label="Context window usage"
        data-testid="context-window-meter-bar"
      >
        <span
          className={styles.barFill}
          style={{ width: `${normalizedPercentage}%` }}
          data-testid="context-window-meter-fill"
        />
      </span>
      <span
        className={styles.dot}
        aria-hidden="true"
        data-testid="context-window-meter-dot"
      />
      {usage.maxTokens !== null && (
        <span className={styles.windowText} data-testid="context-window-meter-window">
          / {formattedWindow}
        </span>
      )}
    </div>
  );
}

// Backwards-compatible re-export of the format helper. Anything that
// imported `formatCompactCount` from the old file can keep working until
// the call site is updated.
export { formatContextWindowTokens as formatCompactCount };
