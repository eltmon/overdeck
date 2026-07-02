import type { AuthMode } from '../subscription-types.js';
import type { RuntimeName } from '../runtimes/types.js';
import type { VBriefDifficulty } from '../vbrief/types.js';
import { getDirectProviders, getProviderForModelSync } from '../providers.js';
import { canUseHarnessSync } from '../harness-policy.js';

export const VBRIEF_DIFFICULTIES: readonly VBriefDifficulty[] = [
  'trivial',
  'simple',
  'medium',
  'complex',
  'expert',
] as const;

export const TIERED_EXECUTION_SUBSCRIBE_POLICIES = ['all', 'flagged', 'sampled'] as const;
export type TieredExecutionSubscribePolicy = typeof TIERED_EXECUTION_SUBSCRIBE_POLICIES[number];

export interface TieredExecutionEndpoint {
  model: string;
  harness: RuntimeName;
}

export interface TieredExecutionTier extends TieredExecutionEndpoint {
  difficulties: VBriefDifficulty[];
}

export interface TieredExecutionConfig {
  enabled: boolean;
  tiers: Record<string, TieredExecutionTier>;
  supervisor: TieredExecutionEndpoint & {
    subscribe: TieredExecutionSubscribePolicy;
  };
  replay_threshold: number;
}

export interface ValidatedTieredExecutionConfig extends TieredExecutionConfig {
  difficultyToTier: Record<VBriefDifficulty, string>;
}

export type TieredExecutionConfigInput = Partial<{
  enabled: boolean;
  tiers: Record<string, Partial<TieredExecutionTier>>;
  supervisor: Partial<TieredExecutionConfig['supervisor']>;
  replay_threshold: number;
}>;

export interface TieredExecutionValidationContext {
  providerAuth?: Partial<Record<string, AuthMode>>;
}

const VALID_HARNESSES: readonly RuntimeName[] = ['claude-code', 'ohmypi', 'codex'] as const;
const VALID_DIFFICULTIES = new Set<string>(VBRIEF_DIFFICULTIES);
const VALID_SUBSCRIBE_POLICIES = new Set<string>(TIERED_EXECUTION_SUBSCRIBE_POLICIES);
const KNOWN_MODELS = new Set(
  getDirectProviders().flatMap((provider) => provider.models.map(String)),
);

export const DEFAULT_TIERED_EXECUTION_CONFIG: TieredExecutionConfig = {
  enabled: false,
  tiers: {},
  supervisor: {
    model: '',
    harness: 'claude-code',
    subscribe: 'flagged',
  },
  replay_threshold: 0.5,
};

export class TieredExecutionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TieredExecutionConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateHarness(path: string, harness: unknown): asserts harness is RuntimeName {
  if (typeof harness !== 'string' || !(VALID_HARNESSES as readonly string[]).includes(harness)) {
    throw new TieredExecutionConfigError(`${path}.harness must be claude-code, ohmypi, or codex`);
  }
}

function validateKnownModel(path: string, model: unknown): asserts model is string {
  if (typeof model !== 'string' || model.trim() === '') {
    throw new TieredExecutionConfigError(`${path}.model must be a non-empty known model id`);
  }

  // OpenRouter models are user/catalog dynamic and intentionally slash-delimited.
  if (model.includes('/') || KNOWN_MODELS.has(model)) return;

  throw new TieredExecutionConfigError(`${path}.model is unknown: ${model}`);
}

function validatePolicy(path: string, endpoint: TieredExecutionEndpoint, context: TieredExecutionValidationContext): void {
  const provider = getProviderForModelSync(endpoint.model).name;
  const decision = canUseHarnessSync(endpoint.harness, endpoint.model, context.providerAuth?.[provider]);
  if (!decision.allowed) {
    throw new TieredExecutionConfigError(`${path}: ${decision.reason ?? 'harness/model/auth policy rejected this definition'}`);
  }
}

function normalizeDifficulties(path: string, difficulties: unknown): VBriefDifficulty[] {
  if (!Array.isArray(difficulties)) {
    throw new TieredExecutionConfigError(`${path}.difficulties must be an array`);
  }

  return difficulties.map((difficulty, index) => {
    if (typeof difficulty !== 'string' || !VALID_DIFFICULTIES.has(difficulty)) {
      throw new TieredExecutionConfigError(`${path}.difficulties[${index}] must be one of ${VBRIEF_DIFFICULTIES.join(', ')}`);
    }
    return difficulty as VBriefDifficulty;
  });
}

export function normalizeTieredExecutionConfig(
  input: TieredExecutionConfigInput | undefined,
): TieredExecutionConfig {
  if (input === undefined) {
    return {
      ...DEFAULT_TIERED_EXECUTION_CONFIG,
      tiers: {},
      supervisor: { ...DEFAULT_TIERED_EXECUTION_CONFIG.supervisor },
    };
  }

  if (!isRecord(input)) {
    throw new TieredExecutionConfigError('tiered_execution must be an object');
  }

  const tiers: Record<string, TieredExecutionTier> = {};
  if (input.tiers !== undefined) {
    if (!isRecord(input.tiers)) {
      throw new TieredExecutionConfigError('tiered_execution.tiers must be an object');
    }
    for (const [tierName, tier] of Object.entries(input.tiers)) {
      if (!isRecord(tier)) {
        throw new TieredExecutionConfigError(`tiered_execution.tiers.${tierName} must be an object`);
      }
      validateKnownModel(`tiered_execution.tiers.${tierName}`, tier.model);
      validateHarness(`tiered_execution.tiers.${tierName}`, tier.harness);
      tiers[tierName] = {
        model: tier.model,
        harness: tier.harness,
        difficulties: normalizeDifficulties(`tiered_execution.tiers.${tierName}`, tier.difficulties),
      };
    }
  }

  const supervisorInput = input.supervisor;
  if (supervisorInput !== undefined && !isRecord(supervisorInput)) {
    throw new TieredExecutionConfigError('tiered_execution.supervisor must be an object');
  }

  const supervisor: TieredExecutionConfig['supervisor'] = {
    ...DEFAULT_TIERED_EXECUTION_CONFIG.supervisor,
    ...(supervisorInput ?? {}),
  };
  if (supervisor.model !== '') {
    validateKnownModel('tiered_execution.supervisor', supervisor.model);
    validateHarness('tiered_execution.supervisor', supervisor.harness);
  } else if (input.enabled === true) {
    throw new TieredExecutionConfigError('tiered_execution.supervisor.model must be set when tiered execution is enabled');
  }
  if (!VALID_SUBSCRIBE_POLICIES.has(supervisor.subscribe)) {
    throw new TieredExecutionConfigError('tiered_execution.supervisor.subscribe must be all, flagged, or sampled');
  }

  const replayThreshold = input.replay_threshold ?? DEFAULT_TIERED_EXECUTION_CONFIG.replay_threshold;
  if (typeof replayThreshold !== 'number' || replayThreshold < 0 || replayThreshold > 1) {
    throw new TieredExecutionConfigError('tiered_execution.replay_threshold must be a number between 0 and 1');
  }

  return {
    enabled: input.enabled ?? DEFAULT_TIERED_EXECUTION_CONFIG.enabled,
    tiers,
    supervisor,
    replay_threshold: replayThreshold,
  };
}

export function validateTieredExecutionConfig(
  input: TieredExecutionConfigInput | TieredExecutionConfig | undefined,
  context: TieredExecutionValidationContext = {},
): ValidatedTieredExecutionConfig {
  const config = normalizeTieredExecutionConfig(input);
  const difficultyToTier = {} as Record<VBriefDifficulty, string>;

  for (const [tierName, tier] of Object.entries(config.tiers)) {
    validatePolicy(`tiered_execution.tiers.${tierName}`, tier, context);
    for (const difficulty of tier.difficulties) {
      if (difficultyToTier[difficulty] !== undefined) {
        throw new TieredExecutionConfigError(
          `tiered_execution difficulty ${difficulty} maps to multiple tiers: ${difficultyToTier[difficulty]}, ${tierName}`,
        );
      }
      difficultyToTier[difficulty] = tierName;
    }
  }

  for (const difficulty of VBRIEF_DIFFICULTIES) {
    if (difficultyToTier[difficulty] === undefined) {
      throw new TieredExecutionConfigError(`tiered_execution difficulty ${difficulty} maps to zero tiers`);
    }
  }

  if (config.supervisor.model !== '') {
    validatePolicy('tiered_execution.supervisor', config.supervisor, context);
  }

  return {
    ...config,
    difficultyToTier,
  };
}
