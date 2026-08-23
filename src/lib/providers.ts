/**
 * Provider Configuration
 *
 * Defines LLM providers that Overdeck launches through Claude Code directly
 * or through local Anthropic-compatible sidecars such as CLIProxyAPI.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { Effect } from 'effect';
import type { ModelId, GrokModel } from './settings.js';
import type { RuntimeName } from './runtimes/types.js';
import { FsError } from './errors.js';
import { getOpenAICompatibleProxyBaseUrl } from './openai-compatible-proxy.js';
import { MODEL_DEPRECATIONS } from './model-capabilities.js';

export type ProviderName = 'anthropic' | 'kimi' | 'openai' | 'google' | 'minimax' | 'zai' | 'mimo' | 'openrouter' | 'nous' | 'dashscope' | 'xai' | 'groq' | 'cerebras' | 'mistral' | 'quantumllama';

/**
 * Provider configuration
 */
/**
 * Auth type for direct providers:
 * - static: Use a long-lived API key passed via ANTHROPIC_AUTH_TOKEN (default)
 * - credential-file: Use apiKeyHelper to read a fresh token from a credential file.
 *   Used for providers like Kimi Code Plan whose JWT tokens expire every ~15 minutes.
 */
export type ProviderAuthType = 'static' | 'credential-file';

export interface ProviderConfig {
  name: ProviderName;
  displayName: string;
  compatibility: 'direct';
  defaultHarness: RuntimeName;
  baseUrl?: string; // For direct providers
  authType?: ProviderAuthType; // Defaults to 'static'
  credentialFile?: string; // Path to credential file (for 'credential-file' auth)
  credentialHelper?: string; // Script that reads credential file and prints token
  models: (ModelId | string)[];
  haikuModel?: string; // Model to use as haiku substitute (for non-Anthropic providers)
  tierModels?: {
    opus?: string;
    sonnet?: string;
    haiku?: string;
  };
  tested: boolean; // Whether compatibility has been verified
  description: string;
}

/**
 * All provider configurations
 */
export const KIMI_CODING_BASE_URL = 'https://api.kimi.com/coding';
export const KIMI_PLATFORM_BASE_URL = 'https://api.moonshot.ai/anthropic';

export function getKimiAnthropicBaseUrl(apiKey: string): string {
  return apiKey.trim().startsWith('sk-kimi-')
    ? KIMI_CODING_BASE_URL
    : KIMI_PLATFORM_BASE_URL;
}

export const PROVIDERS: Record<ProviderName, ProviderConfig> = {
  anthropic: {
    name: 'anthropic',
    displayName: 'Anthropic',
    compatibility: 'direct',
    defaultHarness: 'claude-code',
    models: ['claude-fable-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
    tested: true,
    description: 'Native Claude API',
  },

  kimi: {
    name: 'kimi',
    displayName: 'Kimi (Moonshot AI)',
    compatibility: 'direct',
    // Not ohmypi (PAN-2102). omp v16.1.16 renamed Kimi's provider (kimi-coding
    // → kimi-code), changed its model ids (kimi-k2.7-code → kimi-for-coding),
    // and switched it to OAuth, so omp can no longer launch a Kimi work agent
    // — it exits immediately and the tmux session orphans.
    // PAN-1837 wi7b: flipped from 'claude-code' to 'kimi-code' — the native
    // Kimi Code CLI harness, proven end-to-end (wi14-e2e: real spawn, kickoff
    // + mid-session delivery, session/cost resolution, no fallback, all live
    // against the installed 0.29.2 binary). An operator's providerHarnesses.kimi
    // config override (e.g. 'acp' or 'claude-code') still wins over this
    // built-in default (harness-resolve.ts:80-83).
    defaultHarness: 'kimi-code',
    // PAN-1837: the native kimi-code harness resolves its own model aliases
    // under the installed CLI's config.toml, which are namespaced
    // `kimi-code/<alias>` (verified against the installed 0.29.2 binary's
    // `kimi provider list --json`) — a DIFFERENT id space than the bare
    // claude-code-routed ids above. Both must be registered here so
    // getProviderForModelSync resolves either shape to this provider.
    // The K2.5/K2.6 generation (kimi-k2, kimi-k2.5, kimi-k2.6,
    // K2.6-code-preview) is retired — the Kimi CLI's catalog never carried
    // those ids, so they could not launch under either native harness. They
    // stay in MODEL_DEPRECATIONS and in getProviderForModelSync so old configs
    // migrate and historical cost lookups still resolve.
    models: [
      'k3', 'k3[1m]', 'kimi-k2.7-code',
      'kimi-code/k3', 'kimi-code/k3-256k', 'kimi-code/kimi-for-coding', 'kimi-code/kimi-for-coding-highspeed',
    ],
    tierModels: { opus: 'k3[1m]', sonnet: 'k3', haiku: 'kimi-k2.7-code' },
    tested: true,
    description: 'Route directly to Kimi Anthropic-compatible endpoints via claude-code; sk-kimi-* keys use the coding endpoint, platform keys use Moonshot.',
  },

  openai: {
    name: 'openai',
    displayName: 'OpenAI',
    compatibility: 'direct',
    defaultHarness: 'codex',
    models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-sol[372k]', 'gpt-5.6-terra[372k]', 'gpt-5.6-luna[372k]', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.2'],
    tierModels: { opus: 'gpt-5.6-sol', sonnet: 'gpt-5.4', haiku: 'gpt-5.4-mini' },
    tested: true,
    description: 'First-party Codex CLI harness (default) using ChatGPT-subscription or API-key auth. The local CLIProxyAPI sidecar remains a legacy alternate for routing GPT models into claude-code.',
  },

  google: {
    name: 'google',
    displayName: 'Google (Gemini)',
    compatibility: 'direct',
    defaultHarness: 'ohmypi',
    models: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'],
    tierModels: { opus: 'gemini-3.1-pro-preview', sonnet: 'gemini-3-flash-preview', haiku: 'gemini-3.1-flash-lite-preview' },
    tested: true,
    description: 'Route via local CLIProxyAPI Gemini backend using GOOGLE_API_KEY',
  },

  minimax: {
    name: 'minimax',
    displayName: 'MiniMax',
    compatibility: 'direct',
    defaultHarness: 'ohmypi',
    baseUrl: 'https://api.minimax.io/anthropic',
    authType: 'static',
    models: ['minimax-m2.7', 'minimax-m2.7-highspeed', 'MiniMax-M3'],
    haikuModel: 'minimax-m2.7-highspeed',
    tierModels: { opus: 'MiniMax-M3', sonnet: 'minimax-m2.7', haiku: 'minimax-m2.7-highspeed' },
    tested: true,
    description: 'Route directly to MiniMax Anthropic-compatible endpoint using MINIMAX_API_KEY.',
  },

  zai: {
    name: 'zai',
    displayName: 'Z.AI',
    compatibility: 'direct',
    defaultHarness: 'ohmypi',
    baseUrl: 'https://api.z.ai/api/anthropic',
    authType: 'static',
    models: ['glm-5.2', 'glm-5.1', 'glm-4.7', 'glm-4.7-flash'],
    haikuModel: 'glm-4.7-flash',
    tierModels: { opus: 'glm-5.2', sonnet: 'glm-4.7', haiku: 'glm-4.7-flash' },
    tested: true,
    description: 'Route directly to Z.AI Anthropic-compatible endpoint using ZHIPU_API_KEY.',
  },

  mimo: {
    name: 'mimo',
    displayName: 'Xiaomi MiMo',
    compatibility: 'direct',
    defaultHarness: 'ohmypi',
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/anthropic',
    authType: 'static',
    models: ['mimo-v2.5-pro', 'mimo-v2.5'],
    haikuModel: 'mimo-v2.5',
    tierModels: { opus: 'mimo-v2.5-pro', sonnet: 'mimo-v2.5-pro', haiku: 'mimo-v2.5' },
    tested: true,
    description: 'Route directly to Xiaomi MiMo Anthropic-compatible endpoint using MIMO_API_KEY.',
  },

  openrouter: {
    name: 'openrouter',
    displayName: 'OpenRouter',
    compatibility: 'direct',
    defaultHarness: 'ohmypi',
    // Claude Code appends /v1/messages to ANTHROPIC_BASE_URL, so this must NOT
    // end in /v1 — 'https://openrouter.ai/api/v1' produced /api/v1/v1/messages
    // 404s that surfaced as "model may not exist". Pi ignores this var (it
    // auths via OPENROUTER_API_KEY through its own provider registry).
    baseUrl: 'https://openrouter.ai/api',
    authType: 'static',
    models: [], // Dynamic models fetched from OpenRouter API; IDs contain '/'
    tested: true,
    description: 'Route directly to OpenRouter Anthropic-compatible endpoint; slash-containing model IDs pass through unchanged.',
  },

  nous: {
    name: 'nous',
    displayName: 'Nous Portal',
    compatibility: 'direct',
    defaultHarness: 'ohmypi',
    baseUrl: getOpenAICompatibleProxyBaseUrl('nous'),
    authType: 'static',
    models: ['qwen/qwen3.6-plus'],
    haikuModel: 'qwen/qwen3.6-plus',
    tierModels: { opus: 'qwen/qwen3.6-plus', sonnet: 'qwen/qwen3.6-plus', haiku: 'qwen/qwen3.6-plus' },
    tested: true,
    description: "Route Nous Portal OpenAI-compatible models through Overdeck's local Anthropic-compatible adapter using NOUS_API_KEY.",
  },

  dashscope: {
    name: 'dashscope',
    displayName: 'Alibaba DashScope',
    compatibility: 'direct',
    defaultHarness: 'ohmypi',
    baseUrl: getOpenAICompatibleProxyBaseUrl('dashscope'),
    authType: 'static',
    models: ['qwen3-max', 'qwen3-coder-plus', 'qwen3-plus', 'qwen3.7-max', 'qwen3.8-max'],
    haikuModel: 'qwen3-plus',
    tierModels: { opus: 'qwen3-max', sonnet: 'qwen3-coder-plus', haiku: 'qwen3-plus' },
    tested: false,
    description: "Route Alibaba DashScope Qwen models through Overdeck's local Anthropic-compatible adapter using DASHSCOPE_API_KEY against the Singapore intl endpoint (ap-southeast-1).",
  },

  xai: {
    name: 'xai',
    displayName: 'xAI (Grok)',
    compatibility: 'direct',
    defaultHarness: 'ohmypi',
    baseUrl: 'https://api.x.ai/v1',
    authType: 'static',
    models: ['grok-build-0.1'] as GrokModel[],
    tierModels: { opus: 'grok-build-0.1', sonnet: 'grok-build-0.1', haiku: 'grok-build-0.1' },
    tested: false,
    description: 'Route directly to xAI Anthropic-compatible endpoint using XAI_API_KEY. Model: grok-build-0.1 (256K ctx, $1/M in, $2/M out).',
  },

  groq: {
    name: 'groq',
    displayName: 'Groq',
    compatibility: 'direct',
    defaultHarness: 'ohmypi',
    authType: 'static',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen-qwq-32b', 'gemma2-9b-it'],
    haikuModel: 'llama-3.1-8b-instant',
    tierModels: { opus: 'llama-3.3-70b-versatile', sonnet: 'llama-3.3-70b-versatile', haiku: 'llama-3.1-8b-instant' },
    tested: false,
    description: 'Route via omp using GROQ_API_KEY. Ultra-low-latency inference on open-weight models.',
  },

  cerebras: {
    name: 'cerebras',
    displayName: 'Cerebras',
    compatibility: 'direct',
    defaultHarness: 'ohmypi',
    authType: 'static',
    models: ['llama3.3-70b', 'llama3.1-70b', 'llama3.1-8b'],
    haikuModel: 'llama3.1-8b',
    tierModels: { opus: 'llama3.3-70b', sonnet: 'llama3.1-70b', haiku: 'llama3.1-8b' },
    tested: false,
    description: 'Route via omp using CEREBRAS_API_KEY. Hardware-accelerated inference on Cerebras wafer-scale chips.',
  },

  mistral: {
    name: 'mistral',
    displayName: 'Mistral AI',
    compatibility: 'direct',
    defaultHarness: 'ohmypi',
    authType: 'static',
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
    haikuModel: 'mistral-small-latest',
    tierModels: { opus: 'mistral-large-latest', sonnet: 'mistral-large-latest', haiku: 'mistral-small-latest' },
    tested: false,
    description: 'Route via omp using MISTRAL_API_KEY.',
  },

  quantumllama: {
    name: 'quantumllama',
    displayName: 'QuantumLlama',
    compatibility: 'direct',
    defaultHarness: 'claude-code',
    baseUrl: 'https://api.quantumllama.ai/v1',
    authType: 'static',
    models: ['ql-reason-70b', 'ql-swift-8b', 'ql-nano-1b'],
    haikuModel: 'ql-nano-1b',
    tierModels: { opus: 'ql-reason-70b', sonnet: 'ql-swift-8b', haiku: 'ql-nano-1b' },
    tested: false,
    description: 'Route directly to the QuantumLlama Anthropic-compatible endpoint using QUANTUMLLAMA_API_KEY. Synthetic benchmark provider (PAN-3252); no live endpoint exists.',
  },
};

/**
 * PAN-1837: the native kimi-code CLI's own model catalog (verified via `kimi
 * provider list --json` against the installed 0.29.2 binary) is a smaller,
 * DIFFERENT id space than the claude-code-routed Kimi ids in
 * PROVIDERS.kimi.models — it exposes only kimi-code/k3, kimi-code/k3-256k,
 * kimi-code/kimi-for-coding, and kimi-code/kimi-for-coding-highspeed. Since
 * wi7b flipped the built-in default to kimi-code, an existing role/config
 * pinned to a bare claude-code-routed id (e.g. `kimi-k2.6`) now resolves to
 * kimi-code but `kimi -m kimi-k2.6` fails — the native binary has never heard
 * of that id.
 *
 * Only remap ids with a defensible 1:1 native correspondence. Reviewed
 * against `kimi provider list --json`: kimi-code/k3 reports
 * maxContextSize=1048576 (matches the claude-routed k3[1m] alias's 1M
 * context), kimi-code/k3-256k reports maxContextSize=262144 (matches the
 * claude-routed k3 alias's 256K context) — so the context tiers, not the
 * bare-string similarity, decide the mapping.
 *
 * This table must stay in sync with KIMI_ACP_MODEL_IDS in src/lib/acp/kimi.ts.
 * Both translate a claude-code-routed id into the same CLI catalog, because
 * `acp` and `kimi-code` drive the same `kimi` binary — an id that one accepts
 * and the other rejects is a bug, not a harness difference.
 */
const KIMI_LEGACY_MODEL_TO_NATIVE_ALIAS: Record<string, string> = {
  'k3': 'kimi-code/k3-256k',
  'k3[1m]': 'kimi-code/k3',
  'kimi-k2.7-code': 'kimi-code/kimi-for-coding',
};

/**
 * Resolve a model id to what the kimi-code CLI's `-m` flag will actually
 * accept. Already-native `kimi-code/<alias>` ids pass through unchanged.
 * Legacy claude-code-routed ids with a defensible native counterpart
 * (KIMI_LEGACY_MODEL_TO_NATIVE_ALIAS) are remapped. The retired ids
 * (kimi-k2.6, kimi-k2.5, kimi-k2, K2.6-code-preview) have no native
 * equivalent in the installed CLI's catalog; they are remapped to a live id
 * by MODEL_DEPRECATIONS before reaching this point, and anything that still
 * arrives here fails loudly (matching the existing PAN-1871
 * fail-loud-over-silent-wrong-launch philosophy) instead of guessing an alias
 * the operator never chose.
 */
export function resolveKimiCodeModelAlias(model: string): string {
  if (model.startsWith('kimi-code/')) return model;
  const mapped = KIMI_LEGACY_MODEL_TO_NATIVE_ALIAS[model];
  if (mapped) return mapped;
  throw new Error(
    `Model "${model}" has no native kimi-code CLI equivalent — the installed binary's catalog only exposes `
    + `kimi-code/k3, kimi-code/k3-256k, kimi-code/kimi-for-coding, and kimi-code/kimi-for-coding-highspeed. `
    + `Pick one of those models, or set providerHarnesses.kimi to 'claude-code' or 'acp' in config.yaml to keep using "${model}".`,
  );
}

export function getBuiltInDefaultHarness(provider: ProviderName | string): RuntimeName {
  if (provider in PROVIDERS) {
    return PROVIDERS[provider as ProviderName].defaultHarness;
  }
  return 'claude-code';
}

export class UnknownModelError extends Error {
  constructor(modelId: string, suggestion?: string) {
    super(`Unknown model "${modelId}".${suggestion ? ` Did you mean "${suggestion}"?` : ''}`);
    this.name = 'UnknownModelError';
  }
}

function knownModelIds(): string[] {
  return Array.from(new Set([
    ...Object.values(PROVIDERS).flatMap((provider) => provider.models.map(String)),
    ...Object.keys(MODEL_DEPRECATIONS),
    ...Object.values(MODEL_DEPRECATIONS).map(String),
  ]));
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

function nearestKnownModelId(modelId: string): string | undefined {
  const normalizedInput = modelId.toLowerCase();
  const compactInput = normalizedInput.replace(/[^a-z0-9]/g, '');
  let best: { model: string; distance: number } | undefined;
  for (const candidate of knownModelIds()) {
    const normalizedCandidate = candidate.toLowerCase();
    const distance = Math.min(
      editDistance(normalizedInput, normalizedCandidate),
      editDistance(compactInput, normalizedCandidate.replace(/[^a-z0-9]/g, '')),
    );
    if (!best || distance < best.distance) {
      best = { model: candidate, distance };
    }
  }
  if (!best) return undefined;
  return best.distance <= Math.max(2, Math.floor(modelId.length / 3)) ? best.model : undefined;
}

/**
 * Get provider for a given model ID
 */
export function getProviderForModelSync(modelId: ModelId | string): ProviderConfig {
  // OpenRouter model IDs always contain '/' (e.g. 'qwen/qwen3.6-plus:free'),
  // except for explicitly supported slash-delimited providers such as Nous Portal.
  if (['qwen/qwen3.6-plus'].includes(modelId)) {
    return PROVIDERS.nous;
  }
  if (['qwen3-max', 'qwen3-coder-plus', 'qwen3-plus', 'qwen3.7-max', 'qwen3.8-max'].includes(modelId)) {
    return PROVIDERS.dashscope;
  }
  // PAN-1837: native kimi-code CLI model aliases are namespaced `kimi-code/<alias>`
  // (its own config.toml provider-prefixing, not an OpenRouter id) — carve out
  // before the generic slash-delimited catch-all below.
  if (modelId.startsWith('kimi-code/')) {
    return PROVIDERS.kimi;
  }
  if (modelId.includes('/')) {
    return PROVIDERS.openrouter;
  }

  // Check Anthropic models
  if (['claude-fable-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'].includes(modelId)) {
    return PROVIDERS.anthropic;
  }

  // Check OpenAI models — supported set + retired IDs (still routed so the
  // deprecation-migration path can fire warnings before remap).
  if (['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-sol[372k]', 'gpt-5.6-terra[372k]', 'gpt-5.6-luna[372k]', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.2', 'gpt-5.5-pro', 'gpt-5.4-pro', 'o3', 'o4-mini', 'o3-deep-research', 'gpt-4o', 'gpt-4o-mini'].includes(modelId)) {
    return PROVIDERS.openai;
  }

  // Check Google models
  if (['gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'].includes(modelId)) {
    return PROVIDERS.google;
  }

  // Check MiniMax models
  if (['minimax-m2.7', 'minimax-m2.7-highspeed', 'MiniMax-M3'].includes(modelId)) {
    return PROVIDERS.minimax;
  }

  // Check Kimi models — supported set + retired K2.5/K2.6-generation ids
  // (still routed so the deprecation-migration path can fire before remap).
  if (['k3', 'k3[1m]', 'kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.5', 'kimi-k2', 'K2.6-code-preview'].includes(modelId)) {
    return PROVIDERS.kimi;
  }

  // Check xAI models
  if (['grok-build-0.1'].includes(modelId)) {
    return PROVIDERS.xai;
  }

  // Check Z.AI models
  if (['glm-5.2', 'glm-5.1', 'glm-4.7', 'glm-4.7-flash'].includes(modelId)) {
    return PROVIDERS.zai;
  }

  // Check MiMo models
  if (['mimo-v2.5-pro', 'mimo-v2.5'].includes(modelId)) {
    return PROVIDERS.mimo;
  }

  // Check Groq models
  if (['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen-qwq-32b', 'gemma2-9b-it'].includes(modelId)) {
    return PROVIDERS.groq;
  }

  // Check Cerebras models
  if (['llama3.3-70b', 'llama3.1-70b', 'llama3.1-8b'].includes(modelId)) {
    return PROVIDERS.cerebras;
  }

  // Check Mistral models
  if (['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'].includes(modelId)) {
    return PROVIDERS.mistral;
  }

  // Check QuantumLlama models (synthetic benchmark provider, PAN-3252)
  if (['ql-reason-70b', 'ql-swift-8b', 'ql-nano-1b'].includes(modelId)) {
    return PROVIDERS.quantumllama;
  }

  throw new UnknownModelError(String(modelId), nearestKnownModelId(String(modelId)));
}

/**
 * Get all direct-compatible providers
 */
export function getDirectProviders(): ProviderConfig[] {
  return Object.values(PROVIDERS);
}

/**
 * Get environment variables for spawning agent with specific provider.
 *
 * `harness` is optional and defaults to preserving the pre-PAN-1837 behavior
 * for every existing caller. When harness === 'kimi-code', the Kimi
 * Anthropic-compatibility shim (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN /
 * KIMI_API_KEY) is skipped entirely: native Kimi Code auth is host-owned via
 * `kimi login` / ~/.kimi-code/config.toml, and leaking these vars into the
 * native binary's env would risk silently redirecting or breaking its auth.
 */
export function getProviderEnvSync(
  provider: ProviderConfig,
  apiKey: string,
  harness?: RuntimeName,
): Record<string, string> {
  if (provider.name === 'openai') {
    // OpenAI never receives provider-native or Anthropic token env here.
    // getProviderEnvForModel routes subscription launches through CLIProxy and
    // rejects API-key launches before env construction.
    return {};
  }

  const isKimiCode = provider.name === 'kimi' && harness === 'kimi-code';

  const env: Record<string, string> = {};

  if (!isKimiCode) {
    if (provider.name === 'kimi') {
      env.ANTHROPIC_BASE_URL = getKimiAnthropicBaseUrl(apiKey);
    } else if (provider.baseUrl) {
      env.ANTHROPIC_BASE_URL = provider.baseUrl;
    }
  }

  if (provider.name !== 'anthropic' && !isKimiCode) {
    if (provider.authType === 'credential-file') {
      // Credential-file providers use apiKeyHelper for dynamic token refresh.
      // We still need an initial ANTHROPIC_AUTH_TOKEN for the first request,
      // but apiKeyHelper (configured via setupCredentialFileAuth) will keep it fresh.
      env.ANTHROPIC_AUTH_TOKEN = apiKey;
      // Refresh token every 60 seconds (kimi-cli refreshes credential file automatically)
      env.CLAUDE_CODE_API_KEY_HELPER_TTL_MS = '60000';
    } else {
      // Static providers use a long-lived API key
      env.ANTHROPIC_AUTH_TOKEN = apiKey;
    }
  }

  // Pi-native provider env vars so the Pi harness can authenticate directly
  // when driving non-Anthropic models (Pi has its own provider registry).
  // Native kimi-code ignores this var (auth is host-owned), so it's skipped too.
  if (provider.name === 'kimi' && !isKimiCode) {
    env.KIMI_API_KEY = apiKey;
  } else if (provider.name === 'minimax') {
    env.MINIMAX_API_KEY = apiKey;
  } else if (provider.name === 'zai') {
    env.ZAI_API_KEY = apiKey;
  } else if (provider.name === 'mimo') {
    env.MIMO_API_KEY = apiKey;
  } else if (provider.name === 'openrouter') {
    env.OPENROUTER_API_KEY = apiKey;
  } else if (provider.name === 'nous') {
    env.NOUS_API_KEY = apiKey;
  } else if (provider.name === 'dashscope') {
    env.DASHSCOPE_API_KEY = apiKey;
  } else if (provider.name === 'google') {
    env.GEMINI_API_KEY = apiKey;
  } else if (provider.name === 'xai') {
    env.XAI_API_KEY = apiKey;
  } else if (provider.name === 'groq') {
    env.GROQ_API_KEY = apiKey;
  } else if (provider.name === 'cerebras') {
    env.CEREBRAS_API_KEY = apiKey;
  } else if (provider.name === 'mistral') {
    env.MISTRAL_API_KEY = apiKey;
  } else if (provider.name === 'quantumllama') {
    env.QUANTUMLLAMA_API_KEY = apiKey;
  }

  // MiniMax, Z.AI, and MiMo recommend longer timeouts
  if (provider.name === 'minimax' || provider.name === 'zai' || provider.name === 'mimo') {
    env.API_TIMEOUT_MS = '300000';
  }

  // Non-Anthropic providers don't support claude-haiku-4-5-20251001.
  // Tell Claude Code to use the provider's small/fast model instead
  // for Explore agents and other haiku-dependent features. These are all
  // Claude Code subagent-routing concepts (Explorer/Plan/general-purpose) —
  // meaningless to the native kimi-code binary, so skip them too.
  if (provider.haikuModel && !isKimiCode) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = provider.haikuModel;
  }

  // Inject subagent model env vars so Claude Code spawns subagents
  // (Explorer, Plan, general-purpose) with model IDs the provider knows.
  if (provider.tierModels && !isKimiCode) {
    if (provider.tierModels.opus) {
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = provider.tierModels.opus;
    }
    if (provider.tierModels.sonnet) {
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = provider.tierModels.sonnet;
    }
    if (provider.tierModels.haiku) {
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = provider.tierModels.haiku;
      env.ANTHROPIC_SMALL_FAST_MODEL = provider.tierModels.haiku;
      env.CLAUDE_CODE_SUBAGENT_MODEL = provider.tierModels.haiku;
    }
  }

  return env;
}

/**
 * For credential-file providers (e.g. Kimi Code Plan), configure Claude Code's
 * apiKeyHelper in the workspace settings so tokens are refreshed dynamically.
 *
 * This writes to .claude/settings.local.json in the workspace directory.
 * Must be called before spawning the agent.
 */
export function setupCredentialFileAuthSync(provider: ProviderConfig, workspacePath: string): void {
  if (provider.authType !== 'credential-file' || !provider.credentialHelper) return;

  const helperPath = provider.credentialHelper.replace('~', process.env.HOME || '');
  const claudeDir = join(workspacePath, '.claude');
  const settingsPath = join(claudeDir, 'settings.local.json');

  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  // Read existing settings or start fresh
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch { /* start fresh */ }
  }

  // Set the apiKeyHelper to our token reader script
  settings.apiKeyHelper = helperPath;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

/**
 * Clear credential-file auth from workspace settings.
 *
 * When switching from a credential-file provider (e.g. Kimi) to a static/plan-based
 * provider (e.g. Anthropic), the apiKeyHelper must be removed from
 * .claude/settings.local.json. Otherwise Claude Code will keep using the stale
 * token helper and fail with "Invalid API key".
 */
export function clearCredentialFileAuthSync(workspacePath: string): void {
  const settingsPath = join(workspacePath, '.claude', 'settings.local.json');
  if (!existsSync(settingsPath)) return;

  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    if (!settings.apiKeyHelper) return; // Nothing to clear

    delete settings.apiKeyHelper;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  } catch { /* non-fatal */ }
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Effect variant of {@link getProviderForModelSync}. Pure lookup; cannot fail. */
export const getProviderForModel = (modelId: ModelId | string): Effect.Effect<ProviderConfig, never> =>
  Effect.sync(() => getProviderForModelSync(modelId));

/** Effect variant of {@link getProviderEnvSync}. Pure transform; cannot fail. */
export const getProviderEnv = (
  provider: ProviderConfig,
  apiKey: string,
): Effect.Effect<Record<string, string>, never> =>
  Effect.sync(() => getProviderEnvSync(provider, apiKey));

/** Effect variant of {@link setupCredentialFileAuthSync}. */
export const setupCredentialFileAuth = (
  provider: ProviderConfig,
  workspacePath: string,
): Effect.Effect<void, FsError> =>
  Effect.tryPromise({
    try: async () => {
      if (provider.authType !== 'credential-file' || !provider.credentialHelper) return;

      const helperPath = provider.credentialHelper.replace('~', process.env.HOME || '');
      const claudeDir = join(workspacePath, '.claude');
      const settingsPath = join(claudeDir, 'settings.local.json');

      if (!existsSync(claudeDir)) {
        await mkdir(claudeDir, { recursive: true });
      }

      let settings: Record<string, unknown> = {};
      if (existsSync(settingsPath)) {
        try {
          settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
        } catch { /* start fresh */ }
      }

      settings.apiKeyHelper = helperPath;
      await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    },
    catch: (cause) =>
      new FsError({ path: workspacePath, operation: 'setupCredentialFileAuth', cause }),
  });

/** Effect variant of {@link clearCredentialFileAuthSync}. Swallows all errors (non-fatal). */
export const clearCredentialFileAuth = (workspacePath: string): Effect.Effect<void, never> =>
  Effect.promise(async () => {
    const settingsPath = join(workspacePath, '.claude', 'settings.local.json');
    if (!existsSync(settingsPath)) return;
    try {
      const settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
      if (!settings.apiKeyHelper) return;
      delete settings.apiKeyHelper;
      await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    } catch { /* non-fatal */ }
  });

/**
 * Map a Overdeck provider to the Pi harness's provider name for that
 * vendor. Pi resolves bare model ids against its own registry order, which
 * can pick the wrong provider entirely — e.g. bare `kimi-k2.6` resolves to
 * `moonshotai` (no API key configured) instead of `kimi-coding`, leaving the
 * agent alive but unable to complete any prompt (PAN-1799 follow-up). Pi
 * sessions rely on the user's own Pi auth (`~/.pi/agent/auth.json`); we only
 * constrain WHICH Pi provider is used — we never inject keys.
 */
export function piProviderForModel(modelId: string): string | undefined {
  const provider = getProviderForModelSync(modelId).name;
  switch (provider) {
    case 'openai':
      return 'openai-codex';
    case 'anthropic':
      return 'anthropic';
    case 'google':
      return 'google';
    case 'minimax':
      return 'minimax';
    case 'zai':
      return 'zai';
    case 'kimi':
      return 'kimi-coding';
    case 'mimo':
      return 'xiaomi';
    case 'xai':
      return 'xai';
    case 'dashscope':
      // Not in omp's bundled catalog — provisioned into the omp user
      // registry (~/.omp/agent/models.json) by ohmypi-models.ts at spawn.
      return 'dashscope';
    default:
      return undefined;
  }
}

/**
 * Provider-qualify a model id for Pi (`kimi-coding/kimi-k2.6`). Returns the
 * bare id unchanged when no Pi provider mapping exists.
 */
export function qualifyPiModel(modelId: string): string {
  // Idempotent: conversations pre-qualify (`anthropic/claude-...`) before the
  // launcher sees the model — never double-prefix an already-qualified id.
  if (modelId.includes('/')) return modelId;
  const piProvider = piProviderForModel(modelId);
  return piProvider ? `${piProvider}/${modelId}` : modelId;
}
