// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-tier-fitness.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}
import type { NormalizedConfig } from '../../lib/config-yaml/schema.js';
import { getOllamaInstallGuidance } from './install-ollama.js';
import { configuredOllamaModels } from '../../lib/ollama-usage.js';
import {
  checkOllamaHealth,
  isOllamaInstalled,
  MIN_OLLAMA_VERSION,
  stripOllamaPrefix,
  type OllamaHealth,
} from '../../lib/ollama.js';
import { detectPlatform } from '../../lib/platform.js';
import { Effect } from 'effect';

/** Smallest window a work agent's first prompt reliably fits in (D5). */
const RECOMMENDED_CONTEXT_LENGTH = 65_536;

export interface CheckOllamaOptions {
  config: NormalizedConfig;
  detectInstalled?: () => Promise<boolean>;
  checkHealth?: typeof checkOllamaHealth;
  fetchImpl?: typeof fetch;
}

interface OllamaPsResponse {
  models?: Array<{ name?: string; model?: string; context_length?: number }>;
}

/**
 * Report on the local Ollama server, but only when it is part of this install: a host
 * with no `ollama:` model configured and no binary gets no rows at all, because every
 * extra row in `pan doctor` costs an operator attention they could spend on a real one.
 *
 * Doctor never warm-loads a model — that would pull 8 GB into VRAM as a side effect of
 * asking a diagnostic question. It reports the window of whatever is already resident.
 */
export async function checkOllama(options: CheckOllamaOptions): Promise<CheckResult[]> {
  const models = configuredOllamaModels(options.config);
  const installed = await (options.detectInstalled ?? isOllamaInstalled)();

  if (models.length === 0 && !installed) return [];

  if (!installed) {
    const platform = await Effect.runPromise(detectPlatform());
    return [{
      name: 'Ollama',
      status: 'warn',
      message: `Not installed, but ${models.length} local model${models.length === 1 ? ' is' : 's are'} configured (${models.join(', ')})`,
      fix: getOllamaInstallGuidance(platform),
    }];
  }

  const { baseUrl } = options.config.ollama;
  const tags = models.map(stripOllamaPrefix);
  const checkHealth = options.checkHealth ?? checkOllamaHealth;
  // Probing with one configured tag (or a placeholder) answers reachability and
  // version in one round trip; per-tag presence is resolved below.
  const health: OllamaHealth = await checkHealth(tags[0] ?? '', baseUrl, { fetchImpl: options.fetchImpl });

  if (!health.endpointReachable) {
    return [{
      name: 'Ollama',
      status: 'warn',
      message: `Installed but not reachable at ${baseUrl}`,
      fix: 'Start it with `ollama serve`, or let `pan up` start it for you.',
    }];
  }

  if (!health.versionSupported) {
    return [{
      name: 'Ollama',
      status: 'error',
      message: `${health.version ?? 'Unknown version'} at ${baseUrl} cannot serve the Anthropic Messages API`,
      fix: `Upgrade Ollama to ${MIN_OLLAMA_VERSION} or newer.`,
    }];
  }

  const checks: CheckResult[] = [{
    name: 'Ollama',
    status: 'ok',
    message: `${health.version ?? 'reachable'} at ${baseUrl}`,
  }];

  for (const tag of tags) {
    const tagHealth = await checkHealth(tag, baseUrl, { fetchImpl: options.fetchImpl });
    if (!tagHealth.modelPresent) {
      checks.push({
        name: `Ollama model ${tag}`,
        status: 'warn',
        message: `Configured but not pulled at ${baseUrl}`,
        fix: `Run: ollama pull ${tag}`,
      });
    }
  }

  for (const [tag, contextLength] of await loadedContextLengths(baseUrl, tags, options.fetchImpl)) {
    if (contextLength < RECOMMENDED_CONTEXT_LENGTH) {
      checks.push({
        name: `Ollama context ${tag}`,
        status: 'warn',
        message: `Loaded with a ${contextLength}-token window; an agent's first prompt alone can exceed it`,
        fix: `Restart the server with OLLAMA_CONTEXT_LENGTH=${RECOMMENDED_CONTEXT_LENGTH}, or set ollama.context_length in config.yaml and let \`pan up\` start it.`,
      });
    }
  }

  return checks;
}

/** Windows of the tags already resident, from `/api/ps`. A failure here is silence, not a row. */
async function loadedContextLengths(
  baseUrl: string,
  tags: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Array<[string, number]>> {
  try {
    const response = await fetchImpl(`${baseUrl}/api/ps`, { method: 'GET' });
    if (!response.ok) return [];
    const body = await response.json() as OllamaPsResponse;
    const found: Array<[string, number]> = [];
    for (const tag of tags) {
      const entry = body.models?.find((model) => model.name === tag || model.model === tag);
      if (entry && typeof entry.context_length === 'number') found.push([tag, entry.context_length]);
    }
    return found;
  } catch {
    return [];
  }
}
