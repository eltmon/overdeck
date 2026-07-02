import type { RuntimeName } from '../runtimes/types.js';
import type { VBriefDifficulty, VBriefItem, VBriefItemKind } from '../vbrief/types.js';
import type { TierDefinition } from './tier-table.js';

/**
 * Model + harness resolution chain for tiered execution (PAN-1791, folding in
 * PAN-1196). Resolution order for each bead:
 *
 *   1. per-bead `metadata.model` override — wins for the model; the harness
 *      (and dispatch lane) still comes from the rest of the chain
 *   2. `byKind[item.metadata.kind]` — subject-matter routing to a tier name
 *   3. `difficultyToTier[item.metadata.difficulty]` — the tier table
 *   4. `roleDefault` — the configured role default
 *
 * When nothing resolves and no default is configured, resolveTier throws a
 * named ResolveTierError. It NEVER falls back to a hardcoded model literal
 * (no-hardcoded-model-fallbacks rule).
 *
 * Pure function over already-validated config — no spawning, no I/O here.
 */

/**
 * Reserved tierName values naming the resolution source when the result did
 * not come from a configured tier. Configured tier names must not use these.
 */
export const OVERRIDE_TIER_NAME = 'override';
export const ROLE_DEFAULT_TIER_NAME = 'role-default';

export interface ResolvedTier {
  tierName: string;
  model: string;
  harness: RuntimeName;
}

export interface RoleDefaultTier {
  model: string;
  harness: RuntimeName;
}

/**
 * Structural subset of ValidatedTieredExecutionConfig (tiers +
 * difficultyToTier) plus the chain-specific inputs. Callers can spread a
 * validated tier-table config and attach byKind/roleDefault.
 */
export interface ResolveTierConfig {
  tiers: Record<string, TierDefinition>;
  difficultyToTier: Partial<Record<VBriefDifficulty, string>>;
  /** Subject-matter routing: item kind -> configured tier name. */
  byKind?: Partial<Record<VBriefItemKind, string>>;
  roleDefault?: RoleDefaultTier;
}

export class ResolveTierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolveTierError';
  }
}

function itemLabel(item: Pick<VBriefItem, 'id' | 'title'>): string {
  return item.id || item.title || '<unknown item>';
}

function lookupTier(
  config: ResolveTierConfig,
  tierName: string,
  source: string,
  item: Pick<VBriefItem, 'id' | 'title'>,
): ResolvedTier {
  const tier = config.tiers[tierName];
  if (!tier) {
    throw new ResolveTierError(
      `${source} routes item '${itemLabel(item)}' to tier '${tierName}', but no such tier is configured`,
    );
  }
  return { tierName, model: tier.model, harness: tier.harness };
}

/** The chain below the per-bead override: byKind -> byDifficulty -> role default. */
function resolveBaseTier(
  item: Pick<VBriefItem, 'id' | 'title' | 'metadata'>,
  config: ResolveTierConfig,
): ResolvedTier | undefined {
  const kind = item.metadata?.kind;
  const kindTierName = kind ? config.byKind?.[kind] : undefined;
  if (kindTierName) {
    return lookupTier(config, kindTierName, `byKind['${kind}']`, item);
  }

  const difficulty = item.metadata?.difficulty;
  const difficultyTierName = difficulty ? config.difficultyToTier[difficulty] : undefined;
  if (difficultyTierName) {
    return lookupTier(config, difficultyTierName, `difficultyToTier['${difficulty}']`, item);
  }

  if (config.roleDefault) {
    return {
      tierName: ROLE_DEFAULT_TIER_NAME,
      model: config.roleDefault.model,
      harness: config.roleDefault.harness,
    };
  }

  return undefined;
}

export function resolveTier(
  item: Pick<VBriefItem, 'id' | 'title' | 'metadata'>,
  config: ResolveTierConfig,
): ResolvedTier {
  const base = resolveBaseTier(item, config);

  const override = item.metadata?.model;
  if (typeof override === 'string' && override.length > 0) {
    if (!base) {
      throw new ResolveTierError(
        `item '${itemLabel(item)}' sets metadata.model '${override}' but no tier resolves its harness: `
        + 'no byKind match, no byDifficulty tier, and no role default configured',
      );
    }
    return { tierName: OVERRIDE_TIER_NAME, model: override, harness: base.harness };
  }

  if (!base) {
    throw new ResolveTierError(
      `no tier/model configured for item '${itemLabel(item)}': no metadata.model override, `
      + 'no byKind match, no byDifficulty tier, and no role default configured',
    );
  }

  return base;
}
