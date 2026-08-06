/**
 * ohmypi model-catalog provisioning (PAN-3531).
 *
 * omp resolves `--model <id>` against its bundled provider catalog plus the
 * user registry at ~/.omp/agent/models.json. Overdeck providers whose models
 * are absent from the bundled catalog — DashScope is the first — otherwise
 * fail at spawn with omp's "No model selected" error. This module merge-
 * writes the omp user-registry entry for such providers when a launcher is
 * generated, so every ohmypi spawn (work agent or conversation) is
 * self-sufficient on any machine.
 *
 * The provider apiKey is written as the env-var NAME, never the key
 * material: omp's resolveConfigValue() checks process.env first, and the
 * launcher already exports DASHSCOPE_API_KEY via getProviderEnvSync().
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { getDashScopeUpstreamBaseUrl } from './openai-compatible-proxy.js';
import { getProviderForModelSync } from './providers.js';

interface OmpModelDef {
  id: string;
  name: string;
  reasoning: boolean;
  supportsTools: boolean;
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

interface OmpProviderDef {
  baseUrl: string;
  apiKey: string;
  api: 'openai-completions';
  models: OmpModelDef[];
}

/**
 * Build the omp user-registry entry for an Overdeck provider, or undefined
 * when the provider needs no provisioning (bundled catalog covers it).
 */
function ompProviderDef(providerName: string): OmpProviderDef | undefined {
  if (providerName !== 'dashscope') return undefined;
  // contextWindow values mirror model-capabilities.ts; maxTokens for the
  // older ids are conservative caps (Alibaba does not publish per-model max
  // output on the standard endpoint) — qwen3.8-max's 131072 is documented.
  const models: OmpModelDef[] = [
    { id: 'qwen3-max', name: 'Qwen3 Max', contextWindow: 262144, maxTokens: 65536, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus', contextWindow: 262144, maxTokens: 65536, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    { id: 'qwen3-plus', name: 'Qwen3 Plus', contextWindow: 131072, maxTokens: 32768, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    { id: 'qwen3.7-max', name: 'Qwen3.7 Max', contextWindow: 262144, maxTokens: 65536, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    { id: 'qwen3.8-max', name: 'Qwen3.8 Max', contextWindow: 1048576, maxTokens: 131072, cost: { input: 2, output: 6, cacheRead: 0, cacheWrite: 0 } },
  ].map((m) => ({ ...m, reasoning: true, supportsTools: true }));
  return {
    baseUrl: getDashScopeUpstreamBaseUrl(),
    apiKey: 'DASHSCOPE_API_KEY',
    api: 'openai-completions',
    models,
  };
}

/** Providers Overdeck provisions into the omp user registry at spawn time. */
const PROVISIONED_PROVIDERS = new Set(['dashscope']);

/**
 * Merge-write the omp user registry for the provider behind `modelId`.
 * No-op for providers the bundled catalog already covers. Accepts both bare
 * and provider-qualified ids (`qwen3.8-max`, `dashscope/qwen3.8-max`) —
 * conversations pre-qualify models before the launcher sees them. Throws
 * with a clear message when an existing models.json is unparseable — user
 * config is never silently overwritten. `agentDir` exists for tests.
 */
export function provisionOhmypiProviderForModel(modelId: string, agentDir?: string): void {
  const prefix = modelId.split('/')[0];
  const providerName = PROVISIONED_PROVIDERS.has(prefix) ? prefix : getProviderForModelSync(modelId).name;
  const def = ompProviderDef(providerName);
  if (!def) return;

  const dir = agentDir ?? join(homedir(), '.omp', 'agent');
  const registryPath = join(dir, 'models.json');

  let registry: { providers?: Record<string, unknown> } = {};
  if (existsSync(registryPath)) {
    try {
      registry = JSON.parse(readFileSync(registryPath, 'utf8')) as typeof registry;
    } catch (err) {
      throw new Error(
        `Cannot provision the '${providerName}' provider: ${registryPath} is not valid JSON. ` +
          `Fix or remove it manually — Overdeck will not overwrite it. (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  registry.providers = { ...registry.providers, [providerName]: def };

  mkdirSync(dir, { recursive: true });
  const tmp = `${registryPath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`);
  renameSync(tmp, registryPath);
}
