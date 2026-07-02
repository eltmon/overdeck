import { canUseHarnessSync } from '../harness-policy.js';
import { MODEL_CAPABILITIES, resolveModelIdSync } from '../model-capabilities.js';
import { getProviderForModelSync, PROVIDERS } from '../providers.js';
import type { RuntimeName } from '../runtimes/types.js';
import type { ModelId } from '../settings.js';
import type { AuthMode } from '../subscription-types.js';
import type { VBriefDifficulty } from '../vbrief/types.js';
import type { ModelProvider } from '../model-fallback.js';

export const VBRIEF_DIFFICULTIES: readonly VBriefDifficulty[] = [
  'trivial',
  'simple',
  'medium',
  'complex',
  'expert',
] as const;

export const TIER_SUPERVISOR_SUBSCRIBE_MODES = ['all', 'flagged', 'sampled'] as const;
export type TierSupervisorSubscribe = typeof TIER_SUPERVISOR_SUBSCRIBE_MODES[number];

export interface TierDefinition {
  model: ModelId;
  harness: RuntimeName;
  difficulties: VBriefDifficulty[];
}

export interface TierSupervisorConfig {
  model: ModelId;
  harness: RuntimeName;
  subscribe: TierSupervisorSubscribe;
}

export interface TieredExecutionConfig {
  enabled: boolean;
  tiers: Record<string, TierDefinition>;
  supervisor: TierSupervisorConfig;
  replay_threshold: number;
}

export interface ValidatedTieredExecutionConfig extends TieredExecutionConfig {
  difficulty_to_tier: Partial<Record<VBriefDifficulty, string>>;
}

export type TieredExecutionYamlConfig = Partial<{
  enabled: boolean;
  tiers: Record<string, Partial<TierDefinition>>;
  supervisor: Partial<TierSupervisorConfig>;
  replay_threshold: number;
}>;

export class TieredExecutionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TieredExecutionConfigError';
  }
}

export const DEFAULT_TIERED_EXECUTION_CONFIG: TieredExecutionConfig = {
  enabled: false,
  tiers: {},
  supervisor: {
    model: 'claude-sonnet-5',
    harness: 'claude-code',
    subscribe: 'flagged',
  },
  replay_threshold: 0.5,
};

const VALID_HARNESSES: readonly RuntimeName[] = ['claude-code', 'ohmypi', 'codex'] as const;
const VALID_MODELS = new Set<string>([
  ...Object.keys(MODEL_CAPABILITIES),
  ...Object.values(PROVIDERS).flatMap((provider) => provider.models.map(String)),
]);

function isDifficulty(value: unknown): value is VBriefDifficulty {
  return typeof value === 'string' && VBRIEF_DIFFICULTIES.includes(value as VBriefDifficulty);
}

function isHarness(value: unknown): value is RuntimeName {
  return typeof value === 'string' && VALID_HARNESSES.includes(value as RuntimeName);
}

function isSupervisorSubscribe(value: unknown): value is TierSupervisorSubscribe {
  return typeof value === 'string' && TIER_SUPERVISOR_SUBSCRIBE_MODES.includes(value as TierSupervisorSubscribe);
}

function assertKnownModel(model: unknown, path: string): asserts model is ModelId {
  if (typeof model !== 'string' || model.length === 0 || !VALID_MODELS.has(resolveModelIdSync(model))) {
    throw new TieredExecutionConfigError(`config.yaml: ${path}.model references unknown model "${String(model)}"`);
  }
}

function assertHarness(harness: unknown, path: string): asserts harness is RuntimeName {
  if (!isHarness(harness)) {
    throw new TieredExecutionConfigError(`config.yaml: ${path}.harness must be claude-code, ohmypi, or codex`);
  }
}

function assertPolicyAllowed(
  entry: { model: ModelId; harness: RuntimeName },
  authByProvider: Partial<Record<ModelProvider, AuthMode>>,
  path: string,
): void {
  const provider = getProviderForModelSync(entry.model).name as ModelProvider;
  const decision = canUseHarnessSync(entry.harness, entry.model, authByProvider[provider]);
  if (!decision.allowed) {
    throw new TieredExecutionConfigError(
      `config.yaml: ${path} is not allowed: ${decision.reason ?? `${entry.harness} cannot run ${entry.model}`}`,
    );
  }
}

function normalizeTierDefinition(tierName: string, tier: Partial<TierDefinition> | undefined): TierDefinition {
  const path = `tiered_execution.tiers.${tierName}`;
  if (!tier || typeof tier !== 'object') {
    throw new TieredExecutionConfigError(`config.yaml: ${path} must be an object`);
  }
  assertKnownModel(tier.model, path);
  assertHarness(tier.harness, path);
  if (!Array.isArray(tier.difficulties)) {
    throw new TieredExecutionConfigError(`config.yaml: ${path}.difficulties must be an array`);
  }
  const difficulties = tier.difficulties.map((difficulty) => {
    if (!isDifficulty(difficulty)) {
      throw new TieredExecutionConfigError(
        `config.yaml: ${path}.difficulties contains unknown difficulty "${String(difficulty)}"`,
      );
    }
    return difficulty;
  });
  return {
    model: resolveModelIdSync(tier.model),
    harness: tier.harness,
    difficulties,
  };
}

function normalizeSupervisor(supervisor: Partial<TierSupervisorConfig>): TierSupervisorConfig {
  const path = 'tiered_execution.supervisor';
  assertKnownModel(supervisor.model, path);
  assertHarness(supervisor.harness, path);
  if (!isSupervisorSubscribe(supervisor.subscribe)) {
    throw new TieredExecutionConfigError(`config.yaml: ${path}.subscribe must be all, flagged, or sampled`);
  }
  return {
    model: resolveModelIdSync(supervisor.model),
    harness: supervisor.harness,
    subscribe: supervisor.subscribe,
  };
}

export function mergeTieredExecutionConfig(
  base: TieredExecutionConfig,
  override: TieredExecutionYamlConfig | undefined,
): TieredExecutionConfig {
  if (!override) {
    return {
      enabled: base.enabled,
      tiers: { ...base.tiers },
      supervisor: { ...base.supervisor },
      replay_threshold: base.replay_threshold,
    };
  }

  return {
    enabled: override.enabled ?? base.enabled,
    tiers: override.tiers !== undefined
      ? {
          ...base.tiers,
          ...Object.fromEntries(
            Object.entries(override.tiers).map(([tierName, tier]) => [
              tierName,
              {
                ...base.tiers[tierName],
                ...tier,
                difficulties: tier.difficulties ?? base.tiers[tierName]?.difficulties,
              } as TierDefinition,
            ]),
          ),
        }
      : { ...base.tiers },
    supervisor: {
      ...base.supervisor,
      ...override.supervisor,
    },
    replay_threshold: override.replay_threshold ?? base.replay_threshold,
  };
}

export function validateTieredExecutionConfig(
  config: TieredExecutionConfig,
  authByProvider: Partial<Record<ModelProvider, AuthMode>> = {},
): ValidatedTieredExecutionConfig {
  if (typeof config.enabled !== 'boolean') {
    throw new TieredExecutionConfigError('config.yaml: tiered_execution.enabled must be a boolean');
  }
  if (typeof config.replay_threshold !== 'number' || config.replay_threshold < 0 || config.replay_threshold > 1) {
    throw new TieredExecutionConfigError('config.yaml: tiered_execution.replay_threshold must be a number between 0 and 1');
  }

  const supervisor = normalizeSupervisor(config.supervisor);
  assertPolicyAllowed(supervisor, authByProvider, 'tiered_execution.supervisor');

  const tiers: Record<string, TierDefinition> = {};
  for (const [tierName, tier] of Object.entries(config.tiers)) {
    tiers[tierName] = normalizeTierDefinition(tierName, tier);
    assertPolicyAllowed(tiers[tierName], authByProvider, `tiered_execution.tiers.${tierName}`);
  }

  const difficultyToTier: Partial<Record<VBriefDifficulty, string>> = {};
  const duplicateDifficulties = new Set<VBriefDifficulty>();
  for (const [tierName, tier] of Object.entries(tiers)) {
    for (const difficulty of tier.difficulties) {
      if (difficultyToTier[difficulty] !== undefined) {
        duplicateDifficulties.add(difficulty);
      }
      difficultyToTier[difficulty] = tierName;
    }
  }

  if (config.enabled || Object.keys(tiers).length > 0) {
    for (const difficulty of VBRIEF_DIFFICULTIES) {
      if (duplicateDifficulties.has(difficulty)) {
        throw new TieredExecutionConfigError(
          `config.yaml: tiered_execution difficulty "${difficulty}" maps to more than one tier`,
        );
      }
      if (difficultyToTier[difficulty] === undefined) {
        throw new TieredExecutionConfigError(
          `config.yaml: tiered_execution difficulty "${difficulty}" maps to zero tiers`,
        );
      }
    }
  }

  return {
    enabled: config.enabled,
    tiers,
    supervisor,
    replay_threshold: config.replay_threshold,
    difficulty_to_tier: difficultyToTier,
  };
}
