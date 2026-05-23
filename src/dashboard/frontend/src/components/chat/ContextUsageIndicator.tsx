import type { ContextUsage } from './chat-types';
import styles from './ContextUsageIndicator.module.css';

interface ContextUsageIndicatorProps {
  contextUsage: ContextUsage | null;
}

type UsageTone = 'low' | 'medium' | 'high';

export function formatCompactCount(value: number): string {
  if (value < 1024) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(2)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

function getUsageTone(percentUsed: number): UsageTone {
  if (percentUsed < 50) return 'low';
  if (percentUsed <= 80) return 'medium';
  return 'high';
}

function formatPercent(percentUsed: number): string {
  return `${Math.round(percentUsed)}%`;
}

export function ContextUsageIndicator({ contextUsage }: ContextUsageIndicatorProps) {
  if (!contextUsage) return null;

  const percentUsed = Math.min(100, Math.max(0, contextUsage.percentUsed));
  const tone = getUsageTone(percentUsed);
  const formattedTokens = formatCompactCount(contextUsage.estimatedTokens);
  const formattedWindow = formatCompactCount(contextUsage.contextWindow);
  const formattedPercent = formatPercent(percentUsed);
  const title = `${contextUsage.estimatedTokens.toLocaleString()} active tokens (${formattedPercent}) of ${contextUsage.contextWindow.toLocaleString()} context window`;
  const toneClass = styles[`tone_${tone}`];

  return (
    <div
      className={`${styles.root} ${toneClass}`}
      title={title}
      aria-label={title}
      data-testid="context-usage-indicator"
      data-tone={tone}
    >
      <span className={styles.sizeText} data-testid="context-usage-size">
        {formattedTokens}
      </span>
      <span className={styles.percentText} data-testid="context-usage-percent">
        {formattedPercent}
      </span>
      <span
        className={styles.barTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percentUsed)}
        aria-label="Context usage"
        data-testid="context-usage-bar"
      >
        <span
          className={styles.barFill}
          style={{ width: `${percentUsed}%` }}
          data-testid="context-usage-fill"
        />
      </span>
      <span
        className={styles.dot}
        aria-hidden="true"
        data-testid="context-usage-dot"
      />
      <span className={styles.windowText} data-testid="context-usage-window">
        / {formattedWindow}
      </span>
    </div>
  );
}
