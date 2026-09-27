import {
  TieredExecutionConfigError,
  validateTieredExecutionConfig,
  type TierDefinition,
  type TieredExecutionConfig,
  type TieredExecutionValidationContext,
  type ValidatedTieredExecutionConfig,
} from './agents/tier-table.js';

export type ApiTieredExecutionConfig = Partial<TieredExecutionConfig> | ValidatedTieredExecutionConfig;

/**
 * PAN-4191: config.yaml keeps the ref the operator wrote. The validated shape
 * carries the dereffed `model` beside a `modelRef`; on disk the ref goes back
 * into `model`, so a Settings save never pins a workhorse slot's current model.
 */
function withDeclaredRef<T extends { model: string; modelRef?: string }>(entry: T): Omit<T, 'modelRef'> {
  const { modelRef, ...rest } = entry;
  return modelRef ? { ...rest, model: modelRef } : rest;
}

function tiersForSave(tiers: Record<string, TierDefinition>): Record<string, TierDefinition> {
  return Object.fromEntries(Object.entries(tiers).map(([name, tier]) => [name, {
    ...withDeclaredRef(tier),
    ...(tier.distribution ? { distribution: tier.distribution.map(withDeclaredRef) } : {}),
  }]));
}

export function tieredExecutionConfigForSave(
  config: ApiTieredExecutionConfig | undefined,
  context: TieredExecutionValidationContext,
): Partial<TieredExecutionConfig> | undefined {
  if (config === undefined) return undefined;
  const validated = validateTieredExecutionConfig(config, context);
  return {
    enabled: validated.enabled,
    tiers: tiersForSave(validated.tiers),
    supervisor: validated.supervisor ? withDeclaredRef(validated.supervisor) : undefined,
    by_kind: validated.by_kind,
    feed: validated.feed,
    escalation: validated.escalation,
    compaction_reroute: validated.compaction_reroute,
    replay_threshold: validated.replay_threshold,
  };
}

export function validateTieredExecutionSettings(
  config: ApiTieredExecutionConfig | undefined,
  context: TieredExecutionValidationContext,
): string | null {
  if (config === undefined) return null;
  try {
    validateTieredExecutionConfig(config, context);
    return null;
  } catch (error) {
    if (error instanceof TieredExecutionConfigError) return error.message;
    throw error;
  }
}
