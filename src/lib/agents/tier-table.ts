import type { ModelProvider } from '../model-fallback.js';
import { getModelProviderSync } from '../model-fallback.js';
import { hasModelCapabilitySync } from '../model-capabilities.js';
import type { RuntimeName } from '../runtimes/types.js';
import type { AuthMode } from '../subscription-types.js';
import type { VBriefDifficulty } from '../vbrief/types.js';
import { canUseHarnessSync } from '../harness-policy.js';

export const VBRIEF_DIFFICULTIES: readonly VBriefDifficulty[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];

export type TieredExecutionSubscribePolicy = 'all' | 'flagged' | 'sampled';

export interface TieredExecutionTierConfig {
  model: string;
  harness: RuntimeName;
  difficulties: VBriefDifficulty[];
}

export interface TieredExecutionSupervisorConfig {
  model: string;
  harness: RuntimeName;
  subscribe: TieredExecutionSubscribePolicy;
}

export interface TieredExecutionConfig {
  enabled: boolean;
  tiers: Record<string, TieredExecutionTierConfig>;
  supervisor: TieredExecutionSupervisorConfig;
  replay_threshold: number;
}

export interface ValidatedTieredExecutionConfig extends TieredExecutionConfig {
  difficultyToTier: Record<VBriefDifficulty, string>;
}

export class TieredExecutionValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(`tiered_execution: ${message}`);
    this.name = 'TieredExecutionValidationError';
  }
}

export const DEFAULT_TIERED_EXECUTION_CONFIG: TieredExecutionConfig = {
  enabled: false,
  tiers: {},
  supervisor: {
    model: 'claude-sonnet-4-6',
    harness: 'claude-code',
    subscribe: 'flagged',
  },
  replay_threshold: 0.5,
};

type TierHarnessInput = RuntimeName | 'pi';

function validationError(field: string, message: string): TieredExecutionValidationError {
  return new TieredExecutionValidationError(`${field}: ${message}`, field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeHarness(value: unknown, field: string): RuntimeName {
  if (value === 'pi') return 'ohmypi';
  if (value === 'claude-code' || value === 'ohmypi' || value === 'codex') return value;
  throw validationError(field, 'unknown harness');
}

function normalizeSubscribe(value: unknown, field: string): TieredExecutionSubscribePolicy {
  if (value === 'all' || value === 'flagged' || value === 'sampled') return value;
  throw validationError(field, 'must be all, flagged, or sampled');
}

function normalizeModel(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw validationError(field, 'model must be a non-empty string');
  }
  if (!hasModelCapabilitySync(value)) {
    throw validationError(field, `unknown model ${value}`);
  }
  return value;
}

function normalizeDifficulties(value: unknown, field: string): VBriefDifficulty[] {
  if (!Array.isArray(value)) {
    throw validationError(field, 'difficulties must be an array');
  }

  return value.map((difficulty, index) => {
    if (VBRIEF_DIFFICULTIES.includes(difficulty as VBriefDifficulty)) {
      return difficulty as VBriefDifficulty;
    }
    throw validationError(`${field}[${index}]`, `unknown difficulty ${String(difficulty)}`);
  });
}

function authModeForModel(
  model: string,
  providerAuth: Partial<Record<ModelProvider, AuthMode>> | undefined,
): AuthMode | undefined {
  return providerAuth?.[getModelProviderSync(model)];
}

function validateHarnessPolicy(
  field: string,
  harness: TierHarnessInput,
  model: string,
  providerAuth: Partial<Record<ModelProvider, AuthMode>> | undefined,
): void {
  const normalizedHarness = normalizeHarness(harness, `${field}.harness`);
  const decision = canUseHarnessSync(normalizedHarness, model, authModeForModel(model, providerAuth));
  if (!decision.allowed) {
    throw validationError(field, decision.reason ?? `${normalizedHarness} cannot run ${model}`);
  }
}

export function normalizeTieredExecutionConfig(
  input: Partial<TieredExecutionConfig> | undefined,
): TieredExecutionConfig {
  if (input === undefined) {
    return {
      ...DEFAULT_TIERED_EXECUTION_CONFIG,
      tiers: {},
      supervisor: { ...DEFAULT_TIERED_EXECUTION_CONFIG.supervisor },
    };
  }

  if (!isRecord(input)) {
    throw validationError('tiered_execution', 'must be an object');
  }

  const supervisorInput: Record<string, unknown> = isRecord(input.supervisor) ? input.supervisor : {};
  const tierInputs = isRecord(input.tiers) ? input.tiers : {};
  const tiers: Record<string, TieredExecutionTierConfig> = {};

  for (const [tierName, tier] of Object.entries(tierInputs)) {
    if (!isRecord(tier)) {
      throw validationError(`tiered_execution.tiers.${tierName}`, 'tier must be an object');
    }
    tiers[tierName] = {
      model: normalizeModel(tier.model, `tiered_execution.tiers.${tierName}.model`),
      harness: normalizeHarness(tier.harness, `tiered_execution.tiers.${tierName}.harness`),
      difficulties: normalizeDifficulties(tier.difficulties, `tiered_execution.tiers.${tierName}.difficulties`),
    };
  }

  return {
    enabled: input.enabled ?? DEFAULT_TIERED_EXECUTION_CONFIG.enabled,
    tiers,
    supervisor: {
      model: normalizeModel(
        supervisorInput.model ?? DEFAULT_TIERED_EXECUTION_CONFIG.supervisor.model,
        'tiered_execution.supervisor.model',
      ),
      harness: normalizeHarness(
        supervisorInput.harness ?? DEFAULT_TIERED_EXECUTION_CONFIG.supervisor.harness,
        'tiered_execution.supervisor.harness',
      ),
      subscribe: normalizeSubscribe(
        supervisorInput.subscribe ?? DEFAULT_TIERED_EXECUTION_CONFIG.supervisor.subscribe,
        'tiered_execution.supervisor.subscribe',
      ),
    },
    replay_threshold: input.replay_threshold ?? DEFAULT_TIERED_EXECUTION_CONFIG.replay_threshold,
  };
}

export function validateTieredExecutionConfig(
  input: Partial<TieredExecutionConfig> | undefined,
  options: { providerAuth?: Partial<Record<ModelProvider, AuthMode>> } = {},
): ValidatedTieredExecutionConfig {
  const config = normalizeTieredExecutionConfig(input);

  if (typeof config.replay_threshold !== 'number' || config.replay_threshold < 0 || config.replay_threshold > 1) {
    throw validationError('tiered_execution.replay_threshold', 'must be a number between 0 and 1');
  }

  validateHarnessPolicy('tiered_execution.supervisor', config.supervisor.harness, config.supervisor.model, options.providerAuth);

  const difficultyToTier = {} as Record<VBriefDifficulty, string>;
  const tierNames = Object.keys(config.tiers);
  if (tierNames.length === 0) {
    if (config.enabled) {
      throw validationError('tiered_execution.tiers', 'enabled tiered execution must define tiers for every difficulty');
    }
    return { ...config, difficultyToTier };
  }

  for (const [tierName, tier] of Object.entries(config.tiers)) {
    validateHarnessPolicy(`tiered_execution.tiers.${tierName}`, tier.harness, tier.model, options.providerAuth);

    for (const difficulty of tier.difficulties) {
      if (difficultyToTier[difficulty]) {
        throw validationError(
          `tiered_execution.tiers.${tierName}.difficulties`,
          `difficulty ${difficulty} maps to both ${difficultyToTier[difficulty]} and ${tierName}`,
        );
      }
      difficultyToTier[difficulty] = tierName;
    }
  }

  for (const difficulty of VBRIEF_DIFFICULTIES) {
    if (!difficultyToTier[difficulty]) {
      throw validationError('tiered_execution.tiers', `difficulty ${difficulty} is not mapped to any tier`);
    }
  }

  return { ...config, difficultyToTier };
}
