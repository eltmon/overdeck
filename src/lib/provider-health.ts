/**
 * Provider Health Probing
 *
 * Pre-flight check for non-Anthropic direct providers before spawning agents.
 * Sends a minimal request to detect quota exhaustion, auth failures, and
 * network issues BEFORE the agent enters Claude Code's opaque retry loop.
 */

import { getProviderEnv, getProviderForModel, type ProviderConfig } from './providers.js';
import { loadConfig as loadYamlConfig } from './config-yaml.js';
import type { ModelId } from './settings.js';

export type ProbeResultKind = 'quota' | 'auth' | 'timeout' | 'network' | 'server' | 'unknown';

export type ProbeResult =
  | { ok: true }
  | { ok: false; kind: ProbeResultKind; status?: number; message: string };

interface CacheEntry {
  result: ProbeResult;
  expires: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PROBE_TIMEOUT_MS = 8000;
const cache = new Map<string, CacheEntry>();

function cacheKey(provider: string, apiKey: string): string {
  // Hash the key to avoid storing raw secrets in memory map keys
  const keyHash = apiKey.slice(0, 8) + '...' + apiKey.slice(-4);
  return `${provider}:${keyHash}`;
}

function classifyError(status: number, body: string): ProbeResult {
  const lower = body.toLowerCase();

  if (status === 429) {
    if (lower.includes('quota') || lower.includes('exhausted') || lower.includes('limit')) {
      return { ok: false, kind: 'quota', status, message: parseErrorMessage(body) || 'Quota exhausted' };
    }
    return { ok: false, kind: 'quota', status, message: parseErrorMessage(body) || 'Rate limited (429)' };
  }

  if (status === 401 || status === 403) {
    return { ok: false, kind: 'auth', status, message: parseErrorMessage(body) || 'Invalid API key' };
  }

  if (status >= 500) {
    return { ok: false, kind: 'server', status, message: parseErrorMessage(body) || `Server error (${status})` };
  }

  return { ok: false, kind: 'unknown', status, message: parseErrorMessage(body) || `Unexpected status ${status}` };
}

function parseErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message || parsed?.message || '';
  } catch {
    return body.slice(0, 200);
  }
}

export function buildAnthropicMessagesUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.endsWith('/v1')
    ? `${normalized}/messages`
    : `${normalized}/v1/messages`;
}

/**
 * Probe a direct provider's API to verify it can serve requests.
 * Returns cached results within the TTL window.
 */
export async function probeProvider(
  provider: ProviderConfig,
  apiKey: string,
  model: string,
): Promise<ProbeResult> {
  const key = cacheKey(provider.name, apiKey);
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expires) {
    return cached.result;
  }

  const result = await doProbe(provider, apiKey, model);

  cache.set(key, { result, expires: Date.now() + CACHE_TTL_MS });
  return result;
}

/**
 * Clear cached probe result for a provider (e.g. after key change).
 */
export function invalidateProbeCache(provider?: string): void {
  if (provider) {
    for (const k of cache.keys()) {
      if (k.startsWith(`${provider}:`)) cache.delete(k);
    }
  } else {
    cache.clear();
  }
}

async function doProbe(
  provider: ProviderConfig,
  apiKey: string,
  model: string,
): Promise<ProbeResult> {
  const providerEnv = getProviderEnv(provider, apiKey);
  const baseUrl = providerEnv.ANTHROPIC_BASE_URL ?? provider.baseUrl;
  if (!baseUrl) return { ok: true };

  const url = buildAnthropicMessagesUrl(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: '.' }],
      }),
    });

    clearTimeout(timer);
    const body = await response.text();

    // 2xx = provider is working (even if it returned empty/short content)
    if (response.ok) {
      return { ok: true };
    }

    return classifyError(response.status, body);
  } catch (err: unknown) {
    clearTimeout(timer);

    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        return { ok: false, kind: 'timeout', message: `Provider did not respond within ${PROBE_TIMEOUT_MS / 1000}s` };
      }
      if (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND') || err.message.includes('fetch failed')) {
        return { ok: false, kind: 'network', message: `Cannot reach ${provider.displayName}: ${err.message}` };
      }
    }

    return { ok: false, kind: 'unknown', message: `Probe failed: ${(err as Error).message ?? err}` };
  }
}

/**
 * User-facing error message for a failed probe, suitable for dashboard display.
 */
export function formatProbeError(provider: ProviderConfig, model: string, result: ProbeResult & { ok: false }): string {
  const prefix = `${provider.displayName} (${model})`;

  switch (result.kind) {
    case 'quota':
      return `${prefix}: quota exhausted — top up credits or switch to a different model`;
    case 'auth':
      return `${prefix}: authentication failed — check your API key in Settings`;
    case 'timeout':
      return `${prefix}: endpoint unreachable (timeout) — the provider may be down`;
    case 'network':
      return `${prefix}: network error — ${result.message}`;
    case 'server':
      return `${prefix}: provider returned ${result.status} server error — try again later or switch models`;
    default:
      return `${prefix}: pre-flight check failed — ${result.message}`;
  }
}

/**
 * Pre-flight validation for a model before agent spawn.
 * Throws with a descriptive message if the provider is unhealthy.
 * Skips probing for Anthropic and providers with separate local sidecar checks.
 *
 * If apiKey is not provided, resolves it from config.yaml.
 */
export async function validateProviderHealth(
  model: string,
  apiKey?: string,
): Promise<void> {
  const provider = getProviderForModel(model as ModelId);

  // Skip: Anthropic native and OpenAI subscription routing have their own checks.
  if (provider.name === 'anthropic' || provider.name === 'openai') {
    return;
  }

  const key = apiKey ?? resolveApiKey(provider);
  if (!key) return; // No key configured — let downstream handle the "no key" error

  const result = await probeProvider(provider, key, model);
  if (!result.ok) {
    throw new ProviderHealthError(provider, model, result);
  }
}

function resolveApiKey(provider: ProviderConfig): string | undefined {
  const { config } = loadYamlConfig();
  return config.apiKeys[provider.name as keyof typeof config.apiKeys];
}

export class ProviderHealthError extends Error {
  public readonly provider: ProviderConfig;
  public readonly model: string;
  public readonly probeResult: ProbeResult & { ok: false };

  constructor(provider: ProviderConfig, model: string, result: ProbeResult & { ok: false }) {
    super(formatProbeError(provider, model, result));
    this.name = 'ProviderHealthError';
    this.provider = provider;
    this.model = model;
    this.probeResult = result;
  }
}
