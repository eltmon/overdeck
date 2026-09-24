import type { RuntimeName } from '../runtimes/types.js';
import { type ResolveTierConfig } from './resolve-tier.js';

export type DispatchTier = 'in-context' | 'registered-slot';

/**
 * Tiered-execution generalization of the dispatch decision (PAN-1791).
 * The binary in-context/registered-slot choice stays; when tiered execution
 * is enabled for the issue, the assignment also carries the (tierName,
 * model, harness) resolved by the resolution chain so dispatch spawns the
 * worker difficulty selected — the fix for PAN-1196's "difficulty captured
 * and ignored". When disabled, the assignment carries no model override.
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
