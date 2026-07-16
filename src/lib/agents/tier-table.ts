import type { RuntimeName } from '../runtimes/types.js';
import type { ModelId } from '../settings.js';
import type { VBriefDifficulty, VBriefItemKind } from '../vbrief/types.js';
import type { AuthMode } from '../subscription-types.js';
import type { ModelProvider } from '../model-fallback.js';
import { resolveModelIdSync } from '../model-capabilities.js';
import { getProviderForModelSync, PROVIDERS } from '../providers.js';
import { canUseHarnessSync } from '../harness-policy.js';
import { readIssueRecordSync } from '../pan-dir/record.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';

export const TIERED_EXECUTION_DIFFICULTIES: readonly VBriefDifficulty[] = ['trivial', 'simple', 'medium', 'complex', 'expert'] as const;
export const TIERED_EXECUTION_SUBSCRIPTIONS = ['all', 'flagged', 'sampled'] as const;
export const TIERED_EXECUTION_ITEM_KINDS: readonly VBriefItemKind[] = ['docs', 'api', 'backend', 'frontend', 'infra', 'test', 'refactor', 'design', 'spike'] as const;
export const TIERED_EXECUTION_CALLOUT_POLICIES = ['off', 'notify', 'corroborate'] as const;
export const TIERED_EXECUTION_COMPACTION_REROUTE_POLICIES = ['off', 'on'] as const;

export type TieredExecutionSubscription = typeof TIERED_EXECUTION_SUBSCRIPTIONS[number];
export type TieredExecutionCalloutPolicy = typeof TIERED_EXECUTION_CALLOUT_POLICIES[number];
export type TieredExecutionCompactionReroutePolicy = typeof TIERED_EXECUTION_COMPACTION_REROUTE_POLICIES[number];

export interface TierDistributionEntry {
  model: ModelId | string;
  harness: RuntimeName;
  /** Integer percentage; a tier's entries must total exactly 100. */
  weight: number;
}

export interface TierDefinition {
  model: ModelId | string;
  harness: RuntimeName;
  difficulties: VBriefDifficulty[];
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
  harness: RuntimeName;
  subscribe: TieredExecutionSubscription;
  owns_inspection?: boolean;
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
  flounder_budget_minutes?: Partial<Record<VBriefDifficulty, number>>;
}

export interface ValidatedEscalationConfig {
  enabled: boolean;
  retries_at_tier: number;
  max_promotions: number;
  flounder_budget_minutes: Partial<Record<VBriefDifficulty, number>>;
}

export interface TieredExecutionConfig {
  enabled: boolean;
  tiers: Record<string, TierDefinition>;
  supervisor?: TieredExecutionSupervisorConfig;
  by_kind?: Partial<Record<VBriefItemKind, string>>;
  feed?: TieredExecutionFeedConfig;
  escalation?: TieredEscalationConfig;
  compaction_reroute?: TieredExecutionCompactionReroutePolicy;
  replay_threshold: number;
}

export interface ValidatedTieredExecutionConfig extends TieredExecutionConfig {
  difficultyToTier: Partial<Record<VBriefDifficulty, string>>;
  byKind: Partial<Record<VBriefItemKind, string>>;
  feed: ValidatedTieredExecutionFeedConfig;
  escalation: ValidatedEscalationConfig;
  compaction_reroute: TieredExecutionCompactionReroutePolicy;
}

export interface TieredExecutionValidationContext {
  providerAuth?: Partial<Record<ModelProvider, AuthMode>>;
}

export class TieredExecutionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TieredExecutionConfigError';
  }
}

export const DEFAULT_TIERED_EXECUTION_CONFIG: ValidatedTieredExecutionConfig = {
  enabled: false,
  tiers: {},
  supervisor: undefined,
  by_kind: {},
  byKind: {},
  feed: {
    callouts: 'off',
    exclude: [],
    exclude_subjects: [],
    max_diff_bytes: null,
  },
  escalation: {
    enabled: false,
    retries_at_tier: 0,
    max_promotions: 0,
    flounder_budget_minutes: {},
  },
  compaction_reroute: 'off',
  replay_threshold: 0.5,
  difficultyToTier: {},
};

export const TIERED_EXECUTION_ISSUE_OVERRIDES = ['on', 'off'] as const;
export type TieredExecutionIssueOverride = typeof TIERED_EXECUTION_ISSUE_OVERRIDES[number];

export function resolveTieredExecutionBlock(
  config: Pick<TieredExecutionConfig, 'enabled'>,
  planMetadata: { [key: string]: unknown } | undefined,
  recordOverride: 'on' | 'off' | null | undefined,
): {
  effective: boolean;
  source: 'issue-override' | 'plan-metadata' | 'global';
  override: 'on' | 'off' | null;
} {
  const effective = resolveTieredExecutionEnabled(config, planMetadata, recordOverride);

  if (recordOverride === 'on' || recordOverride === 'off') {
    return {
      effective,
      source: 'issue-override',
      override: recordOverride,
    };
  }

  const planValue = planMetadata?.tiered_execution;
  if (planValue === 'on' || planValue === 'off') {
    return {
      effective,
      source: 'plan-metadata',
      override: null,
    };
  }

  return {
    effective,
    source: 'global',
    override: null,
  };
}

/**
 * Per-issue tiered_execution opt-in/out (PAN-1791 FR-9, PAN-2383 FR-1). Resolves with precedence:
 * record override > plan.metadata.tiered_execution > config.enabled.
 *
 * An issue's vBRIEF may set `tiered_execution: 'on' | 'off'` in plan.metadata; a record
 * override takes precedence; an explicit value wins over the global `tiered_execution.enabled`
 * flag, and an unset value inherits it — zero behavior change when no overrides exist.
 * Any invalid value is a config error (fail-loud, no silent inherit on typos).
 */
export function resolveTieredExecutionEnabled(
  config: Pick<TieredExecutionConfig, 'enabled'>,
  planMetadata?: { [key: string]: unknown },
  recordOverride?: 'on' | 'off' | null,
): boolean {
  // Record override takes precedence
  if (recordOverride === 'on') return true;
  if (recordOverride === 'off') return false;

  // Plan metadata second
  const planValue = planMetadata?.tiered_execution;
  if (planValue === undefined || planValue === null) return config.enabled;
  if (planValue === 'on') return true;
  if (planValue === 'off') return false;
  throw new TieredExecutionConfigError(
    `plan.metadata.tiered_execution must be one of ${TIERED_EXECUTION_ISSUE_OVERRIDES.join(', ')}; got ${JSON.stringify(planValue)}`,
  );
}

/**
 * Issue-aware wrapper for resolveTieredExecutionEnabled (PAN-2383 foundation).
 * Reads the per-issue record to extract the record override, applies precedence:
 * record override > plan.metadata.tiered_execution > config.enabled.
 */
export function resolveTieredExecutionEnabledForIssue(
  config: Pick<TieredExecutionConfig, 'enabled'>,
  issueId: string,
  planMetadata?: { [key: string]: unknown },
): boolean {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) {
    // Fallback to plan/config if project cannot be resolved
    return resolveTieredExecutionEnabled(config, planMetadata);
  }

  const project = getProjectSync(resolved.projectKey);
  if (!project) {
    return resolveTieredExecutionEnabled(config, planMetadata);
  }

  const record = readIssueRecordSync(project, issueId);
  const recordOverride = record?.tieredExecutionOverride;

  return resolveTieredExecutionEnabled(config, planMetadata, recordOverride);
}

function isRuntimeName(value: string): value is RuntimeName {
  return value === 'claude-code' || value === 'ohmypi' || value === 'codex';
}

function isDifficulty(value: string): value is VBriefDifficulty {
  return (TIERED_EXECUTION_DIFFICULTIES as readonly string[]).includes(value);
}

function isSubscription(value: string): value is TieredExecutionSubscription {
  return (TIERED_EXECUTION_SUBSCRIPTIONS as readonly string[]).includes(value);
}

function isItemKind(value: string): value is VBriefItemKind {
  return (TIERED_EXECUTION_ITEM_KINDS as readonly string[]).includes(value);
}

function isCalloutPolicy(value: string): value is TieredExecutionCalloutPolicy {
  return (TIERED_EXECUTION_CALLOUT_POLICIES as readonly string[]).includes(value);
}

function isCompactionReroutePolicy(value: string): value is TieredExecutionCompactionReroutePolicy {
  return (TIERED_EXECUTION_COMPACTION_REROUTE_POLICIES as readonly string[]).includes(value);
}

function knownModelIds(): Set<string> {
  const ids = new Set<string>();
  for (const provider of Object.values(PROVIDERS)) {
    for (const model of provider.models) ids.add(model);
  }
  return ids;
}

function validateHarness(harness: string, path: string): asserts harness is RuntimeName {
  if (!isRuntimeName(harness)) {
    throw new TieredExecutionConfigError(`${path}.harness '${harness}' is unknown; expected claude-code, ohmypi, or codex`);
  }
}

function validateModel(model: string, path: string): ModelId {
  const resolved = resolveModelIdSync(model);
  if (!knownModelIds().has(resolved) && !resolved.includes('/')) {
    throw new TieredExecutionConfigError(`${path}.model '${model}' is unknown`);
  }
  return resolved as ModelId;
}

function validateModelHarnessPolicy(
  model: string,
  harness: RuntimeName,
  path: string,
  context: TieredExecutionValidationContext,
): void {
  const provider = getProviderForModelSync(model);
  const authMode = context.providerAuth?.[provider.name as ModelProvider];
  const decision = canUseHarnessSync(harness, model, authMode);
  if (!decision.allowed) {
    throw new TieredExecutionConfigError(`${path} is not allowed: ${decision.reason ?? 'harness policy rejected this model/harness/auth combination'}`);
  }
}

export function normalizeTieredExecutionConfig(config?: Partial<TieredExecutionConfig>): TieredExecutionConfig {
  return {
    enabled: config?.enabled ?? false,
    tiers: config?.tiers ?? {},
    supervisor: config?.supervisor,
    by_kind: config?.by_kind ?? {},
    feed: config?.feed,
    escalation: config?.escalation,
    compaction_reroute: config?.compaction_reroute ?? 'off',
    replay_threshold: config?.replay_threshold ?? 0.5,
  };
}

function validateStringArray(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new TieredExecutionConfigError(`${path} must be an array of strings`);
  }
  return [...value];
}

function validateNonNegativeInteger(value: unknown, path: string, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TieredExecutionConfigError(`${path} must be a non-negative integer`);
  }
  return value as number;
}

function validateFeedConfig(config?: TieredExecutionFeedConfig): ValidatedTieredExecutionFeedConfig {
  const callouts = config?.callouts ?? 'off';
  if (!isCalloutPolicy(callouts)) {
    throw new TieredExecutionConfigError(`tiered_execution.feed.callouts must be one of ${TIERED_EXECUTION_CALLOUT_POLICIES.join(', ')}`);
  }

  const maxDiffBytes = config?.max_diff_bytes ?? null;
  if (
    maxDiffBytes !== null
    && (!Number.isInteger(maxDiffBytes) || maxDiffBytes <= 0)
  ) {
    throw new TieredExecutionConfigError('tiered_execution.feed.max_diff_bytes must be a positive integer or null');
  }

  return {
    callouts,
    exclude: validateStringArray(config?.exclude, 'tiered_execution.feed.exclude'),
    exclude_subjects: validateStringArray(config?.exclude_subjects, 'tiered_execution.feed.exclude_subjects'),
    max_diff_bytes: maxDiffBytes,
  };
}

function validateEscalationConfig(config?: TieredEscalationConfig): ValidatedEscalationConfig {
  const flounderBudget: Partial<Record<VBriefDifficulty, number>> = {};
  for (const [difficulty, budget] of Object.entries(config?.flounder_budget_minutes ?? {})) {
    if (!isDifficulty(difficulty)) {
      throw new TieredExecutionConfigError(`tiered_execution.escalation.flounder_budget_minutes contains unknown difficulty '${difficulty}'`);
    }
    if (!Number.isFinite(budget) || budget <= 0) {
      throw new TieredExecutionConfigError(`tiered_execution.escalation.flounder_budget_minutes.${difficulty} must be positive`);
    }
    flounderBudget[difficulty] = budget;
  }

  return {
    enabled: config?.enabled ?? false,
    retries_at_tier: validateNonNegativeInteger(config?.retries_at_tier, 'tiered_execution.escalation.retries_at_tier', 0),
    max_promotions: validateNonNegativeInteger(config?.max_promotions, 'tiered_execution.escalation.max_promotions', 0),
    flounder_budget_minutes: flounderBudget,
  };
}

export function validateTieredExecutionConfig(
  rawConfig?: Partial<TieredExecutionConfig>,
  context: TieredExecutionValidationContext = {},
): ValidatedTieredExecutionConfig {
  const config = normalizeTieredExecutionConfig(rawConfig);
  const feed = validateFeedConfig(config.feed);
  const escalation = validateEscalationConfig(config.escalation);
  if (!isCompactionReroutePolicy(config.compaction_reroute ?? 'off')) {
    throw new TieredExecutionConfigError(`tiered_execution.compaction_reroute must be one of ${TIERED_EXECUTION_COMPACTION_REROUTE_POLICIES.join(', ')}`);
  }
  const compactionReroute = config.compaction_reroute ?? 'off';
  const shouldValidateTierTable = config.enabled
    || Object.keys(config.tiers).length > 0
    || Object.keys(config.by_kind ?? {}).length > 0
    || config.supervisor !== undefined;
  if (!shouldValidateTierTable) {
    return { ...DEFAULT_TIERED_EXECUTION_CONFIG, feed, escalation, compaction_reroute: compactionReroute };
  }

  if (typeof config.replay_threshold !== 'number' || config.replay_threshold <= 0 || config.replay_threshold > 1) {
    throw new TieredExecutionConfigError('tiered_execution.replay_threshold must be a number > 0 and <= 1');
  }

  const difficultyOwners: Partial<Record<VBriefDifficulty, string[]>> = {};
  const normalizedTiers: Record<string, TierDefinition> = {};

  for (const [tierName, tier] of Object.entries(config.tiers)) {
    const path = `tiered_execution.tiers.${tierName}`;

    const rawDistribution = (tier as { distribution?: unknown }).distribution;
    let normalizedDistribution: TierDistributionEntry[] | undefined;
    let model: string;
    let harness: RuntimeName;
    if (rawDistribution !== undefined) {
      if (!Array.isArray(rawDistribution) || rawDistribution.length === 0) {
        throw new TieredExecutionConfigError(`${path}.distribution must be a non-empty array of {model, harness, weight}`);
      }
      normalizedDistribution = rawDistribution.map((entry, index) => {
        const entryPath = `${path}.distribution[${index}]`;
        const candidate = entry as Partial<TierDistributionEntry>;
        validateHarness(candidate.harness as RuntimeName, entryPath);
        const entryModel = validateModel(candidate.model as string, entryPath);
        validateModelHarnessPolicy(entryModel, candidate.harness as RuntimeName, entryPath, context);
        if (!Number.isInteger(candidate.weight) || (candidate.weight as number) <= 0) {
          throw new TieredExecutionConfigError(`${entryPath}.weight must be a positive integer`);
        }
        return { model: entryModel, harness: candidate.harness as RuntimeName, weight: candidate.weight as number };
      });
      const total = normalizedDistribution.reduce((sum, entry) => sum + entry.weight, 0);
      if (total !== 100) {
        throw new TieredExecutionConfigError(`${path}.distribution weights must total exactly 100 (got ${total})`);
      }
      const representative = normalizedDistribution.reduce((best, entry) => (entry.weight > best.weight ? entry : best));
      // Idempotent re-validation: a normalized config carries the max-weight
      // representative as model/harness alongside the distribution. Accept
      // model/harness that MATCH the representative; reject a genuine
      // conflicting declaration of both.
      if (
        (tier.model !== undefined && tier.model !== representative.model)
        || (tier.harness !== undefined && tier.harness !== representative.harness)
      ) {
        throw new TieredExecutionConfigError(`${path} must declare either model/harness or distribution, not both`);
      }
      model = representative.model;
      harness = representative.harness;
    } else {
      validateHarness(tier.harness, path);
      model = validateModel(tier.model, path);
      validateModelHarnessPolicy(model, tier.harness, path, context);
      harness = tier.harness;
    }

    if (!Array.isArray(tier.difficulties) || tier.difficulties.length === 0) {
      throw new TieredExecutionConfigError(`${path}.difficulties must contain at least one difficulty`);
    }

    const difficulties: VBriefDifficulty[] = [];
    for (const difficulty of tier.difficulties) {
      if (!isDifficulty(difficulty)) {
        throw new TieredExecutionConfigError(`${path}.difficulties contains unknown difficulty '${difficulty as string}'`);
      }
      difficulties.push(difficulty);
      difficultyOwners[difficulty] = [...(difficultyOwners[difficulty] ?? []), tierName];
    }

    normalizedTiers[tierName] = { model, harness, difficulties, ...(normalizedDistribution ? { distribution: normalizedDistribution } : {}) };
  }

  const difficultyToTier: Partial<Record<VBriefDifficulty, string>> = {};
  for (const difficulty of TIERED_EXECUTION_DIFFICULTIES) {
    const owners = difficultyOwners[difficulty] ?? [];
    if (owners.length === 0) {
      throw new TieredExecutionConfigError(`tiered_execution difficulty '${difficulty}' is not mapped to any tier`);
    }
    if (owners.length > 1) {
      throw new TieredExecutionConfigError(`tiered_execution difficulty '${difficulty}' is mapped to multiple tiers: ${owners.join(', ')}`);
    }
    difficultyToTier[difficulty] = owners[0];
  }

  const byKind: Partial<Record<VBriefItemKind, string>> = {};
  for (const [kind, tierName] of Object.entries(config.by_kind ?? {})) {
    if (!isItemKind(kind)) {
      throw new TieredExecutionConfigError(`tiered_execution.by_kind contains unknown item kind '${kind}'`);
    }
    if (!normalizedTiers[tierName]) {
      throw new TieredExecutionConfigError(`tiered_execution.by_kind.${kind} references unknown tier '${tierName}'`);
    }
    byKind[kind] = tierName;
  }

  if (!config.supervisor) {
    throw new TieredExecutionConfigError('tiered_execution.supervisor is required when tiered execution tiers are configured');
  }

  validateHarness(config.supervisor.harness, 'tiered_execution.supervisor');
  const supervisorModel = validateModel(config.supervisor.model, 'tiered_execution.supervisor');
  validateModelHarnessPolicy(supervisorModel, config.supervisor.harness, 'tiered_execution.supervisor', context);
  if (!isSubscription(config.supervisor.subscribe)) {
    throw new TieredExecutionConfigError(`tiered_execution.supervisor.subscribe must be one of ${TIERED_EXECUTION_SUBSCRIPTIONS.join(', ')}`);
  }

  return {
    enabled: config.enabled,
    tiers: normalizedTiers,
    supervisor: {
      model: supervisorModel,
      harness: config.supervisor.harness,
      subscribe: config.supervisor.subscribe,
      // PAN-2397 W4: a configured supervisor owns inspection by default —
      // one inspection path (the standing supervisor) instead of also
      // spawning ephemeral inspect/inspect-deep subrole agents. An explicit
      // `owns_inspection: false` still routes inspection to the subroles.
      owns_inspection: config.supervisor.owns_inspection ?? true,
    },
    by_kind: byKind,
    byKind,
    feed,
    escalation,
    compaction_reroute: compactionReroute,
    replay_threshold: config.replay_threshold,
    difficultyToTier,
  };
}
