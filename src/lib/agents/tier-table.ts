import { MODEL_CAPABILITIES, resolveModelIdSync } from '../model-capabilities.js';
import { getProviderForModelSync } from '../providers.js';
import type { AuthMode } from '../subscription-types.js';
import type { RuntimeName } from '../runtimes/types.js';
import type { ModelProvider } from '../model-fallback.js';
import { canUseHarnessSync } from '../harness-policy.js';
import type { VBriefDifficulty } from '../vbrief/types.js';

export const VBRIEF_DIFFICULTIES: readonly VBriefDifficulty[] = [
  'trivial',
  'simple',
  'medium',
  'complex',
  'expert',
] as const;

export type TierSupervisorSubscribe = 'all' | 'flagged' | 'sampled';

export interface TierDefinition {
  model: string;
  harness: RuntimeName;
  difficulties: VBriefDifficulty[];
}

export interface TierSupervisorPolicy {
  model: string;
  harness: RuntimeName;
  subscribe: TierSupervisorSubscribe;
}

export interface TieredExecutionConfig {
  enabled: boolean;
  tiers: Record<string, TierDefinition>;
  supervisor?: TierSupervisorPolicy;
  replay_threshold: number;
}

export interface ValidatedTieredExecutionConfig extends TieredExecutionConfig {
  difficultyToTier: Record<VBriefDifficulty, string>;
  supervisor: TierSupervisorPolicy;
}

export type YamlTieredExecutionConfig = Partial<{
  enabled: boolean;
  tiers: Record<string, Partial<{
    model: string;
    harness: RuntimeName;
    difficulties: VBriefDifficulty[];
  }>>;
  supervisor: Partial<{
    model: string;
    harness: RuntimeName;
    subscribe: TierSupervisorSubscribe;
  }>;
  replay_threshold: number;
}>;

export interface TieredExecutionValidationContext {
  providerAuth?: Partial<Record<ModelProvider, AuthMode>>;
}

const VALID_HARNESSES: readonly RuntimeName[] = ['claude-code', 'ohmypi', 'codex'] as const;
const VALID_SUBSCRIBE: readonly TierSupervisorSubscribe[] = ['all', 'flagged', 'sampled'] as const;

export const DEFAULT_TIERED_EXECUTION_CONFIG: TieredExecutionConfig = {
  enabled: false,
  tiers: {},
  replay_threshold: 0.5,
};

function isRuntimeName(value: unknown): value is RuntimeName {
  return typeof value === 'string' && (VALID_HARNESSES as readonly string[]).includes(value);
}

function isSupervisorSubscribe(value: unknown): value is TierSupervisorSubscribe {
  return typeof value === 'string' && (VALID_SUBSCRIBE as readonly string[]).includes(value);
}

function isVBriefDifficulty(value: unknown): value is VBriefDifficulty {
  return typeof value === 'string' && (VBRIEF_DIFFICULTIES as readonly string[]).includes(value);
}

function validateModelHarness(
  path: string,
  model: unknown,
  harness: unknown,
  context: TieredExecutionValidationContext,
): { model: string; harness: RuntimeName } {
  if (typeof model !== 'string' || model.trim() === '') {
    throw new Error(`config.yaml: tiered_execution.${path}.model must be a known model id`);
  }

  const resolvedModel = resolveModelIdSync(model);
  if (!MODEL_CAPABILITIES[resolvedModel as keyof typeof MODEL_CAPABILITIES]) {
    throw new Error(`config.yaml: tiered_execution.${path}.model unknown model: ${model}`);
  }

  if (!isRuntimeName(harness)) {
    throw new Error(`config.yaml: tiered_execution.${path}.harness must be ${VALID_HARNESSES.join(', ')}`);
  }

  const provider = getProviderForModelSync(resolvedModel).name as ModelProvider;
  const decision = canUseHarnessSync(harness, resolvedModel, context.providerAuth?.[provider]);
  if (!decision.allowed) {
    throw new Error(`config.yaml: tiered_execution.${path} violates harness policy: ${decision.reason}`);
  }

  return { model: resolvedModel, harness };
}

export function validateTieredExecutionConfig(
  config: TieredExecutionConfig,
  context: TieredExecutionValidationContext = {},
): ValidatedTieredExecutionConfig {
  const difficultyToTier = {} as Record<VBriefDifficulty, string>;

  if (typeof config.replay_threshold !== 'number' || config.replay_threshold < 0 || config.replay_threshold > 1) {
    throw new Error('config.yaml: tiered_execution.replay_threshold must be a number between 0 and 1');
  }

  for (const [tierName, tier] of Object.entries(config.tiers)) {
    if (!tierName.trim()) {
      throw new Error('config.yaml: tiered_execution.tiers contains an empty tier name');
    }

    validateModelHarness(`tiers.${tierName}`, tier.model, tier.harness, context);

    if (!Array.isArray(tier.difficulties) || tier.difficulties.length === 0) {
      throw new Error(`config.yaml: tiered_execution.tiers.${tierName}.difficulties must include at least one difficulty`);
    }

    for (const difficulty of tier.difficulties) {
      if (!isVBriefDifficulty(difficulty)) {
        throw new Error(`config.yaml: tiered_execution.tiers.${tierName}.difficulties contains unknown difficulty: ${String(difficulty)}`);
      }
      if (difficultyToTier[difficulty]) {
        throw new Error(`config.yaml: tiered_execution difficulty ${difficulty} maps to multiple tiers: ${difficultyToTier[difficulty]}, ${tierName}`);
      }
      difficultyToTier[difficulty] = tierName;
    }
  }

  for (const difficulty of VBRIEF_DIFFICULTIES) {
    if (!difficultyToTier[difficulty]) {
      throw new Error(`config.yaml: tiered_execution difficulty ${difficulty} maps to zero tiers`);
    }
  }

  if (!config.supervisor) {
    throw new Error('config.yaml: tiered_execution.supervisor is required when tiers are configured');
  }

  const supervisor = validateModelHarness('supervisor', config.supervisor.model, config.supervisor.harness, context);
  if (!isSupervisorSubscribe(config.supervisor.subscribe)) {
    throw new Error(`config.yaml: tiered_execution.supervisor.subscribe must be ${VALID_SUBSCRIBE.join(', ')}`);
  }

  return {
    ...config,
    supervisor: {
      ...supervisor,
      subscribe: config.supervisor.subscribe,
    },
    difficultyToTier,
  };
}

export function mergeTieredExecutionConfig(
  current: TieredExecutionConfig,
  incoming: YamlTieredExecutionConfig | undefined,
): TieredExecutionConfig {
  if (!incoming) return current;

  return {
    enabled: incoming.enabled ?? current.enabled,
    tiers: incoming.tiers !== undefined
      ? Object.fromEntries(
        Object.entries(incoming.tiers).map(([name, tier]) => [
          name,
          {
            model: tier.model,
            harness: tier.harness,
            difficulties: tier.difficulties ? [...tier.difficulties] : undefined,
          },
        ]),
      ) as Record<string, TierDefinition>
      : current.tiers,
    supervisor: incoming.supervisor !== undefined
      ? {
        model: incoming.supervisor.model,
        harness: incoming.supervisor.harness,
        subscribe: incoming.supervisor.subscribe,
      } as TierSupervisorPolicy
      : current.supervisor,
    replay_threshold: incoming.replay_threshold ?? current.replay_threshold,
  };
}
