/** Raw `security:` block as it appears in config.yaml (PAN-4585). */
export interface YamlSecurityConfig {
  semgrep?: YamlSemgrepConfig;
}

/** Raw `security.semgrep:` block. Phase 1 reads only `enabled`; later keys are ignored. */
export interface YamlSemgrepConfig {
  enabled?: boolean;
}

export interface NormalizedSemgrepConfig {
  enabled: boolean;
}

export interface NormalizedSecurityConfig {
  semgrep: NormalizedSemgrepConfig;
}

export const DEFAULT_NORMALIZED_SECURITY: NormalizedSecurityConfig = {
  semgrep: { enabled: false },
};

/**
 * Fold one config layer's `security:` block onto the value merged so far. Off by
 * default; a bad value throws at config load, like `jev:` does. Unknown keys under
 * `security.semgrep` are ignored so a config written for a later phase still loads.
 */
export function normalizeSecurityConfig(
  raw: YamlSecurityConfig | null | undefined,
  current: NormalizedSecurityConfig,
): NormalizedSecurityConfig {
  if (raw === null || raw === undefined) return current;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('config.yaml: security must be a mapping');
  }
  const semgrep = raw.semgrep;
  if (semgrep === null || semgrep === undefined) return current;
  if (typeof semgrep !== 'object' || Array.isArray(semgrep)) {
    throw new Error('config.yaml: security.semgrep must be a mapping');
  }
  const merged: NormalizedSemgrepConfig = { ...current.semgrep };
  if (semgrep.enabled !== undefined) {
    if (typeof semgrep.enabled !== 'boolean') {
      throw new Error(`config.yaml: security.semgrep.enabled must be true or false (got: ${String(semgrep.enabled)})`);
    }
    merged.enabled = semgrep.enabled;
  }
  return { ...current, semgrep: merged };
}
