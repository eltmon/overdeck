import { canUseHarnessSync } from '../harness-policy.js';
import { PROVIDERS, getProviderForModelSync } from '../providers.js';
import type { HarnessName, RuntimeName } from '../runtimes/types.js';
import type { AuthMode } from '../subscription-types.js';
import type { VBriefDifficulty } from '../vbrief/types.js';

export const VBRIEF_DIFFICULTIES: readonly VBriefDifficulty[] = [
  'trivial',
  'simple',
  'medium',
  'complex',
  'expert',
] as const;

export const SUPERVISOR_SUBSCRIBE_POLICIES = ['all', 'flagged', 'sampled'] as const;

export type SupervisorSubscribePolicy = typeof SUPERVISOR_SUBSCRIBE_POLICIES[number];

export interface TieredExecutionTierConfig {
  model: string;
  harness: HarnessName;
  difficulties: VBriefDifficulty[];
}

export interface TieredExecutionSupervisorConfig {
  model: string;
  harness: HarnessName;
  subscribe: SupervisorSubscribePolicy;
}

export interface TieredExecutionConfig {
  enabled: boolean;
  tiers: Record<string, TieredExecutionTierConfig>;
  supervisor?: TieredExecutionSupervisorConfig;
  replay_threshold: number;
}

export interface ResolvedTieredExecutionTierConfig extends Omit<TieredExecutionTierConfig, 'harness'> {
  harness: RuntimeName;
}

export interface ResolvedTieredExecutionSupervisorConfig extends Omit<TieredExecutionSupervisorConfig, 'harness'> {
  harness: RuntimeName;
}

export interface ResolvedTieredExecutionConfig extends Omit<TieredExecutionConfig, 'tiers' | 'supervisor'> {
  tiers: Record<string, ResolvedTieredExecutionTierConfig>;
  supervisor?: ResolvedTieredExecutionSupervisorConfig;
  difficultyToTier?: Record<VBriefDifficulty, string>;
}

export class TieredExecutionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TieredExecutionConfigError';
  }
}

const KNOWN_MODELS = new Set<string>(
  Object.values(PROVIDERS).flatMap(provider => provider.models.map(model => String(model))),
);

function normalizeHarness(value: unknown): RuntimeName | null {
  if (value === 'pi' || value === 'ohmypi') return 'ohmypi';
  if (value === 'claude-code' || value === 'codex') return value;
  return null;
}

function isDifficulty(value: unknown): value is VBriefDifficulty {
  return VBRIEF_DIFFICULTIES.includes(value as VBriefDifficulty);
}

function authModeForModel(model: string, providerAuth: Partial<Record<string, AuthMode>>): AuthMode | undefined {
  const provider = getProviderForModelSync(model).name;
  return providerAuth[provider];
}

function validateModelHarness(
  fieldPath: string,
  model: unknown,
  harness: unknown,
  providerAuth: Partial<Record<string, AuthMode>>,
): { model: string; harness: RuntimeName } {
  if (typeof model !== 'string' || !KNOWN_MODELS.has(model)) {
    throw new TieredExecutionConfigError(`${fieldPath}.model unknown model ${String(model)}`);
  }

  const normalizedHarness = normalizeHarness(harness);
  if (!normalizedHarness) {
    throw new TieredExecutionConfigError(`${fieldPath}.harness unknown harness ${String(harness)}`);
  }

  const decision = canUseHarnessSync(normalizedHarness, model, authModeForModel(model, providerAuth));
  if (!decision.allowed) {
    throw new TieredExecutionConfigError(`${fieldPath} denied by harness policy: ${decision.reason ?? 'policy denied'}`);
  }

  return { model, harness: normalizedHarness };
}

function validateSupervisorSubscribe(value: unknown): SupervisorSubscribePolicy {
  if (SUPERVISOR_SUBSCRIBE_POLICIES.includes(value as SupervisorSubscribePolicy)) {
    return value as SupervisorSubscribePolicy;
  }
  throw new TieredExecutionConfigError('tiered_execution.supervisor.subscribe must be all, flagged, or sampled');
}

export function validateTieredExecutionConfig(
  config: TieredExecutionConfig,
  providerAuth: Partial<Record<string, AuthMode>> = {},
): ResolvedTieredExecutionConfig {
  if (typeof config.enabled !== 'boolean') {
    throw new TieredExecutionConfigError('tiered_execution.enabled must be boolean');
  }
  if (typeof config.replay_threshold !== 'number' || config.replay_threshold < 0 || config.replay_threshold > 1) {
    throw new TieredExecutionConfigError('tiered_execution.replay_threshold must be a number between 0 and 1');
  }
  if (!config.tiers || typeof config.tiers !== 'object' || Array.isArray(config.tiers)) {
    throw new TieredExecutionConfigError('tiered_execution.tiers must be an object');
  }

  if (!config.enabled && Object.keys(config.tiers).length === 0 && config.supervisor === undefined) {
    return {
      enabled: config.enabled,
      tiers: {},
      replay_threshold: config.replay_threshold,
    };
  }

  const difficultyToTier = Object.fromEntries(
    VBRIEF_DIFFICULTIES.map(difficulty => [difficulty, undefined]),
  ) as Partial<Record<VBriefDifficulty, string>>;
  const tiers: Record<string, ResolvedTieredExecutionTierConfig> = {};

  for (const [tierName, tier] of Object.entries(config.tiers)) {
    if (!tier || typeof tier !== 'object' || Array.isArray(tier)) {
      throw new TieredExecutionConfigError(`tiered_execution.tiers.${tierName} must be an object`);
    }

    const modelHarness = validateModelHarness(`tiered_execution.tiers.${tierName}`, tier.model, tier.harness, providerAuth);
    if (!Array.isArray(tier.difficulties) || tier.difficulties.length === 0) {
      throw new TieredExecutionConfigError(`tiered_execution.tiers.${tierName}.difficulties must be a non-empty array`);
    }
    tiers[tierName] = { ...modelHarness, difficulties: tier.difficulties };

    for (const difficulty of tier.difficulties) {
      if (!isDifficulty(difficulty)) {
        throw new TieredExecutionConfigError(`tiered_execution.tiers.${tierName}.difficulties unknown difficulty ${String(difficulty)}`);
      }
      const existingTier = difficultyToTier[difficulty];
      if (existingTier) {
        throw new TieredExecutionConfigError(`tiered_execution difficulty ${difficulty} maps to multiple tiers: ${existingTier}, ${tierName}`);
      }
      difficultyToTier[difficulty] = tierName;
    }
  }

  for (const difficulty of VBRIEF_DIFFICULTIES) {
    if (!difficultyToTier[difficulty]) {
      throw new TieredExecutionConfigError(`tiered_execution difficulty ${difficulty} maps to zero tiers`);
    }
  }

  if (!config.supervisor || typeof config.supervisor !== 'object' || Array.isArray(config.supervisor)) {
    throw new TieredExecutionConfigError('tiered_execution.supervisor must be configured');
  }
  const supervisorModelHarness = validateModelHarness(
    'tiered_execution.supervisor',
    config.supervisor.model,
    config.supervisor.harness,
    providerAuth,
  );
  const supervisor: ResolvedTieredExecutionSupervisorConfig = {
    ...supervisorModelHarness,
    subscribe: validateSupervisorSubscribe(config.supervisor.subscribe),
  };

  return {
    ...config,
    tiers,
    supervisor,
    difficultyToTier: difficultyToTier as Record<VBriefDifficulty, string>,
  };
}
