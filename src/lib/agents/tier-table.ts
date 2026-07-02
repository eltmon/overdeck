import type { RuntimeName } from '../runtimes/types.js';
import type { ModelId } from '../settings.js';
import type { VBriefDifficulty } from '../vbrief/types.js';
import type { AuthMode } from '../subscription-types.js';
import type { ModelProvider } from '../model-fallback.js';
import { resolveModelIdSync } from '../model-capabilities.js';
import { getProviderForModelSync, PROVIDERS } from '../providers.js';
import { canUseHarnessSync } from '../harness-policy.js';

export const TIERED_EXECUTION_DIFFICULTIES: readonly VBriefDifficulty[] = ['trivial', 'simple', 'medium', 'complex', 'expert'] as const;
export const TIERED_EXECUTION_SUBSCRIPTIONS = ['all', 'flagged', 'sampled'] as const;

export type TieredExecutionSubscription = typeof TIERED_EXECUTION_SUBSCRIPTIONS[number];

export interface TierDefinition {
  model: ModelId | string;
  harness: RuntimeName;
  difficulties: VBriefDifficulty[];
}

export interface TieredExecutionSupervisorConfig {
  model: ModelId | string;
  harness: RuntimeName;
  subscribe: TieredExecutionSubscription;
}

export interface TieredExecutionConfig {
  enabled: boolean;
  tiers: Record<string, TierDefinition>;
  supervisor?: TieredExecutionSupervisorConfig;
  replay_threshold: number;
}

export interface ValidatedTieredExecutionConfig extends TieredExecutionConfig {
  difficultyToTier: Partial<Record<VBriefDifficulty, string>>;
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
    replay_threshold: config?.replay_threshold ?? 0.5,
  };
}

export function validateTieredExecutionConfig(
  rawConfig?: Partial<TieredExecutionConfig>,
  context: TieredExecutionValidationContext = {},
): ValidatedTieredExecutionConfig {
  const config = normalizeTieredExecutionConfig(rawConfig);
  const shouldValidateTierTable = config.enabled || Object.keys(config.tiers).length > 0 || config.supervisor !== undefined;
  if (!shouldValidateTierTable) {
    return { ...DEFAULT_TIERED_EXECUTION_CONFIG };
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
    },
    replay_threshold: config.replay_threshold,
    difficultyToTier,
  };
}
