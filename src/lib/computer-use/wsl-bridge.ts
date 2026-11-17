/**
 * Runs the vendored Orca Windows helper (native/computer-use-windows/runtime.ps1)
 * from WSL2 through Windows interop (PAN-5462, PRD WI-1, D-2..D-7, D-15..D-18).
 *
 * The helper and its operation files live in the Windows-side helper dir,
 * `%LOCALAPPDATA%\Overdeck\computer-use\`, never on `\\wsl.localhost\…`:
 * PowerShell treats UNC paths as remote. Each call is one `powershell.exe`
 * process (no `-Serve` mode, D-3) that prints one JSON line. Only promisified
 * execFile is used; every dependency is injectable for tests.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { ComputerUseError } from './errors.js';
import { parseHelperOutput, type ExecFileFn, type HelperResponse } from './helper.js';
import { windowsHelperDirCachePath, windowsHelperSource } from './paths.js';

const execFileAsync = promisify(execFile);

const HELPER_TIMEOUT_MS = 30_000;
const HELPER_MAX_BUFFER = 64 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 10_000;
const PROBE_MAX_BUFFER = 1024 * 1024;

export const POWERSHELL_FALLBACK = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const INTEROP_ENTRIES = ['/proc/sys/fs/binfmt_misc/WSLInterop', '/proc/sys/fs/binfmt_misc/WSLInterop-late'];
const INTEROP_SOCKET_DIR = '/run/WSL';
const HELPER_FILE = 'runtime.ps1';

/** The arguments Orca uses for Windows PowerShell 5.1; `Bypass` is process-scoped and needs no admin (D-4). */
const POWERSHELL_ARGS = ['-NoLogo', '-NoProfile', '-NonInteractive'];
const EXECUTION_POLICY_PATTERN = /\bUnauthorizedAccess\b|\bSecurityError\b|about_Execution_Policies/;
export const EXECUTION_POLICY_MESSAGE =
  'Windows execution policy blocked the computer-use helper (set by Group Policy). Ask the PC\'s administrator to allow local scripts.';
export const POWERSHELL_NOT_FOUND_MESSAGE =
  'powershell.exe was not found. WSL normally adds the Windows PATH; check appendWindowsPath in /etc/wsl.conf.';

export interface WslBridgeDeps {
  execFile?: ExecFileFn;
  readFile?: typeof readFile;
  writeFile?: typeof writeFile;
  mkdir?: typeof mkdir;
  rm?: typeof rm;
  rename?: typeof rename;
  stat?: typeof stat;
  readdir?: (path: string) => Promise<string[]>;
  /** binfmt_misc and fallback-path checks. */
  exists?: (path: string) => boolean;
  randomUUID?: () => string;
  env?: NodeJS.ProcessEnv;
  helperSource?: () => string;
  helperDirCachePath?: () => string;
}

export interface HelperDir {
  /** The Windows path, e.g. `C:\Users\me\AppData\Local\Overdeck\computer-use`. */
  win: string;
  /** The same dir seen from WSL, e.g. `/mnt/c/Users/me/AppData/Local/Overdeck/computer-use`. */
  linux: string;
}

function execFor(deps: WslBridgeDeps): ExecFileFn {
  return deps.execFile ?? ((file, args, options) => execFileAsync(file, args, options));
}

function probeOptions(env: NodeJS.ProcessEnv) {
  return { env, timeout: PROBE_TIMEOUT_MS, killSignal: 'SIGKILL' as const, maxBuffer: PROBE_MAX_BUFFER };
}

function isTimeoutError(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { killed?: boolean }).killed === true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** D-16: WSL2 registers a WSLInterop binfmt entry; WSL1 and interop-off hosts don't. */
export function interopEnabled(deps: WslBridgeDeps = {}): boolean {
  const exists = deps.exists ?? existsSync;
  return INTEROP_ENTRIES.some((entry) => exists(entry));
}

/**
 * D-17: a shell started by WSL carries WSL_INTEROP; a systemd user service may not.
 * When it's missing, point it at /run/WSL/1_interop, else the socket with the
 * lowest numeric pid prefix. Returns the env unchanged when nothing is found.
 */
export async function interopEnv(deps: WslBridgeDeps = {}): Promise<NodeJS.ProcessEnv> {
  const env = deps.env ?? process.env;
  if (env.WSL_INTEROP) return env;
  const readdirFn = deps.readdir ?? ((path: string) => readdir(path));
  let entries: string[];
  try {
    entries = await readdirFn(INTEROP_SOCKET_DIR);
  } catch {
    return env;
  }
  const sockets = entries
    .map((name) => /^(\d+)_interop$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ name: match[0], pid: Number(match[1]) }))
    .sort((a, b) => a.pid - b.pid);
  if (sockets.length === 0) return env;
  const chosen = sockets.find((socket) => socket.pid === 1) ?? sockets[0];
  return { ...env, WSL_INTEROP: join(INTEROP_SOCKET_DIR, chosen.name) };
}

/** D-2: `which powershell.exe` first (WSL appends the Windows PATH), then the System32 path. Never pwsh. */
export async function resolvePowershell(deps: WslBridgeDeps = {}): Promise<string | null> {
  const exec = execFor(deps);
  const exists = deps.exists ?? existsSync;
  try {
    const { stdout } = await exec('which', ['powershell.exe'], probeOptions(deps.env ?? process.env));
    const hit = stdout.trim().split('\n')[0]?.trim();
    if (hit) return hit;
  } catch {
    // `which` exits 1 when nothing matches; fall through to the fixed path.
  }
  return exists(POWERSHELL_FALLBACK) ? POWERSHELL_FALLBACK : null;
}

async function wslpath(flag: '-u' | '-w', path: string, env: NodeJS.ProcessEnv, deps: WslBridgeDeps): Promise<string> {
  const { stdout } = await execFor(deps)('wslpath', [flag, path], probeOptions(env));
  const converted = stdout.trim();
  if (!converted) throw new ComputerUseError('helper_error', `wslpath ${flag} printed nothing for ${path}`);
  return converted;
}

async function readCachedHelperDir(deps: WslBridgeDeps): Promise<HelperDir | null> {
  const readFileFn = deps.readFile ?? readFile;
  const statFn = deps.stat ?? stat;
  const cachePath = (deps.helperDirCachePath ?? windowsHelperDirCachePath)();
  try {
    const [linux, win] = String(await readFileFn(cachePath, 'utf8'))
      .split('\n')
      .map((line) => line.trim());
    if (!linux || !win) return null;
    const info = await statFn(linux);
    return info.isDirectory() ? { linux, win } : null;
  } catch {
    return null;
  }
}

/**
 * D-5: the Windows-side helper dir under %LOCALAPPDATA%. The result is cached in
 * ~/.overdeck/computer-use/windows-helper-dir.txt (WSL path, then Windows path)
 * and re-resolved when the cached dir no longer exists.
 */
export async function resolveHelperDir(deps: WslBridgeDeps = {}, powershell?: string): Promise<HelperDir> {
  const cached = await readCachedHelperDir(deps);
  if (cached) return cached;

  // Readiness calls this directly, so it needs the D-17 guard as much as runWindowsHelper.
  const env = await interopEnv(deps);
  const bridgeDeps: WslBridgeDeps = { ...deps, env };
  const exe = powershell ?? (await resolvePowershell(bridgeDeps));
  if (!exe) throw new ComputerUseError('no_desktop_session', POWERSHELL_NOT_FOUND_MESSAGE);
  const { stdout } = await execFor(bridgeDeps)(
    exe,
    [...POWERSHELL_ARGS, '-Command', "[Environment]::GetFolderPath('LocalApplicationData')"],
    probeOptions(env),
  );
  const localAppData = stdout.trim().split('\n').at(-1)?.trim();
  if (!localAppData) {
    throw new ComputerUseError('helper_error', 'pan computer: Windows did not report a LocalApplicationData folder.');
  }
  const linuxBase = await wslpath('-u', localAppData, env, bridgeDeps);
  const dir: HelperDir = {
    linux: join(linuxBase, 'Overdeck', 'computer-use'),
    win: `${localAppData.replace(/\\+$/, '')}\\Overdeck\\computer-use`,
  };

  const mkdirFn = deps.mkdir ?? mkdir;
  const writeFileFn = deps.writeFile ?? writeFile;
  const cachePath = (deps.helperDirCachePath ?? windowsHelperDirCachePath)();
  await mkdirFn(dir.linux, { recursive: true });
  await mkdirFn(dirname(cachePath), { recursive: true });
  await writeFileFn(cachePath, `${dir.linux}\n${dir.win}\n`);
  return dir;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * D-5/D-18: copy the vendored helper into the helper dir when the copy is
 * missing or differs, through a temp file renamed into place so a concurrent
 * reader never sees half a script.
 */
export async function ensureHelperCopied(linuxDir: string, deps: WslBridgeDeps = {}): Promise<void> {
  const readFileFn = deps.readFile ?? readFile;
  const writeFileFn = deps.writeFile ?? writeFile;
  const renameFn = deps.rename ?? rename;
  const rmFn = deps.rm ?? rm;
  const uuid = deps.randomUUID ?? randomUUID;

  const source = Buffer.from(await readFileFn((deps.helperSource ?? windowsHelperSource)()));
  const target = join(linuxDir, HELPER_FILE);
  let current: Buffer | null = null;
  try {
    current = Buffer.from(await readFileFn(target));
  } catch {
    current = null;
  }
  if (current && sha256(current) === sha256(source)) return;

  const temp = join(linuxDir, `${HELPER_FILE}.tmp-${uuid()}`);
  try {
    await writeFileFn(temp, source);
    await renameFn(temp, target);
  } catch (error) {
    await rmFn(temp, { force: true });
    throw error;
  }
}

/** D-3..D-7, D-15: run one operation through powershell.exe and return the helper's ok response. */
export async function runWindowsHelper(operation: Record<string, unknown>, deps: WslBridgeDeps = {}): Promise<HelperResponse> {
  const env = await interopEnv(deps);
  const bridgeDeps: WslBridgeDeps = { ...deps, env };
  const exec = execFor(bridgeDeps);
  const mkdirFn = deps.mkdir ?? mkdir;
  const writeFileFn = deps.writeFile ?? writeFile;
  const rmFn = deps.rm ?? rm;
  const uuid = deps.randomUUID ?? randomUUID;

  const powershell = await resolvePowershell(bridgeDeps);
  if (!powershell) throw new ComputerUseError('no_desktop_session', POWERSHELL_NOT_FOUND_MESSAGE);
  const dir = await resolveHelperDir(bridgeDeps, powershell);
  const opsDir = join(dir.linux, 'ops');
  await mkdirFn(opsDir, { recursive: true });
  await ensureHelperCopied(dir.linux, bridgeDeps);
  const opFile = join(opsDir, `${uuid()}.json`);

  let stdout: string;
  let stderr: string;
  try {
    await writeFileFn(opFile, JSON.stringify(operation));
    const winHelper = await wslpath('-w', join(dir.linux, HELPER_FILE), env, bridgeDeps);
    const winOp = await wslpath('-w', opFile, env, bridgeDeps);
    try {
      const result = await exec(powershell, [...POWERSHELL_ARGS, '-ExecutionPolicy', 'Bypass', '-File', winHelper, winOp], {
        env,
        timeout: HELPER_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: HELPER_MAX_BUFFER,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      if (isTimeoutError(error)) {
        // Killing the interop stub may leave the Windows powershell.exe running (D-7).
        throw new ComputerUseError('helper_timeout', `pan computer: the helper did not respond within ${HELPER_TIMEOUT_MS}ms and was killed`);
      }
      const failedStderr = (error as { stderr?: string }).stderr ?? '';
      if (EXECUTION_POLICY_PATTERN.test(failedStderr)) {
        throw new ComputerUseError('helper_error', EXECUTION_POLICY_MESSAGE);
      }
      throw new ComputerUseError('helper_error', failedStderr.slice(-500) || errorMessage(error));
    }
  } finally {
    await rmFn(opFile, { force: true });
  }

  const parsed = parseHelperOutput(stdout, stderr);
  if (parsed.ok === false) {
    throw new ComputerUseError('helper_error', typeof parsed.error === 'string' ? parsed.error : 'unknown helper error');
  }
  return parsed;
}

/** One powershell.exe call: the PowerShell version and the Windows build, e.g. { powershell: '5.1.22621.4391', build: '10.0.22631.0' }. */
export async function windowsVersion(deps: WslBridgeDeps = {}): Promise<{ powershell: string; build: string }> {
  const env = await interopEnv(deps);
  const bridgeDeps: WslBridgeDeps = { ...deps, env };
  const powershell = await resolvePowershell(bridgeDeps);
  if (!powershell) throw new ComputerUseError('no_desktop_session', POWERSHELL_NOT_FOUND_MESSAGE);
  let stdout: string;
  try {
    ({ stdout } = await execFor(bridgeDeps)(
      powershell,
      [...POWERSHELL_ARGS, '-Command', '$PSVersionTable.PSVersion.ToString(); [Environment]::OSVersion.Version.ToString()'],
      probeOptions(env),
    ));
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new ComputerUseError('helper_timeout', `pan computer: powershell.exe did not respond within ${PROBE_TIMEOUT_MS}ms`);
    }
    throw new ComputerUseError('helper_error', `pan computer: powershell.exe failed to start: ${errorMessage(error)}`);
  }
  const [version, build] = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!version || !build) {
    throw new ComputerUseError('helper_error', `pan computer: unexpected powershell.exe version output: ${stdout.slice(0, 200)}`);
  }
  return { powershell: version, build };
}
