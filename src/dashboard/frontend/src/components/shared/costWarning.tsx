/**
 * Cost-warning UI for expensive models.
 *
 * Shows a scary red triangle next to ultra-premium models so users don't
 * accidentally pick gpt-5.5-pro ($119/1M) when they meant gpt-5.5 ($10/1M)
 * — same dropdown, an order of magnitude apart in burn rate.
 *
 * Tiers (blended $/1M tokens):
 *   extreme  ≥ $60     red, pulsing — gpt-5.5-pro ($119)
 *   high     $30–$59   amber       — opus-4-7, opus-4-6 ($45)
 *   (none)   <  $30                 — no badge
 */

import { AlertTriangle } from 'lucide-react';
import type { CSSProperties } from 'react';

export type CostWarningLevel = 'extreme' | 'high';

export function costWarningLevel(costPer1MTokens?: number): CostWarningLevel | null {
  if (costPer1MTokens == null || !Number.isFinite(costPer1MTokens)) return null;
  if (costPer1MTokens >= 60) return 'extreme';
  if (costPer1MTokens >= 30) return 'high';
  return null;
}

export function costWarningTitle(level: CostWarningLevel, costPer1MTokens?: number): string {
  const cost = costPer1MTokens != null ? ` ($${Math.round(costPer1MTokens)}/1M tokens)` : '';
  if (level === 'extreme') {
    return `EXTREMELY EXPENSIVE${cost} — make sure you really want this model. A single agent run can burn dozens of dollars.`;
  }
  return `Expensive${cost} — only pick if you need its specific capabilities.`;
}

interface BadgeProps {
  level: CostWarningLevel;
  /** When true, render only the icon (no text). Used in tight rows / dropdown options. */
  compact?: boolean;
  /** Provided so we can build the tooltip with the actual price. */
  costPer1MTokens?: number;
}

/**
 * Inline warning badge. Renders a colored triangle + (optionally) "EXPENSIVE" /
 * "PRICEY" label. Inline styles keep this drop-in for every picker without
 * coordinating CSS-module class names across three different stylesheets.
 */
export function CostWarningBadge({ level, compact = false, costPer1MTokens }: BadgeProps) {
  const isExtreme = level === 'extreme';
  const color = isExtreme ? '#ef4444' : '#f59e0b';
  const bg = isExtreme
    ? 'color-mix(in srgb, #ef4444 18%, transparent)'
    : 'color-mix(in srgb, #f59e0b 18%, transparent)';
  const border = isExtreme
    ? '1px solid color-mix(in srgb, #ef4444 50%, transparent)'
    : '1px solid color-mix(in srgb, #f59e0b 40%, transparent)';

  const baseStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: compact ? '1px 4px' : '2px 6px',
    fontSize: compact ? 9 : 10,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color,
    background: bg,
    border,
    borderRadius: 3,
    flexShrink: 0,
    whiteSpace: 'nowrap',
    lineHeight: 1,
    animation: isExtreme ? 'pan-cost-warning-pulse 2s ease-in-out infinite' : undefined,
  };

  const label = isExtreme ? '$$$' : '$$';
  const iconSize = compact ? 10 : 11;

  return (
    <span
      style={baseStyle}
      title={costWarningTitle(level, costPer1MTokens)}
      role="img"
      aria-label={isExtreme ? 'Extremely expensive model' : 'Expensive model'}
    >
      <AlertTriangle
        size={iconSize}
        strokeWidth={2.5}
        style={{ color, flexShrink: 0 }}
      />
      {!compact && <span>{label}</span>}
    </span>
  );
}

/**
 * Keyframes for the pulsing extreme-tier badge. Mounted once in App.tsx (or
 * any always-rendered ancestor) so every badge picks up the animation.
 */
export function CostWarningStyles() {
  return (
    <style>{`
      @keyframes pan-cost-warning-pulse {
        0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, #ef4444 60%, transparent); }
        50%      { box-shadow: 0 0 0 4px color-mix(in srgb, #ef4444 0%, transparent); }
      }
    `}</style>
  );
}
