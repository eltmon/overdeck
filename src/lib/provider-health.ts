/**
 * Provider Health Probing
 *
 * Pre-flight check for non-Anthropic direct providers before spawning agents.
 * Sends a minimal request to detect quota exhaustion, auth failures, and
 * network issues BEFORE the agent enters Claude Code's opaque retry loop.
 */

import { Effect } from 'effect';
import { getProviderEnvSync, getProviderForModelSync, type ProviderConfig } from './providers.js';
import { loadConfigSync as loadYamlConfig } from './config-yaml.js';
import { ensureOpenAICompatibleProxyRunning } from './openai-compatible-proxy.js';
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
}async function probeProviderPromise(
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
export function invalidateProbeCacheSync(provider?: string): void {
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
  // Nous Portal routes through the local OpenAI-compatible proxy sidecar at
  // 127.0.0.1:12436. Without this, the probe runs before the proxy is booted
  // on the first spawn after every dashboard restart and surfaces a spurious
  // "Cannot reach Nous Portal: fetch failed" toast.
  if (provider.name === 'nous') {
    await Effect.runPromise(ensureOpenAICompatibleProxyRunning());
    // Use GET /v1/models instead of POST /v1/messages. The only Nous model
    // (qwen/qwen3.6-plus) is a reasoning model that ignores max_tokens for
    // its reasoning phase and routinely takes >8s to answer a one-character
    // probe, blowing the timeout. /v1/models verifies network + auth without
    // burning reasoning tokens.
    return probeModelsEndpoint(provider, apiKey);
  }

  const providerEnv = getProviderEnvSync(provider, apiKey);
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
    return classifyFetchError(err, provider);
  }
}

async function probeModelsEndpoint(
  provider: ProviderConfig,
  apiKey: string,
): Promise<ProbeResult> {
  const baseUrl = provider.baseUrl;
  if (!baseUrl) return { ok: true };

  const normalized = baseUrl.replace(/\/+$/, '');
  const url = normalized.endsWith('/v1') ? `${normalized}/models` : `${normalized}/v1/models`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        accept: 'application/json',
      },
    });

    clearTimeout(timer);
    if (response.ok) return { ok: true };
    return classifyError(response.status, await response.text());
  } catch (err: unknown) {
    clearTimeout(timer);
    return classifyFetchError(err, provider);
  }
}

function classifyFetchError(err: unknown, provider: ProviderConfig): ProbeResult {
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
}async function validateProviderHealthPromise(
  model: string,
  apiKey?: string,
): Promise<void> {
  const provider = getProviderForModelSync(model as ModelId);

  // Skip: Anthropic native and OpenAI subscription routing have their own checks.
  if (provider.name === 'anthropic' || provider.name === 'openai') {
    return;
  }

  const key = apiKey ?? resolveApiKey(provider);
  if (!key) return; // No key configured — let downstream handle the "no key" error

  const result = await Effect.runPromise(probeProvider(provider, key, model));
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

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect variant of {@link probeProvider}. Never fails — probe results
 * (including error classifications) are carried in the success channel as
 * `ProbeResult`.
 */
export const probeProvider = (
  provider: ProviderConfig,
  apiKey: string,
  model: string,
): Effect.Effect<ProbeResult, never> =>
  Effect.promise(() => probeProviderPromise(provider, apiKey, model));

/** Effect variant of {@link validateProviderHealth}. */
export const validateProviderHealth = (
  model: string,
  apiKey?: string,
): Effect.Effect<void, ProviderHealthError> =>
  Effect.tryPromise({
    try: () => validateProviderHealthPromise(model, apiKey),
    catch: (cause) => {
      if (cause instanceof ProviderHealthError) return cause;
      // Should never happen — validateProviderHealth only throws ProviderHealthError.
      // Re-wrap defensively so the typed error channel stays narrow.
      const provider = getProviderForModelSync(model as ModelId);
      return new ProviderHealthError(provider, model, {
        ok: false,
        kind: 'unknown',
        message: cause instanceof Error ? cause.message : String(cause),
      });
    },
  });

/** Effect variant of {@link invalidateProbeCacheSync}. Pure cache mutation; cannot fail. */
export const invalidateProbeCache = (provider?: string): Effect.Effect<void, never> =>
  Effect.sync(() => invalidateProbeCacheSync(provider));
