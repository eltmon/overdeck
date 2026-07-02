import { canUseHarnessSync } from '../harness-policy.js';
import { getProviderForModelSync, PROVIDERS } from '../providers.js';
import type { ModelProvider } from '../model-fallback.js';
import type { RuntimeName } from '../runtimes/types.js';
import type { AuthMode } from '../subscription-types.js';
import type { VBriefDifficulty } from '../vbrief/types.js';

export const VBRIEF_DIFFICULTIES: readonly VBriefDifficulty[] = [
  'trivial',
  'simple',
  'medium',
  'complex',
  'expert',
] as const;

export const SUPERVISOR_SUBSCRIPTIONS = ['all', 'flagged', 'sampled'] as const;
export type SupervisorSubscription = typeof SUPERVISOR_SUBSCRIPTIONS[number];

export interface TierDefinition {
  model: string;
  harness: RuntimeName;
  difficulties: VBriefDifficulty[];
}

export interface SupervisorDefinition {
  model: string;
  harness: RuntimeName;
  subscribe: SupervisorSubscription;
}

export interface TieredExecutionConfig {
  enabled: boolean;
  tiers: Record<string, TierDefinition>;
  supervisor?: SupervisorDefinition;
  replay_threshold: number;
}

export interface ValidatedTieredExecutionConfig extends TieredExecutionConfig {
  difficultyToTier: Partial<Record<VBriefDifficulty, string>>;
}

export type TieredExecutionConfigInput = Partial<Omit<TieredExecutionConfig, 'tiers' | 'supervisor'>> & {
  tiers?: Record<string, Partial<TierDefinition>>;
  supervisor?: Partial<SupervisorDefinition>;
};

export const DEFAULT_TIERED_EXECUTION_CONFIG: TieredExecutionConfig = {
  enabled: false,
  tiers: {},
  replay_threshold: 0.5,
};

export class TierTableValidationError extends Error {
  constructor(message: string) {
    super(`TierTableValidationError: ${message}`);
    this.name = 'TierTableValidationError';
  }
}

const VALID_HARNESSES: readonly RuntimeName[] = ['claude-code', 'ohmypi', 'codex'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDifficulty(value: unknown): value is VBriefDifficulty {
  return typeof value === 'string' && (VBRIEF_DIFFICULTIES as readonly string[]).includes(value);
}

function isSupervisorSubscription(value: unknown): value is SupervisorSubscription {
  return typeof value === 'string' && (SUPERVISOR_SUBSCRIPTIONS as readonly string[]).includes(value);
}

function isRuntimeName(value: unknown): value is RuntimeName {
  return typeof value === 'string' && (VALID_HARNESSES as readonly string[]).includes(value);
}

function isKnownModel(model: string): boolean {
  return Object.values(PROVIDERS).some((provider) => provider.models.includes(model));
}

function normalizeTierDefinition(path: string, value: unknown): TierDefinition {
  if (!isRecord(value)) {
    throw new TierTableValidationError(`${path} must be an object`);
  }

  const { model, harness, difficulties } = value;
  if (typeof model !== 'string' || model.length === 0) {
    throw new TierTableValidationError(`${path}.model must be a known model id`);
  }
  if (!isRuntimeName(harness)) {
    throw new TierTableValidationError(`${path}.harness must be claude-code, ohmypi, or codex`);
  }
  if (!Array.isArray(difficulties)) {
    throw new TierTableValidationError(`${path}.difficulties must be an array`);
  }

  const normalizedDifficulties = difficulties.map((difficulty, index) => {
    if (!isDifficulty(difficulty)) {
      throw new TierTableValidationError(`${path}.difficulties[${index}] must be one of ${VBRIEF_DIFFICULTIES.join(', ')}`);
    }
    return difficulty;
  });

  return { model, harness, difficulties: normalizedDifficulties };
}

function normalizeSupervisorDefinition(path: string, value: unknown): SupervisorDefinition {
  if (!isRecord(value)) {
    throw new TierTableValidationError(`${path} must be an object`);
  }

  const { model, harness, subscribe } = value;
  if (typeof model !== 'string' || model.length === 0) {
    throw new TierTableValidationError(`${path}.model must be a known model id`);
  }
  if (!isRuntimeName(harness)) {
    throw new TierTableValidationError(`${path}.harness must be claude-code, ohmypi, or codex`);
  }
  if (!isSupervisorSubscription(subscribe)) {
    throw new TierTableValidationError(`${path}.subscribe must be all, flagged, or sampled`);
  }

  return { model, harness, subscribe };
}

function validateModelHarnessPolicy(
  path: string,
  definition: { model: string; harness: RuntimeName },
  providerAuth: Partial<Record<ModelProvider, AuthMode>>,
): void {
  if (!isKnownModel(definition.model)) {
    throw new TierTableValidationError(`${path}.model "${definition.model}" is unknown`);
  }

  const provider = getProviderForModelSync(definition.model);
  const decision = canUseHarnessSync(definition.harness, definition.model, providerAuth[provider.name]);
  if (!decision.allowed) {
    throw new TierTableValidationError(`${path} violates harness policy: ${decision.reason ?? 'not allowed'}`);
  }
}

export function normalizeTieredExecutionConfig(input: unknown): TieredExecutionConfig {
  if (input === undefined || input === null) {
    return { ...DEFAULT_TIERED_EXECUTION_CONFIG };
  }
  if (!isRecord(input)) {
    throw new TierTableValidationError('tiered_execution must be an object');
  }

  const enabled = input.enabled === undefined ? DEFAULT_TIERED_EXECUTION_CONFIG.enabled : input.enabled;
  if (typeof enabled !== 'boolean') {
    throw new TierTableValidationError('tiered_execution.enabled must be boolean');
  }

  const replayThreshold = input.replay_threshold === undefined
    ? DEFAULT_TIERED_EXECUTION_CONFIG.replay_threshold
    : input.replay_threshold;
  if (typeof replayThreshold !== 'number' || !Number.isFinite(replayThreshold) || replayThreshold < 0 || replayThreshold > 1) {
    throw new TierTableValidationError('tiered_execution.replay_threshold must be a number between 0 and 1');
  }

  const tiers: Record<string, TierDefinition> = {};
  if (input.tiers !== undefined) {
    if (!isRecord(input.tiers)) {
      throw new TierTableValidationError('tiered_execution.tiers must be an object');
    }
    for (const [tierName, tier] of Object.entries(input.tiers)) {
      tiers[tierName] = normalizeTierDefinition(`tiered_execution.tiers.${tierName}`, tier);
    }
  }

  const supervisor = input.supervisor === undefined
    ? undefined
    : normalizeSupervisorDefinition('tiered_execution.supervisor', input.supervisor);

  return { enabled, tiers, supervisor, replay_threshold: replayThreshold };
}

export function validateTieredExecutionConfig(
  input: unknown,
  providerAuth: Partial<Record<ModelProvider, AuthMode>> = {},
): ValidatedTieredExecutionConfig {
  const config = normalizeTieredExecutionConfig(input);
  const difficultyOwners = new Map<VBriefDifficulty, string[]>(
    VBRIEF_DIFFICULTIES.map((difficulty) => [difficulty, []]),
  );
  const hasTierDefinitions = Object.keys(config.tiers).length > 0;

  for (const [tierName, tier] of Object.entries(config.tiers)) {
    validateModelHarnessPolicy(`tiered_execution.tiers.${tierName}`, tier, providerAuth);
    for (const difficulty of tier.difficulties) {
      difficultyOwners.get(difficulty)?.push(tierName);
    }
  }

  const difficultyToTier: Partial<Record<VBriefDifficulty, string>> = {};
  for (const difficulty of VBRIEF_DIFFICULTIES) {
    const owners = difficultyOwners.get(difficulty) ?? [];
    if (!config.enabled && !hasTierDefinitions && owners.length === 0) {
      continue;
    }
    if (owners.length !== 1) {
      throw new TierTableValidationError(
        `difficulty "${difficulty}" must map to exactly one tier; found ${owners.length}${owners.length > 0 ? ` (${owners.join(', ')})` : ''}`,
      );
    }
    difficultyToTier[difficulty] = owners[0];
  }

  if (config.supervisor !== undefined) {
    validateModelHarnessPolicy('tiered_execution.supervisor', config.supervisor, providerAuth);
  }

  return {
    ...config,
    difficultyToTier,
  };
}

export function mergeTieredExecutionConfig(
  base: TieredExecutionConfig,
  override: TieredExecutionConfigInput | undefined,
): TieredExecutionConfig {
  if (!override) return { ...base, tiers: { ...base.tiers }, supervisor: base.supervisor ? { ...base.supervisor } : undefined };

  const tiers = { ...base.tiers };
  if (override.tiers) {
    for (const [tierName, tier] of Object.entries(override.tiers)) {
      tiers[tierName] = {
        ...tiers[tierName],
        ...tier,
        difficulties: tier.difficulties ? [...tier.difficulties] : tiers[tierName]?.difficulties,
      } as TierDefinition;
    }
  }

  return {
    enabled: override.enabled ?? base.enabled,
    tiers,
    supervisor: override.supervisor
      ? { ...base.supervisor, ...override.supervisor } as SupervisorDefinition
      : base.supervisor ? { ...base.supervisor } : undefined,
    replay_threshold: override.replay_threshold ?? base.replay_threshold,
  };
}
