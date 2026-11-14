/**
 * pi model-catalog provisioning (PAN-5212), the pi counterpart of
 * ohmypi-models.ts.
 *
 * pi resolves `--model <provider>/<id>` against its bundled catalog plus the
 * user registry at `~/.pi/agent/models.json`. When an id is missing, pi does
 * not fail: it fuzzy-matches another provider's model (verified: a missing
 * `xai/grok-build-0.1` bound a vercel-ai-gateway model). So every Overdeck
 * tier model that the installed pi does not ship is merge-written into the
 * user registry before the launch, keyed by its real provider id.
 *
 * Which ids pi ships changes between versions (pi 1.5.2 added gemini-4-argon,
 * MiniMax-M3.1-Flash, the MiMo v2.6 ids and grok-4.7 over 0.85.0), and an
 * entry with the same id as a built-in model REPLACES it. So the installed
 * pi's catalog is read first (`pi-ai/dist/providers/data/<provider>.json`
 * beside the `pi` binary), and only the ids it lacks are written. An entry
 * Overdeck wrote earlier is removed once pi ships that id, but only while it
 * still matches what Overdeck wrote, so a hand-edited entry is never touched.
 * When the catalog cannot be read, every planned id is written.
 *
 * Merge rules (pi's documented models.json semantics, verified live in
 * .pan/pi-vs-omp.md):
 *   - Built-in providers (google, minimax, zai, xiaomi-token-plan-sgp, xai,
 *     mistral) get only models, upserted by id. No provider-level baseUrl,
 *     api or apiKey is written, so the built-in models and the user's own
 *     auth stay as they are; a model-level `api` makes each entry
 *     self-describing.
 *   - Providers pi does not have (nous, dashscope) get a full provider entry.
 *     `apiKey` is written as a `$ENV_NAME` reference (pi treats a bare name as
 *     a literal key); the launcher exports the value.
 *   - Other providers and other models in the file are never touched.
 *
 * Costs are zero: Overdeck prices pi sessions from its own table (the
 * transcript parser's `cost_v2`), not from pi's per-message cost.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'fs';
import { delimiter, dirname, join } from 'path';

import { getModelCapability, hasModelCapability } from './model-capabilities.js';
import { getDashScopeUpstreamBaseUrl, getNousUpstreamBaseUrl } from './openai-compatible-proxy.js';
import { piFamilyProviderForModel } from './providers.js';
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
  models?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface ProvisionPlan {
  /** Full provider entry for a provider pi does not ship; undefined for built-in providers. */
  provider?: { baseUrl: string; api: PiApi; apiKey: string; compat?: Record<string, boolean> };
  api: PiApi;
  models: Array<{ id: string; name: string }>;
}

/**
 * Overdeck tier models that pi 0.85.0's bundled catalog lacks, keyed by pi
 * provider id (pi-ai catalog, checked 2026-11-13). The installed catalog
 * filters this list at launch, so a newer pi that ships an id keeps its own.
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
    case 'xiaomi-token-plan-sgp':
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
        // DashScope rejects the `developer` role ("developer is not one of
        // ['system', ...]", verified 2026-11-13), so pi must send `system`.
        provider: { baseUrl: getDashScopeUpstreamBaseUrl(), api: 'openai-completions', apiKey: '$DASHSCOPE_API_KEY', compat: { supportsDeveloperRole: false } },
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

/**
 * The installed pi's catalog data dir (`pi-ai/dist/providers/data`), found
 * from the `pi` binary on PATH, or null. pi-ai is either nested under the
 * pi-coding-agent package (0.85) or hoisted beside it (1.5).
 */
export function findPiCatalogDataDir(pathValue: string | undefined = process.env.PATH): string | null {
  for (const dir of (pathValue ?? '').split(delimiter)) {
    if (!dir) continue;
    const bin = join(dir, 'pi');
    if (!existsSync(bin)) continue;
    let cli: string;
    try {
      cli = realpathSync(bin);
    } catch {
      continue;
    }
    // <pkg>/dist/bundle/cli.js → <pkg>
    const pkgRoot = dirname(dirname(dirname(cli)));
    for (const candidate of [
      join(pkgRoot, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data'),
      join(dirname(pkgRoot), 'pi-ai', 'dist', 'providers', 'data'),
    ]) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
  return null;
}

/** Model ids the installed pi ships for `piProvider`, or null when unknown. */
function catalogIds(catalogDir: string | null, piProvider: string): Set<string> | null {
  if (!catalogDir) return null;
  const file = join(catalogDir, `${piProvider}.json`);
  if (!existsSync(file)) return new Set();
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, { id?: unknown }>>;
    const ids = new Set<string>();
    for (const byKey of Object.values(data)) {
      for (const entry of Object.values(byKey ?? {})) {
        if (typeof entry?.id === 'string') ids.add(entry.id);
      }
    }
    return ids;
  } catch {
    return null;
  }
}

function sameEntry(a: Record<string, unknown>, b: PiModelDef): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface ProvisionPiOptions {
  /** pi's agent dir holding models.json (tests). Default: the pi profile's userAgentDir. */
  agentDir?: string;
  /** pi's catalog data dir (tests). Default: found from the `pi` binary on PATH; null = unknown. */
  catalogDir?: string | null;
}

/**
 * Merge-write pi's user registry for the provider behind the Overdeck model
 * `modelId`. No-op when the installed pi ships every planned model for that
 * provider and no stale Overdeck entry remains. Throws with a clear message
 * when an existing models.json is unparseable; user config is never silently
 * overwritten.
 */
export function provisionPiProviderForModel(modelId: string, options: ProvisionPiOptions = {}): void {
  let piProvider: string | undefined;
  try {
    piProvider = piFamilyProviderForModel(modelId, 'pi');
  } catch {
    return;
  }
  const plan = piProvider ? provisionPlan(piProvider) : undefined;
  if (!piProvider || !plan) return;

  const shipped = catalogIds(options.catalogDir === undefined ? findPiCatalogDataDir() : options.catalogDir, piProvider);
  const defs = plan.models.map((m) => modelDef(m.id, m.name, plan.api));
  const wanted = defs.filter((def) => !shipped?.has(def.id));
  const nowShipped = defs.filter((def) => shipped?.has(def.id));

  const dir = options.agentDir ?? getPiFamilyProfile('pi').userAgentDir();
  const registryPath = join(dir, 'models.json');
  if (wanted.length === 0 && !existsSync(registryPath)) return;

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

  const existing: PiProviderEntry | undefined = registry.providers?.[piProvider];
  if (wanted.length === 0 && !existing) return;
  const wantedIds = new Set(wanted.map((def) => def.id));
  const kept = (existing?.models ?? []).filter((model) => {
    if (wantedIds.has(String(model['id']))) return false;
    // pi now ships this id: drop the entry Overdeck wrote, never a hand-edited one.
    return !nowShipped.some((def) => def.id === model['id'] && sameEntry(model, def));
  });
  const models: Array<Record<string, unknown>> = [...kept, ...wanted.map((def) => ({ ...def }))];

  const providers = { ...registry.providers };
  if (models.length === 0 && !plan.provider && existing && Object.keys(existing).every((key) => key === 'models')) {
    delete providers[piProvider];
  } else {
    providers[piProvider] = { ...existing, ...(plan.provider ?? {}), models };
  }

  const serialized = `${JSON.stringify({ ...registry, providers }, null, 2)}\n`;
  if (existsSync(registryPath) && readFileSync(registryPath, 'utf8') === serialized) return;

  mkdirSync(dir, { recursive: true });
  const tmp = `${registryPath}.${process.pid}.tmp`;
  writeFileSync(tmp, serialized);
  renameSync(tmp, registryPath);
}
