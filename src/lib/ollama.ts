import { spawn } from 'node:child_process';
import { platform } from 'node:os';

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
export const DEFAULT_OLLAMA_MODEL = 'nomic-embed-text';

const SAFE_OLLAMA_HOST_RE = /^https?:\/\/(localhost|127(?:\.\d+){3}|\[::1\]|::1)(:\d+)?\/?$/;

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
    throw new OllamaEnsureError(`Ollama baseUrl must be a localhost address (got: ${baseUrl})`);
  }
  return normalized;
}
