/** Raw `computer_use:` block in ~/.overdeck/config.yaml (PAN-5452). Global layer only. */
export interface YamlComputerUseConfig {
  enabled?: boolean;
}

export interface NormalizedComputerUseConfig {
  enabled: boolean;
}

export const DEFAULT_NORMALIZED_COMPUTER_USE: NormalizedComputerUseConfig = { enabled: false };

/** Fold one layer's `computer_use:` block; a non-boolean `enabled` throws at load, like `security:`. */
export function normalizeComputerUseConfig(
  raw: YamlComputerUseConfig | null | undefined,
  current: NormalizedComputerUseConfig,
): NormalizedComputerUseConfig {
  if (raw === null || raw === undefined) return current;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('config.yaml: computer_use must be a mapping');
  }
  if (raw.enabled === undefined) return current;
  if (typeof raw.enabled !== 'boolean') {
    throw new Error(`config.yaml: computer_use.enabled must be true or false (got: ${String(raw.enabled)})`);
  }
  return { ...current, enabled: raw.enabled };
}
