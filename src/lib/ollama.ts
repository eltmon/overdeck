/**
 * Ollama local sidecar lifecycle for model-agnostic local agents.
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { Data } from 'effect';

const execAsync = promisify(exec);

export const OLLAMA_BASE_URL = 'http://localhost:11434';
export const OLLAMA_OPENAI_BASE_URL = `${OLLAMA_BASE_URL}/v1`;
export const DEFAULT_OLLAMA_MODEL = 'gemma4:12b';
export const OLLAMA_MODEL_PREFIX = 'ollama:';
export const SAFE_OLLAMA_HOST_RE = /^https?:\/\/(localhost|127(?:\.\d+){3}|\[::1\]|::1)(:\d+)?\/?$/;

export class OllamaError extends Data.TaggedError('OllamaError')<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface OllamaConfigLike {
  models?: {
    providers?: {
      ollama?: boolean | {
        base_url?: unknown;
      };
    };
  };
}

export interface OllamaModelInfo {
  name?: string;
  model?: string;
}

export interface OllamaTagsResponse {
  models?: OllamaModelInfo[];
}

export interface OllamaHealthResult {
  endpointReachable: boolean;
  modelPresent: boolean;
  models: string[];
  message?: string;
}

export function resolveOllamaBaseUrl(config?: OllamaConfigLike | null): string {
  const ollamaConfig = config?.models?.providers?.ollama;
  const configured = typeof ollamaConfig === 'object' && ollamaConfig !== null
    ? ollamaConfig.base_url
    : undefined;
  const baseUrl = typeof configured === 'string' && configured.trim().length > 0
    ? configured.trim().replace(/\/$/, '')
    : OLLAMA_BASE_URL;

  if (!SAFE_OLLAMA_HOST_RE.test(baseUrl)) {
    throw new OllamaError({
      operation: 'resolveOllamaBaseUrl',
      message: `Ollama base_url must be a localhost address (got: ${baseUrl})`,
    });
  }

  return baseUrl;
}

export function resolveOllamaOpenAIBaseUrl(config?: OllamaConfigLike | null): string {
  return `${resolveOllamaBaseUrl(config)}/v1`;
}

export function stripOllamaModelPrefix(model: string): string {
  return model.startsWith(OLLAMA_MODEL_PREFIX) ? model.slice(OLLAMA_MODEL_PREFIX.length) : model;
}

export function toPiOllamaModelSelector(model: string): string {
  return model.startsWith(OLLAMA_MODEL_PREFIX) ? `ollama/${stripOllamaModelPrefix(model)}` : model;
}

export async function isOllamaInstalled(): Promise<boolean> {
  try {
    await execAsync('ollama --version', { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function fetchOllamaTags(baseUrl: string): Promise<OllamaTagsResponse> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) {
    throw new OllamaError({
      operation: 'fetchOllamaTags',
      message: `Ollama endpoint returned HTTP ${response.status}`,
    });
  }
  return response.json() as Promise<OllamaTagsResponse>;
}

export async function checkOllamaEndpointReachable(baseUrl: string = OLLAMA_BASE_URL): Promise<boolean> {
  try {
    await fetchOllamaTags(baseUrl);
    return true;
  } catch {
    return false;
  }
}

async function waitForOllamaEndpoint(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    try {
      await fetchOllamaTags(baseUrl);
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new OllamaError({
    operation: 'ensureOllamaServeRunning',
    message: `Ollama did not become reachable at ${baseUrl}. Start it with \`ollama serve\`.`,
    cause: lastError,
  });
}

export async function ensureOllamaServeRunning(
  baseUrl: string = OLLAMA_BASE_URL,
  options: { startupTimeoutMs?: number } = {},
): Promise<void> {
  if (await checkOllamaEndpointReachable(baseUrl)) return;

  if (!await isOllamaInstalled()) {
    throw new OllamaError({
      operation: 'ensureOllamaServeRunning',
      message: 'Ollama is not installed. Install Ollama, then run `ollama serve` or let Panopticon start it.',
    });
  }

  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
  });

  if (!child.pid) {
    throw new OllamaError({
      operation: 'ensureOllamaServeRunning',
      message: 'Failed to spawn `ollama serve`.',
    });
  }

  child.unref();
  await waitForOllamaEndpoint(baseUrl, options.startupTimeoutMs ?? 30_000);
}

export async function checkOllamaModelHealth(
  model: string,
  baseUrl: string = OLLAMA_BASE_URL,
): Promise<OllamaHealthResult> {
  let tags: OllamaTagsResponse;
  try {
    tags = await fetchOllamaTags(baseUrl);
  } catch (cause) {
    return {
      endpointReachable: false,
      modelPresent: false,
      models: [],
      message: `Ollama is not reachable at ${baseUrl}. Start it with \`ollama serve\`.`,
    };
  }

  const models = (tags.models ?? [])
    .map(entry => entry.name ?? entry.model)
    .filter((name): name is string => typeof name === 'string');
  const modelPresent = models.includes(model);

  return {
    endpointReachable: true,
    modelPresent,
    models,
    message: modelPresent
      ? undefined
      : `Ollama model ${model} is not pulled. Run \`ollama pull ${model}\`.`,
  };
}

export async function assertOllamaModelAvailable(
  model: string,
  baseUrl: string = OLLAMA_BASE_URL,
): Promise<void> {
  const health = await checkOllamaModelHealth(model, baseUrl);
  if (!health.endpointReachable) {
    throw new OllamaError({
      operation: 'checkOllamaModelHealth',
      message: health.message ?? `Ollama is not reachable at ${baseUrl}.`,
    });
  }
  if (!health.modelPresent) {
    throw new OllamaError({
      operation: 'checkOllamaModelHealth',
      message: health.message ?? `Ollama model ${model} is not pulled. Run \`ollama pull ${model}\`.`,
    });
  }
}
