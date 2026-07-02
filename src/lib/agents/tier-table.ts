import { Data } from 'effect';
import { canUseHarnessSync } from '../harness-policy.js';
import { hasModelCapabilitySync, resolveModelIdSync } from '../model-capabilities.js';
import { getProviderForModelSync } from '../providers.js';
import type { RuntimeName } from '../runtimes/types.js';
import type { AuthMode } from '../subscription-types.js';
import type { VBriefDifficulty } from '../vbrief/types.js';

export const VBRIEF_DIFFICULTIES: readonly VBriefDifficulty[] = [
  'trivial',
  'simple',
  'medium',
  'complex',
  'expert',
];

export const TIER_SUPERVISOR_SUBSCRIPTIONS = ['all', 'flagged', 'sampled'] as const;
export type TierSupervisorSubscribe = typeof TIER_SUPERVISOR_SUBSCRIPTIONS[number];

export interface TierDefinitionConfig {
  model: string;
  harness: RuntimeName | 'pi';
  difficulties: VBriefDifficulty[];
}

export interface TierSupervisorConfig {
  model: string;
  harness: RuntimeName | 'pi';
  subscribe: TierSupervisorSubscribe;
}

export interface TieredExecutionConfig {
  enabled?: boolean;
  tiers?: Record<string, TierDefinitionConfig>;
  supervisor?: TierSupervisorConfig;
  replay_threshold?: number;
}

export interface NormalizedTierDefinition {
  model: string;
  harness: RuntimeName;
  difficulties: VBriefDifficulty[];
}

export interface NormalizedTierSupervisor {
  model: string;
  harness: RuntimeName;
  subscribe: TierSupervisorSubscribe;
}

export interface NormalizedTieredExecutionConfig {
  enabled: boolean;
  tiers: Record<string, NormalizedTierDefinition>;
  supervisor?: NormalizedTierSupervisor;
  difficultyToTier: Record<VBriefDifficulty, string>;
  replayThreshold: number;
}

export class TierTableValidationError extends Data.TaggedError('TierTableValidationError')<{
  readonly path: string;
  readonly message: string;
}> {}

export const DEFAULT_TIERED_EXECUTION_CONFIG: NormalizedTieredExecutionConfig = {
  enabled: false,
  tiers: {},
  difficultyToTier: {} as Record<VBriefDifficulty, string>,
  replayThreshold: 0.5,
};

export function cloneTieredExecutionConfig(
  config: NormalizedTieredExecutionConfig,
): NormalizedTieredExecutionConfig {
  return {
    enabled: config.enabled,
    tiers: Object.fromEntries(
      Object.entries(config.tiers).map(([tierName, tier]) => [
        tierName,
        { ...tier, difficulties: [...tier.difficulties] },
      ]),
    ),
    supervisor: config.supervisor ? { ...config.supervisor } : undefined,
    difficultyToTier: { ...config.difficultyToTier },
    replayThreshold: config.replayThreshold,
  };
}

export function mergeTieredExecutionConfig(
  current: NormalizedTieredExecutionConfig,
  raw: TieredExecutionConfig | undefined,
  providerAuth: Partial<Record<string, AuthMode>>,
): NormalizedTieredExecutionConfig {
  if (!raw) return cloneTieredExecutionConfig(current);

  const merged: TieredExecutionConfig = {
    enabled: raw.enabled ?? current.enabled,
    tiers: raw.tiers ?? current.tiers,
    supervisor: raw.supervisor ?? current.supervisor,
    replay_threshold: raw.replay_threshold ?? current.replayThreshold,
  };

  return validateTieredExecutionConfig(merged, providerAuth);
}

export function validateTieredExecutionConfig(
  raw: TieredExecutionConfig,
  providerAuth: Partial<Record<string, AuthMode>> = {},
): NormalizedTieredExecutionConfig {
  const enabled = raw.enabled ?? false;
  const replayThreshold = raw.replay_threshold ?? 0.5;
  if (typeof replayThreshold !== 'number' || Number.isNaN(replayThreshold) || replayThreshold < 0 || replayThreshold > 1) {
    throw tierError('tiered_execution.replay_threshold', 'must be a number between 0 and 1');
  }

  const rawTiers = raw.tiers ?? {};
  const hasTierTable = Object.keys(rawTiers).length > 0;
  if (!enabled && !hasTierTable && raw.supervisor === undefined) {
    return {
      ...cloneTieredExecutionConfig(DEFAULT_TIERED_EXECUTION_CONFIG),
      replayThreshold,
    };
  }

  const tiers: Record<string, NormalizedTierDefinition> = {};
  const difficultyToTier = {} as Record<VBriefDifficulty, string>;
  const seen = new Map<VBriefDifficulty, string>();

  for (const [tierName, tier] of Object.entries(rawTiers)) {
    if (!tierName.trim()) {
      throw tierError('tiered_execution.tiers', 'tier names must be non-empty');
    }
    if (!tier || typeof tier !== 'object') {
      throw tierError(`tiered_execution.tiers.${tierName}`, 'must be an object');
    }

    const normalized = validateModelHarness(
      `tiered_execution.tiers.${tierName}`,
      tier.model,
      tier.harness,
      providerAuth,
    );

    if (!Array.isArray(tier.difficulties) || tier.difficulties.length === 0) {
      throw tierError(`tiered_execution.tiers.${tierName}.difficulties`, 'must include at least one difficulty');
    }

    const difficulties: VBriefDifficulty[] = [];
    for (const difficulty of tier.difficulties) {
      if (!isVBriefDifficulty(difficulty)) {
        throw tierError(
          `tiered_execution.tiers.${tierName}.difficulties`,
          `unknown difficulty ${String(difficulty)}`,
        );
      }
      const previousTier = seen.get(difficulty);
      if (previousTier) {
        throw tierError(
          `tiered_execution.difficulties.${difficulty}`,
          `difficulty ${difficulty} maps to multiple tiers: ${previousTier}, ${tierName}`,
        );
      }
      seen.set(difficulty, tierName);
      difficultyToTier[difficulty] = tierName;
      difficulties.push(difficulty);
    }

    tiers[tierName] = {
      ...normalized,
      difficulties,
    };
  }

  for (const difficulty of VBRIEF_DIFFICULTIES) {
    if (!seen.has(difficulty)) {
      throw tierError(
        `tiered_execution.difficulties.${difficulty}`,
        `difficulty ${difficulty} maps to zero tiers`,
      );
    }
  }

  if (!raw.supervisor) {
    throw tierError('tiered_execution.supervisor', 'is required when tiers are configured');
  }

  const supervisorModelHarness = validateModelHarness(
    'tiered_execution.supervisor',
    raw.supervisor.model,
    raw.supervisor.harness,
    providerAuth,
  );
  if (!isSupervisorSubscribe(raw.supervisor.subscribe)) {
    throw tierError(
      'tiered_execution.supervisor.subscribe',
      'must be all, flagged, or sampled',
    );
  }

  return {
    enabled,
    tiers,
    supervisor: {
      ...supervisorModelHarness,
      subscribe: raw.supervisor.subscribe,
    },
    difficultyToTier,
    replayThreshold,
  };
}

function validateModelHarness(
  path: string,
  model: unknown,
  harness: unknown,
  providerAuth: Partial<Record<string, AuthMode>>,
): { model: string; harness: RuntimeName } {
  if (typeof model !== 'string' || model.trim() === '') {
    throw tierError(`${path}.model`, 'must be a non-empty string');
  }
  const resolvedModel = resolveModelIdSync(model.trim());
  if (!hasModelCapabilitySync(resolvedModel)) {
    throw tierError(`${path}.model`, `unknown model ${model}`);
  }

  const normalizedHarness = normalizeTierHarness(harness);
  if (!normalizedHarness) {
    throw tierError(`${path}.harness`, 'must be claude-code, ohmypi, codex, or legacy pi');
  }

  const provider = getProviderForModelSync(resolvedModel);
  const decision = canUseHarnessSync(normalizedHarness, resolvedModel, providerAuth[provider.name]);
  if (!decision.allowed) {
    throw tierError(`${path}.harness`, decision.reason ?? `harness ${normalizedHarness} is not allowed for ${resolvedModel}`);
  }

  return {
    model: resolvedModel,
    harness: normalizedHarness,
  };
}

function normalizeTierHarness(value: unknown): RuntimeName | null {
  if (value === 'pi' || value === 'ohmypi') return 'ohmypi';
  if (value === 'claude-code' || value === 'codex') return value;
  return null;
}

function isVBriefDifficulty(value: unknown): value is VBriefDifficulty {
  return typeof value === 'string' && (VBRIEF_DIFFICULTIES as readonly string[]).includes(value);
}

function isSupervisorSubscribe(value: unknown): value is TierSupervisorSubscribe {
  return typeof value === 'string' && (TIER_SUPERVISOR_SUBSCRIPTIONS as readonly string[]).includes(value);
}

function tierError(path: string, message: string): TierTableValidationError {
  return new TierTableValidationError({
    path,
    message: `config.yaml: ${path} ${message}`,
  });
}
