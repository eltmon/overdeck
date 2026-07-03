import type { RuntimeName } from '../runtimes/types.js';
import type { ModelId } from '../settings.js';
import type { VBriefDifficulty, VBriefItemKind } from '../vbrief/types.js';
import type { AuthMode } from '../subscription-types.js';
import type { ModelProvider } from '../model-fallback.js';
import { resolveModelIdSync } from '../model-capabilities.js';
import { getProviderForModelSync, PROVIDERS } from '../providers.js';
import { canUseHarnessSync } from '../harness-policy.js';

export const TIERED_EXECUTION_DIFFICULTIES: readonly VBriefDifficulty[] = ['trivial', 'simple', 'medium', 'complex', 'expert'] as const;
export const TIERED_EXECUTION_SUBSCRIPTIONS = ['all', 'flagged', 'sampled'] as const;
export const TIERED_EXECUTION_ITEM_KINDS: readonly VBriefItemKind[] = ['docs', 'api', 'backend', 'frontend', 'infra', 'test', 'refactor', 'design', 'spike'] as const;
export const TIERED_EXECUTION_CALLOUT_POLICIES = ['off', 'notify', 'corroborate'] as const;
export const TIERED_EXECUTION_COMPACTION_REROUTE_POLICIES = ['off', 'on'] as const;

export type TieredExecutionSubscription = typeof TIERED_EXECUTION_SUBSCRIPTIONS[number];
export type TieredExecutionCalloutPolicy = typeof TIERED_EXECUTION_CALLOUT_POLICIES[number];
export type TieredExecutionCompactionReroutePolicy = typeof TIERED_EXECUTION_COMPACTION_REROUTE_POLICIES[number];

export interface TierDefinition {
  model: ModelId | string;
  harness: RuntimeName;
  difficulties: VBriefDifficulty[];
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

/**
 * Per-issue tiered_execution opt-in/out (PAN-1791 FR-9). An issue's vBRIEF
 * may set `tiered_execution: 'on' | 'off'` in plan.metadata; an explicit
 * value wins over the global `tiered_execution.enabled` flag, and an unset
 * value inherits it — zero behavior change from today. Any other value is a
 * config error (fail-loud, no silent inherit on typos like 'yes' or true).
 */
export function resolveTieredExecutionEnabled(
  config: Pick<TieredExecutionConfig, 'enabled'>,
  planMetadata?: { [key: string]: unknown },
): boolean {
  const override = planMetadata?.tiered_execution;
  if (override === undefined || override === null) return config.enabled;
  if (override === 'on') return true;
  if (override === 'off') return false;
  throw new TieredExecutionConfigError(
    `plan.metadata.tiered_execution must be one of ${TIERED_EXECUTION_ISSUE_OVERRIDES.join(', ')}; got ${JSON.stringify(override)}`,
  );
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
    validateHarness(tier.harness, path);
    const model = validateModel(tier.model, path);
    validateModelHarnessPolicy(model, tier.harness, path, context);

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

    normalizedTiers[tierName] = { model, harness: tier.harness, difficulties };
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
      owns_inspection: config.supervisor.owns_inspection ?? false,
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
