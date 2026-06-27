import { execSync, execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, chmodSync, appendFileSync, mkdirSync, existsSync, unlinkSync, readFileSync } from 'fs';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { getOverdeckHome } from './paths.js';
import { loadConfigSync, type TmuxConfigMode } from './config-yaml.js';
import { buildChildEnvSync } from './child-env.js';
import { TmuxError } from './errors.js';
import { getUiTheme, TERMINAL_BG } from './ui-theme.js';

const execFileAsync = promisify(execFile);

const VALID_SESSION_NAME_RE = /^[a-zA-Z0-9._-]+$/;
const DEFAULT_TMUX_WINDOW_COLS = 200;
const DEFAULT_TMUX_WINDOW_ROWS = 50;

function validateSessionName(name: string): void {
  if (!VALID_SESSION_NAME_RE.test(name)) {
    throw new Error(`Invalid tmux session name: ${name}`);
  }
}

const MANAGED_TMUX_SERVER_UNIT = 'overdeck-tmux-server';
const SERVER_ALIVE_POLL_MS = 50;
const SERVER_ALIVE_TIMEOUT_MS = 5000;
const MANAGED_TMUX_CONFIG_CONTENT = [
  '# Overdeck-managed tmux config',
  '# Keep this minimal and include only behavior Overdeck intentionally depends on.',
  '# PAN-1798: keep the server alive at zero sessions so a dedicated, cleanly-named',
  '# server process can be founded ahead of any agent spawn and persist between them.',
  'set -g exit-empty off',
  'set -g mouse on',
  '# Overdeck owns the browser-facing context menu. Prevent tmux defaults',
  '# from opening a competing right-click menu inside managed sessions.',
  'unbind-key -T root MouseDown3Pane',
  'unbind-key -T root M-MouseDown3Pane',
  'bind-key -T root MouseDown3Pane select-pane -t =',
  'bind-key -T root M-MouseDown3Pane select-pane -t =',
  '',
].join('\n');

// One-shot guard: the managed tmux context (config file + loaded server) only needs
// to be prepared once per process. Every tmux subprocess invocation already passes
// `-L overdeck -f <configPath>`, so after the first source-file the config is live
// on the shared server for every subsequent command. Re-writing the file and
// re-sourcing it per call was the root of PAN-785's terminal lag.
let tmuxContextPrepared = false;

/**
 * Log file for tmux sendKeys operations.
 * This helps debug mysterious messages appearing in agent prompts.
 */
function getSendKeysLogFile(): string {
  return join(getOverdeckHome(), 'logs', 'sendkeys.jsonl');
}

function getTmuxDir(): string {
  return join(getOverdeckHome(), 'tmux');
}

export function getManagedTmuxConfigPath(): string {
  return join(getTmuxDir(), 'overdeck.tmux.conf');
}

export function getManagedTmuxSocketName(): string {
  return process.env.OVERDECK_TMUX_SOCKET_NAME ?? 'overdeck';
}

function ensureLogDir(): void {
  const logDir = join(getOverdeckHome(), 'logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

function ensureManagedTmuxDirSync(): void {
  const tmuxDir = getTmuxDir();
  if (!existsSync(tmuxDir)) {
    mkdirSync(tmuxDir, { recursive: true });
  }
}

async function ensureManagedTmuxDirAsync(): Promise<void> {
  await mkdir(getTmuxDir(), { recursive: true });
}

/**
 * True when a tmux server is already answering on the managed socket.
 * `list-sessions` exits 0 (possibly with empty output) on a live server and
 * fails with "no server running" / ENOENT when there is none.
 */
function isManagedServerAliveSync(): boolean {
  try {
    execFileSync('tmux', ['-L', getManagedTmuxSocketName(), 'list-sessions'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * PAN-1798: locate the shared tmux server PID. Prefer the dedicated unit's
 * MainPID when we manage it; fall back to pgrep so the founder guard still
 * fires on pre-fix or manually-founded servers.
 */
export function findManagedServerPidSync(): number | undefined {
  try {
    const mainPidOut = execFileSync(
      'systemctl',
      ['--user', 'show', '--property=MainPID', '--value', MANAGED_TMUX_SERVER_UNIT],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    const mainPid = Number.parseInt(mainPidOut, 10);
    if (Number.isInteger(mainPid) && mainPid > 0) {
      return mainPid;
    }
  } catch {
    // Unit not loaded or systemctl unavailable — fall through.
  }

  try {
    const pgrepOut = execFileSync(
      'pgrep',
      ['-f', `tmux -L ${getManagedTmuxSocketName()}`],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    for (const line of pgrepOut.split('\n')) {
      const pid = Number.parseInt(line.trim(), 10);
      if (Number.isInteger(pid) && pid > 0) {
        return pid;
      }
    }
  } catch {
    // pgrep unavailable or no match.
  }

  return undefined;
}

/**
 * PAN-1798: read the cgroup of the given PID. Returns empty string on failure.
 */
function readServerCgroupSync(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cgroup`, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * PAN-1798: read /proc/<pid>/cmdline for the given PID. Returns empty string
 * on failure.
 */
function readServerCmdlineSync(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf-8').replace(/\0/g, ' ').trim();
  } catch {
    return '';
  }
}

/**
 * PAN-1798: warn if the live shared server is still stuck inside a per-spawn
 * scope (servers founded before this fix, or by manual tmux use). Never auto-
 * restart — the operator must decide when to migrate off the live founder.
 */
function warnIfServerInTmuxSpawnScopeSync(): boolean {
  const pid = findManagedServerPidSync();
  if (pid === undefined) return false;
  const cgroup = readServerCgroupSync(pid);
  if (!cgroup.includes('tmux-spawn-')) return false;
  console.warn(
    `[tmux] WARNING (PAN-1798): shared tmux server PID ${pid} lives in a per-spawn scope. ` +
      `Cgroup: ${cgroup.trim().replace(/\n/g, ' ')}. ` +
      `Killing the founding session/agent may destroy the entire shared server. ` +
      `Restart Overdeck to migrate to the dedicated unit '${MANAGED_TMUX_SERVER_UNIT}'.`,
  );
  return true;
}

/**
 * PAN-1798: warn if the live shared server was founded implicitly by a client
 * `new-session` rather than by the dedicated `start-server` founding. A dirty
 * cmdline embeds the founding session name, so any cmdline-match teardown
 * (pkill -f, pgrep -f) can hit the server itself. Never auto-restart.
 */
function warnIfServerCmdlineIsDirtySync(): boolean {
  const pid = findManagedServerPidSync();
  if (pid === undefined) return false;
  const cmdline = readServerCmdlineSync(pid);
  // A clean dedicated founding looks like `tmux -L overdeck -f ... start-server`.
  // Any `new-session` in the server argv means a client founded the server.
  if (!cmdline.includes('new-session')) return false;
  console.warn(
    `[tmux] WARNING (PAN-1798): shared tmux server PID ${pid} has a dirty cmdline ` +
      `founded by a client new-session: ${cmdline.slice(0, 240)}. ` +
      `Conversation/agent teardown that matches cmdlines may destroy the entire shared server. ` +
      `Restart Overdeck to migrate to the dedicated unit '${MANAGED_TMUX_SERVER_UNIT}'.`,
  );
  return true;
}

/**
 * PAN-1798: a tmux server founded implicitly by a client `new-session` (e.g. a
 * Playwright UAT, or any ad-hoc spawn that beats the managed founding to the
 * socket) captures that founding process's environment as the server's GLOBAL
 * environment. Every subsequent `new-session` inherits it — so a stray test's
 * `HOME=/tmp/pan-playwright-...` leaks into real conversation/agent sessions and
 * breaks Claude/Codex auth: they read a fresh `~/.claude.json` under the wrong
 * HOME and drop into the onboarding/login screen.
 *
 * Detecting this and only warning (the old behaviour) left the poison in place.
 * Since `ensureOverdeckTmuxServer*` runs before every `new-session`, overwrite the
 * critical vars in the server's global environment with the clean child env so new
 * sessions are always spawned with the correct HOME/OVERDECK_HOME — even on a
 * dirtily-founded server — and strip known test pollution. Non-destructive: existing
 * sessions keep their captured env; only future sessions change.
 */
function sanitizeManagedServerGlobalEnvSync(cleanEnv: NodeJS.ProcessEnv): void {
  const sock = getManagedTmuxSocketName();
  // Pin the vars that, if wrong, break agent auth / overdeck-home resolution.
  for (const key of ['HOME', 'OVERDECK_HOME'] as const) {
    const value = cleanEnv[key];
    if (!value) continue;
    try {
      execFileSync('tmux', ['-L', sock, 'set-environment', '-g', key, value], { stdio: 'ignore' });
    } catch {
      // tmux momentarily unavailable; the next createSession preflight retries.
    }
  }
  // Strip test-only pollution that must never reach a real session.
  for (const key of ['OVERDECK_FRONTEND_DIR', 'OVERDECK_TEST_HOME_ROOT', 'OVERDECK_TEST_POLL_MS']) {
    try {
      execFileSync('tmux', ['-L', sock, 'set-environment', '-g', '-u', key], { stdio: 'ignore' });
    } catch {
      // best-effort.
    }
  }
}

/** PAN-1798: surface dirty-founding teardown hazards once per process, not per spawn. */
let warnedManagedServerTmuxSpawnScope = false;
let warnedManagedServerDirtyCmdline = false;

/** @internal Reset the per-process dirty-server warn guard. Only for use in tests. */
export function _resetWarnedManagedServerDirtyForTest(): void {
  warnedManagedServerDirtyCmdline = false;
  warnedManagedServerTmuxSpawnScope = false;
}

/**
 * PAN-1798: ensure the shared tmux server is running in a dedicated, long-lived
 * systemd user service — never inside an agent/conversation spawn scope. The
 * service is created on demand; once running it outlives every client on the
 * socket so `pan kill` of any agent cannot take down the fleet.
 *
 * Must be invoked before any `new-session` and at `pan up` time. Waits for the
 * socket to answer before returning.
 */
export function ensureOverdeckTmuxServerSync(cleanEnv: NodeJS.ProcessEnv): void {
  // PAN-1824: never run the managed-server founding under a test runner — it
  // targets the real user-level socket/unit (defeating per-test socket
  // isolation, PAN-1808) and on hosts where the server cannot come up it
  // burns SERVER_ALIVE_TIMEOUT_MS synchronously inside every createSession.
  // Unit tests of this function itself opt back in via the FORCE override.
  if (process.env.OVERDECK_TMUX_MANAGED_SERVER_FORCE !== '1') {
    if (process.env.OVERDECK_TMUX_NO_MANAGED_SERVER === '1' || process.env.VITEST) {
      return;
    }
  }

  if (isManagedServerAliveSync()) {
    // PAN-1798: repair a poisoned global environment so new sessions spawn clean,
    // even on a server founded by a stray client `new-session`.
    sanitizeManagedServerGlobalEnvSync(cleanEnv);
    // Surface the dirty-founding teardown hazard once per process (not per spawn).
    if (!warnedManagedServerTmuxSpawnScope) {
      warnedManagedServerTmuxSpawnScope = warnIfServerInTmuxSpawnScopeSync();
    }
    if (!warnedManagedServerDirtyCmdline) {
      warnedManagedServerDirtyCmdline = warnIfServerCmdlineIsDirtySync();
    }
    return;
  }

  const args = ['-L', getManagedTmuxSocketName(), '-f', getManagedTmuxConfigPath(), 'start-server'];
  const startedBySystemd = (() => {
    try {
      execFileSync(
        'systemd-run',
        ['--user', '--unit', MANAGED_TMUX_SERVER_UNIT, '--collect', '--quiet', 'tmux', ...args],
        { stdio: 'ignore', env: cleanEnv },
      );
      return true;
    } catch {
      return false;
    }
  })();

  if (!startedBySystemd) {
    // No systemd (macOS / non-systemd Linux) — daemonize with setsid so the
    // server is not a child of the spawning process tree. If setsid is absent,
    // a plain start-server is still better than no server.
    let daemonized = false;
    try {
      execFileSync('setsid', ['tmux', ...args], { stdio: 'ignore', env: cleanEnv });
      daemonized = true;
    } catch {
      // setsid unavailable.
    }
    if (!daemonized) {
      execFileSync('tmux', args, { stdio: 'ignore', env: cleanEnv });
    }
    console.warn(
      `[tmux] WARNING (PAN-1798): could not start '${MANAGED_TMUX_SERVER_UNIT}' via systemd-run. ` +
        `Shared tmux server is running without systemd scope isolation; ` +
        `killing the founding process tree may still destroy the server.`,
    );
  }

  const deadline = Date.now() + SERVER_ALIVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isManagedServerAliveSync()) {
      warnIfServerInTmuxSpawnScopeSync();
      return;
    }
    try {
      execFileSync('sleep', [String(SERVER_ALIVE_POLL_MS / 1000)], { stdio: 'ignore' });
    } catch {
      // sleep unavailable — busy-spin briefly.
    }
  }
}

/**
 * Async variant of ensureOverdeckTmuxServerSync. Effect-spawn paths use this
 * so server preflight does not block the event loop. Founding itself is still
 * sync (it is rare, fast, and uses the same single path for both variants).
 */
export async function ensureOverdeckTmuxServerAsync(cleanEnv: NodeJS.ProcessEnv): Promise<void> {
  // Delegate to the sync helper: it already waits for the socket and runs the
  // founder guard. This keeps async tests that mock execFile but not
  // execFileSync from accidentally looping on a never-started mocked server.
  ensureOverdeckTmuxServerSync(cleanEnv);
}

function reloadManagedTmuxConfigSync(): void {
  try {
    // Strip provider env vars (ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, etc.) so
    // the tmux server doesn't inherit stale provider config. Without this,
    // every session spawned by the server inherits the parent's env — and tmux
    // -e can only override, not unset, so stale vars leak through.
    const cleanEnv = buildChildEnvSync();
    ensureOverdeckTmuxServerSync(cleanEnv);
    execFileSync('tmux', ['-L', getManagedTmuxSocketName(), 'start-server'], { stdio: 'ignore', env: cleanEnv });
    execFileSync('tmux', ['-L', getManagedTmuxSocketName(), 'source-file', getManagedTmuxConfigPath()], { stdio: 'ignore' });
  } catch {
    // If tmux isn't available or the server can't be started yet, callers will
    // still write the managed config file and retry on the next tmux interaction.
  }
}

async function reloadManagedTmuxConfigAsync(): Promise<void> {
  try {
    const cleanEnv = buildChildEnvSync();
    await ensureOverdeckTmuxServerAsync(cleanEnv);
    await execFileAsync('tmux', ['-L', getManagedTmuxSocketName(), 'start-server'], { encoding: 'utf-8', env: cleanEnv });
    await execFileAsync('tmux', ['-L', getManagedTmuxSocketName(), 'source-file', getManagedTmuxConfigPath()], { encoding: 'utf-8' });
  } catch {
    // If tmux isn't available or the server can't be started yet, callers will
    // still write the managed config file and retry on the next tmux interaction.
  }
}

function ensureManagedTmuxConfigSync(): void {
  if (tmuxContextPrepared) return;
  ensureManagedTmuxDirSync();
  writeFileSync(getManagedTmuxConfigPath(), MANAGED_TMUX_CONFIG_CONTENT, 'utf-8');
  reloadManagedTmuxConfigSync();
  tmuxContextPrepared = true;
}

async function ensureManagedTmuxConfigAsync(): Promise<void> {
  if (tmuxContextPrepared) return;
  await ensureManagedTmuxDirAsync();
  await writeFile(getManagedTmuxConfigPath(), MANAGED_TMUX_CONFIG_CONTENT, 'utf-8');
  await reloadManagedTmuxConfigAsync();
  tmuxContextPrepared = true;
}async function ensureManagedTmuxContextOncePromise(): Promise<void> {
  const mode = getTmuxConfigMode();
  await ensureTmuxContextPreparedAsync(mode);
}

export function getTmuxConfigMode(): TmuxConfigMode {
  const { config } = loadConfigSync();
  return config.tmux.configMode;
}

function getTmuxContextArgsForMode(mode: TmuxConfigMode): string[] {
  if (mode === 'inherit-user') {
    return [];
  }

  return ['-L', getManagedTmuxSocketName(), '-f', getManagedTmuxConfigPath()];
}

function ensureTmuxContextPreparedSync(mode: TmuxConfigMode): void {
  if (mode === 'managed') {
    ensureManagedTmuxConfigSync();
  }
}

async function ensureTmuxContextPreparedAsync(mode: TmuxConfigMode): Promise<void> {
  if (mode === 'managed') {
    await ensureManagedTmuxConfigAsync();
  }
}

/**
 * Pure: returns the tmux socket/config args for the active mode.
 *
 * Callers that build a tmux command line directly (e.g., `pty.spawn('tmux',
 * buildTmuxArgs(...))`) MUST have `ensureManagedTmuxContextOnce()` awaited
 * earlier in the process lifetime — the dashboard server does this from
 * main.ts before `server.listen`. The `tmuxExecAsync` / `tmuxExecSync`
 * helpers still call `ensureTmuxContextPrepared*` themselves (cheap after the
 * first call) so CLI entry points that never went through the server init
 * still work on first use.
 */
export function getTmuxBaseArgs(): string[] {
  return getTmuxContextArgsForMode(getTmuxConfigMode());
}

export function buildTmuxArgs(args: string[]): string[] {
  return [...getTmuxBaseArgs(), ...args];
}

export function getTmuxCommand(args: string[]): { command: string; args: string[] } {
  return { command: 'tmux', args: buildTmuxArgs(args) };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildTmuxCommandString(args: string[]): string {
  const { command, args: commandArgs } = getTmuxCommand(args);
  return [command, ...commandArgs.map(shellQuote)].join(' ');
}

async function tmuxExecAsync(args: string[], options?: Parameters<typeof execFileAsync>[2]) {
  const mode = getTmuxConfigMode();
  await ensureTmuxContextPreparedAsync(mode);
  return execFileAsync('tmux', [...getTmuxContextArgsForMode(mode), ...args], options);
}

function tmuxExecSync(args: string[], options?: Parameters<typeof execFileSync>[2]) {
  const mode = getTmuxConfigMode();
  ensureTmuxContextPreparedSync(mode);
  return execFileSync('tmux', [...getTmuxContextArgsForMode(mode), ...args], options);
}

function buildNewSessionArgs(
  name: string,
  cwd: string,
  initialCommand?: string,
  options?: { env?: Record<string, string>; width?: number; height?: number }
): string[] {
  const width = options?.width ?? DEFAULT_TMUX_WINDOW_COLS;
  const height = options?.height ?? DEFAULT_TMUX_WINDOW_ROWS;
  const args = ['new-session', '-d', '-s', name, '-c', cwd, '-x', String(width), '-y', String(height)];
  if (options?.env) {
    for (const [key, value] of Object.entries(options.env)) {
      args.push('-e', `${key}=${value}`);
    }
  }
  if (initialCommand) {
    args.push(initialCommand);
  }

  return args;
}

/**
 * Log a sendKeys operation for debugging.
 */
function logSendKeys(sessionName: string, keys: string, caller?: string): void {
  try {
    ensureLogDir();

    const stack = new Error().stack || '';
    const stackLines = stack.split('\n').slice(3, 6);
    const callerInfo = caller || stackLines.map(l => l.trim()).join(' <- ');

    const entry = {
      timestamp: new Date().toISOString(),
      sessionName,
      keysLength: keys.length,
      caller: callerInfo,
      pid: process.pid,
      tmuxConfigMode: getTmuxConfigMode(),
    };

    appendFileSync(getSendKeysLogFile(), JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Silently fail - logging should never break functionality
  }
}

export interface TmuxSession {
  name: string;
  created: Date;
  attached: boolean;
  windows: number;
}

export function listSessionsSync(): TmuxSession[] {
  try {
    const output = tmuxExecSync(
      ['list-sessions', '-F', '#{session_name}|#{session_created}|#{session_attached}|#{session_windows}'],
      { encoding: 'utf8' }
    ) as string;

    return output.trim().split('\n').filter(Boolean).map(line => {
      const [name, created, attached, windows] = line.split('|');
      return {
        name,
        created: new Date(parseInt(created) * 1000),
        attached: attached === '1',
        windows: parseInt(windows),
      };
    });
  } catch {
    return [];
  }
}


export function listSessionNamesSync(): string[] {
  return listSessionsSync().map((session) => session.name);
}



/**
 * tmux target-session syntax: a bare name is matched as a *prefix* against
 * existing session names. That means `has-session -t agent-pan-977` returns
 * true when only `agent-pan-977-review` exists, `kill-session -t agent-pan-977`
 * kills `agent-pan-977-review`, and `capture-pane -t agent-pan-977` captures the
 * wrong pane. Prefixing the name with `=` forces an exact-name match. Every
 * call site that targets a *whole session by its exact name* must route through
 * this helper. (PAN-977 fallout: recoverAgent saw the lingering review session
 * as the work agent and silently no-op'd.)
 */
export function exactSession(name: string): string {
  return name.startsWith('=') ? name : `=${name}`;
}

/**
 * Exact-match target for *pane*-scoped commands (`capture-pane`, `list-panes`).
 *
 * The `=name` session-exact form that works for `has-session`/`kill-session`
 * is NOT a valid pane target — `capture-pane -t '=name'` fails outright with
 * "can't find pane". A pane target needs a window/pane component, so the
 * correct exact form is `=name:` (session named exactly <name>, active window,
 * active pane).
 *
 * Regression history: PAN-977's exact-match commit routed capture-pane and
 * list-panes through exactSession() (`=name`), which silently broke every
 * pane capture — calls started returning '' — taking down dialog dismissal,
 * waitForClaudeReady, paste verification, and health checks.
 */
export function exactPaneTarget(name: string): string {
  if (name.startsWith('=')) return name.endsWith(':') ? name : `${name}:`;
  return `=${name}:`;
}

export function sessionExistsSync(name: string): boolean {
  try {
    tmuxExecSync(['has-session', '-t', exactSession(name)], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}


/**
 * @deprecated Legacy sync function — blocks the event loop. Use `createSession` instead.
 * Kept for CLI-only callers. Never call from server-reachable code.
 */
export function createSessionSync(
  name: string,
  cwd: string,
  initialCommand?: string,
  options?: { env?: Record<string, string>; width?: number; height?: number }
): void {
  // PAN-1798: every spawn path must ensure the shared server lives in its
  // dedicated unit before creating a session, so no client becomes the founder.
  ensureOverdeckTmuxServerSync(buildChildEnvSync());
  if (initialCommand && (initialCommand.includes('`') || initialCommand.includes('\n') || initialCommand.length > 500)) {
    tmuxExecSync(buildNewSessionArgs(name, cwd, undefined, options));
    execSync('sleep 0.5');

    const tmpFile = join(tmpdir(), `pan-cmd-${name}.sh`);
    writeFileSync(tmpFile, initialCommand);
    chmodSync(tmpFile, '755');

    try {
      tmuxExecSync(['send-keys', '-t', name, `bash ${tmpFile}`]);
      tmuxExecSync(['send-keys', '-t', name, 'C-m']);
      execSync('sleep 2');
    } finally {
      try { unlinkSync(tmpFile); } catch {}
    }
    return;
  }

  tmuxExecSync(buildNewSessionArgs(name, cwd, initialCommand, options));
}


export function killSessionSync(name: string): void {
  // Exact-match target — a bare name prefix-matches and would kill e.g.
  // `agent-pan-977-review` when asked to kill `agent-pan-977`.
  tmuxExecSync(['kill-session', '-t', exactSession(name)]);
}


/**
 * Error raised when message delivery to a tmux session fails verification.
 */
export class MessageDeliveryFailed extends Error {
  constructor(
    message: string,
    public readonly sessionName: string,
    public readonly paneSnapshot: string,
  ) {
    super(message);
    this.name = 'MessageDeliveryFailed';
  }
}



/**
 * Send keys to a tmux session (sync, blocks event loop).
 * Only use from CLI commands — NEVER from the dashboard server.
 */
export function sendKeysSync(sessionName: string, keys: string, caller?: string): void {
  validateSessionName(sessionName);
  logSendKeys(sessionName, keys, caller);

  const sendId = randomUUID();
  const tmpFile = join(tmpdir(), `pan-sendkeys-${sendId}.txt`);
  const bufferName = `pan-${sendId}`;
  try {
    writeFileSync(tmpFile, keys);
    tmuxExecSync(['load-buffer', '-b', bufferName, tmpFile]);
    tmuxExecSync(['paste-buffer', '-b', bufferName, '-t', sessionName]);
    try { tmuxExecSync(['delete-buffer', '-b', bufferName], { stdio: 'ignore' }); } catch {}
    execSync('sleep 0.6');
    tmuxExecSync(['send-keys', '-t', sessionName, 'C-m']);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

export function capturePaneSync(sessionName: string, lines: number = 50): string {
  try {
    return tmuxExecSync(['capture-pane', '-t', exactPaneTarget(sessionName), '-p', '-S', `-${lines}`], {
      encoding: 'utf8',
    }) as string;
  } catch {
    return '';
  }
}

async function capturePaneText(
  sessionName: string,
  lines: number = 50,
  options?: { escapeSequences?: boolean }
): Promise<string> {
  try {
    const args = ['capture-pane', '-t', exactPaneTarget(sessionName), '-p'];
    if (options?.escapeSequences) {
      args.push('-e');
    }
    args.push('-S', `-${lines}`);
    const { stdout } = await tmuxExecAsync(args, { encoding: 'utf-8' });
    return String(stdout);
  } catch {
    return '';
  }
}

export function listPaneValuesSync(target: string, format: string): string[] {
  try {
    const output = tmuxExecSync(['list-panes', '-t', exactPaneTarget(target), '-F', format], { encoding: 'utf8' }) as string;
    return output.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function listPaneValuesText(target: string, format: string): Promise<string[]> {
  try {
    const { stdout } = await tmuxExecAsync(['list-panes', '-t', exactPaneTarget(target), '-F', format], { encoding: 'utf-8' });
    return String(stdout).split('\n').map((line: string) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Process names that mean a launcher session is a keep-alive *corpse*, not a
 * live harness. Launchers end with `while true; do sleep 60; done`
 * (src/lib/launcher-generator.ts), so after the harness process (Claude/Pi/…)
 * exits the tmux session stays alive running that loop — its process tree is
 * then only the hosting shell and `sleep`, never the harness, which surfaces
 * as `node`/`claude`/the runtime binary.
 */
const KEEPALIVE_FOREGROUND_COMMANDS = new Set(['sleep', 'bash', 'sh', 'dash', 'zsh', 'ash']);

/**
 * Pure tree walk behind isHarnessProcessAlive, exported for tests: true when
 * any process in the pane's tree (the pane pids themselves or any descendant)
 * is something other than a shell or `sleep`. `psTable` is `ps -eo
 * pid=,ppid=,comm=` output.
 */
export function paneTreeHasHarnessProcess(panePids: number[], psTable: string): boolean {
  const childrenByPpid = new Map<number, number[]>();
  const commByPid = new Map<number, string>();
  for (const line of psTable.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    commByPid.set(pid, match[3].trim());
    const siblings = childrenByPpid.get(ppid);
    if (siblings) siblings.push(pid);
    else childrenByPpid.set(ppid, [pid]);
  }
  const queue = [...panePids];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const pid = queue.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const comm = commByPid.get(pid);
    if (comm && !KEEPALIVE_FOREGROUND_COMMANDS.has(comm)) return true;
    const children = childrenByPpid.get(pid);
    if (children) queue.push(...children);
  }
  return false;
}

/**
 * Honest liveness signal for a launcher-managed session: true only when the
 * session exists AND a real harness process is running in it — not the post-exit
 * keep-alive loop. `sessionExists` alone cannot tell a live session from a
 * corpse because the keep-alive loop outlives the harness. PAN-1637/PAN-1638.
 *
 * The check must walk the pane's process TREE, not read
 * `#{pane_current_command}`: launcher scripts run the harness without job
 * control, so the pane's foreground process group stays the launcher shell and
 * tmux reports `bash` for a pane whose live tree is
 * bash → node (pty-supervisor) → claude. Trusting pane_current_command marked
 * every live supervisor-wrapped conversation as a corpse ~37s after spawn
 * (PAN-1769, conv 2701/2707 false-"ended").
 */
export async function isHarnessProcessAlive(sessionName: string): Promise<boolean> {
  const panePids = (await listPaneValuesText(sessionName, '#{pane_pid}'))
    .map((value) => Number.parseInt(value, 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
  if (panePids.length === 0) return false;
  let psTable: string;
  try {
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf-8' });
    psTable = String(stdout);
  } catch {
    // Can't inspect the process table — report alive so a probe hiccup never
    // corpse-marks (and auto-ends) a live session.
    return true;
  }
  return paneTreeHasHarnessProcess(panePids, psTable);
}


/**
 * Categorizes an API failure surfaced inside an interactive Claude Code pane.
 *
 * "Terminal" here means the upstream provider returned an error that won't be
 * fixed by waiting or retrying the same request — quota exhausted, auth/login
 * required, permission denied. The CLI prints the error and returns to the
 * input prompt, which means session-alive and pane-alive checks both pass:
 * callers polling for completion will sit idle until their timeout fires.
 * Detecting these in pane content is the only reliable signal.
 *
 * Distinct from the transient family the deacon already handles
 * (Overloaded / Rate limit / 5xx / Timed out), which are nudge-to-retry.
 */
export type TerminalApiErrorKind =
  | 'quota_exhausted'
  | 'auth_failed'
  | 'permission_denied'
  | 'login_required';

export interface TerminalApiError {
  kind: TerminalApiErrorKind;
  /** Short, user-facing summary suitable for review_notes / dashboard text. */
  summary: string;
  /** First matching line from the pane, for diagnostics. */
  raw: string;
}

const TERMINAL_API_ERROR_PATTERNS: Array<{
  re: RegExp;
  kind: TerminalApiErrorKind;
  summary: string;
}> = [
  // Order matters: more specific quota/usage messages first so we surface the
  // most actionable summary even when both a 403 and a quota line are present.
  { re: /usage limit for this billing cycle/i, kind: 'quota_exhausted', summary: 'Provider quota exhausted (billing cycle limit reached)' },
  { re: /reached your usage limit/i,           kind: 'quota_exhausted', summary: 'Provider quota exhausted (usage limit reached)' },
  { re: /(?:^|[^a-z])quota[^a-z].{0,40}(?:exceeded|exhausted|reached)/i, kind: 'quota_exhausted', summary: 'Provider quota exhausted' },
  { re: /You've hit your limit/i,              kind: 'quota_exhausted', summary: 'Provider usage limit reached' },
  { re: /credit balance is too low/i,          kind: 'quota_exhausted', summary: 'Provider credit balance too low' },
  { re: /Please run \/login/i,                 kind: 'login_required',  summary: 'Provider login required' },
  { re: /authentication_error/i,               kind: 'auth_failed',     summary: 'Provider authentication failed' },
  { re: /API Error:\s*401\b/i,                 kind: 'auth_failed',     summary: 'Provider rejected request (401 unauthorized)' },
  { re: /permission_error/i,                   kind: 'permission_denied', summary: 'Provider returned permission_error' },
  { re: /API Error:\s*403\b/i,                 kind: 'permission_denied', summary: 'Provider rejected request (403 forbidden)' },
];

/**
 * Scan a captured tmux pane for terminal upstream-API failures.
 * Returns the first match, or null if none. Safe to call frequently — pure
 * regex, no I/O.
 *
 * Why we collapse whitespace: real tmux captures wrap long error messages at
 * the pane width, so a phrase like "usage limit for this billing cycle" can
 * land across two or three lines. Matching against the raw capture would miss
 * those. We normalize a copy to a single-spaced string for matching, then
 * preserve the original for the `raw` diagnostics field.
 */
export function detectTerminalApiErrorSync(paneOutput: string): TerminalApiError | null {
  if (!paneOutput) return null;
  const normalized = paneOutput.replace(/\s+/g, ' ');
  for (const entry of TERMINAL_API_ERROR_PATTERNS) {
    const match = normalized.match(entry.re);
    if (match) {
      // For raw, find the original line that contained the start of the
      // match. Approximate: match.index in normalized doesn't map 1:1 to
      // paneOutput, so just grab the first 240 chars around any line in
      // paneOutput that contains the matched substring.
      const matchedText = match[0];
      const rawIdx = paneOutput.indexOf(matchedText.split(' ')[0] ?? matchedText);
      const lineStart = rawIdx >= 0 ? paneOutput.lastIndexOf('\n', rawIdx) + 1 : 0;
      const lineEnd = rawIdx >= 0 ? paneOutput.indexOf('\n', rawIdx) : -1;
      const raw = paneOutput.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim().slice(0, 240);
      return { kind: entry.kind, summary: entry.summary, raw };
    }
  }
  return null;
}

// waitForClaudePromptPromise / waitForClaudePrompt removed in PAN-1596.
// Readiness is hook-driven now: ready.json (waitForReadySignal) for post-launch
// readiness and the runtime mirror 'idle' (waitForAgentIdle) for live idleness,
// both in agents.ts. The old `❯` pane-scrape was non-deterministic and is no
// longer used by any caller.

/**
 * Verify that a message sent to Claude was actually received and processing started.
 * Compares tmux output before and after to detect new activity.
 */
export async function confirmDelivery(
  sessionName: string,
  outputBefore: string,
  timeoutMs: number = 10000,
): Promise<boolean> {
  const start = Date.now();
  const poll = 1000;
  const beforeText = outputBefore.trimEnd();
  const processingPatterns = [
    '●',
    '⎿',
    'Read',
    '✻',
    '✶',
    '✽',
    '✢',
    'Generating',
    'thinking',
    'thought for',
    'Retrying in',
    'API Error',
    "You've hit your limit",
    'Tool use',
  ];

  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, poll));
    const after = await Effect.runPromise(capturePane(sessionName, 50));
    const afterText = after.trimEnd();
    if (afterText === beforeText) continue;

    const newOutput = afterText.startsWith(beforeText)
      ? afterText.slice(beforeText.length)
      : afterText;

    if (processingPatterns.some(pattern => newOutput.includes(pattern))) {
      return true;
    }
  }
  return false;
}

export function getAgentSessionsSync(): TmuxSession[] {
  return listSessionsSync().filter(s => s.name.startsWith('agent-'));
}


// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

const toTmuxError = (op: string, cause: unknown): TmuxError =>
  new TmuxError({
    command: op,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

/** Prepare the managed tmux config + server (idempotent). */
export const ensureManagedTmuxContextOnce = (): Effect.Effect<void, TmuxError> =>
  Effect.tryPromise({
    try: () => ensureManagedTmuxContextOncePromise(),
    catch: (cause) => toTmuxError('ensureManagedTmuxContext', cause),
  });

export const listSessions = (): Effect.Effect<readonly TmuxSession[], TmuxError> =>
  Effect.tryPromise({
    try: async () => {
      try {
        const { stdout } = await tmuxExecAsync(
          ['list-sessions', '-F', '#{session_name}|#{session_created}|#{session_attached}|#{session_windows}'],
          { encoding: 'utf8' },
        );
        return String(stdout).trim().split('\n').filter(Boolean).map((line: string) => {
          const [name, created, attached, windows] = line.split('|');
          return {
            name,
            created: new Date(parseInt(created) * 1000),
            attached: attached === '1',
            windows: parseInt(windows),
          };
        });
      } catch {
        return [];
      }
    },
    catch: (cause) => toTmuxError('list-sessions', cause),
  });

export const listSessionNames = (): Effect.Effect<readonly string[], TmuxError> =>
  Effect.tryPromise({
    try: async () => {
      try {
        const { stdout } = await tmuxExecAsync(['list-sessions', '-F', '#{session_name}'], { encoding: 'utf-8' });
        return String(stdout).split('\n').map((line: string) => line.trim()).filter(Boolean);
      } catch {
        return [];
      }
    },
    catch: (cause) => toTmuxError('list-session-names', cause),
  });

export const getWindowDimensions = (
  sessionName: string,
): Effect.Effect<{ cols: number; rows: number } | null, TmuxError> =>
  Effect.tryPromise({
    try: async () => {
      try {
        const { stdout } = await tmuxExecAsync(
          ['display-message', '-p', '-t', sessionName, '#{window_width},#{window_height}'],
          { encoding: 'utf-8' },
        );
        const parts = String(stdout).trim().split(',');
        if (parts.length !== 2) return null;
        const cols = parseInt(parts[0]!, 10);
        const rows = parseInt(parts[1]!, 10);
        if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) return null;
        return { cols, rows };
      } catch {
        return null;
      }
    },
    catch: (cause) => toTmuxError('window-dimensions', cause),
  });

export const sessionExists = (
  name: string,
): Effect.Effect<boolean, TmuxError> =>
  Effect.tryPromise({
    try: async () => {
      try {
        await tmuxExecAsync(['has-session', '-t', exactSession(name)], { encoding: 'utf-8' });
        return true;
      } catch {
        return false;
      }
    },
    catch: (cause) => toTmuxError('session-exists', cause),
  });

export const createSession = (
  name: string,
  cwd: string,
  initialCommand?: string,
  options?: { env?: Record<string, string>; width?: number; height?: number },
): Effect.Effect<void, TmuxError> =>
  Effect.tryPromise({
    try: async () => {
      // PAN-1798: every spawn path must ensure the shared server lives in its
      // dedicated unit before creating a session, so no client becomes the founder.
      await ensureOverdeckTmuxServerAsync(buildChildEnvSync());
      await tmuxExecAsync(buildNewSessionArgs(name, cwd, initialCommand, options), { encoding: 'utf-8' });
      // Stamp the initial window's background with the dashboard theme so tmux
      // answers OSC 11 background queries even with no client attached. Claude
      // Code's `theme: auto` queries once at startup; without this, headless
      // agents get no answer and fall back to dark regardless of the
      // dashboard theme (conv 2547).
      try {
        const theme = await getUiTheme();
        // window-style is a window option: the trailing ':' targets the
        // session's (only) window — a bare '=name' fails with "no such window".
        await tmuxExecAsync(
          ['set-option', '-t', `${exactSession(name)}:`, 'window-style', `bg=${TERMINAL_BG[theme]}`],
          { encoding: 'utf-8' },
        );
      } catch {
        // Best-effort: a failed theme stamp must not fail session creation.
      }
    },
    catch: (cause) => toTmuxError('create-session', cause),
  });

export const killSession = (name: string): Effect.Effect<void, TmuxError> =>
  Effect.tryPromise({
    try: () => tmuxExecAsync(['kill-session', '-t', exactSession(name)], { encoding: 'utf-8' }).then(() => undefined),
    catch: (cause) => toTmuxError('kill-session', cause),
  });

export const setOption = (
  target: string,
  option: string,
  value: string,
): Effect.Effect<void, TmuxError> =>
  Effect.tryPromise({
    try: () => tmuxExecAsync(['set-option', '-t', target, option, value], { encoding: 'utf-8' }).then(() => undefined),
    catch: (cause) => toTmuxError('set-option', cause),
  });

export const resizeWindow = (
  target: string,
  cols: number,
  rows: number,
): Effect.Effect<void, TmuxError> =>
  Effect.tryPromise({
    try: () => tmuxExecAsync(['resize-window', '-t', target, '-x', String(cols), '-y', String(rows)], { encoding: 'utf-8' }).then(() => undefined),
    catch: (cause) => toTmuxError('resize-window', cause),
  });

export const sendRawKeystroke = (
  sessionName: string,
  key: string,
  caller?: string,
): Effect.Effect<void, TmuxError> =>
  Effect.tryPromise({
    try: async () => {
      validateSessionName(sessionName);
      logSendKeys(sessionName, key, caller ?? 'raw-keystroke');
      await tmuxExecAsync(['send-keys', '-t', sessionName, key], { encoding: 'utf-8' });
    },
    catch: (cause) => toTmuxError('send-raw-key', cause),
  });

export async function sendEscapeKeyAsync(sessionName: string, times = 1): Promise<void> {
  validateSessionName(sessionName);
  const target = exactPaneTarget(sessionName);
  for (let i = 0; i < times; i += 1) {
    logSendKeys(sessionName, 'Escape', 'escape-key');
    await tmuxExecAsync(['send-keys', '-t', target, 'Escape'], { encoding: 'utf-8' });
    if (i < times - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

export const sendKeys = (
  sessionName: string,
  keys: string,
  caller?: string,
): Effect.Effect<void, TmuxError | MessageDeliveryFailed> =>
  Effect.tryPromise({
    try: async () => {
      validateSessionName(sessionName);
      logSendKeys(sessionName, keys, caller);

      const sendId = randomUUID();
      const tmpFile = join(tmpdir(), `pan-sendkeys-${sendId}.txt`);
      const bufferName = `pan-${sendId}`;

      try {
        await writeFile(tmpFile, keys, 'utf-8');
        await tmuxExecAsync(['load-buffer', '-b', bufferName, tmpFile], { encoding: 'utf-8' });
        await tmuxExecAsync(['paste-buffer', '-b', bufferName, '-p', '-t', sessionName], { encoding: 'utf-8' });

        const lines = keys.split('\n');
        const verifyLine = ([...lines].reverse().find(l => l.trim().length >= 3) ?? lines[lines.length - 1])?.trim() ?? '';
        // 1.5s per attempt × 2 attempts = 3s worst case. The previous 8s × 2 = 16s
        // caused user-visible "Enter not sent" lag whenever the 10-line tail check
        // missed the verify line (e.g. tall Claude input box or wrapped paste).
        const VERIFY_TIMEOUT_MS = 1_500;
        const VERIFY_INTERVAL_MS = 50;
        const PASTE_MAX_ATTEMPTS = 2;
        let pasteVerified = false;

        if (verifyLine.length >= 3) {
          attemptLoop: for (let attempt = 1; attempt <= PASTE_MAX_ATTEMPTS; attempt++) {
            const verifyStart = Date.now();
            const deadline = verifyStart + VERIFY_TIMEOUT_MS;
            while (Date.now() < deadline) {
              const pane = await capturePaneText(sessionName, 10);
              if (pane.includes(verifyLine.slice(0, 40))) {
                pasteVerified = true;
                const elapsed = Date.now() - verifyStart;
                const minDelay = 600;
                if (elapsed < minDelay) {
                  await new Promise(r => setTimeout(r, minDelay - elapsed));
                }
                break attemptLoop;
              }
              await new Promise(r => setTimeout(r, VERIFY_INTERVAL_MS));
            }

            // Wide-window fallback on every attempt (including the last) so we
            // catch pastes that landed off-screen of the 10-line tail before
            // giving up and stranding Enter.
            const wideCheck = await capturePaneText(sessionName, 200);
            if (wideCheck.includes(verifyLine.slice(0, 40))) {
              pasteVerified = true;
              break attemptLoop;
            }

            if (attempt < PASTE_MAX_ATTEMPTS) {
              console.warn(`[tmux] Paste not visible on ${sessionName} after ${VERIFY_TIMEOUT_MS}ms (attempt ${attempt}/${PASTE_MAX_ATTEMPTS}) — re-pasting buffer.`);
              await tmuxExecAsync(['paste-buffer', '-b', bufferName, '-p', '-t', sessionName], { encoding: 'utf-8' });
            }
          }
        } else {
          const delayMs = Math.max(600, Math.min(3000, keys.split('\n').length * 15 + Math.floor(keys.length / 1000) * 50));
          await new Promise(r => setTimeout(r, delayMs));
          pasteVerified = true;
        }

        await tmuxExecAsync(['delete-buffer', '-b', bufferName], { encoding: 'utf-8' }).catch(() => {});

        if (!pasteVerified) {
          const snapshot = await capturePaneText(sessionName, 30);
          console.warn(`[tmux] Paste verification failed for ${sessionName} after ${PASTE_MAX_ATTEMPTS} attempts × ${VERIFY_TIMEOUT_MS}ms. Sending Enter anyway to avoid orphaned input. Snapshot:\n${snapshot.slice(0, 500)}`);
        }

        await tmuxExecAsync(['send-keys', '-t', sessionName, 'C-m'], { encoding: 'utf-8' });
        logSendKeys(sessionName, pasteVerified ? '[Enter sent]' : '[Enter sent (unverified paste)]', caller);

        if (verifyLine.length >= 3) {
          const SUBMIT_TIMEOUT_MS = 2_000;
          const submitDeadline = Date.now() + SUBMIT_TIMEOUT_MS;
          let stillPendingSubmit = true;
          while (Date.now() < submitDeadline) {
            const pane = await capturePaneText(sessionName, 5);
            if (!pane.includes(verifyLine.slice(0, 40))) {
              stillPendingSubmit = false;
              break;
            }
            await new Promise(r => setTimeout(r, VERIFY_INTERVAL_MS));
          }
          if (stillPendingSubmit) {
            console.warn(`[tmux] Submitted text still visible on ${sessionName} after ${SUBMIT_TIMEOUT_MS}ms; sending Enter once more.`);
            await tmuxExecAsync(['send-keys', '-t', sessionName, 'C-m'], { encoding: 'utf-8' });
            logSendKeys(sessionName, '[Enter resent after submit verification timeout]', caller);
          }
        }
      } finally {
        await unlink(tmpFile).catch(() => {});
      }
    },
    catch: (cause) => cause instanceof MessageDeliveryFailed ? cause : toTmuxError('send-keys', cause),
  });

export const capturePane = (
  sessionName: string,
  lines: number = 50,
  options?: { escapeSequences?: boolean },
): Effect.Effect<string, TmuxError> =>
  Effect.tryPromise({
    try: () => capturePaneText(sessionName, lines, options),
    catch: (cause) => toTmuxError('capture-pane', cause),
  });

export const listPaneValues = (
  target: string,
  format: string,
): Effect.Effect<readonly string[], TmuxError> =>
  Effect.tryPromise({
    try: () => listPaneValuesText(target, format),
    catch: (cause) => toTmuxError('list-pane-values', cause),
  });

export const isPaneDead = (
  sessionName: string,
): Effect.Effect<boolean, TmuxError> =>
  Effect.gen(function* () {
    const values = yield* listPaneValues(sessionName, '#{pane_dead}');
    return values.some(v => v === '1');
  }).pipe(Effect.catch(() => Effect.succeed(false)));

export const detectTerminalApiError = (
  paneOutput: string,
): Effect.Effect<TerminalApiError | null> =>
  Effect.sync(() => detectTerminalApiErrorSync(paneOutput));

export const getAgentSessions = (): Effect.Effect<readonly TmuxSession[], TmuxError> =>
  listSessions().pipe(
    Effect.map((sessions) => sessions.filter(s => s.name.startsWith('agent-'))),
  );

export const getReviewSessions = (): Effect.Effect<readonly TmuxSession[], TmuxError> =>
  listSessions().pipe(
    Effect.map((sessions) => sessions.filter(s => /^review-/.test(s.name))),
  );
