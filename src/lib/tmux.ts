/**
 * Sync twins (PAN-3958). Each `…Sync` function below has an async twin and exists only because
 * these callers run in synchronous contexts (sync functions, sync callbacks, or dependency slots typed
 * as sync) and cannot await:
 * - `capturePaneSync` (async: `capturePane`): src/lib/agents/termination.ts:170.
 * - `getAgentSessionsSync` (async: `getAgentSessions`): src/cli/commands/doctor.ts:511.
 * - `killSessionSync` (async: `killSession`): src/lib/agents/termination.ts:180,
 *   src/lib/runtimes/claude-code.ts:332.
 * - `listPaneValuesSync` (async: `listPaneValues`): src/lib/agents/liveness.ts:161,326.
 * - `listSessionNamesSync` (async: `listSessionNames`): 9 sites in cli/commands/doctor.ts, cli/commands/pause.ts,
 *   cli/commands/swarm-status.ts, cli/commands/swarm.ts.
 * - `listSessionsSync` (async: `listSessions`): src/cli/commands/resources.ts:153, src/lib/agents/queries.ts:36,
 *   src/lib/hygiene.ts:51, src/lib/runtimes/ohmypi.ts:210, src/lib/tmux.ts:628,815.
 * - `sessionExistsSync` (async: `sessionExists`): 7 sites in cli/commands/answer.ts, lib/agents/liveness.ts,
 *   lib/agents/termination.ts, lib/runtimes/claude-code.ts.
 * Each of these blocks on a child process: never call one from src/dashboard/** or src/lib/cloister/** (FR-8).
 * Long lists name files under src/; `node scripts/audit-effect-boundary.mjs --json --usage` has the lines.
 * Do not add new synchronous callers; server-reachable code uses the async variants.
 */

import { execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir, tmpdir } from 'os';
import { createHash, randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { getCanonicalOverdeckHome, getOverdeckHome } from './paths.js';
import { DEFAULT_INSTANCE_NAME, managedInstanceName } from './instance-name.js';
import { loadConfigSync, type TmuxConfigMode } from './config-yaml.js';
import { buildChildEnv } from './child-env.js';
import { MessageDeliveryFailed, TmuxError } from './errors.js';

export { MessageDeliveryFailed } from './errors.js';
import { getUiTheme, TERMINAL_BG } from './ui-theme.js';
import { paneTreeHasHarnessProcess } from './tmux-process-tree.js';
import { paneHasBlockingChoiceMenu } from './pane-choice-menu.js';
import { deliveryVerifyLine, type PaneViewport } from './pane-composer.js';

export { paneTreeHasHarnessProcess } from './tmux-process-tree.js';
export { deliveryVerifyLine } from './pane-composer.js';
export type { PaneViewport } from './pane-composer.js';

const execFileAsync = promisify(execFile);

const VALID_SESSION_NAME_RE = /^[a-zA-Z0-9._-]+$/;
const DEFAULT_TMUX_WINDOW_COLS = 200;
const DEFAULT_TMUX_WINDOW_ROWS = 50;

export function validateSessionName(name: string): void {
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

const DEFAULT_MANAGED_TMUX_SOCKET = DEFAULT_INSTANCE_NAME;

/**
 * PAN-3673: a process whose OVERDECK_HOME is not the default home is a separate
 * Overdeck instance (an isolated verification dashboard, a scratch home). If it
 * drives the shared 'overdeck' socket, its PAN-1798 sanitizer pins race the real
 * stack's pins in the server global env, and whichever pinned last at the instant
 * of `new-session` wins — real sessions then capture the wrong OVERDECK_HOME
 * (PAN-3668 incident, 2026-08-13: the review orchestrator's app-server wrote its
 * socket under a /tmp home and the readiness check never saw it). Derive a
 * deterministic per-home socket instead so a non-default stack can never touch
 * the shared server. An explicit OVERDECK_TMUX_SOCKET_NAME still wins (per-test
 * isolation, PAN-1808).
 */
export function getManagedTmuxSocketName(): string {
  if (process.env.OVERDECK_TMUX_SOCKET_NAME) return process.env.OVERDECK_TMUX_SOCKET_NAME;
  return managedInstanceName();
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
export function findManagedServerPid(): number | undefined {
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
  const pid = findManagedServerPid();
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
  const pid = findManagedServerPid();
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
 * Since `ensureOverdeckTmuxServer*` runs before every `new-session`, always pin
 * canonical HOME/OVERDECK_HOME on the shared socket. Isolated sockets instead get
 * the caller's resolved values. Non-destructive: existing sessions keep their
 * captured env; only future sessions change.
 */
/** @internal Exported only for focused sanitizer tests. */
export function sanitizeManagedServerGlobalEnv(cleanEnv: NodeJS.ProcessEnv): void {
  const sock = getManagedTmuxSocketName();
  const canonicalOverdeckHome = getCanonicalOverdeckHome();
  const sharedSocket = sock === DEFAULT_MANAGED_TMUX_SOCKET;
  const callerOverdeckHome = getOverdeckHome();
  const pinnedEnv = sharedSocket
    ? { HOME: homedir(), OVERDECK_HOME: canonicalOverdeckHome }
    : { HOME: cleanEnv.HOME ?? homedir(), OVERDECK_HOME: callerOverdeckHome };

  if (sharedSocket && resolve(callerOverdeckHome) !== resolve(canonicalOverdeckHome)) {
    console.warn(
      `[tmux] WARNING (PAN-3671): refusing to pin non-canonical OVERDECK_HOME ` +
        `'${callerOverdeckHome}' on shared socket '${sock}'. Set ` +
        `OVERDECK_TMUX_SOCKET_NAME to isolate this Overdeck instance.`,
    );
  }

  // Pin the vars that, if wrong, break agent auth / overdeck-home resolution.
  for (const key of ['HOME', 'OVERDECK_HOME'] as const) {
    const value = pinnedEnv[key];
    try {
      execFileSync('tmux', ['-L', sock, 'set-environment', '-g', key, value], { stdio: 'ignore' });
    } catch {
      // tmux momentarily unavailable; the next createSession preflight retries.
    }
  }
  // Strip test-only pollution that must never reach a real session.
  for (const key of ['OVERDECK_FRONTEND_DIR', 'OVERDECK_TEST_HOME_ROOT', 'OVERDECK_TEST_REAL_HOME', 'OVERDECK_TEST_POLL_MS']) {
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
    sanitizeManagedServerGlobalEnv(cleanEnv);
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
  // PAN-3673: only the default socket may use the dedicated systemd unit — a
  // derived (per-home) socket must never take over 'overdeck-tmux-server'.
  const useManagedUnit = getManagedTmuxSocketName() === DEFAULT_MANAGED_TMUX_SOCKET;
  const startedBySystemd = !useManagedUnit ? false : (() => {
    try {
      // start-server daemonizes, so the unit must be Type=forking: under the
      // default Type=simple the founding client's exit deactivates the unit and
      // the cgroup kill murders the forked server (PAN-1798, 5 dead foundings/boot).
      execFileSync(
        'systemd-run',
        [
          '--user', '--unit', MANAGED_TMUX_SERVER_UNIT, '--collect', '--quiet', '--service-type=forking',
          // PAN-2500 kernel-oom-net: deprioritize the tmux server for systemd-oomd
          // so a memory-governor miss degrades gracefully instead of wiping every
          // agent process at once (#2390).
          '--property=ManagedOOMPreference=avoid',
          // 2026-08-04 kernel OOM: a 41GB agent-spawned python was OOM-killed and
          // systemd's default OOMPolicy=stop then FAILED the whole unit — the tmux
          // server and every agent/conversation session died with it. continue =
          // the guilty child dies, the server and every other session survive.
          '--property=OOMPolicy=continue',
          'tmux', ...args,
        ],
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
    // Derived sockets (PAN-3673) never attempt the unit, so don't warn as if it failed.
    if (useManagedUnit) {
      console.warn(
        `[tmux] WARNING (PAN-1798): could not start '${MANAGED_TMUX_SERVER_UNIT}' via systemd-run. ` +
          `Shared tmux server is running without systemd scope isolation; ` +
          `killing the founding process tree may still destroy the server.`,
      );
    }
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
    const cleanEnv = buildChildEnv();
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
    const cleanEnv = buildChildEnv();
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
 * buildTmuxArgs(...))`) MUST have run a tmux command through the helpers below
 * earlier in the process lifetime: `tmuxExecAsync` / `tmuxExecSync` call
 * `ensureTmuxContextPrepared*` themselves (cheap after the first call), which
 * prepares the managed context on first use. There is no boot-time hook (see
 * the PAN-3958 note in the dashboard's main.ts).
 */
function getTmuxBaseArgs(): string[] {
  return getTmuxContextArgsForMode(getTmuxConfigMode());
}

export function buildTmuxArgs(args: string[]): string[] {
  return [...getTmuxBaseArgs(), ...args];
}

export function getTmuxCommand(args: string[]): { command: string; args: string[] } {
  return { command: 'tmux', args: buildTmuxArgs(args) };
}

export async function tmuxExecAsync(args: string[], options?: Parameters<typeof execFileAsync>[2]) {
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
  // PAN-3673: pin HOME/OVERDECK_HOME on the session itself. The PAN-1798 global-env
  // sanitizer runs as a separate tmux call before new-session, so a second stack
  // sharing the socket can re-poison the global env in between and win. `-e` flags
  // are applied atomically at session creation and override the global env, so the
  // pane always lands this process's resolved home. Caller-provided env still wins.
  const env: Record<string, string> = {
    HOME: process.env.HOME ?? homedir(),
    OVERDECK_HOME: getOverdeckHome(),
    ...options?.env,
  };
  for (const [key, value] of Object.entries(env)) {
    args.push('-e', `${key}=${value}`);
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

export interface TmuxPaneRecord {
  sessionName: string;
  panePid: number;
  paneDead: boolean;
  paneDeadStatus: number | null;
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

export type SessionQueryResult =
  | { status: 'exists' }
  | { status: 'missing'; detail: string }
  | { status: 'error'; detail: string };

/** Classify a failed `has-session`; the exit code is `status` (execFileSync) or a numeric `code` (promisified execFile). */
export function sessionQueryFailure(cause: unknown): Exclude<SessionQueryResult, { status: 'exists' }> {
  const error = cause as Omit<NodeJS.ErrnoException, 'code'> & { code?: string | number; stderr?: string | Buffer; status?: number };
  const exitCode = typeof error.status === 'number' ? error.status : typeof error.code === 'number' ? error.code : undefined;
  const stderr = String(error.stderr ?? '').trim();
  const detail = [
    `exit=${exitCode ?? 'unknown'}`,
    typeof error.code === 'string' ? `code=${error.code}` : '',
    stderr ? `stderr=${stderr}` : '',
    error.message ? `message=${error.message}` : '',
  ].filter(Boolean).join(' ');
  return exitCode === 1 && /can't find session:/i.test(stderr)
    ? { status: 'missing', detail }
    : { status: 'error', detail };
}

export function querySession(name: string): SessionQueryResult {
  try {
    // Explicit stdio — without it execFileSync echoes the routine "can't find session" stderr of dead-session probes into the server log.
    tmuxExecSync(['has-session', '-t', exactSession(name)], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 'exists' };
  } catch (cause) {
    return sessionQueryFailure(cause);
  }
}

export function sessionExistsSync(name: string): boolean {
  return querySession(name).status === 'exists';
}

export function killSessionSync(name: string): void {
  // Exact-match target — a bare name prefix-matches and would kill e.g.
  // `agent-pan-977-review` when asked to kill `agent-pan-977`.
  // Explicit stdio — killing a maybe-dead session is routine; see querySessionSync.
  tmuxExecSync(['kill-session', '-t', exactSession(name)], { stdio: ['ignore', 'pipe', 'pipe'] });
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

/** Capture the last `lines` lines of a pane; empty string on any tmux failure. */
export async function capturePane(
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

/**
 * Capture the visible pane plus its cursor row as a PaneViewport for
 * cursor-anchored composer detection (pane-composer.ts). Returns null when
 * the pane or cursor position is unreadable.
 */
export async function capturePaneViewport(sessionName: string): Promise<PaneViewport | null> {
  try {
    const target = exactPaneTarget(sessionName);
    const [pane, cursor] = await Promise.all([
      tmuxExecAsync(['capture-pane', '-t', target, '-p'], { encoding: 'utf-8' }),
      tmuxExecAsync(['display-message', '-p', '-t', target, '#{cursor_y}'], { encoding: 'utf-8' }),
    ]);
    const cursorY = Number.parseInt(String(cursor.stdout).trim(), 10);
    if (!Number.isInteger(cursorY)) return null;
    return { text: String(pane.stdout), cursorY };
  } catch {
    return null;
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

/** List one `#{format}` value per pane of a target; empty on any tmux failure. */
export async function listPaneValues(target: string, format: string): Promise<string[]> {
  try {
    const { stdout } = await tmuxExecAsync(['list-panes', '-t', exactPaneTarget(target), '-F', format], { encoding: 'utf-8' });
    return String(stdout).split('\n').map((line: string) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
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
  const panePids = (await listPaneValues(sessionName, '#{pane_pid}'))
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


// waitForClaudePromptPromise / waitForClaudePrompt removed in PAN-1596.
// Readiness is hook-driven now: ready.json (waitForReadySignal) for post-launch
// readiness and the runtime mirror 'idle' (waitForAgentIdle) for live idleness,
// both in agents.ts. The old `❯` pane-scrape was non-deterministic and is no
// longer used by any caller.

export function getAgentSessionsSync(): TmuxSession[] {
  return listSessionsSync().filter(s => s.name.startsWith('agent-'));
}


// ─── Effect API ───────────────────────────────────────────────────────────────

const toTmuxError = (op: string, cause: unknown): TmuxError =>
  new TmuxError({
    command: op,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
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

export function parseTmuxPaneRecords(output: string): TmuxPaneRecord[] {
  return output.split('\n').flatMap((line) => {
    if (!line) return [];
    const [sessionName = '', panePidRaw = '', paneDeadRaw = '', paneDeadStatusRaw = ''] = line.split('\t');
    const panePid = Number.parseInt(panePidRaw, 10);
    if (!sessionName || !Number.isInteger(panePid) || panePid <= 0) return [];
    const paneDeadStatus = Number.parseInt(paneDeadStatusRaw, 10);
    return [{
      sessionName,
      panePid,
      paneDead: paneDeadRaw === '1',
      paneDeadStatus: Number.isInteger(paneDeadStatus) ? paneDeadStatus : null,
    }];
  });
}

export const listAllPaneRecords = (): Effect.Effect<readonly TmuxPaneRecord[], TmuxError> =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await tmuxExecAsync([
        'list-panes',
        '-a',
        '-F',
        '#{session_name}\t#{pane_pid}\t#{pane_dead}\t#{pane_dead_status}',
      ], { encoding: 'utf-8' });
      return parseTmuxPaneRecords(String(stdout));
    },
    catch: (cause) => toTmuxError('list-all-pane-records', cause),
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
      await ensureOverdeckTmuxServerAsync(buildChildEnv());
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

export async function sendKeysAsync(
  sessionName: string,
  key: string,
  caller?: string,
): Promise<void> {
  validateSessionName(sessionName);
  const target = exactPaneTarget(sessionName);
  logSendKeys(sessionName, key, caller ?? 'send-keys-async');
  await tmuxExecAsync(['send-keys', '-t', target, key], { encoding: 'utf-8' });
}

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

        const verifyLine = deliveryVerifyLine(keys);
        // PAN-3261: sample the choice-menu detector BEFORE our own paste lands.
        // paneHasBlockingChoiceMenu() only recognises a menu that is still the
        // bottom-of-pane surface, and pasted text renders below it — so every
        // snapshot taken after we paste can report a live gate as absent, and
        // the fail-open Enter further down then answers it. This pre-paste
        // observation is the only uncontaminated one the tier gets. Skipped for
        // short key sequences, which never reach that guard.
        const menuBeforePaste = verifyLine.length >= 3
          && paneHasBlockingChoiceMenu(await capturePane(sessionName, 90).catch(() => ''));

        await tmuxExecAsync(['paste-buffer', '-b', bufferName, '-p', '-t', sessionName], { encoding: 'utf-8' });
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
              const pane = await capturePane(sessionName, 10);
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
            const wideCheck = await capturePane(sessionName, 200);
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
          const snapshot = await capturePane(sessionName, 90);
          // A blocking menu swallowed the paste, and Enter would confirm ITS
          // highlighted row — at the resume gate, "Resume from summary" over
          // the operator's "as-is" (PAN-3212). Never answer a menu we did not
          // open; see the delivery-cascade section in CLAUDE.md. The pre-paste
          // observation carries the verdict whenever our own paste has since
          // pushed the menu off the bottom of the pane (PAN-3261).
          if (menuBeforePaste || paneHasBlockingChoiceMenu(snapshot)) {
            throw new MessageDeliveryFailed(
              `Delivery to ${sessionName} aborted: the pane is blocked on a choice menu, so the paste never reached the composer and Enter would answer that menu`,
              sessionName,
              snapshot,
            );
          }
          console.warn(`[tmux] Paste verification failed for ${sessionName} after ${PASTE_MAX_ATTEMPTS} attempts × ${VERIFY_TIMEOUT_MS}ms. Sending Enter anyway to avoid orphaned input. Snapshot:\n${snapshot.slice(0, 500)}`);
        }

        await tmuxExecAsync(['send-keys', '-t', sessionName, 'C-m'], { encoding: 'utf-8' });
        logSendKeys(sessionName, pasteVerified ? '[Enter sent]' : '[Enter sent (unverified paste)]', caller);

        if (verifyLine.length >= 3) {
          const SUBMIT_TIMEOUT_MS = 2_000;
          const submitDeadline = Date.now() + SUBMIT_TIMEOUT_MS;
          let stillPendingSubmit = true;
          while (Date.now() < submitDeadline) {
            const pane = await capturePane(sessionName, 5);
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

export const isPaneDead = (
  sessionName: string,
): Effect.Effect<boolean, TmuxError> =>
  Effect.gen(function* () {
    const values = yield* Effect.promise(() => listPaneValues(sessionName, '#{pane_dead}'));
    return values.some(v => v === '1');
  }).pipe(Effect.catch(() => Effect.succeed(false)));

export const getAgentSessions = (): Effect.Effect<readonly TmuxSession[], TmuxError> =>
  listSessions().pipe(
    Effect.map((sessions) => sessions.filter(s => s.name.startsWith('agent-'))),
  );
