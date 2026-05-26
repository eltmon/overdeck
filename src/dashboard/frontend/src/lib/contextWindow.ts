/**
 * Context-window snapshot helpers, named to mirror t3code's
 * apps/web/src/lib/contextWindow.ts so future updates to t3code's
 * ContextWindowMeter can be ported with minimal rename churn.
 *
 * Source of truth on the wire is still the server's `ContextUsage` schema
 * (packages/contracts ContextUsage — { activeBytes, estimatedTokens,
 * contextWindow, percentUsed }). This module is the frontend adapter
 * layer: it exposes a t3code-shaped snapshot + format helper that the
 * component consumes.
 */

import type { ContextUsage } from '../components/chat/chat-types';

/**
 * Mirrors t3code's ContextWindowSnapshot. Field names follow t3code
 * (`usedTokens`, `maxTokens`, `usedPercentage`, `remainingTokens`,
 * `remainingPercentage`) so the component code reads the same.
 *
 * Fields t3code carries that we don't track (toolUses, durationMs, lastInput*,
 * etc.) are omitted rather than nulled — adding them requires producer-side
 * support in our JSONL parser, which is a separate effort.
 */
export interface ContextWindowSnapshot {
  /** Tokens currently inside the active context window (post-compaction). */
  readonly usedTokens: number;
  /** Maximum tokens the model accepts in a single context. */
  readonly maxTokens: number | null;
  /** 0–100 percentage of the context window currently consumed. */
  readonly usedPercentage: number | null;
  /** maxTokens − usedTokens, clamped to ≥0. null when maxTokens is unknown. */
  readonly remainingTokens: number | null;
  /** 100 − usedPercentage, clamped to ≥0. null when usedPercentage is unknown. */
  readonly remainingPercentage: number | null;
  /**
   * Raw active bytes from the JSONL session file. Panopticon-specific (t3code
   * doesn't expose this); useful for debugging the heuristic. Optional.
   */
  readonly activeBytes?: number;
}

/**
 * Convert the server's `ContextUsage` payload into the t3code-shaped snapshot.
 * Returns null when no usage data is available, matching t3code's
 * `deriveLatestContextWindowSnapshot()` shape.
 */
export function toContextWindowSnapshot(
  usage: ContextUsage | null | undefined,
): ContextWindowSnapshot | null {
  if (!usage) return null;

  const usedTokens = Math.max(0, Math.round(usage.estimatedTokens));
  const maxTokens = usage.contextWindow > 0 ? usage.contextWindow : null;
  const usedPercentage =
    maxTokens !== null ? Math.min(100, Math.max(0, usage.percentUsed)) : null;
  const remainingTokens =
    maxTokens !== null ? Math.max(0, maxTokens - usedTokens) : null;
  const remainingPercentage =
    usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;

  return {
    usedTokens,
    maxTokens,
    usedPercentage,
    remainingTokens,
    remainingPercentage,
    activeBytes: usage.activeBytes,
  };
}

/**
 * Format token counts with t3code's exact thresholds so the visual matches:
 *   <1k     → raw count
 *   <10k    → one decimal (e.g. 4.2k, trailing .0 dropped)
 *   <1M     → rounded thousands (e.g. 142k)
 *   ≥1M     → one decimal millions (e.g. 1.4m)
 */
export function formatContextWindowTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '0';
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  if (value < 1_000_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
}
