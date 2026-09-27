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

/** Ollama's own default listen port, used when a configured base_url names none. */
const DEFAULT_OLLAMA_PORT = 11_434;

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
    // A port-less URL would otherwise load and then fail confusingly: the health probes
    // go to port 80, while an Overdeck-started `ollama serve` given OLLAMA_HOST without a
    // port binds 11434 — so the start "succeeds" and every probe times out. Default the
    // port here instead, where the fix is one place and visible in the loaded config.
    merged.baseUrl = withDefaultOllamaPort(trimmed);
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

/** `http://localhost` -> `http://localhost:11434`; a URL that already names a port is unchanged. */
function withDefaultOllamaPort(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    if (url.port === '') {
      url.port = String(DEFAULT_OLLAMA_PORT);
      // href re-adds a trailing slash for a bare-origin URL; the rest of the code
      // stores base URLs without one.
      return url.toString().replace(/\/$/, '');
    }
    return baseUrl;
  } catch {
    // SAFE_OLLAMA_HOST_RE admits a bare `http://::1`, which the URL parser rejects.
    // Leave it as the operator wrote it rather than guessing at a rewrite.
    return baseUrl;
  }
}
