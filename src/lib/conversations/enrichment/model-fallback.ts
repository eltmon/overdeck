/**
 * Model fallback routing for enrichment tiers (PAN-457).
 *
 * Tier → model mapping:
 *   L1 (quick)  → configured quickModel or claude-haiku-4-5-20251001
 *   L2 (detail) → configured deepModel or claude-sonnet-4-6
 *   L3 (deep)   → configured deepModel or claude-sonnet-4-6
 *
 * Context window sizes per tier (number of JSONL message lines to include):
 *   L1 → 3  messages
 *   L2 → 11 messages
 *   L3 → all messages (no truncation)
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_QUICK_MODEL = 'claude-haiku-4-5-20251001';
export const DEFAULT_DEEP_MODEL = 'claude-sonnet-4-6';

export const TIER_MAX_MESSAGES: Record<1 | 2 | 3, number | null> = {
  1: 3,
  2: 11,
  3: null, // unlimited
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type EnrichmentTier = 1 | 2 | 3;

export interface TierConfig {
  quickModel: string | null;
  deepModel: string | null;
}

// ─── Routing ──────────────────────────────────────────────────────────────────

/**
 * Select the model ID for a given enrichment tier.
 * Falls back to hardcoded defaults when config models are null.
 */
export function selectModelForTier(tier: EnrichmentTier, config: TierConfig): string {
  if (tier === 1) {
    return config.quickModel ?? DEFAULT_QUICK_MODEL;
  }
  return config.deepModel ?? DEFAULT_DEEP_MODEL;
}

/**
 * Maximum number of JSONL lines to include in the enrichment context.
 * Returns null for L3 (all messages).
 */
export function maxMessagesForTier(tier: EnrichmentTier): number | null {
  return TIER_MAX_MESSAGES[tier];
}
