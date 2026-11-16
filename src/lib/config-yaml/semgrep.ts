/** Raw `security:` block as it appears in config.yaml (PAN-4585). */
export interface YamlSecurityConfig {
  semgrep?: YamlSemgrepConfig;
}

/** Raw `security.semgrep:` block. Unknown keys beyond these are ignored. */
export interface YamlSemgrepConfig {
  enabled?: boolean;
  mcp?: boolean;
  edit_hook?: boolean;
}

export interface NormalizedSemgrepConfig {
  enabled: boolean;
  mcp: boolean;
  edit_hook: boolean;
}

export interface NormalizedSecurityConfig {
  semgrep: NormalizedSemgrepConfig;
}

export const DEFAULT_NORMALIZED_SECURITY: NormalizedSecurityConfig = {
  semgrep: { enabled: false, mcp: false, edit_hook: false },
};

const BOOLEAN_KEYS = ['enabled', 'mcp', 'edit_hook'] as const;

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
  for (const key of BOOLEAN_KEYS) {
    const value = semgrep[key];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      throw new Error(`config.yaml: security.semgrep.${key} must be true or false (got: ${String(value)})`);
    }
    merged[key] = value;
  }
  return { ...current, semgrep: merged };
}
