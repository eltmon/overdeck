import { canUseHarnessSync } from '../harness-policy.js';
import { hasModelCapabilitySync, resolveModelIdSync } from '../model-capabilities.js';
import { getProviderForModelSync } from '../providers.js';
import type { ModelProvider } from '../model-fallback.js';
import type { ModelId } from '../settings.js';
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

export type TieredExecutionSubscribe = 'all' | 'flagged' | 'sampled';

export interface TierDefinition {
  model: ModelId | string;
  harness: RuntimeName;
  difficulties: VBriefDifficulty[];
}

export interface TieredExecutionSupervisorConfig {
  model: ModelId | string;
  harness: RuntimeName;
  subscribe: TieredExecutionSubscribe;
}

export interface TieredExecutionConfig {
  enabled?: boolean;
  tiers?: Record<string, TierDefinition>;
  supervisor?: Partial<TieredExecutionSupervisorConfig>;
  replay_threshold?: number;
}

export interface NormalizedTierDefinition {
  model: ModelId;
  harness: RuntimeName;
  difficulties: VBriefDifficulty[];
}

export interface NormalizedTieredExecutionConfig {
  enabled: boolean;
  tiers: Record<string, NormalizedTierDefinition>;
  supervisor: TieredExecutionSupervisorConfig;
  replayThreshold: number;
  difficultyToTier: Record<VBriefDifficulty, string> | {};
}

export const DEFAULT_TIERED_EXECUTION_SUPERVISOR: TieredExecutionSupervisorConfig = {
  model: 'claude-sonnet-5',
  harness: 'claude-code',
  subscribe: 'flagged',
};

export const DEFAULT_TIERED_EXECUTION_CONFIG: NormalizedTieredExecutionConfig = {
  enabled: false,
  tiers: {},
  supervisor: DEFAULT_TIERED_EXECUTION_SUPERVISOR,
  replayThreshold: 0.5,
  difficultyToTier: {},
};

function isRuntimeName(value: unknown): value is RuntimeName {
  return value === 'claude-code' || value === 'ohmypi' || value === 'codex';
}

function isDifficulty(value: unknown): value is VBriefDifficulty {
  return typeof value === 'string' && (VBRIEF_DIFFICULTIES as readonly string[]).includes(value);
}

function isSubscribe(value: unknown): value is TieredExecutionSubscribe {
  return value === 'all' || value === 'flagged' || value === 'sampled';
}

function normalizeModel(model: unknown, fieldPath: string): ModelId {
  if (typeof model !== 'string' || model.length === 0) {
    throw new Error(`config.yaml: ${fieldPath} must be a non-empty string`);
  }
  const resolved = resolveModelIdSync(model);
  if (!hasModelCapabilitySync(resolved)) {
    throw new Error(`config.yaml: ${fieldPath} references unknown model ${model}`);
  }
  return resolved;
}

function normalizeHarness(harness: unknown, fieldPath: string): RuntimeName {
  if (!isRuntimeName(harness)) {
    throw new Error(`config.yaml: ${fieldPath} must be claude-code, ohmypi, or codex`);
  }
  return harness;
}

function validateHarnessPolicy(
  model: ModelId,
  harness: RuntimeName,
  providerAuth: Partial<Record<ModelProvider, AuthMode>>,
  fieldPath: string,
): void {
  const provider = getProviderForModelSync(model).name;
  const decision = canUseHarnessSync(harness, model, providerAuth[provider]);
  if (!decision.allowed) {
    throw new Error(`config.yaml: ${fieldPath} is not allowed: ${decision.reason ?? `${harness} cannot run ${model}`}`);
  }
}

function normalizeSupervisor(
  supervisor: TieredExecutionConfig['supervisor'] | undefined,
  providerAuth: Partial<Record<ModelProvider, AuthMode>>,
): TieredExecutionSupervisorConfig {
  const merged = {
    ...DEFAULT_TIERED_EXECUTION_SUPERVISOR,
    ...(supervisor ?? {}),
  };
  const model = normalizeModel(merged.model, 'tiered_execution.supervisor.model');
  const harness = normalizeHarness(merged.harness, 'tiered_execution.supervisor.harness');
  if (!isSubscribe(merged.subscribe)) {
    throw new Error('config.yaml: tiered_execution.supervisor.subscribe must be all, flagged, or sampled');
  }
  validateHarnessPolicy(model, harness, providerAuth, 'tiered_execution.supervisor');
  return { model, harness, subscribe: merged.subscribe };
}

function normalizeTiers(
  tiers: Record<string, TierDefinition> | undefined,
  providerAuth: Partial<Record<ModelProvider, AuthMode>>,
): Record<string, NormalizedTierDefinition> {
  const normalized: Record<string, NormalizedTierDefinition> = {};
  for (const [tierName, tier] of Object.entries(tiers ?? {})) {
    const fieldPath = `tiered_execution.tiers.${tierName}`;
    if (!tier || typeof tier !== 'object') {
      throw new Error(`config.yaml: ${fieldPath} must be an object`);
    }
    const model = normalizeModel(tier.model, `${fieldPath}.model`);
    const harness = normalizeHarness(tier.harness, `${fieldPath}.harness`);
    if (!Array.isArray(tier.difficulties)) {
      throw new Error(`config.yaml: ${fieldPath}.difficulties must be an array`);
    }
    const difficulties = tier.difficulties.map((difficulty, index) => {
      if (!isDifficulty(difficulty)) {
        throw new Error(`config.yaml: ${fieldPath}.difficulties[${index}] must be one of ${VBRIEF_DIFFICULTIES.join(', ')}`);
      }
      return difficulty;
    });
    validateHarnessPolicy(model, harness, providerAuth, fieldPath);
    normalized[tierName] = { model, harness, difficulties };
  }
  return normalized;
}

function buildDifficultyMap(
  tiers: Record<string, NormalizedTierDefinition>,
): Record<VBriefDifficulty, string> {
  const assignments = new Map<VBriefDifficulty, string[]>();
  for (const difficulty of VBRIEF_DIFFICULTIES) {
    assignments.set(difficulty, []);
  }
  for (const [tierName, tier] of Object.entries(tiers)) {
    for (const difficulty of tier.difficulties) {
      assignments.get(difficulty)?.push(tierName);
    }
  }

  const result = {} as Record<VBriefDifficulty, string>;
  for (const difficulty of VBRIEF_DIFFICULTIES) {
    const tierNames = assignments.get(difficulty) ?? [];
    if (tierNames.length === 0) {
      throw new Error(`config.yaml: tiered_execution difficulty ${difficulty} maps to zero tiers`);
    }
    if (tierNames.length > 1) {
      throw new Error(`config.yaml: tiered_execution difficulty ${difficulty} maps to multiple tiers: ${tierNames.join(', ')}`);
    }
    result[difficulty] = tierNames[0];
  }
  return result;
}

export function validateTieredExecutionConfig(
  config: TieredExecutionConfig | undefined,
  providerAuth: Partial<Record<ModelProvider, AuthMode>> = {},
): NormalizedTieredExecutionConfig {
  const enabled = config?.enabled ?? DEFAULT_TIERED_EXECUTION_CONFIG.enabled;
  const replayThreshold = config?.replay_threshold ?? DEFAULT_TIERED_EXECUTION_CONFIG.replayThreshold;
  if (typeof replayThreshold !== 'number' || Number.isNaN(replayThreshold) || replayThreshold < 0 || replayThreshold > 1) {
    throw new Error('config.yaml: tiered_execution.replay_threshold must be a number between 0 and 1');
  }

  const supervisor = normalizeSupervisor(config?.supervisor, providerAuth);
  const tiers = normalizeTiers(config?.tiers, providerAuth);
  const shouldValidateDifficulties = enabled || Object.keys(tiers).length > 0;
  const difficultyToTier = shouldValidateDifficulties ? buildDifficultyMap(tiers) : {};

  return {
    enabled,
    tiers,
    supervisor,
    replayThreshold,
    difficultyToTier,
  };
}
