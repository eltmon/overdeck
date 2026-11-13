/**
 * pi model-catalog provisioning (PAN-5212), the pi counterpart of
 * ohmypi-models.ts.
 *
 * pi resolves `--model <provider>/<id>` against its bundled catalog plus the
 * user registry at `~/.pi/agent/models.json`. When an id is missing, pi does
 * not fail: it fuzzy-matches another provider's model (verified: a missing
 * `xai/grok-build-0.1` bound a vercel-ai-gateway model). So every Overdeck
 * tier model that pi 0.85.0 does not ship is merge-written into the user
 * registry before the launch, keyed by its real provider id.
 *
 * Merge rules (pi's documented models.json semantics, verified live in
 * .pan/pi-vs-omp.md):
 *   - Built-in providers (google, minimax, zai, xiaomi, xai, mistral) get only
 *     the missing models, upserted by id. No provider-level baseUrl, api or
 *     apiKey is written, so the built-in models and the user's own auth stay
 *     as they are; a model-level `api` makes each entry self-describing.
 *   - Providers pi does not have (nous, dashscope) get a full provider entry.
 *     `apiKey` is written as a `$ENV_NAME` reference (pi treats a bare name as
 *     a literal key); the launcher exports the value.
 *   - Other providers and other models in the file are never touched.
 *
 * Costs are zero: Overdeck prices pi sessions from its own table (the
 * transcript parser's `cost_v2`), not from pi's per-message cost.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

import { getModelCapability, hasModelCapability } from './model-capabilities.js';
import { getDashScopeUpstreamBaseUrl, getNousUpstreamBaseUrl } from './openai-compatible-proxy.js';
import { getProviderForModel, piProviderForModel } from './providers.js';
import { getPiFamilyProfile } from './runtimes/pi-family.js';

type PiApi = 'google-generative-ai' | 'anthropic-messages' | 'openai-completions' | 'openai-responses' | 'mistral-conversations';

interface PiModelDef {
  id: string;
  name: string;
  api: PiApi;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

interface PiProviderEntry {
  baseUrl?: string;
  api?: PiApi;
  apiKey?: string;
  models?: Array<Record<string, unknown> | PiModelDef>;
  [key: string]: unknown;
}

interface ProvisionPlan {
  /** Full provider entry for a provider pi does not ship; undefined for built-in providers. */
  provider?: { baseUrl: string; api: PiApi; apiKey: string };
  api: PiApi;
  models: Array<{ id: string; name: string }>;
}

/**
 * Overdeck catalog models missing from pi 0.85.0's bundled catalog, keyed by
 * pi provider id (pi-ai `models.generated.js`, checked 2026-11-13). Ids pi
 * already ships are absent on purpose: an entry with the same id would
 * replace pi's built-in definition.
 */
function provisionPlan(piProvider: string): ProvisionPlan | undefined {
  switch (piProvider) {
    case 'google':
      return { api: 'google-generative-ai', models: [{ id: 'gemini-4-argon', name: 'Gemini 4 Argon' }] };
    case 'minimax':
      return { api: 'anthropic-messages', models: [{ id: 'MiniMax-M3.1-Flash', name: 'MiniMax M3.1 Flash' }] };
    case 'zai':
      return {
        api: 'openai-completions',
        models: [
          { id: 'glm-5.3-flashx', name: 'GLM-5.3 FlashX' },
          { id: 'glm-5.1', name: 'GLM-5.1' },
          { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash' },
        ],
      };
    case 'xiaomi':
      return {
        api: 'openai-completions',
        models: [
          { id: 'mimo-v2.6-pro', name: 'MiMo V2.6 Pro' },
          { id: 'mimo-v2.6-flash', name: 'MiMo V2.6 Flash' },
          { id: 'mimo-v2.6-pro-ultraspeed', name: 'MiMo V2.6 Pro Ultraspeed' },
        ],
      };
    case 'xai':
      return {
        api: 'openai-responses',
        models: [
          { id: 'grok-build-0.1', name: 'Grok Build 0.1' },
          { id: 'grok-4.7', name: 'Grok 4.7' },
        ],
      };
    case 'mistral':
      return { api: 'mistral-conversations', models: [{ id: 'mistral-large-4-0', name: 'Mistral Large 4' }] };
    case 'nous':
      return {
        provider: { baseUrl: getNousUpstreamBaseUrl(), api: 'openai-completions', apiKey: '$NOUS_API_KEY' },
        api: 'openai-completions',
        models: [{ id: 'qwen/qwen3.6-plus', name: 'Qwen3.6 Plus (Nous Portal)' }],
      };
    case 'dashscope':
      return {
        provider: { baseUrl: getDashScopeUpstreamBaseUrl(), api: 'openai-completions', apiKey: '$DASHSCOPE_API_KEY' },
        api: 'openai-completions',
        models: [
          { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus' },
          { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash' },
          { id: 'qwen3.7-max', name: 'Qwen3.7 Max' },
          { id: 'qwen3.8-max', name: 'Qwen3.8 Max' },
        ],
      };
    default:
      return undefined;
  }
}

function modelDef(id: string, name: string, api: PiApi): PiModelDef {
  const capability = hasModelCapability(id) ? getModelCapability(id as Parameters<typeof getModelCapability>[0]) : undefined;
  return {
    id,
    name,
    api,
    reasoning: true,
    input: capability?.supportsImages ? ['text', 'image'] : ['text'],
    contextWindow: capability?.contextWindow ?? 128_000,
    maxTokens: 65_536,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

/** The pi provider id behind an Overdeck model id, bare or `<piProvider>/`-qualified. */
function piProviderFor(modelId: string): string | undefined {
  const slash = modelId.indexOf('/');
  if (slash > 0) {
    const head = modelId.slice(0, slash);
    if (provisionPlan(head)) return head;
  }
  try {
    return piProviderForModel(modelId) ?? getProviderForModel(modelId).name;
  } catch {
    return undefined;
  }
}

/**
 * Merge-write pi's user registry for the provider behind `modelId`. No-op when
 * pi's bundled catalog already covers that provider's Overdeck models. Throws
 * with a clear message when an existing models.json is unparseable; user
 * config is never silently overwritten. `agentDir` exists for tests.
 */
export function provisionPiProviderForModel(modelId: string, agentDir?: string): void {
  const piProvider = piProviderFor(modelId);
  const plan = piProvider ? provisionPlan(piProvider) : undefined;
  if (!piProvider || !plan) return;

  const dir = agentDir ?? getPiFamilyProfile('pi').userAgentDir();
  const registryPath = join(dir, 'models.json');

  let registry: { providers?: Record<string, PiProviderEntry> } = {};
  if (existsSync(registryPath)) {
    try {
      registry = JSON.parse(readFileSync(registryPath, 'utf8')) as typeof registry;
    } catch (err) {
      throw new Error(
        `Cannot provision pi models for '${piProvider}': ${registryPath} is not valid JSON. ` +
          `Fix or remove it manually; Overdeck will not overwrite it. (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  const existing: PiProviderEntry = registry.providers?.[piProvider] ?? {};
  const wanted = plan.models.map((m) => modelDef(m.id, m.name, plan.api));
  const wantedIds = new Set(wanted.map((m) => m.id));
  const kept = (existing.models ?? []).filter((m) => !wantedIds.has(String(m.id)));
  const entry: PiProviderEntry = {
    ...existing,
    ...(plan.provider ?? {}),
    models: [...kept, ...wanted],
  };

  const next = { ...registry, providers: { ...registry.providers, [piProvider]: entry } };
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  if (existsSync(registryPath) && readFileSync(registryPath, 'utf8') === serialized) return;

  mkdirSync(dir, { recursive: true });
  const tmp = `${registryPath}.${process.pid}.tmp`;
  writeFileSync(tmp, serialized);
  renameSync(tmp, registryPath);
}
