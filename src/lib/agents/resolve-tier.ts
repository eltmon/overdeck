import type { RuntimeName } from '../runtimes/types.js';
import type { VBriefItem, VBriefItemKind } from '../vbrief/types.js';
import { resolveVBriefItemKind } from '../vbrief/types.js';
import type { ValidatedTieredExecutionConfig } from './tier-table.js';

/**
 * Tier resolution chain for tiered execution (PAN-1791).
 *
 * Resolution order for a vBRIEF item:
 *   1. Per-bead `metadata.model` override — the override replaces the model of
 *      whatever tier the rest of the chain resolves (the harness still comes
 *      from the chain; an override cannot invent a harness).
 *   2. `byKind[item.metadata.kind]` — subject-matter routing to a named tier.
 *      Kind defaults to 'backend' when the item does not set one.
 *   3. `byDifficulty` — the tier table's difficulty-to-tier mapping.
 *   4. Role default — the caller's resolved role model+harness.
 *
 * When nothing resolves, this throws TierResolutionError. It never falls back
 * to a hardcoded model literal (no-hardcoded-model-fallbacks rule).
 *
 * Pure function over the validated tier-table config; no spawning here.
 */

export interface ResolvedTier {
  tierName: string;
  model: string;
  harness: RuntimeName;
}

export interface TierResolutionConfig {
  /** Validated tier table from tier-table.ts (provides byDifficulty routing). */
  tierTable: ValidatedTieredExecutionConfig;
  /** Optional subject-matter routing: item kind -> tier name in tierTable.tiers. */
  byKind?: Partial<Record<VBriefItemKind, string>>;
  /** Role default used when neither byKind nor byDifficulty resolves. */
  roleDefault?: { model: string; harness: RuntimeName };
}

export class TierResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TierResolutionError';
  }
}

function tierByName(config: TierResolutionConfig, tierName: string, source: string, itemId: string): ResolvedTier {
  const tier = config.tierTable.tiers[tierName];
  if (!tier) {
    throw new TierResolutionError(`${source} routes item '${itemId}' to tier '${tierName}', which is not defined in tiered_execution.tiers`);
  }
  return { tierName, model: tier.model, harness: tier.harness };
}

function resolveBaseTier(item: VBriefItem, config: TierResolutionConfig): ResolvedTier | undefined {
  const kind = resolveVBriefItemKind(item.metadata);
  const byKindTier = config.byKind?.[kind];
  if (byKindTier !== undefined) {
    return tierByName(config, byKindTier, `byKind['${kind}']`, item.id);
  }

  const difficulty = item.metadata?.difficulty;
  if (difficulty !== undefined) {
    const byDifficultyTier = config.tierTable.difficultyToTier[difficulty];
    if (byDifficultyTier !== undefined) {
      return tierByName(config, byDifficultyTier, `byDifficulty['${difficulty}']`, item.id);
    }
  }

  if (config.roleDefault) {
    return { tierName: 'role-default', model: config.roleDefault.model, harness: config.roleDefault.harness };
  }

  return undefined;
}

export function resolveTier(item: VBriefItem, config: TierResolutionConfig): ResolvedTier {
  const override = typeof item.metadata?.model === 'string' && item.metadata.model.length > 0
    ? item.metadata.model
    : undefined;

  const base = resolveBaseTier(item, config);

  if (override !== undefined) {
    if (!base) {
      throw new TierResolutionError(`item '${item.id}' sets a model override '${override}' but no tier, byKind route, or role default resolves a harness for it`);
    }
    return { tierName: 'override', model: override, harness: base.harness };
  }

  if (!base) {
    throw new TierResolutionError(`no tier/model configured for item '${item.id}': no override, no byKind route, no byDifficulty tier, and no role default`);
  }

  return base;
}
