import { DEFAULT_OLLAMA_BASE_URL, SAFE_OLLAMA_HOST_RE } from '../ollama.js';

/** Raw `ollama:` block as it appears in config.yaml. */
export interface YamlOllamaConfig {
  base_url?: string;
  context_length?: number;
}

/** Normalized `ollama` block on NormalizedConfig. */
export interface NormalizedOllamaConfig {
  baseUrl: string;
  contextLength: number;
}

export const DEFAULT_OLLAMA_CONTEXT_LENGTH = 65_536;

/**
 * Smallest context window worth launching an agent against: Overdeck's own first
 * prompt alone runs to tens of thousands of tokens, and Ollama silently truncates
 * anything past the window rather than erroring.
 */
const MIN_OLLAMA_CONTEXT_LENGTH = 2_048;

export const DEFAULT_NORMALIZED_OLLAMA: NormalizedOllamaConfig = {
  baseUrl: DEFAULT_OLLAMA_BASE_URL,
  contextLength: DEFAULT_OLLAMA_CONTEXT_LENGTH,
};

/**
 * Fold one config layer's `ollama:` block onto the value merged so far. A bad value throws
 * at config load, the same way an unresolvable role model ref does: a non-localhost endpoint
 * would send every local-agent prompt to a third party, so silently ignoring it is worse
 * than refusing to load.
 */
export function normalizeOllamaConfig(
  raw: YamlOllamaConfig | undefined,
  current: NormalizedOllamaConfig,
): NormalizedOllamaConfig {
  if (!raw) return current;
  const merged: NormalizedOllamaConfig = { ...current };

  if (raw.base_url !== undefined) {
    const trimmed = String(raw.base_url).trim().replace(/\/$/, '');
    if (!SAFE_OLLAMA_HOST_RE.test(trimmed)) {
      throw new Error(`config.yaml: ollama.base_url must be a localhost address (got: ${raw.base_url})`);
    }
    merged.baseUrl = trimmed;
  }

  if (raw.context_length !== undefined) {
    const value = raw.context_length;
    if (!Number.isInteger(value) || value < MIN_OLLAMA_CONTEXT_LENGTH) {
      throw new Error(
        `config.yaml: ollama.context_length must be an integer of at least ${MIN_OLLAMA_CONTEXT_LENGTH} (got: ${String(value)})`,
      );
    }
    merged.contextLength = value;
  }

  return merged;
}
