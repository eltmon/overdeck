import {
  TieredExecutionConfigError,
  validateTieredExecutionConfig,
  type TieredExecutionConfig,
  type TieredExecutionValidationContext,
  type ValidatedTieredExecutionConfig,
} from './agents/tier-table.js';

export type ApiTieredExecutionConfig = Partial<TieredExecutionConfig> | ValidatedTieredExecutionConfig;

export function tieredExecutionConfigForSave(
  config: ApiTieredExecutionConfig | undefined,
  providerAuth: TieredExecutionValidationContext['providerAuth'],
): Partial<TieredExecutionConfig> | undefined {
  if (config === undefined) return undefined;
  const validated = validateTieredExecutionConfig(config, { providerAuth });
  return {
    enabled: validated.enabled,
    tiers: validated.tiers,
    supervisor: validated.supervisor,
    by_kind: validated.by_kind,
    feed: validated.feed,
    escalation: validated.escalation,
    compaction_reroute: validated.compaction_reroute,
    replay_threshold: validated.replay_threshold,
  };
}

export function validateTieredExecutionSettings(
  config: ApiTieredExecutionConfig | undefined,
  providerAuth: TieredExecutionValidationContext['providerAuth'],
): string | null {
  if (config === undefined) return null;
  try {
    validateTieredExecutionConfig(config, { providerAuth });
    return null;
  } catch (error) {
    if (error instanceof TieredExecutionConfigError) return error.message;
    throw error;
  }
}
