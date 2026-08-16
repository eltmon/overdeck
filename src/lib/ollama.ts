import { spawn } from 'node:child_process';
import { platform } from 'node:os';

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
export const DEFAULT_OLLAMA_MODEL = 'nomic-embed-text';
export const DEFAULT_OLLAMA_AGENT_MODEL = 'gemma4:12b';

const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)';
export const SAFE_OLLAMA_HOST_RE = new RegExp(
  `^https?://(?:localhost|127(?:\\.${IPV4_OCTET}){3}|\\[::1\\]|::1)(?::\\d+)?/?$`,
);
const OLLAMA_PROBE_TIMEOUT_MS = 5_000;

export type OllamaErrorCode =
  | 'invalid-base-url'
  | 'not-installed'
  | 'start-failed'
  | 'endpoint-unreachable'
  | 'model-not-pulled'
  | 'command-failed';

export class OllamaError extends Error {
  constructor(
    readonly code: OllamaErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'OllamaError';
  }
}

export interface EnsureOllamaOptions {
  baseUrl?: string;
  model?: string;
  autoInstall?: boolean;
  retryDelayMs?: number;
  maxHealthAttempts?: number;
  startupDeadlineMs?: number;
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

export class OllamaEnsureError extends OllamaError {
  constructor(message: string, code: OllamaErrorCode = 'command-failed') {
    super(code, message);
    this.name = 'OllamaEnsureError';
  }
}

export interface OllamaProviderConfig {
  providers?: {
    ollama?: {
      base_url?: string;
    };
  };
}

export interface OllamaHealth {
  endpointReachable: boolean;
  modelPresent: boolean;
  message?: string;
}

export interface OllamaLifecycleOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  runCommand?: CommandRunner;
  startServer?: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
  startupDeadlineMs?: number;
  knownUnhealthy?: boolean;
}

export function resolveOllamaBaseUrl(config: OllamaProviderConfig = {}): string {
  return normalizeBaseUrl(config.providers?.ollama?.base_url ?? DEFAULT_OLLAMA_BASE_URL);
}

export async function isOllamaInstalled(runCommand: CommandRunner = runCommandWithSpawn): Promise<boolean> {
  return hasOllamaBinary(runCommand);
}

export async function checkOllamaHealth(
  model: string,
  baseUrl = DEFAULT_OLLAMA_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<OllamaHealth> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  let probe: Awaited<ReturnType<typeof fetchOllamaTags>>;
  try {
    probe = await fetchOllamaTags(normalizedBaseUrl, fetchImpl);
  } catch {
    return {
      endpointReachable: false,
      modelPresent: false,
      message: `Ollama is not reachable at ${normalizedBaseUrl}. Start it with \`ollama serve\`.`,
    };
  }
  try {
    if (!probe.response.ok) {
      void probe.response.body?.cancel().catch(() => undefined);
      return {
        endpointReachable: false,
        modelPresent: false,
        message: `Ollama is not reachable at ${normalizedBaseUrl} (HTTP ${probe.response.status}). Start it with \`ollama serve\`.`,
      };
    }

    let data: { models?: Array<{ name?: string; model?: string }> };
    try {
      data = await probe.response.json() as { models?: Array<{ name?: string; model?: string }> };
    } catch (cause) {
      if (probe.signal.aborted) {
        void probe.response.body?.cancel().catch(() => undefined);
        return unreachableHealth(normalizedBaseUrl);
      }
      throw new OllamaError(
        'endpoint-unreachable',
        `Ollama returned an invalid /api/tags response from ${normalizedBaseUrl}.`,
        cause,
      );
    }
    const bareModel = model.replace(/^ollama:/, '');
    const modelPresent = data.models?.some((entry) => entry.name === bareModel || entry.model === bareModel) ?? false;
    return modelPresent
      ? { endpointReachable: true, modelPresent: true }
      : {
          endpointReachable: true,
          modelPresent: false,
          message: `Ollama model ${bareModel} is not pulled. Run \`ollama pull ${bareModel}\`.`,
        };
  } finally {
    probe.dispose();
  }
}

export async function ensureOllamaServeRunning(options: OllamaLifecycleOptions = {}): Promise<void> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL);
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!options.knownUnhealthy && await isOllamaHealthy(baseUrl, fetchImpl)) return;

  if (!await isOllamaInstalled(options.runCommand)) {
    throw new OllamaError('not-installed', 'Ollama is not installed. Install it from https://ollama.com/download.');
  }

  try {
    await (options.startServer ?? startOllamaServerWithSpawn)();
    await waitForOllamaHealth(
      baseUrl,
      fetchImpl,
      options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
      options.retryDelayMs ?? 1_000,
      options.startupDeadlineMs ?? 30_000,
    );
  } catch (cause) {
    throw new OllamaError('start-failed', `Ollama did not become reachable at ${baseUrl} after starting \`ollama serve\`.`, cause);
  }
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
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const startupDeadlineMs = options.startupDeadlineMs ??
    (options.maxHealthAttempts ? options.maxHealthAttempts * retryDelayMs : 30_000);

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
    await waitForOllamaHealth(baseUrl, fetchImpl, sleep, retryDelayMs, startupDeadlineMs);
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
    const probe = await fetchOllamaTags(baseUrl, fetchImpl);
    try {
      return probe.response.ok;
    } finally {
      probe.dispose();
      void probe.response.body?.cancel().catch(() => undefined);
    }
  } catch {
    return false;
  }
}

async function fetchOllamaTags(
  baseUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs = OLLAMA_PROBE_TIMEOUT_MS,
): Promise<{ response: Response; signal: AbortSignal; dispose: () => void }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`, { method: 'GET', signal: controller.signal });
    return { response, signal: controller.signal, dispose: () => clearTimeout(timeout) };
  } catch (cause) {
    clearTimeout(timeout);
    throw cause;
  }
}

async function waitForOllamaHealth(
  baseUrl: string,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  retryDelayMs: number,
  startupDeadlineMs: number,
): Promise<void> {
  const deadline = Date.now() + startupDeadlineMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (await isOllamaHealthyWithin(baseUrl, fetchImpl, Math.min(OLLAMA_PROBE_TIMEOUT_MS, remaining))) return;
    const retryBudget = deadline - Date.now();
    if (retryBudget > 0) await sleep(Math.min(retryDelayMs, retryBudget));
  }
  throw new OllamaEnsureError(`Ollama did not become healthy at ${baseUrl}`);
}

async function isOllamaHealthyWithin(baseUrl: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<boolean> {
  try {
    const probe = await fetchOllamaTags(baseUrl, fetchImpl, timeoutMs);
    try {
      return probe.response.ok;
    } finally {
      probe.dispose();
      void probe.response.body?.cancel().catch(() => undefined);
    }
  } catch {
    return false;
  }
}

function unreachableHealth(baseUrl: string): OllamaHealth {
  return {
    endpointReachable: false,
    modelPresent: false,
    message: `Ollama is not reachable at ${baseUrl}. Start it with \`ollama serve\`.`,
  };
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

async function startOllamaServerWithSpawn(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ollama', ['serve'], { stdio: 'ignore', detached: true });
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
    throw new OllamaEnsureError(`Ollama baseUrl must be a localhost address (got: ${baseUrl})`, 'invalid-base-url');
  }
  return normalized;
}
