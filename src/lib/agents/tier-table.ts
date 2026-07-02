import type { ModelProvider } from '../model-fallback.js';
import { canUseHarnessSync } from '../harness-policy.js';
import { resolveModelIdSync } from '../model-capabilities.js';
import { PROVIDERS, getProviderForModelSync } from '../providers.js';
import type { AuthMode } from '../subscription-types.js';
import type { RuntimeName } from '../runtimes/types.js';
import type { VBriefDifficulty } from '../vbrief/types.js';

export const VBRIEF_DIFFICULTIES: readonly VBriefDifficulty[] = [
  'trivial',
  'simple',
  'medium',
  'complex',
  'expert',
] as const;

export const SUPERVISOR_SUBSCRIPTIONS = ['all', 'flagged', 'sampled'] as const;
export type SupervisorSubscribe = typeof SUPERVISOR_SUBSCRIPTIONS[number];

export interface TieredExecutionTierConfig {
  model: string;
  harness: RuntimeName;
  difficulties: VBriefDifficulty[];
}

export interface TieredExecutionSupervisorConfig {
  model: string;
  harness: RuntimeName;
  subscribe: SupervisorSubscribe;
}

export interface TieredExecutionConfig {
  enabled: boolean;
  tiers: Record<string, TieredExecutionTierConfig>;
  supervisor?: TieredExecutionSupervisorConfig;
  replay_threshold: number;
}

export interface ValidatedTieredExecutionConfig {
  config: TieredExecutionConfig;
  difficultyToTier: Record<VBriefDifficulty, string>;
  supervisor?: TieredExecutionSupervisorConfig;
}

export interface TieredExecutionValidationContext {
  providerAuth?: Partial<Record<ModelProvider, AuthMode>>;
}

export class TieredExecutionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TieredExecutionValidationError';
  }
}

export const DEFAULT_TIERED_EXECUTION_CONFIG: TieredExecutionConfig = {
  enabled: false,
  tiers: {},
  replay_threshold: 0.5,
};

function isVBriefDifficulty(value: unknown): value is VBriefDifficulty {
  return typeof value === 'string' && VBRIEF_DIFFICULTIES.includes(value as VBriefDifficulty);
}

function isSupervisorSubscribe(value: unknown): value is SupervisorSubscribe {
  return typeof value === 'string' && SUPERVISOR_SUBSCRIPTIONS.includes(value as SupervisorSubscribe);
}

function normalizeRuntime(rawHarness: unknown, path: string): RuntimeName {
  if (typeof rawHarness !== 'string') {
    throw new TieredExecutionValidationError(`${path}.harness must be claude-code, ohmypi, or codex`);
  }
  if (rawHarness === 'pi' || rawHarness === 'ohmypi') {
    return 'ohmypi';
  }
  if (rawHarness === 'claude-code' || rawHarness === 'codex') {
    return rawHarness;
  }
  throw new TieredExecutionValidationError(`${path}.harness '${rawHarness}' is unknown`);
}

function isKnownModel(model: string): boolean {
  const resolved = resolveModelIdSync(model);
  return Object.values(PROVIDERS).some((provider) => provider.models.includes(resolved));
}

function normalizeModel(rawModel: unknown, path: string): string {
  if (typeof rawModel !== 'string' || rawModel.trim().length === 0) {
    throw new TieredExecutionValidationError(`${path}.model must be a known model id`);
  }

  const model = resolveModelIdSync(rawModel);
  if (!isKnownModel(model)) {
    throw new TieredExecutionValidationError(`${path}.model '${rawModel}' is unknown`);
  }
  return model;
}

function validateHarnessPolicy(
  harness: RuntimeName,
  model: string,
  path: string,
  context: TieredExecutionValidationContext,
): void {
  const provider = getProviderForModelSync(model).name;
  const authMode = context.providerAuth?.[provider];
  const decision = canUseHarnessSync(harness, model, authMode);
  if (!decision.allowed) {
    throw new TieredExecutionValidationError(
      `${path} violates harness policy: ${decision.reason ?? 'combination is not allowed'}`,
    );
  }
}

function normalizeDifficulties(rawDifficulties: unknown, path: string): VBriefDifficulty[] {
  if (!Array.isArray(rawDifficulties) || rawDifficulties.length === 0) {
    throw new TieredExecutionValidationError(`${path}.difficulties must list one or more vBRIEF difficulties`);
  }

  return rawDifficulties.map((difficulty) => {
    if (!isVBriefDifficulty(difficulty)) {
      throw new TieredExecutionValidationError(`${path}.difficulties contains unknown difficulty '${String(difficulty)}'`);
    }
    return difficulty;
  });
}

export function normalizeTieredExecutionConfig(
  input: Partial<TieredExecutionConfig> | undefined,
  context: TieredExecutionValidationContext = {},
): TieredExecutionConfig {
  const enabled = input?.enabled ?? DEFAULT_TIERED_EXECUTION_CONFIG.enabled;
  const replayThreshold = input?.replay_threshold ?? DEFAULT_TIERED_EXECUTION_CONFIG.replay_threshold;
  if (typeof replayThreshold !== 'number' || !Number.isFinite(replayThreshold) || replayThreshold < 0 || replayThreshold > 1) {
    throw new TieredExecutionValidationError('tiered_execution.replay_threshold must be a number between 0 and 1');
  }

  const tiers: Record<string, TieredExecutionTierConfig> = {};
  for (const [tierName, tier] of Object.entries(input?.tiers ?? {})) {
    if (!tier || typeof tier !== 'object') {
      throw new TieredExecutionValidationError(`tiered_execution.tiers.${tierName} must be an object`);
    }

    const path = `tiered_execution.tiers.${tierName}`;
    const model = normalizeModel((tier as Partial<TieredExecutionTierConfig>).model, path);
    const harness = normalizeRuntime((tier as Partial<TieredExecutionTierConfig>).harness, path);
    validateHarnessPolicy(harness, model, path, context);
    tiers[tierName] = {
      model,
      harness,
      difficulties: normalizeDifficulties((tier as Partial<TieredExecutionTierConfig>).difficulties, path),
    };
  }

  let supervisor: TieredExecutionSupervisorConfig | undefined;
  if (input?.supervisor !== undefined) {
    const path = 'tiered_execution.supervisor';
    const model = normalizeModel(input.supervisor.model, path);
    const harness = normalizeRuntime(input.supervisor.harness, path);
    validateHarnessPolicy(harness, model, path, context);
    const subscribe = input.supervisor.subscribe ?? 'flagged';
    if (!isSupervisorSubscribe(subscribe)) {
      throw new TieredExecutionValidationError(`${path}.subscribe must be all, flagged, or sampled`);
    }
    supervisor = { model, harness, subscribe };
  }

  const config: TieredExecutionConfig = {
    enabled,
    tiers,
    ...(supervisor ? { supervisor } : {}),
    replay_threshold: replayThreshold,
  };

  validateTieredExecutionConfig(config);
  return config;
}

export function validateTieredExecutionConfig(config: TieredExecutionConfig): ValidatedTieredExecutionConfig {
  const difficultyToTier = {} as Record<VBriefDifficulty, string>;

  if (!config.enabled && Object.keys(config.tiers).length === 0 && config.supervisor === undefined) {
    return { config, difficultyToTier };
  }

  if (config.enabled && config.supervisor === undefined) {
    throw new TieredExecutionValidationError('tiered_execution.supervisor is required when tiered execution is enabled');
  }

  for (const [tierName, tier] of Object.entries(config.tiers)) {
    for (const difficulty of tier.difficulties) {
      if (difficultyToTier[difficulty] !== undefined) {
        throw new TieredExecutionValidationError(
          `tiered_execution difficulty '${difficulty}' maps to both '${difficultyToTier[difficulty]}' and '${tierName}'`,
        );
      }
      difficultyToTier[difficulty] = tierName;
    }
  }

  for (const difficulty of VBRIEF_DIFFICULTIES) {
    if (difficultyToTier[difficulty] === undefined) {
      throw new TieredExecutionValidationError(`tiered_execution difficulty '${difficulty}' is not mapped to any tier`);
    }
  }

  return {
    config,
    difficultyToTier,
    ...(config.supervisor ? { supervisor: config.supervisor } : {}),
  };
}
