import type { RuntimeName } from '../runtimes/types.js';
import type { VBriefDifficulty, VBriefItem } from '../vbrief/types.js';
import { resolveTier, type ResolveTierConfig } from './resolve-tier.js';
import { resolveTieredExecutionEnabled } from './tier-table.js';

export type DispatchTier = 'in-context' | 'registered-slot';

const CHEAP_DIFFICULTIES = new Set<VBriefDifficulty>(['trivial', 'simple']);
const HEAVY_DIFFICULTIES = new Set<VBriefDifficulty>(['complex', 'expert']);

export function chooseDispatchTier(item: Pick<VBriefItem, 'metadata'>): DispatchTier {
  const metadata = item.metadata;
  const difficulty = metadata?.difficulty;

  if (difficulty && HEAVY_DIFFICULTIES.has(difficulty)) return 'registered-slot';

  const highConfidenceScope =
    metadata?.files_scope_confidence === 'high'
    && (metadata.files_scope?.length ?? 0) > 0;
  const independentlyDispatchable = metadata?.readiness === 'ready';

  if (difficulty && CHEAP_DIFFICULTIES.has(difficulty) && highConfidenceScope) {
    return 'in-context';
  }

  if (independentlyDispatchable && highConfidenceScope) return 'registered-slot';

  return 'in-context';
}

/**
 * Tiered-execution generalization of the dispatch decision (PAN-1791).
 * The binary in-context/registered-slot choice stays; when tiered execution
 * is enabled for the issue, the assignment also carries the (tierName,
 * model, harness) resolved by the resolution chain so dispatch spawns the
 * worker difficulty selected — the fix for PAN-1196's "difficulty captured
 * and ignored". When disabled, the result is exactly chooseDispatchTier's
 * with no model override.
 */
export interface TierAssignment {
  dispatch: DispatchTier;
  tierName?: string;
  model?: string;
  harness?: RuntimeName;
}

export interface TierAssignmentConfig extends ResolveTierConfig {
  enabled: boolean;
}

/**
 * Generalization of the binary dispatch lane into a tier assignment: the
 * dispatch lane plus, when tiered execution is enabled (globally or via
 * per-plan override), the (model, harness) resolved through the tier chain
 * so an item's difficulty actually selects its worker.
 *
 * With tiered execution disabled or no config, the result is exactly
 * chooseDispatchTier's lane with no model or harness attached.
 */
export function assignDispatchTier(
  item: Pick<VBriefItem, 'id' | 'title' | 'metadata'>,
  config?: TierAssignmentConfig,
  planMetadata?: { [key: string]: unknown },
): TierAssignment {
  const dispatch = chooseDispatchTier(item);
  if (!config || !resolveTieredExecutionEnabled(config, planMetadata)) {
    return { dispatch };
  }
  const tier = resolveTier(item, config);
  return { dispatch, tierName: tier.tierName, model: tier.model, harness: tier.harness };
}

/**
 * Plan-metadata-agnostic entry point: honors only the global enabled flag.
 * Kept for callers that resolve the per-plan override themselves (or have
 * no plan in scope, e.g. the enablement-gate parity tests).
 */
export function chooseTierAssignment(
  item: Pick<VBriefItem, 'id' | 'title' | 'metadata'>,
  tiering?: TierAssignmentConfig,
): TierAssignment {
  return assignDispatchTier(item, tiering);
}
