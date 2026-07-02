import type { RuntimeName } from '../runtimes/types.js';
import type { AuthMode } from '../subscription-types.js';
import { canUseHarnessSync } from '../harness-policy.js';
import { getProviderForModelSync, PROVIDERS } from '../providers.js';
import type { ModelProvider } from '../model-fallback.js';
import type { VBriefDifficulty } from '../vbrief/types.js';

export const VBRIEF_DIFFICULTIES: readonly VBriefDifficulty[] = [
  'trivial',
  'simple',
  'medium',
  'complex',
  'expert',
] as const;

export type SupervisorSubscribePolicy = 'all' | 'flagged' | 'sampled';

export interface TierDefinition {
  model: string;
  harness: RuntimeName;
  difficulties: VBriefDifficulty[];
}

export interface TierSupervisorDefinition {
  model: string;
  harness: RuntimeName;
  subscribe: SupervisorSubscribePolicy;
}

export interface TieredExecutionInput {
  enabled?: boolean;
  tiers?: Record<string, TierDefinition>;
  supervisor?: TierSupervisorDefinition;
  replay_threshold?: number;
}

export interface TieredExecutionConfig {
  enabled: boolean;
  tiers: Record<string, TierDefinition>;
  supervisor?: TierSupervisorDefinition;
  replay_threshold: number;
  difficultyToTier: Partial<Record<VBriefDifficulty, string>>;
}

export interface TierValidationContext {
  providerAuth?: Partial<Record<ModelProvider, AuthMode>>;
}

export const DEFAULT_TIERED_EXECUTION_CONFIG: TieredExecutionConfig = {
  enabled: false,
  tiers: {},
  replay_threshold: 0.5,
  difficultyToTier: {},
};

const VALID_HARNESSES = new Set<RuntimeName>(['claude-code', 'ohmypi', 'codex']);
const VALID_SUBSCRIBE_POLICIES = new Set<SupervisorSubscribePolicy>(['all', 'flagged', 'sampled']);
const KNOWN_MODELS = new Set(
  Object.values(PROVIDERS).flatMap((provider) => provider.models),
);

function isKnownModel(model: string): boolean {
  return KNOWN_MODELS.has(model) || model.includes('/');
}

function assertHarness(value: string, fieldPath: string): asserts value is RuntimeName {
  if (!VALID_HARNESSES.has(value as RuntimeName)) {
    throw new Error(`config.yaml: ${fieldPath} must be claude-code, ohmypi, or codex`);
  }
}

function assertSubscribe(value: string, fieldPath: string): asserts value is SupervisorSubscribePolicy {
  if (!VALID_SUBSCRIBE_POLICIES.has(value as SupervisorSubscribePolicy)) {
    throw new Error(`config.yaml: ${fieldPath} must be all, flagged, or sampled`);
  }
}

function validateModelHarness(
  model: string,
  harness: RuntimeName,
  fieldPath: string,
  context: TierValidationContext,
): void {
  if (!isKnownModel(model)) {
    throw new Error(`config.yaml: ${fieldPath}.model unknown model "${model}"`);
  }

  const provider = getProviderForModelSync(model);
  const decision = canUseHarnessSync(harness, model, context.providerAuth?.[provider.name]);
  if (!decision.allowed) {
    throw new Error(`config.yaml: ${fieldPath} violates harness policy: ${decision.reason}`);
  }
}

function validateTierDefinition(
  tierName: string,
  tier: TierDefinition,
  context: TierValidationContext,
): void {
  const fieldPath = `tiered_execution.tiers.${tierName}`;
  if (!tier || typeof tier !== 'object') {
    throw new Error(`config.yaml: ${fieldPath} must be an object`);
  }
  if (!tier.model || typeof tier.model !== 'string') {
    throw new Error(`config.yaml: ${fieldPath}.model must be a non-empty string`);
  }
  assertHarness(tier.harness as string, `${fieldPath}.harness`);
  if (!Array.isArray(tier.difficulties) || tier.difficulties.length === 0) {
    throw new Error(`config.yaml: ${fieldPath}.difficulties must be a non-empty array`);
  }
  for (const difficulty of tier.difficulties) {
    if (!(VBRIEF_DIFFICULTIES as readonly string[]).includes(difficulty)) {
      throw new Error(`config.yaml: ${fieldPath}.difficulties contains unknown difficulty "${difficulty}"`);
    }
  }
  validateModelHarness(tier.model, tier.harness, fieldPath, context);
}

function validateSupervisor(
  supervisor: TierSupervisorDefinition,
  context: TierValidationContext,
): void {
  const fieldPath = 'tiered_execution.supervisor';
  if (!supervisor || typeof supervisor !== 'object') {
    throw new Error(`config.yaml: ${fieldPath} must be an object`);
  }
  if (!supervisor.model || typeof supervisor.model !== 'string') {
    throw new Error(`config.yaml: ${fieldPath}.model must be a non-empty string`);
  }
  assertHarness(supervisor.harness as string, `${fieldPath}.harness`);
  assertSubscribe(supervisor.subscribe as string, `${fieldPath}.subscribe`);
  validateModelHarness(supervisor.model, supervisor.harness, fieldPath, context);
}

export function validateTieredExecutionConfig(
  config: TieredExecutionConfig,
  context: TierValidationContext = {},
): TieredExecutionConfig {
  if (typeof config.enabled !== 'boolean') {
    throw new Error('config.yaml: tiered_execution.enabled must be a boolean');
  }
  if (typeof config.replay_threshold !== 'number' || config.replay_threshold < 0 || config.replay_threshold > 1) {
    throw new Error('config.yaml: tiered_execution.replay_threshold must be a number between 0 and 1');
  }

  const tierNames = Object.keys(config.tiers);
  if (!config.enabled && tierNames.length === 0 && config.supervisor === undefined) {
    return { ...config, difficultyToTier: {} };
  }
  if (!config.supervisor) {
    throw new Error('config.yaml: tiered_execution.supervisor is required when tiered_execution is configured');
  }

  const difficultyToTier = {} as Record<VBriefDifficulty, string>;
  const duplicates = new Set<VBriefDifficulty>();
  for (const [tierName, tier] of Object.entries(config.tiers)) {
    validateTierDefinition(tierName, tier, context);
    for (const difficulty of tier.difficulties) {
      if (difficultyToTier[difficulty]) {
        duplicates.add(difficulty);
      } else {
        difficultyToTier[difficulty] = tierName;
      }
    }
  }

  for (const difficulty of VBRIEF_DIFFICULTIES) {
    if (duplicates.has(difficulty)) {
      throw new Error(`config.yaml: tiered_execution difficulty "${difficulty}" maps to multiple tiers`);
    }
    if (!difficultyToTier[difficulty]) {
      throw new Error(`config.yaml: tiered_execution difficulty "${difficulty}" maps to zero tiers`);
    }
  }

  validateSupervisor(config.supervisor, context);
  return { ...config, difficultyToTier };
}

export function mergeTieredExecutionConfig(
  base: TieredExecutionConfig,
  input: TieredExecutionInput | undefined,
  context: TierValidationContext = {},
): TieredExecutionConfig {
  if (!input) {
    return validateTieredExecutionConfig(base, context);
  }

  const merged: TieredExecutionConfig = {
    enabled: input.enabled ?? base.enabled,
    tiers: input.tiers ?? base.tiers,
    supervisor: input.supervisor ?? base.supervisor,
    replay_threshold: input.replay_threshold ?? base.replay_threshold,
    difficultyToTier: {},
  };

  return validateTieredExecutionConfig(merged, context);
}
