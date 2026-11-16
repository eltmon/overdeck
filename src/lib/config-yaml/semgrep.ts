/** Raw `security:` block as it appears in config.yaml (PAN-4585). */
export interface YamlSecurityConfig {
  semgrep?: YamlSemgrepConfig;
}

/** PAN-4590: what the built-in `sast` verification gate does with findings. */
export type SemgrepGateMode = 'off' | 'advisory' | 'blocking';
/** PAN-4590: the lowest finding severity the `sast` gate counts. */
export type SemgrepSeverity = 'INFO' | 'WARNING' | 'ERROR';

export const SEMGREP_GATE_MODES: readonly SemgrepGateMode[] = ['off', 'advisory', 'blocking'];
export const SEMGREP_SEVERITIES: readonly SemgrepSeverity[] = ['INFO', 'WARNING', 'ERROR'];

/** Raw `security.semgrep:` block. Unknown keys beyond these are ignored. */
export interface YamlSemgrepConfig {
  enabled?: boolean;
  mcp?: boolean;
  edit_hook?: boolean;
  gate?: SemgrepGateMode;
  severity?: SemgrepSeverity;
  configs?: string[];
  timeout_seconds?: number;
}

export interface NormalizedSemgrepConfig {
  enabled: boolean;
  mcp: boolean;
  edit_hook: boolean;
  /** PAN-4590: `sast` gate mode; only consulted while `enabled` is true. */
  gate: SemgrepGateMode;
  severity: SemgrepSeverity;
  /** Registry ids (`p/default`) or repo-relative rule paths, each passed as `--config`. */
  configs: string[];
  /** Wall-clock limit for one repo's scan; a scan past it is killed and the gate is skipped. */
  timeout_seconds: number;
}

export interface NormalizedSecurityConfig {
  semgrep: NormalizedSemgrepConfig;
}

export const DEFAULT_NORMALIZED_SECURITY: NormalizedSecurityConfig = {
  semgrep: {
    enabled: false,
    mcp: false,
    edit_hook: false,
    gate: 'advisory',
    severity: 'ERROR',
    configs: ['p/default'],
    timeout_seconds: 300,
  },
};

const BOOLEAN_KEYS = ['enabled', 'mcp', 'edit_hook'] as const;

function readEnum<T extends string>(key: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`config.yaml: security.semgrep.${key} must be one of ${allowed.join(', ')} (got: ${String(value)})`);
  }
  return value as T;
}

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
  const merged: NormalizedSemgrepConfig = { ...current.semgrep, configs: [...current.semgrep.configs] };
  for (const key of BOOLEAN_KEYS) {
    const value = semgrep[key];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      throw new Error(`config.yaml: security.semgrep.${key} must be true or false (got: ${String(value)})`);
    }
    merged[key] = value;
  }
  if (semgrep.gate !== undefined) merged.gate = readEnum('gate', semgrep.gate, SEMGREP_GATE_MODES);
  if (semgrep.severity !== undefined) merged.severity = readEnum('severity', semgrep.severity, SEMGREP_SEVERITIES);
  if (semgrep.configs !== undefined) {
    const configs: unknown = semgrep.configs;
    if (!Array.isArray(configs) || configs.length === 0
      || !configs.every((entry) => typeof entry === 'string' && entry.trim() !== '' && !entry.startsWith('-'))) {
      throw new Error('config.yaml: security.semgrep.configs must be a non-empty list of rule ids or paths');
    }
    merged.configs = configs.map((entry: string) => entry.trim());
  }
  if (semgrep.timeout_seconds !== undefined) {
    const timeout: unknown = semgrep.timeout_seconds;
    if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1) {
      throw new Error(`config.yaml: security.semgrep.timeout_seconds must be a positive whole number (got: ${String(timeout)})`);
    }
    merged.timeout_seconds = timeout;
  }
  return { ...current, semgrep: merged };
}
