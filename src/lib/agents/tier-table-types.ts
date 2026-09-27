/**
 * Tiered-execution config shapes and enum lists. A leaf module: `config-yaml/schema.ts`
 * imports these types, and `tier-table.ts` resolves `workhorse:` refs through
 * `config-yaml/roles.ts`, which reaches `schema.ts`. Keeping the shapes here stops
 * `schema.ts` from importing `tier-table.ts` back (PAN-4191).
 */
import type { RuntimeName } from '../runtimes/types.js';
import type { ModelId } from '../settings.js';
import type { XBriefDifficulty, XBriefItemKind } from '../xbrief/types.js';
import type { EffortLevel } from '@overdeck/contracts';

export const TIERED_EXECUTION_DIFFICULTIES: readonly XBriefDifficulty[] = ['trivial', 'simple', 'medium', 'complex', 'expert'] as const;
export const TIERED_EXECUTION_SUBSCRIPTIONS = ['all', 'flagged', 'sampled'] as const;
export const TIERED_EXECUTION_ITEM_KINDS: readonly XBriefItemKind[] = ['docs', 'api', 'backend', 'frontend', 'infra', 'test', 'refactor', 'design', 'spike'] as const;
export const TIERED_EXECUTION_CALLOUT_POLICIES = ['off', 'notify', 'corroborate'] as const;
export const TIERED_EXECUTION_COMPACTION_REROUTE_POLICIES = ['off', 'on'] as const;

export type TieredExecutionSubscription = typeof TIERED_EXECUTION_SUBSCRIPTIONS[number];
export type TieredExecutionCalloutPolicy = typeof TIERED_EXECUTION_CALLOUT_POLICIES[number];
export type TieredExecutionCompactionReroutePolicy = typeof TIERED_EXECUTION_COMPACTION_REROUTE_POLICIES[number];

export interface TierDistributionEntry {
  /** The concrete model id this entry launches (a `workhorse:` ref is already dereffed). */
  model: ModelId | string;
  /**
   * PAN-4191: the `workhorse:<slot>` ref the operator wrote, when `model` came
   * from one. It is what the settings save writes back to config.yaml, so a
   * Settings save never pins the slot's current model as a literal.
   */
  modelRef?: string;
  harness: RuntimeName;
  /** Integer percentage; a tier's entries must total exactly 100. */
  weight: number;
}

export interface TierDefinition {
  /** The concrete model id this tier launches (a `workhorse:` ref is already dereffed). */
  model: ModelId | string;
  /** PAN-4191: the `workhorse:<slot>` ref behind `model`, when there is one. */
  modelRef?: string;
  harness: RuntimeName;
  difficulties: XBriefDifficulty[];
  /**
   * Reasoning effort this tier launches its agents at. Overrides the role's
   * (and sub-role's) effort for a bead dispatched into this tier; falls back
   * through the normal precedence when unset.
   */
  effort?: EffortLevel;
  /**
   * PAN-2391: weighted model+harness entries this tier spreads its beads
   * across (to consume multiple subscription plans). When present, the raw
   * config declared `distribution` INSTEAD of model/harness; the normalized
   * model/harness above are the max-weight representative so distribution-
   * unaware readers degrade safely. Selection is deterministic per bead
   * (see pickDistributionEntry).
   */
  distribution?: TierDistributionEntry[];
}

export interface TieredExecutionSupervisorConfig {
  model: ModelId | string;
  /** PAN-4191: the `workhorse:<slot>` ref behind `model`, when there is one. */
  modelRef?: string;
  harness: RuntimeName;
  subscribe: TieredExecutionSubscription;
}

export interface TieredExecutionFeedConfig {
  callouts?: TieredExecutionCalloutPolicy;
  exclude?: string[];
  exclude_subjects?: string[];
  max_diff_bytes?: number | null;
}

export interface ValidatedTieredExecutionFeedConfig {
  callouts: TieredExecutionCalloutPolicy;
  exclude: string[];
  exclude_subjects: string[];
  max_diff_bytes: number | null;
}

export interface TieredEscalationConfig {
  enabled?: boolean;
  retries_at_tier?: number;
  max_promotions?: number;
}

export interface ValidatedEscalationConfig {
  enabled: boolean;
  retries_at_tier: number;
  max_promotions: number;
}

export interface TieredExecutionConfig {
  enabled: boolean;
  tiers: Record<string, TierDefinition>;
  supervisor?: TieredExecutionSupervisorConfig;
  by_kind?: Partial<Record<XBriefItemKind, string>>;
  feed?: TieredExecutionFeedConfig;
  escalation?: TieredEscalationConfig;
  compaction_reroute?: TieredExecutionCompactionReroutePolicy;
  replay_threshold: number;
}

export interface ValidatedTieredExecutionConfig extends TieredExecutionConfig {
  difficultyToTier: Partial<Record<XBriefDifficulty, string>>;
  byKind: Partial<Record<XBriefItemKind, string>>;
  feed: ValidatedTieredExecutionFeedConfig;
  escalation: ValidatedEscalationConfig;
  compaction_reroute: TieredExecutionCompactionReroutePolicy;
}
