import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, chmod, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { LOGS_DIR, PANOPTICON_HOME } from './paths.js';
import type { NormalizedTtsDaemonConfig } from './config-yaml.js';

const execFileAsync = promisify(execFile);

export const QWEN_TTS_PID_PATH = join(PANOPTICON_HOME, 'pids', 'qwen-tts.pid');
export const QWEN_TTS_STATE_PATH = join(PANOPTICON_HOME, 'pids', 'qwen-tts.json');
export const QWEN_TTS_START_LOCK_PATH = join(PANOPTICON_HOME, 'pids', 'qwen-tts.start.lock');
export const QWEN_TTS_MANUAL_STOP_PATH = join(PANOPTICON_HOME, 'pids', 'qwen-tts.manual-stop');
export const QWEN_TTS_AUTH_TOKEN_PATH = join(PANOPTICON_HOME, 'secrets', 'qwen-tts.token');
export const QWEN_TTS_AUTH_HEADER = 'X-Panopticon-TTS-Token';
export const QWEN_TTS_LOG_PATH = join(LOGS_DIR, 'qwen-tts.log');
const GPU_MEMORY_CACHE_TTL_MS = 30_000;
let gpuMemoryCache: { pid: number; sampledAt: number; value: number | undefined } | null = null;

export interface TtsDaemonState {
  pid: number;
  startedAt: string;
  host: string;
  port: number;
  model?: string;
}

export interface TtsDaemonStatus {
  ok: boolean;
  running: boolean;
  pid: number | null;
  daemonHost: string;
  daemonPort: number;
  queue?: unknown;
  queueDepth?: number;
  model?: unknown;
  uptimeSeconds?: number;
  gpuMemoryUsedMb?: number;
  error?: string;
}

export interface TtsDaemonStartOptions {
  config: NormalizedTtsDaemonConfig;
  detach?: boolean;
  waitForHealth?: boolean;
  timeoutMs?: number;
}

export interface TtsDaemonStartResult {
  ok: boolean;
  pid: number | null;
  alreadyRunning: boolean;
  status?: TtsDaemonStatus;
  error?: string;
}

export interface TtsDaemonStopResult {
  stopped: boolean;
  pid: number | null;
  error?: string;
}

export interface TtsDaemonForegroundResult {
  pid: number | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export type TtsDaemonInstallResult =
  | { status: 'installed'; venvDir: string; message: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveQwenTtsPackageDir(): Promise<string> {
  const root = repoRoot();
  const candidates = [
    join(root, 'packages', 'qwen-tts-linux-x64'),
    join(root, 'node_modules', 'qwen-tts-linux-x64'),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  await mkdir(candidates[0], { recursive: true });
  return candidates[0];
}

export async function resolveTtsDaemonScript(): Promise<string> {
  const script = join(repoRoot(), 'skills', 'pan-tts', 'scripts', 'tts_daemon.py');
  if (await pathExists(script)) return script;
  throw new Error(`Qwen TTS daemon script not found at ${script}`);
}

export async function getTtsDaemonVenvDir(): Promise<string> {
  return join(await resolveQwenTtsPackageDir(), '.venv');
}

export async function getTtsDaemonPython(): Promise<string> {
  const venvDir = await getTtsDaemonVenvDir();
  return join(venvDir, 'bin', 'python');
}

async function readPid(): Promise<number | null> {
  try {
    const raw = (await readFile(QWEN_TTS_PID_PATH, 'utf8')).trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function readState(): Promise<TtsDaemonState | null> {
  try {
    const parsed = JSON.parse(await readFile(QWEN_TTS_STATE_PATH, 'utf8')) as Partial<TtsDaemonState>;
    if (typeof parsed.pid !== 'number' || !Number.isFinite(parsed.pid)) return null;
    if (typeof parsed.startedAt !== 'string') return null;
    if (typeof parsed.host !== 'string') return null;
    if (typeof parsed.port !== 'number') return null;
    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt,
      host: parsed.host,
      port: parsed.port,
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
    };
  } catch {
    return null;
  }
}

async function writeState(state: TtsDaemonState): Promise<void> {
  await mkdir(dirname(QWEN_TTS_PID_PATH), { recursive: true });
  await writeFile(QWEN_TTS_PID_PATH, `${state.pid}\n`, 'utf8');
  await writeFile(QWEN_TTS_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function hasTtsDaemonState(): Promise<boolean> {
  return (await readPid()) !== null || (await readState()) !== null;
}

export async function isTtsDaemonManuallyStopped(): Promise<boolean> {
  return pathExists(QWEN_TTS_MANUAL_STOP_PATH);
}

async function setTtsDaemonManualStopGate(): Promise<void> {
  await mkdir(dirname(QWEN_TTS_MANUAL_STOP_PATH), { recursive: true });
  await writeFile(QWEN_TTS_MANUAL_STOP_PATH, `${new Date().toISOString()}\n`, 'utf8');
}

async function clearTtsDaemonManualStopGate(): Promise<void> {
  await rm(QWEN_TTS_MANUAL_STOP_PATH, { force: true });
}

export async function getTtsDaemonAuthToken(): Promise<string> {
  if (process.env.QWEN_TTS_AUTH_TOKEN?.trim()) return process.env.QWEN_TTS_AUTH_TOKEN.trim();

  try {
    const existing = (await readFile(QWEN_TTS_AUTH_TOKEN_PATH, 'utf8')).trim();
    if (existing) {
      await chmod(QWEN_TTS_AUTH_TOKEN_PATH, 0o600).catch(() => undefined);
      return existing;
    }
  } catch {
    // create below
  }

  const token = randomBytes(32).toString('base64url');
  await mkdir(dirname(QWEN_TTS_AUTH_TOKEN_PATH), { recursive: true, mode: 0o700 });
  try {
    await writeFile(QWEN_TTS_AUTH_TOKEN_PATH, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(QWEN_TTS_AUTH_TOKEN_PATH, 0o600).catch(() => undefined);
    return token;
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = (await readFile(QWEN_TTS_AUTH_TOKEN_PATH, 'utf8')).trim();
    if (!existing) throw new Error(`TTS daemon auth token file is empty: ${QWEN_TTS_AUTH_TOKEN_PATH}`);
    await chmod(QWEN_TTS_AUTH_TOKEN_PATH, 0o600).catch(() => undefined);
    return existing;
  }
}

export async function getTtsDaemonAuthHeaders(): Promise<Record<string, string>> {
  return { [QWEN_TTS_AUTH_HEADER]: await getTtsDaemonAuthToken() };
}

function defaultAllowedOrigins(): string {
  const port = Number.parseInt(process.env.API_PORT ?? process.env.PORT ?? '3011', 10);
  const origins = new Set<string>();
  const dashboardUrl = process.env.DASHBOARD_URL;
  if (dashboardUrl) origins.add(dashboardUrl);
  origins.add(`http://localhost:${port}`);
  origins.add(`http://127.0.0.1:${port}`);
  for (const origin of process.env.PANOPTICON_TRUSTED_ORIGINS?.split(',') ?? []) {
    const trimmed = origin.trim();
    if (trimmed) origins.add(trimmed);
  }
  return Array.from(origins).join(',');
}

async function acquireStartLock(): Promise<void> {
  await mkdir(dirname(QWEN_TTS_START_LOCK_PATH), { recursive: true });
  while (true) {
    try {
      await mkdir(QWEN_TTS_START_LOCK_PATH, { mode: 0o700 });
      return;
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const lockStat = await stat(QWEN_TTS_START_LOCK_PATH);
        if (Date.now() - lockStat.mtimeMs > 180_000) {
          await rm(QWEN_TTS_START_LOCK_PATH, { recursive: true, force: true });
          continue;
        }
      } catch (statError: any) {
        if (statError?.code === 'ENOENT') continue;
        throw statError;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function releaseStartLock(): Promise<void> {
  await rm(QWEN_TTS_START_LOCK_PATH, { recursive: true, force: true });
}

async function clearState(): Promise<void> {
  await Promise.all([
    rm(QWEN_TTS_PID_PATH, { force: true }),
    rm(QWEN_TTS_STATE_PATH, { force: true }),
  ]);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function getGpuMemoryUsedMb(pid: number | null): Promise<number | undefined> {
  if (!pid) return undefined;
  if (gpuMemoryCache?.pid === pid && Date.now() - gpuMemoryCache.sampledAt < GPU_MEMORY_CACHE_TTL_MS) {
    return gpuMemoryCache.value;
  }
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-compute-apps=pid,used_memory',
      '--format=csv,noheader,nounits',
    ], { timeout: 2_000 });
    for (const line of stdout.split('\n')) {
      const [rawPid, rawMemory] = line.split(',').map((part) => part?.trim());
      if (Number.parseInt(rawPid ?? '', 10) === pid) {
        const memory = Number.parseInt(rawMemory ?? '', 10);
        const value = Number.isFinite(memory) ? memory : undefined;
        gpuMemoryCache = { pid, sampledAt: Date.now(), value };
        return value;
      }
    }
  } catch {
    gpuMemoryCache = { pid, sampledAt: Date.now(), value: undefined };
    return undefined;
  }
  gpuMemoryCache = { pid, sampledAt: Date.now(), value: undefined };
  return undefined;
}

async function fetchDaemonHealth(config: NormalizedTtsDaemonConfig, timeoutMs = 2_000): Promise<Partial<TtsDaemonStatus>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://${config.daemonHost}:${config.daemonPort}/health`, { signal: controller.signal });
    if (!response.ok) return { ok: false, error: 'daemon unreachable' };
    const body = await response.json() as { queue?: unknown; model?: unknown };
    return {
      ok: true,
      queue: body.queue,
      queueDepth: typeof body.queue === 'number' ? body.queue : undefined,
      model: body.model,
    };
  } catch {
    return { ok: false, error: 'daemon unreachable' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getTtsDaemonStatus(config: NormalizedTtsDaemonConfig): Promise<TtsDaemonStatus> {
  const pid = await readPid();
  const running = pid !== null && isProcessAlive(pid);
  const [state, health, gpuMemoryUsedMb] = await Promise.all([
    readState(),
    fetchDaemonHealth(config),
    getGpuMemoryUsedMb(pid),
  ]);

  const uptimeSeconds = state?.startedAt && running
    ? Math.max(0, Math.floor((Date.now() - Date.parse(state.startedAt)) / 1000))
    : undefined;

  return {
    ok: health.ok === true,
    running,
    pid: running ? pid : null,
    daemonHost: config.daemonHost,
    daemonPort: config.daemonPort,
    queue: health.queue,
    queueDepth: health.queueDepth,
    model: health.model ?? state?.model,
    uptimeSeconds,
    gpuMemoryUsedMb,
    error: health.ok === true ? undefined : health.error ?? (running ? 'daemon unhealthy' : 'daemon not running'),
  };
}

export async function waitForTtsDaemonHealth(config: NormalizedTtsDaemonConfig, timeoutMs = 120_000): Promise<TtsDaemonStatus> {
  const deadline = Date.now() + timeoutMs;
  let latest = await getTtsDaemonStatus(config);
  while (!latest.ok && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    latest = await getTtsDaemonStatus(config);
  }
  return latest;
}

export async function startTtsDaemon(options: TtsDaemonStartOptions): Promise<TtsDaemonStartResult> {
  const { config } = options;
  const detach = options.detach !== false;
  const waitForHealth = options.waitForHealth !== false;

  if (process.platform !== 'linux') {
    return { ok: false, pid: null, alreadyRunning: false, error: `Qwen TTS daemon is only supported on Linux (current platform: ${process.platform})` };
  }

  let spawnedPid: number | null = null;
  let alreadyRunning = false;
  await acquireStartLock();
  try {
    await clearTtsDaemonManualStopGate();
    const existing = await getTtsDaemonStatus(config);
    if (existing.running) {
      alreadyRunning = true;
      spawnedPid = existing.pid;
    } else {
      const python = await getTtsDaemonPython();
      const script = await resolveTtsDaemonScript();
      if (!(await pathExists(python))) {
        return { ok: false, pid: null, alreadyRunning: false, error: `TTS daemon venv not found at ${python}; run pan install` };
      }

      const authToken = await getTtsDaemonAuthToken();
      let logFile: Awaited<ReturnType<typeof open>> | undefined;
      if (detach) {
        await mkdir(LOGS_DIR, { recursive: true });
        logFile = await open(QWEN_TTS_LOG_PATH, 'a');
      }
      const child = spawn(python, [script], {
        detached: detach,
        stdio: detach ? ['ignore', logFile!.fd, logFile!.fd] : 'inherit',
        env: {
          ...process.env,
          QWEN_TTS_HOST: config.daemonHost,
          QWEN_TTS_PORT: String(config.daemonPort),
          QWEN_TTS_AUTH_TOKEN: authToken,
          QWEN_TTS_ALLOWED_ORIGINS: process.env.QWEN_TTS_ALLOWED_ORIGINS ?? defaultAllowedOrigins(),
        },
      });

      if (!child.pid) {
        await logFile?.close();
        return { ok: false, pid: null, alreadyRunning: false, error: 'failed to spawn TTS daemon' };
      }

      spawnedPid = child.pid;
      await writeState({
        pid: child.pid,
        startedAt: new Date().toISOString(),
        host: config.daemonHost,
        port: config.daemonPort,
      });

      if (detach) child.unref();
      await logFile?.close();
    }
  } finally {
    await releaseStartLock();
  }

  if (!waitForHealth) {
    return { ok: true, pid: spawnedPid, alreadyRunning, status: await getTtsDaemonStatus(config) };
  }

  const status = await waitForTtsDaemonHealth(config, options.timeoutMs);
  return { ok: status.ok, pid: status.pid ?? spawnedPid, alreadyRunning, status, error: status.ok ? undefined : status.error };
}

export async function runTtsDaemonForeground(config: NormalizedTtsDaemonConfig): Promise<TtsDaemonForegroundResult> {
  if (process.platform !== 'linux') {
    return { pid: null, exitCode: 1, signal: null };
  }

  const python = await getTtsDaemonPython();
  const script = await resolveTtsDaemonScript();
  if (!(await pathExists(python))) {
    throw new Error(`TTS daemon venv not found at ${python}; run pan install`);
  }

  const authToken = await getTtsDaemonAuthToken();
  await acquireStartLock();
  let child: ReturnType<typeof spawn>;
  try {
    await clearTtsDaemonManualStopGate();
    child = spawn(python, [script], {
      detached: false,
      stdio: 'inherit',
      env: {
        ...process.env,
        QWEN_TTS_HOST: config.daemonHost,
        QWEN_TTS_PORT: String(config.daemonPort),
        QWEN_TTS_AUTH_TOKEN: authToken,
        QWEN_TTS_ALLOWED_ORIGINS: process.env.QWEN_TTS_ALLOWED_ORIGINS ?? defaultAllowedOrigins(),
      },
    });

    if (!child.pid) return { pid: null, exitCode: 1, signal: null };
    await writeState({
      pid: child.pid,
      startedAt: new Date().toISOString(),
      host: config.daemonHost,
      port: config.daemonPort,
    });
  } finally {
    await releaseStartLock();
  }

  return await new Promise<TtsDaemonForegroundResult>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', async (exitCode, signal) => {
      const currentPid = await readPid();
      if (currentPid === child.pid) await clearState();
      resolve({ pid: child.pid ?? null, exitCode, signal });
    });
  });
}

export async function stopTtsDaemon(timeoutMs = 5_000): Promise<TtsDaemonStopResult> {
  await setTtsDaemonManualStopGate();
  const pid = await readPid();
  if (pid === null) return { stopped: false, pid: null, error: 'TTS daemon is not running' };
  if (!isProcessAlive(pid)) {
    await clearState();
    return { stopped: false, pid, error: 'TTS daemon pid file was stale' };
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    await clearState();
    return { stopped: false, pid, error: error instanceof Error ? error.message : String(error) };
  }

  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }

  await clearState();
  return { stopped: true, pid };
}

async function runProcess(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', cwd: options.cwd, env: options.env ?? process.env });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

async function hasCudaGpu(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['-L'], { timeout: 2_000 });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function installTtsDaemonDependencies(): Promise<TtsDaemonInstallResult> {
  if (process.platform !== 'linux') {
    return { status: 'skipped', reason: `Qwen TTS daemon is Linux-only (current platform: ${process.platform})` };
  }
  if (process.arch !== 'x64') {
    return { status: 'skipped', reason: `Qwen TTS daemon package is linux/x64-only (current arch: ${process.arch})` };
  }
  if (!(await hasCudaGpu())) {
    return { status: 'skipped', reason: 'No CUDA GPU detected with nvidia-smi; skipping Qwen TTS daemon install' };
  }

  const packageDir = await resolveQwenTtsPackageDir();
  const venvDir = await getTtsDaemonVenvDir();
  await mkdir(packageDir, { recursive: true });

  try {
    if (!(await pathExists(join(venvDir, 'bin', 'python')))) {
      await runProcess('python3', ['-m', 'venv', venvDir], { cwd: packageDir });
    }
    const python = join(venvDir, 'bin', 'python');
    await runProcess(python, ['-m', 'pip', 'install', '--upgrade', 'pip', 'wheel', 'setuptools'], { cwd: packageDir });
    await runProcess(python, ['-m', 'pip', 'install', 'torch', '--index-url', 'https://download.pytorch.org/whl/cu121'], { cwd: packageDir });
    await runProcess(python, ['-m', 'pip', 'install', 'qwen-tts', 'soundfile', 'numpy'], { cwd: packageDir });
    return { status: 'installed', venvDir, message: `Qwen TTS daemon venv ready at ${venvDir}` };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function installTtsSystemdUnit(): Promise<string> {
  const configDir = join(process.env.HOME ?? '', '.config', 'systemd', 'user');
  await mkdir(configDir, { recursive: true });
  const unitPath = join(configDir, 'panopticon-qwen-tts.service');
  const panBinary = process.env.PANOPTICON_PAN_BINARY ?? process.argv[1] ?? 'pan';
  const content = `[Unit]\nDescription=Panopticon Qwen TTS daemon\nAfter=default.target\n\n[Service]\nType=simple\nExecStart=${panBinary} tts start --foreground\nRestart=on-failure\nRestartSec=10\n\n[Install]\nWantedBy=default.target\n`;
  await writeFile(unitPath, content, 'utf8');
  return unitPath;
}

export async function ttsDaemonInstallState(): Promise<{ venvDir: string; installed: boolean }> {
  const venvDir = await getTtsDaemonVenvDir();
  try {
    await stat(join(venvDir, 'bin', 'python'));
    return { venvDir, installed: true };
  } catch {
    return { venvDir, installed: false };
  }
}
