import { execSync, execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, chmodSync, appendFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'node:crypto';
import { getPanopticonHome } from './paths.js';
import { loadConfig, type TmuxConfigMode } from './config-yaml.js';
import { buildChildEnv } from './child-env.js';

const execFileAsync = promisify(execFile);

const VALID_SESSION_NAME_RE = /^[a-zA-Z0-9._-]+$/;

function validateSessionName(name: string): void {
  if (!VALID_SESSION_NAME_RE.test(name)) {
    throw new Error(`Invalid tmux session name: ${name}`);
  }
}

const MANAGED_TMUX_SOCKET_NAME = 'panopticon';
const MANAGED_TMUX_CONFIG_CONTENT = [
  '# Panopticon-managed tmux config',
  '# Keep this minimal and include only behavior Panopticon intentionally depends on.',
  'set -g mouse on',
  '# Panopticon owns the browser-facing context menu. Prevent tmux defaults',
  '# from opening a competing right-click menu inside managed sessions.',
  'unbind-key -T root MouseDown3Pane',
  'unbind-key -T root M-MouseDown3Pane',
  'bind-key -T root MouseDown3Pane select-pane -t =',
  'bind-key -T root M-MouseDown3Pane select-pane -t =',
  '',
].join('\n');

// One-shot guard: the managed tmux context (config file + loaded server) only needs
// to be prepared once per process. Every tmux subprocess invocation already passes
// `-L panopticon -f <configPath>`, so after the first source-file the config is live
// on the shared server for every subsequent command. Re-writing the file and
// re-sourcing it per call was the root of PAN-785's terminal lag.
let tmuxContextPrepared = false;

/**
 * Log file for tmux sendKeys operations.
 * This helps debug mysterious messages appearing in agent prompts.
 */
function getSendKeysLogFile(): string {
  return join(getPanopticonHome(), 'logs', 'sendkeys.jsonl');
}

function getTmuxDir(): string {
  return join(getPanopticonHome(), 'tmux');
}

export function getManagedTmuxConfigPath(): string {
  return join(getTmuxDir(), 'panopticon.tmux.conf');
}

export function getManagedTmuxSocketName(): string {
  return MANAGED_TMUX_SOCKET_NAME;
}

function ensureLogDir(): void {
  const logDir = join(getPanopticonHome(), 'logs');
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

function reloadManagedTmuxConfigSync(): void {
  try {
    // Strip provider env vars (ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, etc.) so
    // the tmux server doesn't inherit stale provider config. Without this,
    // every session spawned by the server inherits the parent's env — and tmux
    // -e can only override, not unset, so stale vars leak through.
    const cleanEnv = buildChildEnv();
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

/**
 * Explicit one-shot init for the managed tmux context. Call awaited from the
 * dashboard server entry point before `server.listen` so that no request path
 * ever pays the prep cost (file write + tmux start-server + source-file).
 *
 * In `inherit-user` mode this is a no-op. Safe to call multiple times.
 */
export async function ensureManagedTmuxContextOnce(): Promise<void> {
  const mode = getTmuxConfigMode();
  await ensureTmuxContextPreparedAsync(mode);
}

export function getTmuxConfigMode(): TmuxConfigMode {
  const { config } = loadConfig();
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
  const args = ['new-session', '-d', '-s', name, '-c', cwd];

  if (options?.width !== undefined) {
    args.push('-x', String(options.width));
  }
  if (options?.height !== undefined) {
    args.push('-y', String(options.height));
  }
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

export function listSessions(): TmuxSession[] {
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

export async function listSessionsAsync(): Promise<TmuxSession[]> {
  try {
    const { stdout } = await tmuxExecAsync(
      ['list-sessions', '-F', '#{session_name}|#{session_created}|#{session_attached}|#{session_windows}'],
      { encoding: 'utf8' },
    );
    const text = String(stdout);
    return text.trim().split('\n').filter(Boolean).map((line: string) => {
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

export function listSessionNames(): string[] {
  return listSessions().map((session) => session.name);
}

export async function listSessionNamesAsync(): Promise<string[]> {
  try {
    const { stdout } = await tmuxExecAsync(['list-sessions', '-F', '#{session_name}'], { encoding: 'utf-8' });
    const text = String(stdout);
    return text.split('\n').map((line: string) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Query the current window dimensions for a session. Returns null if the
 * session does not exist, tmux fails, or the response is malformed.
 */
export async function getWindowDimensionsAsync(sessionName: string): Promise<{ cols: number; rows: number } | null> {
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

export function sessionExists(name: string): boolean {
  try {
    tmuxExecSync(['has-session', '-t', exactSession(name)], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function sessionExistsAsync(name: string): Promise<boolean> {
  try {
    await tmuxExecAsync(['has-session', '-t', exactSession(name)], { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/**
 * @deprecated Legacy sync function — blocks the event loop. Use `createSessionAsync` instead.
 * Kept for CLI-only callers. Never call from server-reachable code.
 */
export function createSession(
  name: string,
  cwd: string,
  initialCommand?: string,
  options?: { env?: Record<string, string> }
): void {
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

export async function createSessionAsync(
  name: string,
  cwd: string,
  initialCommand?: string,
  options?: { env?: Record<string, string>; width?: number; height?: number }
): Promise<void> {
  await tmuxExecAsync(buildNewSessionArgs(name, cwd, initialCommand, options), { encoding: 'utf-8' });
}

export function killSession(name: string): void {
  // Exact-match target — a bare name prefix-matches and would kill e.g.
  // `agent-pan-977-review` when asked to kill `agent-pan-977`.
  tmuxExecSync(['kill-session', '-t', exactSession(name)]);
}

export async function killSessionAsync(name: string): Promise<void> {
  await tmuxExecAsync(['kill-session', '-t', exactSession(name)], { encoding: 'utf-8' });
}

export async function setOptionAsync(target: string, option: string, value: string): Promise<void> {
  await tmuxExecAsync(['set-option', '-t', target, option, value], { encoding: 'utf-8' });
}

export async function resizeWindowAsync(target: string, cols: number, rows: number): Promise<void> {
  await tmuxExecAsync(['resize-window', '-t', target, '-x', String(cols), '-y', String(rows)], {
    encoding: 'utf-8',
  });
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
 * Send a raw keystroke to a tmux session — no load-buffer, no Enter.
 * Used for Ink TUI interactions (e.g. plan approval digit selection)
 * where the application consumes single keystrokes directly.
 */
export async function sendRawKeystrokeAsync(sessionName: string, key: string, caller?: string): Promise<void> {
  validateSessionName(sessionName);
  logSendKeys(sessionName, key, caller ?? 'raw-keystroke');
  await tmuxExecAsync(['send-keys', '-t', sessionName, key], { encoding: 'utf-8' });
}

/**
 * Send keys to a tmux session (async, non-blocking).
 * Uses load-buffer + paste-buffer with capture-pane verification.
 * MUST be used from the dashboard server and any async context.
 */
export async function sendKeysAsync(sessionName: string, keys: string, caller?: string): Promise<void> {
  validateSessionName(sessionName);
  logSendKeys(sessionName, keys, caller);

  const sendId = randomUUID();
  const tmpFile = join(tmpdir(), `pan-sendkeys-${sendId}.txt`);
  const bufferName = `pan-${sendId}`;

  try {
    await writeFile(tmpFile, keys, 'utf-8');
    await tmuxExecAsync(['load-buffer', '-b', bufferName, tmpFile], { encoding: 'utf-8' });
    await tmuxExecAsync(['paste-buffer', '-b', bufferName, '-p', '-t', sessionName], { encoding: 'utf-8' });

    // Verify paste arrived: poll capture-pane until the last non-empty line of
    // the pasted text is visible. Using the last line instead of the first
    // because large messages scroll the first line out of the capture window.
    //
    // Cold-start panes (Claude TUI booting, MCP servers loading, hooks firing)
    // commonly take 4-8s to render the first frame, so the previous 3s budget
    // false-negatived constantly. Bumped to 8s and added one paste-buffer retry
    // before falling back to "send Enter anyway" — without retry, a missed
    // paste sent Enter against an empty input box, the agent received nothing,
    // and the orchestrator counted that as delivered (silent message loss).
    const lines = keys.split('\n');
    const verifyLine = ([...lines].reverse().find(l => l.trim().length >= 3) ?? lines[lines.length - 1])?.trim() ?? '';
    const VERIFY_TIMEOUT_MS = 8_000;
    const VERIFY_INTERVAL_MS = 50;
    const PASTE_MAX_ATTEMPTS = 2;
    let pasteVerified = false;

    if (verifyLine.length >= 3) {
      attemptLoop: for (let attempt = 1; attempt <= PASTE_MAX_ATTEMPTS; attempt++) {
        const verifyStart = Date.now();
        const deadline = verifyStart + VERIFY_TIMEOUT_MS;
        while (Date.now() < deadline) {
          const pane = await capturePaneAsync(sessionName, 10);
          if (pane.includes(verifyLine.slice(0, 40))) {
            pasteVerified = true;
            // Ensure a minimum paste-to-Enter delay so Claude Code's TUI finishes
            // processing the bracketed paste before Enter arrives. (PAN-699 follow-up)
            const elapsed = Date.now() - verifyStart;
            const minDelay = 600;
            if (elapsed < minDelay) {
              await new Promise(r => setTimeout(r, minDelay - elapsed));
            }
            break attemptLoop;
          }
          await new Promise(r => setTimeout(r, VERIFY_INTERVAL_MS));
        }

        if (attempt < PASTE_MAX_ATTEMPTS) {
          console.warn(`[tmux] Paste not visible on ${sessionName} after ${VERIFY_TIMEOUT_MS}ms (attempt ${attempt}/${PASTE_MAX_ATTEMPTS}) — re-pasting buffer.`);
          await tmuxExecAsync(['paste-buffer', '-b', bufferName, '-p', '-t', sessionName], { encoding: 'utf-8' });
        }
      }
    } else {
      // Very short text — use the old delay-based approach
      const delayMs = Math.max(600, Math.min(3000, keys.split('\n').length * 15 + Math.floor(keys.length / 1000) * 50));
      await new Promise(r => setTimeout(r, delayMs));
      pasteVerified = true;
    }

    await tmuxExecAsync(['delete-buffer', '-b', bufferName], { encoding: 'utf-8' }).catch(() => {});

    if (!pasteVerified) {
      const snapshot = await capturePaneAsync(sessionName, 30);
      console.warn(`[tmux] Paste verification failed for ${sessionName} after ${PASTE_MAX_ATTEMPTS} attempts × ${VERIFY_TIMEOUT_MS}ms. Sending Enter anyway to avoid orphaned input. Snapshot:\n${snapshot.slice(0, 500)}`);
    }

    // Send Enter — even if verification failed, the buffer was pasted; leaving
    // orphaned text in the input is worse than a possibly-redundant Enter.
    await tmuxExecAsync(['send-keys', '-t', sessionName, 'C-m'], { encoding: 'utf-8' });
    logSendKeys(sessionName, pasteVerified ? '[Enter sent]' : '[Enter sent (unverified paste)]', caller);

    // Verify Enter submitted: poll until the pasted text is no longer in the
    // input region (last 3 lines of the pane). This confirms the message was
    // submitted rather than just sitting in the input box.
    if (verifyLine.length >= 3) {
      const SUBMIT_TIMEOUT_MS = 2_000;
      const submitDeadline = Date.now() + SUBMIT_TIMEOUT_MS;
      while (Date.now() < submitDeadline) {
        const pane = await capturePaneAsync(sessionName, 5);
        if (!pane.includes(verifyLine.slice(0, 40))) {
          break; // Text moved out of input — submitted
        }
        await new Promise(r => setTimeout(r, VERIFY_INTERVAL_MS));
      }
    }
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

/**
 * Send keys to a tmux session (sync, blocks event loop).
 * Only use from CLI commands — NEVER from the dashboard server.
 */
export function sendKeys(sessionName: string, keys: string, caller?: string): void {
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

export function capturePane(sessionName: string, lines: number = 50): string {
  try {
    return tmuxExecSync(['capture-pane', '-t', exactSession(sessionName), '-p', '-S', `-${lines}`], {
      encoding: 'utf8',
    }) as string;
  } catch {
    return '';
  }
}

/**
 * Capture tmux pane output (async, non-blocking).
 * MUST be used from the dashboard server and any async context.
 */
export async function capturePaneAsync(
  sessionName: string,
  lines: number = 50,
  options?: { escapeSequences?: boolean }
): Promise<string> {
  try {
    const args = ['capture-pane', '-t', exactSession(sessionName), '-p'];
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

export function listPaneValues(target: string, format: string): string[] {
  try {
    const output = tmuxExecSync(['list-panes', '-t', exactSession(target), '-F', format], { encoding: 'utf8' }) as string;
    return output.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function listPaneValuesAsync(target: string, format: string): Promise<string[]> {
  try {
    const { stdout } = await tmuxExecAsync(['list-panes', '-t', exactSession(target), '-F', format], { encoding: 'utf-8' });
    return String(stdout).split('\n').map((line: string) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Check whether any pane in a tmux session is dead (process exited).
 * Returns true if the session exists and at least one pane is dead.
 * Returns false if the session doesn't exist or all panes are alive.
 */
export async function isPaneDeadAsync(sessionName: string): Promise<boolean> {
  try {
    const values = await listPaneValuesAsync(sessionName, '#{pane_dead}');
    return values.some(v => v === '1');
  } catch {
    return false;
  }
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
export function detectTerminalApiError(paneOutput: string): TerminalApiError | null {
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

/**
 * Wait for Claude Code to reach its interactive prompt (❯) in a tmux session.
 * Polls tmux output until the prompt appears or timeout is reached.
 */
export async function waitForClaudePrompt(sessionName: string, timeoutMs: number = 15000): Promise<boolean> {
  const start = Date.now();
  const poll = 500;
  let consecutivePromptPolls = 0;

  while (Date.now() - start < timeoutMs) {
    if (!await sessionExistsAsync(sessionName)) return false;

    const output = await capturePaneAsync(sessionName, 10);
    const lines = output.split('\n').filter(l => l.trim());
    // Use lines.some() instead of lastLine — the status bar/footer is often the
    // last line, so checking only lastLine misses the prompt. (feature/pan-704)
    const hasPromptLine = lines.some(line => line.includes('❯'));

    if (hasPromptLine) {
      consecutivePromptPolls += 1;
      if (consecutivePromptPolls >= 2 && await sessionExistsAsync(sessionName)) {
        return true;
      }
    } else {
      consecutivePromptPolls = 0;
    }

    await new Promise(r => setTimeout(r, poll));
  }
  return false;
}

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
    const after = await capturePaneAsync(sessionName, 50);
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

export function getAgentSessions(): TmuxSession[] {
  return listSessions().filter(s => s.name.startsWith('agent-'));
}

export async function getAgentSessionsAsync(): Promise<TmuxSession[]> {
  return (await listSessionsAsync()).filter(s => s.name.startsWith('agent-'));
}

export async function getReviewSessionsAsync(): Promise<TmuxSession[]> {
  return (await listSessionsAsync()).filter(s => /^review-/.test(s.name));
}
