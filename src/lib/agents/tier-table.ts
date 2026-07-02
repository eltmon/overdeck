import type { ModelProvider } from '../model-fallback.js';
import { resolveModelIdSync } from '../model-capabilities.js';
import { canUseHarnessSync } from '../harness-policy.js';
import { PROVIDERS, getProviderForModelSync } from '../providers.js';
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

export const TIERED_EXECUTION_SUBSCRIPTIONS = ['all', 'flagged', 'sampled'] as const;
export type TieredExecutionSubscribe = typeof TIERED_EXECUTION_SUBSCRIPTIONS[number];

export interface TieredExecutionTier {
  model: string;
  harness: RuntimeName;
  difficulties: VBriefDifficulty[];
}

export interface TieredExecutionSupervisor {
  model: string;
  harness: RuntimeName;
  subscribe: TieredExecutionSubscribe;
}

export interface TieredExecutionConfig {
  enabled: boolean;
  tiers: Record<string, TieredExecutionTier>;
  supervisor?: TieredExecutionSupervisor;
  replay_threshold: number;
}

export interface ValidatedTieredExecutionConfig extends TieredExecutionConfig {
  difficultyToTier: Partial<Record<VBriefDifficulty, string>>;
}

export const DEFAULT_TIERED_EXECUTION_CONFIG: TieredExecutionConfig = {
  enabled: false,
  tiers: {},
  replay_threshold: 0.5,
};

export class TieredExecutionConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TieredExecutionConfigError';
    this.code = code;
  }
}

const VALID_HARNESSES: readonly RuntimeName[] = ['claude-code', 'ohmypi', 'codex'];
const MODEL_IDS = new Set<string>(
  Object.values(PROVIDERS).flatMap((provider) => provider.models.map((model) => resolveModelIdSync(model))),
);

function fail(code: string, message: string): never {
  throw new TieredExecutionConfigError(code, message);
}

function isDifficulty(value: string): value is VBriefDifficulty {
  return (VBRIEF_DIFFICULTIES as readonly string[]).includes(value);
}

function validateHarness(harness: string, fieldPath: string): RuntimeName {
  if (!(VALID_HARNESSES as readonly string[]).includes(harness)) {
    fail('unknown_harness', `${fieldPath} has unknown harness "${harness}". Valid harnesses: ${VALID_HARNESSES.join(', ')}.`);
  }
  return harness as RuntimeName;
}

function validateModel(model: string, fieldPath: string): string {
  const resolved = resolveModelIdSync(model);
  if (!MODEL_IDS.has(resolved)) {
    fail('unknown_model', `${fieldPath} has unknown model "${model}".`);
  }
  return resolved;
}

function validateHarnessPolicy(
  model: string,
  harness: RuntimeName,
  providerAuth: Partial<Record<ModelProvider, AuthMode>>,
  fieldPath: string,
): void {
  const provider = getProviderForModelSync(model).name as ModelProvider;
  const decision = canUseHarnessSync(harness, model, providerAuth[provider]);
  if (!decision.allowed) {
    fail('harness_policy_rejected', `${fieldPath} is not allowed: ${decision.reason ?? 'harness policy rejected this model/harness/auth combination'}`);
  }
}

export function validateTieredExecutionConfig(
  config: TieredExecutionConfig,
  options: { providerAuth?: Partial<Record<ModelProvider, AuthMode>> } = {},
): ValidatedTieredExecutionConfig {
  if (typeof config.enabled !== 'boolean') {
    fail('invalid_enabled', 'tiered_execution.enabled must be a boolean.');
  }
  if (!Number.isFinite(config.replay_threshold) || config.replay_threshold < 0 || config.replay_threshold > 1) {
    fail('invalid_replay_threshold', 'tiered_execution.replay_threshold must be a number between 0 and 1.');
  }

  const providerAuth = options.providerAuth ?? {};
  const difficultyToTier = Object.fromEntries(
    VBRIEF_DIFFICULTIES.map((difficulty) => [difficulty, undefined]),
  ) as Record<VBriefDifficulty, string | undefined>;

  for (const [tierName, tier] of Object.entries(config.tiers ?? {})) {
    if (!tierName.trim()) {
      fail('invalid_tier_name', 'tiered_execution.tiers contains an empty tier name.');
    }
    const fieldPath = `tiered_execution.tiers.${tierName}`;
    const model = validateModel(tier.model, `${fieldPath}.model`);
    const harness = validateHarness(tier.harness, `${fieldPath}.harness`);
    validateHarnessPolicy(model, harness, providerAuth, fieldPath);

    if (!Array.isArray(tier.difficulties) || tier.difficulties.length === 0) {
      fail('missing_difficulty', `${fieldPath}.difficulties must list at least one difficulty.`);
    }

    for (const difficulty of tier.difficulties) {
      if (!isDifficulty(difficulty)) {
        fail('unknown_difficulty', `${fieldPath}.difficulties contains unknown difficulty "${difficulty}".`);
      }
      const existing = difficultyToTier[difficulty];
      if (existing) {
        fail('duplicate_difficulty', `Difficulty "${difficulty}" maps to multiple tiers: ${existing}, ${tierName}.`);
      }
      difficultyToTier[difficulty] = tierName;
    }
  }

  if (config.enabled || Object.keys(config.tiers ?? {}).length > 0) {
    for (const difficulty of VBRIEF_DIFFICULTIES) {
      if (!difficultyToTier[difficulty]) {
        fail('missing_difficulty', `Difficulty "${difficulty}" does not map to any tier.`);
      }
    }
  }

  if ((config.enabled || Object.keys(config.tiers ?? {}).length > 0) && !config.supervisor) {
    fail('missing_supervisor', 'tiered_execution.supervisor is required when tiered execution is configured.');
  }

  if (config.supervisor) {
    const model = validateModel(config.supervisor.model, 'tiered_execution.supervisor.model');
    const harness = validateHarness(config.supervisor.harness, 'tiered_execution.supervisor.harness');
    if (!TIERED_EXECUTION_SUBSCRIPTIONS.includes(config.supervisor.subscribe)) {
      fail('invalid_supervisor_subscribe', `tiered_execution.supervisor.subscribe must be one of ${TIERED_EXECUTION_SUBSCRIPTIONS.join(', ')}.`);
    }
    validateHarnessPolicy(model, harness, providerAuth, 'tiered_execution.supervisor');
  }

  return {
    ...config,
    difficultyToTier,
  };
}
