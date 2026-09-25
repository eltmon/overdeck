import { spawn } from 'node:child_process';
import { platform } from 'node:os';

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
export const DEFAULT_OLLAMA_MODEL = 'nomic-embed-text';

/**
 * Recommended pull target for local agent work. This is a recommendation only:
 * model resolution never falls back to it (no-hardcoded-model-fallbacks).
 */
export const DEFAULT_OLLAMA_AGENT_MODEL = 'gemma4:12b';

/** Oldest Ollama release that serves the Anthropic Messages API claude-code speaks. */
export const MIN_OLLAMA_VERSION = '0.14.0';

/** Overdeck addresses local tags as `ollama:<tag>`. */
export const OLLAMA_MODEL_PREFIX = 'ollama:';

export const SAFE_OLLAMA_HOST_RE = /^https?:\/\/(localhost|127(?:\.\d+){3}|\[::1\]|::1)(:\d+)?\/?$/;

const OLLAMA_PROBE_TIMEOUT_MS = 5_000;
const OLLAMA_START_DEADLINE_MS = 30_000;
const OLLAMA_START_RETRY_DELAY_MS = 1_000;
const OLLAMA_WARM_TIMEOUT_MS = 120_000;

export interface EnsureOllamaOptions {
  baseUrl?: string;
  model?: string;
  autoInstall?: boolean;
  retryDelayMs?: number;
  maxHealthAttempts?: number;
  fetchImpl?: typeof fetch;
  runCommand?: CommandRunner;
  startServer?: () => Promise<void>;
  installOllama?: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

export interface EnsureOllamaResult {
  status: 'already-running' | 'started';
  baseUrl: string;
  model: string;
}

export type CommandRunner = (command: string, args: string[]) => Promise<void>;

export class OllamaEnsureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OllamaEnsureError';
  }
}

export interface OllamaHealth {
  /** The endpoint answered `/api/version` and `/api/tags` within the probe timeout. */
  endpointReachable: boolean;
  /** Version string reported by `/api/version`, when it answered. */
  version?: string;
  /** `version` is at least {@link MIN_OLLAMA_VERSION}. */
  versionSupported: boolean;
  /** The tag is listed by `/api/tags`. */
  modelPresent: boolean;
  /** Actionable operator text whenever any of the flags above is false. */
  message?: string;
}

export interface CheckOllamaHealthOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface EnsureOllamaServeOptions {
  baseUrl?: string;
  /** Exported as `OLLAMA_CONTEXT_LENGTH` to an Overdeck-started `ollama serve`. */
  contextLength: number;
  /** Skip the pre-start probe when the caller already knows the endpoint is down. */
  knownUnhealthy?: boolean;
  deadlineMs?: number;
  fetchImpl?: typeof fetch;
  startServer?: (env: NodeJS.ProcessEnv) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface WarmOllamaModelOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

interface OllamaPsResponse {
  models?: Array<{ name?: string; model?: string; context_length?: number }>;
}

/** `ollama:gemma4:12b` -> `gemma4:12b`; ids without the prefix are returned unchanged. */
export function stripOllamaPrefix(model: string): string {
  return model.startsWith(OLLAMA_MODEL_PREFIX) ? model.slice(OLLAMA_MODEL_PREFIX.length) : model;
}

export async function isOllamaInstalled(runCommand: CommandRunner = runCommandWithSpawn): Promise<boolean> {
  return hasOllamaBinary(runCommand);
}

/**
 * Probe a local Ollama endpoint for the three facts a launch needs: it answers, it is new
 * enough to serve the Anthropic Messages API, and it has the tag pulled. One AbortController
 * bounds both requests including their bodies, so a server that accepts a connection and then
 * stalls still reports `endpointReachable: false` after `timeoutMs`.
 */
export async function checkOllamaHealth(
  tag: string,
  baseUrl: string = DEFAULT_OLLAMA_BASE_URL,
  options: CheckOllamaHealthOptions = {},
): Promise<OllamaHealth> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? OLLAMA_PROBE_TIMEOUT_MS;
  const bareTag = stripOllamaPrefix(tag);

  let version: string | undefined;
  let tags: OllamaTagsResponse;
  try {
    ({ version, tags } = await withAbortTimeout(timeoutMs, async (signal) => {
      const versionBody = await getJson<{ version?: string }>(`${normalizedBaseUrl}/api/version`, fetchImpl, signal);
      const tagsBody = await getJson<OllamaTagsResponse>(`${normalizedBaseUrl}/api/tags`, fetchImpl, signal);
      return { version: versionBody.version, tags: tagsBody };
    }));
  } catch {
    return {
      endpointReachable: false,
      versionSupported: false,
      modelPresent: false,
      message: `Ollama is not reachable at ${normalizedBaseUrl}. Start it with \`ollama serve\`.`,
    };
  }

  const versionSupported = version !== undefined && compareVersions(version, MIN_OLLAMA_VERSION) >= 0;
  const modelPresent = tagsContain(tags, bareTag);

  let message: string | undefined;
  if (!versionSupported) {
    message =
      `Ollama ${version ?? 'of an unknown version'} at ${normalizedBaseUrl} is older than ${MIN_OLLAMA_VERSION}, ` +
      `which is the first release that serves the Anthropic Messages API. Upgrade Ollama to ${MIN_OLLAMA_VERSION} or newer.`;
  } else if (!modelPresent) {
    message = `Ollama model ${bareTag} is not pulled. Run \`ollama pull ${bareTag}\`.`;
  }

  return { endpointReachable: true, version, versionSupported, modelPresent, message };
}

/**
 * Make sure something is serving at `baseUrl`, starting a detached `ollama serve` when nothing is.
 * Every probe and gap is charged against one overall deadline, so a server that never comes up
 * fails in `deadlineMs`, not in `attempts x timeout`.
 */
export async function ensureOllamaServeRunning(options: EnsureOllamaServeOptions): Promise<void> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const deadlineMs = options.deadlineMs ?? OLLAMA_START_DEADLINE_MS;

  if (!options.knownUnhealthy && (await isOllamaHealthyWithin(baseUrl, fetchImpl, OLLAMA_PROBE_TIMEOUT_MS))) return;

  await (options.startServer ?? startOllamaServerWithSpawn)({
    ...process.env,
    OLLAMA_HOST: hostFromBaseUrl(baseUrl),
    OLLAMA_CONTEXT_LENGTH: String(options.contextLength),
  });

  const deadline = now() + deadlineMs;
  while (now() < deadline) {
    const probeBudget = Math.min(OLLAMA_PROBE_TIMEOUT_MS, deadline - now());
    if (await isOllamaHealthyWithin(baseUrl, fetchImpl, probeBudget)) return;
    const retryBudget = deadline - now();
    if (retryBudget <= 0) break;
    await sleep(Math.min(OLLAMA_START_RETRY_DELAY_MS, retryBudget));
  }

  throw new OllamaEnsureError(
    `Ollama did not become healthy at ${baseUrl} within ${Math.round(deadlineMs / 1_000)}s. ` +
      'Start it with `ollama serve` and retry.',
  );
}

/**
 * Load a tag into VRAM and report the context window the server actually gave it. The server is
 * the authority here: `OLLAMA_CONTEXT_LENGTH` only applies to a serve Overdeck started itself.
 */
export async function warmOllamaModel(
  tag: string,
  baseUrl: string = DEFAULT_OLLAMA_BASE_URL,
  options: WarmOllamaModelOptions = {},
): Promise<{ contextLength: number }> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? OLLAMA_WARM_TIMEOUT_MS;
  const bareTag = stripOllamaPrefix(tag);

  return withAbortTimeout(timeoutMs, async (signal) => {
    const loaded = await fetchImpl(`${normalizedBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: bareTag, prompt: '' }),
      signal,
    });
    if (!loaded.ok) {
      discardBody(loaded);
      throw new OllamaEnsureError(`Ollama could not load ${bareTag} (HTTP ${loaded.status}) at ${normalizedBaseUrl}.`);
    }
    // Drain the load response: Ollama streams it and only finishes once the model is resident.
    await raceAbort(loaded.text(), signal);

    const running = await getJson<OllamaPsResponse>(`${normalizedBaseUrl}/api/ps`, fetchImpl, signal);
    const entry = running.models?.find((model) => model.name === bareTag || model.model === bareTag);
    if (!entry || typeof entry.context_length !== 'number') {
      throw new OllamaEnsureError(
        `Ollama did not report a context length for ${bareTag} at ${normalizedBaseUrl}. ` +
          'Check `ollama ps` and retry.',
      );
    }
    return { contextLength: entry.context_length };
  });
}

/**
 * PAN-1641 coordination note: this shared helper is intentionally usable by both
 * OKF embedding flows and the future Pi-harness sidecar bootstrap.
 */
export async function ensureOllama(options: EnsureOllamaOptions = {}): Promise<EnsureOllamaResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL);
  const model = options.model ?? DEFAULT_OLLAMA_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const runCommand = options.runCommand ?? runCommandWithSpawn;
  const startServer = options.startServer ?? startOllamaServerWithSpawn;
  const sleep = options.sleep ?? defaultSleep;
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const maxHealthAttempts = options.maxHealthAttempts ?? 30;

  const alreadyHealthy = await isOllamaHealthy(baseUrl, fetchImpl);

  if (!alreadyHealthy) {
    const binaryExists = await hasOllamaBinary(runCommand);
    if (!binaryExists) {
      if (!options.autoInstall) {
        throw new OllamaEnsureError('Ollama is not installed. Re-run with autoInstall enabled or install it manually from https://ollama.com/download.');
      }
      await (options.installOllama ?? installOllamaWithPlatformCommand)();
    }

    await startServer();
    await waitForOllamaHealth(baseUrl, fetchImpl, sleep, retryDelayMs, maxHealthAttempts);
  }

  await runCommand('ollama', ['pull', model]);
  return { status: alreadyHealthy ? 'already-running' : 'started', baseUrl, model };
}

async function hasOllamaBinary(runCommand: CommandRunner): Promise<boolean> {
  try {
    await runCommand('ollama', ['--version']);
    return true;
  } catch {
    return false;
  }
}

async function isOllamaHealthy(baseUrl: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

async function isOllamaHealthyWithin(baseUrl: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<boolean> {
  try {
    return await withAbortTimeout(timeoutMs, async (signal) => {
      const response = await fetchImpl(`${baseUrl}/api/tags`, { method: 'GET', signal });
      discardBody(response);
      return response.ok;
    });
  } catch {
    return false;
  }
}

async function waitForOllamaHealth(
  baseUrl: string,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  retryDelayMs: number,
  maxAttempts: number,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (await isOllamaHealthy(baseUrl, fetchImpl)) return;
    if (attempt < maxAttempts) await sleep(retryDelayMs);
  }
  throw new OllamaEnsureError(`Ollama did not become healthy at ${baseUrl}`);
}

async function getJson<T>(url: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<T> {
  const response = await fetchImpl(url, { method: 'GET', signal });
  if (!response.ok) {
    discardBody(response);
    throw new OllamaEnsureError(`Ollama returned HTTP ${response.status} for ${url}.`);
  }
  return (await raceAbort(response.json(), signal)) as T;
}

/**
 * Run `work` under a single AbortController that fires after `timeoutMs`. The abort rejects the
 * returned promise even when the underlying body read never settles on its own.
 */
async function withAbortTimeout<T>(timeoutMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new OllamaEnsureError(`Ollama request timed out after ${timeoutMs}ms.`));
  }, timeoutMs);
  try {
    return await raceAbort(work(controller.signal), controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

function tagsContain(tags: OllamaTagsResponse, bareTag: string): boolean {
  const candidates = bareTag.includes(':') ? [bareTag] : [bareTag, `${bareTag}:latest`];
  return tags.models?.some((entry) =>
    candidates.some((candidate) => entry.name === candidate || entry.model === candidate),
  ) ?? false;
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

function versionParts(version: string): number[] {
  return version
    .trim()
    .split('.')
    .map((part) => {
      const parsed = Number.parseInt(part, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    });
}

function hostFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/^https?:\/\//, '');
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function installOllamaWithPlatformCommand(): Promise<void> {
  if (platform() === 'darwin') {
    await runCommandWithSpawn('brew', ['install', 'ollama']);
    return;
  }
  throw new OllamaEnsureError(
    'Automatic Ollama installation is only available on macOS via Homebrew. ' +
      'On this platform, install Ollama manually from https://ollama.com/download and re-run.',
  );
}

async function runCommandWithSpawn(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new OllamaEnsureError(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function startOllamaServerWithSpawn(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ollama', ['serve'], { stdio: 'ignore', detached: true, env });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, '');
  if (!SAFE_OLLAMA_HOST_RE.test(normalized)) {
    throw new OllamaEnsureError(`Ollama baseUrl must be a localhost address (got: ${baseUrl})`);
  }
  return normalized;
}
