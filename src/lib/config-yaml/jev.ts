/** Raw `jev:` block as it appears in config.yaml (PAN-4369). */
export interface YamlJevConfig {
  base_url?: string;
  model?: string;
  api_key_ref?: string;
  timeout_ms?: number;
}

/** Normalized `jev` block. `configured` is false until some layer has a `jev:` mapping. */
export interface NormalizedJevConfig {
  configured: boolean;
  baseUrl?: string;
  model?: string;
  apiKeyRef: string;
  timeoutMs: number;
}

export const DEFAULT_JEV_API_KEY_REF = 'TYPESAFE_API_KEY';
export const DEFAULT_JEV_TIMEOUT_MS = 2_000;
const MAX_JEV_TIMEOUT_MS = 30_000;

export const DEFAULT_NORMALIZED_JEV: NormalizedJevConfig = {
  configured: false,
  apiKeyRef: DEFAULT_JEV_API_KEY_REF,
  timeoutMs: DEFAULT_JEV_TIMEOUT_MS,
};

/**
 * Fold one config layer's `jev:` block onto the value merged so far. Any mapping, even `{}`,
 * marks Jev as configured; a bad value throws at config load, like `ollama:` does. There is
 * no default model: a blank `model` normalizes to undefined so callers report
 * `model-not-configured` instead of picking one.
 */
export function normalizeJevConfig(
  raw: YamlJevConfig | null | undefined,
  current: NormalizedJevConfig,
): NormalizedJevConfig {
  if (raw === null || raw === undefined) return current;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('config.yaml: jev must be a mapping');
  }
  const merged: NormalizedJevConfig = { ...current, configured: true };

  if (raw.model !== undefined) {
    merged.model = requireString('model', raw.model).trim() || undefined;
  }
  if (raw.base_url !== undefined) {
    merged.baseUrl = requireString('base_url', raw.base_url).trim() || undefined;
  }
  if (raw.api_key_ref !== undefined) {
    const ref = requireString('api_key_ref', raw.api_key_ref).trim();
    if (ref) merged.apiKeyRef = ref;
  }
  if (raw.timeout_ms !== undefined) {
    const value = raw.timeout_ms;
    if (!Number.isInteger(value) || value <= 0 || value > MAX_JEV_TIMEOUT_MS) {
      throw new Error(
        `config.yaml: jev.timeout_ms must be an integer between 1 and ${MAX_JEV_TIMEOUT_MS} (got: ${String(value)})`,
      );
    }
    merged.timeoutMs = value;
  }

  return merged;
}

function requireString(key: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`config.yaml: jev.${key} must be a string`);
  }
  return value;
}
