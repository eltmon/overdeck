import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, chmod, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { LOGS_DIR, PANOPTICON_HOME, SYNC_SOURCES, packageRoot } from './paths.js';
import { loadConfig, type NormalizedTtsDaemonConfig } from './config-yaml.js';
import { ProcessSpawnError, FsError } from './errors.js';

const execFileAsync = promisify(execFile);

export const QWEN_TTS_PID_PATH = join(PANOPTICON_HOME, 'pids', 'qwen-tts.pid');
export const QWEN_TTS_STATE_PATH = join(PANOPTICON_HOME, 'pids', 'qwen-tts.json');
export const QWEN_TTS_START_LOCK_PATH = join(PANOPTICON_HOME, 'pids', 'qwen-tts.start.lock');
export const QWEN_TTS_MANUAL_STOP_PATH = join(PANOPTICON_HOME, 'pids', 'qwen-tts.manual-stop');
export const QWEN_TTS_AUTH_TOKEN_PATH = join(PANOPTICON_HOME, 'secrets', 'qwen-tts.token');
export const QWEN_TTS_AUTH_HEADER = 'X-Panopticon-TTS-Token';
export const QWEN_TTS_LOG_PATH = join(LOGS_DIR, 'qwen-tts.log');
const GPU_MEMORY_CACHE_TTL_MS = 30_000;
const DEFAULT_TTS_DAEMON_STARTUP_GRACE_MS = 30 * 60_000;
let gpuMemoryCache: { pid: number; sampledAt: number; value: number | undefined } | null = null;
let gpuMemoryInFlight: { pid: number; promise: Promise<number | undefined> } | null = null;

export type TtsDaemonStatePhase = 'starting' | 'running';
export type TtsDaemonStatusPhase = 'stopped' | 'starting' | 'healthy' | 'unhealthy';

export interface TtsDaemonState {
  pid: number;
  startedAt: string;
  host: string;
  port: number;
  phase?: TtsDaemonStatePhase;
  startupDeadlineAt?: string;
  scriptPath?: string;
  processStartTimeTicks?: string;
  model?: string;
}

export interface TtsDaemonStatus {
  ok: boolean;
  running: boolean;
  pid: number | null;
  managed?: boolean;
  phase: TtsDaemonStatusPhase;
  initializing?: boolean;
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveQwenTtsPackageDir(): Promise<string> {
  const candidates = [
    join(packageRoot, 'packages', 'qwen-tts-linux-x64'),
    join(packageRoot, 'node_modules', 'qwen-tts-linux-x64'),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  await mkdir(candidates[0], { recursive: true });
  return candidates[0];
}

export async function resolveTtsDaemonScript(): Promise<string> {
  const script = join(SYNC_SOURCES.skills, 'pan-tts', 'scripts', 'tts_daemon.py');
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
      phase: parsed.phase === 'starting' || parsed.phase === 'running' ? parsed.phase : undefined,
      startupDeadlineAt: typeof parsed.startupDeadlineAt === 'string' ? parsed.startupDeadlineAt : undefined,
      scriptPath: typeof parsed.scriptPath === 'string' ? parsed.scriptPath : undefined,
      processStartTimeTicks: typeof parsed.processStartTimeTicks === 'string' ? parsed.processStartTimeTicks : undefined,
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

function buildTtsDaemonEnv(config: NormalizedTtsDaemonConfig, authToken: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'HOME',
    'USER',
    'LANG',
    'LANGUAGE',
    'XDG_RUNTIME_DIR',
    'PULSE_SERVER',
    'PIPEWIRE_RUNTIME_DIR',
    'ALSA_CONFIG_PATH',
    'CUDA_VISIBLE_DEVICES',
    'NVIDIA_VISIBLE_DEVICES',
    'NVIDIA_DRIVER_CAPABILITIES',
    'LD_LIBRARY_PATH',
    'SSL_CERT_FILE',
    'REQUESTS_CA_BUNDLE',
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(process.env)) {
    if ((key.startsWith('LC_') || key.startsWith('QWEN_TTS_')) && value !== undefined) env[key] = value;
  }
  env.QWEN_TTS_HOST = config.daemonHost;
  env.QWEN_TTS_PORT = String(config.daemonPort);
  env.QWEN_TTS_AUTH_TOKEN = authToken;
  env.QWEN_TTS_ALLOWED_ORIGINS = process.env.QWEN_TTS_ALLOWED_ORIGINS ?? defaultAllowedOrigins();
  return env;
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

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readStartupGraceMs(): number {
  return parsePositiveInt(process.env.PANOPTICON_TTS_DAEMON_STARTUP_GRACE_MS, DEFAULT_TTS_DAEMON_STARTUP_GRACE_MS);
}

function startupDeadlineIso(): string {
  return new Date(Date.now() + readStartupGraceMs()).toISOString();
}

function isWithinStartupGrace(state: TtsDaemonState | null, now = Date.now()): boolean {
  if (state?.phase !== 'starting' || !state.startupDeadlineAt) return false;
  const deadline = Date.parse(state.startupDeadlineAt);
  return Number.isFinite(deadline) && now < deadline;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readProcessIdentity(pid: number): Promise<{ cmdline: string; startTimeTicks: string } | null> {
  try {
    const [cmdlineRaw, statRaw] = await Promise.all([
      readFile(`/proc/${pid}/cmdline`, 'utf8'),
      readFile(`/proc/${pid}/stat`, 'utf8'),
    ]);
    const closeParen = statRaw.lastIndexOf(')');
    if (closeParen === -1) return null;
    const fields = statRaw.slice(closeParen + 2).trim().split(/\s+/);
    const startTimeTicks = fields[19];
    if (!startTimeTicks) return null;
    return { cmdline: cmdlineRaw.replace(/\0/g, ' ').trim(), startTimeTicks };
  } catch {
    return null;
  }
}

async function buildManagedProcessIdentity(pid: number, scriptPath: string): Promise<Pick<TtsDaemonState, 'scriptPath' | 'processStartTimeTicks'>> {
  const identity = await readProcessIdentity(pid);
  return {
    scriptPath,
    processStartTimeTicks: identity?.startTimeTicks,
  };
}

async function isManagedProcessAlive(state: TtsDaemonState | null): Promise<boolean> {
  if (!state || !isProcessAlive(state.pid)) return false;
  if (!state.scriptPath || !state.processStartTimeTicks) return false;
  const identity = await readProcessIdentity(state.pid);
  return identity !== null
    && identity.startTimeTicks === state.processStartTimeTicks
    && identity.cmdline.includes(state.scriptPath);
}

async function terminateManagedProcess(state: TtsDaemonState, timeoutMs: number): Promise<boolean> {
  if (!await isManagedProcessAlive(state)) return false;
  const pid = state.pid;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  while (await isManagedProcessAlive(state) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (await isManagedProcessAlive(state)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  return true;
}

async function sampleGpuMemoryUsedMb(pid: number): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-compute-apps=pid,used_memory',
      '--format=csv,noheader,nounits',
    ], { timeout: 2_000 });
    for (const line of stdout.split('\n')) {
      const [rawPid, rawMemory] = line.split(',').map((part) => part?.trim());
      if (Number.parseInt(rawPid ?? '', 10) === pid) {
        const memory = Number.parseInt(rawMemory ?? '', 10);
        return Number.isFinite(memory) ? memory : undefined;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function getGpuMemoryUsedMb(pid: number | null): number | undefined {
  if (!pid) return undefined;
  if (gpuMemoryCache?.pid === pid && Date.now() - gpuMemoryCache.sampledAt < GPU_MEMORY_CACHE_TTL_MS) {
    return gpuMemoryCache.value;
  }
  if (gpuMemoryInFlight?.pid === pid) return undefined;

  const promise = sampleGpuMemoryUsedMb(pid).then((value) => {
    gpuMemoryCache = { pid, sampledAt: Date.now(), value };
    return value;
  }).finally(() => {
    if (gpuMemoryInFlight?.pid === pid) gpuMemoryInFlight = null;
  });
  gpuMemoryInFlight = { pid, promise };
  return undefined;
}

function parseHealthPid(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

async function fetchDaemonHealth(config: NormalizedTtsDaemonConfig, timeoutMs = 2_000): Promise<Partial<TtsDaemonStatus>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://${config.daemonHost}:${config.daemonPort}/health`, { signal: controller.signal });
    if (!response.ok) return { ok: false, error: 'daemon unreachable' };
    const body = await response.json() as { queue?: unknown; model?: unknown; pid?: unknown };
    return {
      ok: true,
      pid: parseHealthPid(body.pid),
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
  const [state, health] = await Promise.all([
    readState(),
    fetchDaemonHealth(config),
  ]);
  const managedRunning = await isManagedProcessAlive(state);
  const managedPid = managedRunning ? state!.pid : null;
  const healthPid = health.ok === true ? health.pid ?? null : null;
  const pid = managedRunning ? managedPid : healthPid;
  const running = managedRunning || health.ok === true;
  const initializing = managedRunning && health.ok !== true && isWithinStartupGrace(state);
  const phase: TtsDaemonStatusPhase = health.ok === true
    ? 'healthy'
    : initializing
      ? 'starting'
      : running
        ? 'unhealthy'
        : 'stopped';

  if (health.ok === true && managedRunning && state?.phase === 'starting') {
    await writeState({
      pid: state.pid,
      startedAt: state.startedAt,
      host: state.host,
      port: state.port,
      phase: 'running',
      scriptPath: state.scriptPath,
      processStartTimeTicks: state.processStartTimeTicks,
      model: typeof health.model === 'string' ? health.model : state.model,
    });
  }

  const uptimeSeconds = state?.startedAt && managedRunning
    ? Math.max(0, Math.floor((Date.now() - Date.parse(state.startedAt)) / 1000))
    : undefined;
  const gpuMemoryUsedMb = managedRunning ? getGpuMemoryUsedMb(managedPid) : undefined;

  return {
    ok: health.ok === true,
    running,
    pid,
    managed: managedRunning,
    phase,
    initializing: initializing || undefined,
    daemonHost: config.daemonHost,
    daemonPort: config.daemonPort,
    queue: health.queue,
    queueDepth: health.queueDepth,
    model: health.model ?? state?.model,
    uptimeSeconds,
    gpuMemoryUsedMb,
    error: health.ok === true ? undefined : initializing ? 'daemon starting' : health.error ?? (managedRunning ? 'daemon unhealthy' : 'daemon not running'),
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
    if (existing.ok || existing.initializing) {
      alreadyRunning = true;
      spawnedPid = existing.pid;
    } else {
      const state = await readState();
      if (existing.managed && state) {
        await terminateManagedProcess(state, 5_000);
        await clearState();
      } else if (state && !await isManagedProcessAlive(state)) {
        await clearState();
      }
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
        env: buildTtsDaemonEnv(config, authToken),
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
        phase: 'starting',
        startupDeadlineAt: startupDeadlineIso(),
        ...await buildManagedProcessIdentity(child.pid, script),
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
      env: buildTtsDaemonEnv(config, authToken),
    });

    if (!child.pid) return { pid: null, exitCode: 1, signal: null };
    await writeState({
      pid: child.pid,
      startedAt: new Date().toISOString(),
      host: config.daemonHost,
      port: config.daemonPort,
      phase: 'starting',
      startupDeadlineAt: startupDeadlineIso(),
      ...await buildManagedProcessIdentity(child.pid, script),
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
  const state = await readState();
  if (state) {
    if (!await isManagedProcessAlive(state)) {
      await clearState();
      return { stopped: false, pid: state.pid, error: 'TTS daemon pid file was stale' };
    }
    await terminateManagedProcess(state, timeoutMs);
    await clearState();
    return { stopped: true, pid: state.pid };
  }

  const config = loadConfig().config.tts;
  const status = await getTtsDaemonStatus(config);
  const pid = status.pid ?? null;
  if (pid === null) return { stopped: false, pid: null, error: 'TTS daemon is not running' };

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return { stopped: false, pid, error: 'TTS daemon is not running' };
  }
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
    // Install torch AND torchaudio together from the CUDA wheel index. qwen-tts depends on
    // torchaudio, and if it is absent at this point pip's resolver pulls the newest torchaudio
    // from PyPI in the next step — which is built against a torch ABI ahead of the cu121 wheels
    // and crashes the daemon with `undefined symbol: aoti_torch_abi_version` on import.
    await runProcess(python, ['-m', 'pip', 'install', 'torch', 'torchaudio', '--index-url', 'https://download.pytorch.org/whl/cu121'], { cwd: packageDir });
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

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

const ttsProcessError = (op: string, cause: unknown): ProcessSpawnError =>
  new ProcessSpawnError({
    command: 'tts-daemon',
    args: [op],
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

const ttsFsError = (op: string, path: string, cause: unknown): FsError =>
  new FsError({ path, operation: op, cause });

/** Path to the bundled qwen-tts package on disk. */
export const resolveQwenTtsPackageDirEffect = (): Effect.Effect<string, FsError> =>
  Effect.tryPromise({
    try: () => resolveQwenTtsPackageDir(),
    catch: (cause) => ttsFsError('resolveQwenTtsPackageDir', packageRoot, cause),
  });

/** Path to the daemon entry script inside the qwen-tts package. */
export const resolveTtsDaemonScriptEffect = (): Effect.Effect<string, FsError> =>
  Effect.tryPromise({
    try: () => resolveTtsDaemonScript(),
    catch: (cause) => ttsFsError('resolveTtsDaemonScript', packageRoot, cause),
  });

/** Resolved venv directory for the TTS daemon. */
export const getTtsDaemonVenvDirEffect = (): Effect.Effect<string, FsError> =>
  Effect.tryPromise({
    try: () => getTtsDaemonVenvDir(),
    catch: (cause) => ttsFsError('getTtsDaemonVenvDir', PANOPTICON_HOME, cause),
  });

/** Resolved python interpreter inside the TTS daemon venv. */
export const getTtsDaemonPythonEffect = (): Effect.Effect<string, FsError> =>
  Effect.tryPromise({
    try: () => getTtsDaemonPython(),
    catch: (cause) => ttsFsError('getTtsDaemonPython', PANOPTICON_HOME, cause),
  });

/** True if a daemon state file exists on disk. */
export const hasTtsDaemonStateEffect = (): Effect.Effect<boolean> =>
  Effect.promise(() => hasTtsDaemonState());

/** True if the manual-stop sentinel file exists. */
export const isTtsDaemonManuallyStoppedEffect = (): Effect.Effect<boolean> =>
  Effect.promise(() => isTtsDaemonManuallyStopped());

/** Lazily-materialised auth token shared with the daemon. */
export const getTtsDaemonAuthTokenEffect = (): Effect.Effect<string, FsError> =>
  Effect.tryPromise({
    try: () => getTtsDaemonAuthToken(),
    catch: (cause) => ttsFsError('getTtsDaemonAuthToken', QWEN_TTS_AUTH_TOKEN_PATH, cause),
  });

/** Auth headers (token + content-type) for daemon HTTP calls. */
export const getTtsDaemonAuthHeadersEffect = (): Effect.Effect<Record<string, string>, FsError> =>
  Effect.tryPromise({
    try: () => getTtsDaemonAuthHeaders(),
    catch: (cause) => ttsFsError('getTtsDaemonAuthHeaders', QWEN_TTS_AUTH_TOKEN_PATH, cause),
  });

/** Query the daemon's live status (health probe + state read). */
export const getTtsDaemonStatusEffect = (
  config: NormalizedTtsDaemonConfig,
): Effect.Effect<TtsDaemonStatus, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => getTtsDaemonStatus(config),
    catch: (cause) => ttsProcessError('status', cause),
  });

/** Poll until the daemon reports a healthy phase or the timeout elapses. */
export const waitForTtsDaemonHealthEffect = (
  config: NormalizedTtsDaemonConfig,
  timeoutMs = 120_000,
): Effect.Effect<TtsDaemonStatus, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => waitForTtsDaemonHealth(config, timeoutMs),
    catch: (cause) => ttsProcessError('wait-health', cause),
  });

/** Start the daemon (detached). Idempotent — returns the existing PID when alive. */
export const startTtsDaemonEffect = (
  options: TtsDaemonStartOptions,
): Effect.Effect<TtsDaemonStartResult, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => startTtsDaemon(options),
    catch: (cause) => ttsProcessError('start', cause),
  });

/** Run the daemon in the foreground (debugging / CLI mode). */
export const runTtsDaemonForegroundEffect = (
  config: NormalizedTtsDaemonConfig,
): Effect.Effect<TtsDaemonForegroundResult, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => runTtsDaemonForeground(config),
    catch: (cause) => ttsProcessError('foreground', cause),
  });

/** Stop the daemon, waiting up to `timeoutMs` for graceful shutdown. */
export const stopTtsDaemonEffect = (
  timeoutMs = 5_000,
): Effect.Effect<TtsDaemonStopResult, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => stopTtsDaemon(timeoutMs),
    catch: (cause) => ttsProcessError('stop', cause),
  });

/** Install the daemon's Python dependencies into the venv. */
export const installTtsDaemonDependenciesEffect = (): Effect.Effect<TtsDaemonInstallResult, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => installTtsDaemonDependencies(),
    catch: (cause) => ttsProcessError('install-deps', cause),
  });

/** Write a systemd unit for the daemon. Returns the unit-file path. */
export const installTtsSystemdUnitEffect = (): Effect.Effect<string, FsError> =>
  Effect.tryPromise({
    try: () => installTtsSystemdUnit(),
    catch: (cause) => ttsFsError('installTtsSystemdUnit', PANOPTICON_HOME, cause),
  });

/** Reports whether the daemon venv is materialised. */
export const ttsDaemonInstallStateEffect = (): Effect.Effect<{ venvDir: string; installed: boolean }, FsError> =>
  Effect.tryPromise({
    try: () => ttsDaemonInstallState(),
    catch: (cause) => ttsFsError('ttsDaemonInstallState', PANOPTICON_HOME, cause),
  });
