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

export function sessionExists(name: string): boolean {
  try {
    tmuxExecSync(['has-session', '-t', name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function sessionExistsAsync(name: string): Promise<boolean> {
  try {
    await tmuxExecAsync(['has-session', '-t', name], { encoding: 'utf-8' });
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
  tmuxExecSync(['kill-session', '-t', name]);
}

export async function killSessionAsync(name: string): Promise<void> {
  await tmuxExecAsync(['kill-session', '-t', name], { encoding: 'utf-8' });
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
 * Send keys to a tmux session (async, non-blocking).
 * Uses load-buffer + paste-buffer for reliable delivery, with a delay before Enter.
 * MUST be used from the dashboard server and any async context.
 */
export async function sendKeysAsync(sessionName: string, keys: string, caller?: string): Promise<void> {
  validateSessionName(sessionName);
  logSendKeys(sessionName, keys, caller);

  // Mirror the sync `sendKeys` pattern: one temp file, one load-buffer, one
  // paste-buffer, one Enter. Splitting by line and pasting line-by-line
  // (the previous implementation) cost ~5 tmux spawns and 50 ms of sleep
  // per line, which made large prompts take seconds (PAN-785).
  // `paste-buffer -d` drops the buffer in the same call so we don't need a
  // separate delete-buffer round-trip.
  const sendId = randomUUID();
  const tmpFile = join(tmpdir(), `pan-sendkeys-${sendId}.txt`);
  // Use a named tmux buffer so concurrent sendKeysAsync calls (e.g. spawning
  // 4 parallel reviewers) don't race on the global unnamed buffer.
  const bufferName = `pan-${sendId}`;

  try {
    await writeFile(tmpFile, keys, 'utf-8');
    await tmuxExecAsync(['load-buffer', '-b', bufferName, tmpFile], { encoding: 'utf-8' });
    await tmuxExecAsync(['paste-buffer', '-b', bufferName, '-t', sessionName], { encoding: 'utf-8' });
    // Explicitly delete the named buffer — paste-buffer -d only drops the default buffer.
    await tmuxExecAsync(['delete-buffer', '-b', bufferName], { encoding: 'utf-8' }).catch(() => {});
    // Scale delay with prompt size — large pastes need more time to render before
    // Enter arrives. Hybrid formula: 15ms/line + 50ms per 1000 chars, minimum 600ms.
    // (PAN-699: 300ms was insufficient for small messages when Claude Code shows
    // warning banners; 600ms provides headroom for TUI render latency.)
    const lineDelay = keys.split('\n').length * 15;
    const lengthDelay = Math.floor(keys.length / 1000) * 50;
    const delayMs = Math.max(600, Math.min(3000, lineDelay + lengthDelay));
    await new Promise(r => setTimeout(r, delayMs));
    await tmuxExecAsync(['send-keys', '-t', sessionName, 'C-m'], { encoding: 'utf-8' });
    logSendKeys(sessionName, '[Enter sent]', caller);
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
    return tmuxExecSync(['capture-pane', '-t', sessionName, '-p', '-S', `-${lines}`], {
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
    const args = ['capture-pane', '-t', sessionName, '-p'];
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
    const output = tmuxExecSync(['list-panes', '-t', target, '-F', format], { encoding: 'utf8' }) as string;
    return output.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function listPaneValuesAsync(target: string, format: string): Promise<string[]> {
  try {
    const { stdout } = await tmuxExecAsync(['list-panes', '-t', target, '-F', format], { encoding: 'utf-8' });
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
