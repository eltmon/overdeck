import { execSync, execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, chmodSync, appendFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { getPanopticonHome } from './paths.js';
import { loadConfig, type TmuxConfigMode } from './config-yaml.js';

const execFileAsync = promisify(execFile);

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
    execFileSync('tmux', ['-L', getManagedTmuxSocketName(), 'start-server'], { stdio: 'ignore' });
    execFileSync('tmux', ['-L', getManagedTmuxSocketName(), 'source-file', getManagedTmuxConfigPath()], { stdio: 'ignore' });
  } catch {
    // If tmux isn't available or the server can't be started yet, callers will
    // still write the managed config file and retry on the next tmux interaction.
  }
}

async function reloadManagedTmuxConfigAsync(): Promise<void> {
  try {
    await execFileAsync('tmux', ['-L', getManagedTmuxSocketName(), 'start-server'], { encoding: 'utf-8' });
    await execFileAsync('tmux', ['-L', getManagedTmuxSocketName(), 'source-file', getManagedTmuxConfigPath()], { encoding: 'utf-8' });
  } catch {
    // If tmux isn't available or the server can't be started yet, callers will
    // still write the managed config file and retry on the next tmux interaction.
  }
}

function ensureManagedTmuxConfigSync(): void {
  ensureManagedTmuxDirSync();
  writeFileSync(getManagedTmuxConfigPath(), MANAGED_TMUX_CONFIG_CONTENT, 'utf-8');
  reloadManagedTmuxConfigSync();
}

async function ensureManagedTmuxConfigAsync(): Promise<void> {
  await ensureManagedTmuxDirAsync();
  await writeFile(getManagedTmuxConfigPath(), MANAGED_TMUX_CONFIG_CONTENT, 'utf-8');
  await reloadManagedTmuxConfigAsync();
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

export function getTmuxBaseArgs(): string[] {
  const mode = getTmuxConfigMode();
  ensureTmuxContextPreparedSync(mode);
  return getTmuxContextArgsForMode(mode);
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
      keysPreview: keys.length > 200 ? keys.slice(0, 200) + '...' : keys,
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
  logSendKeys(sessionName, keys, caller);

  const lines = keys.split('\n');
  const opId = `${process.pid}-${Date.now()}-${randomUUID()}`;
  if (lines.length > 1) {
    // Multiline: send each line separately with S-Enter between them.
    // S-Enter (Shift+Enter) inserts a newline in readline without submitting,
    // whereas literal \n in a pasted buffer gets interpreted as Enter/submit.
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.length > 0) {
        await tmpLoadAndPaste(sessionName, lines[i]!, `${opId}-${i}`);
      }
      if (i < lines.length - 1) {
        await tmuxExecAsync(['send-keys', '-t', sessionName, 'S-Enter'], { encoding: 'utf-8' });
      }
    }
    // Final Enter to submit
    await tmuxExecAsync(['send-keys', '-t', sessionName, 'C-m'], { encoding: 'utf-8' });
  } else {
    await tmpLoadAndPaste(sessionName, keys, opId);
    await new Promise(r => setTimeout(r, 300));
    await tmuxExecAsync(['send-keys', '-t', sessionName, 'C-m'], { encoding: 'utf-8' });
  }
}

/** Load text into a unique tmux buffer via a unique temp file, paste it, then clean up. */
async function tmpLoadAndPaste(sessionName: string, keys: string, opId: string): Promise<void> {
  const tmpFile = join(tmpdir(), `pan-sendkeys-${opId}.txt`);
  const bufId = `pan-sendkeys-${opId}`;
  await writeFile(tmpFile, keys);
  try {
    await tmuxExecAsync(['load-buffer', '-b', bufId, tmpFile], { encoding: 'utf-8' });
    await tmuxExecAsync(['paste-buffer', '-b', bufId, '-t', sessionName, '-d'], { encoding: 'utf-8' });
    await new Promise(r => setTimeout(r, 50));
  } finally {
    try { await unlink(tmpFile); } catch {}
  }
}

/**
 * Send keys to a tmux session (sync, blocks event loop).
 * Only use from CLI commands — NEVER from the dashboard server.
 */
export function sendKeys(sessionName: string, keys: string, caller?: string): void {
  logSendKeys(sessionName, keys, caller);

  const tmpFile = join(tmpdir(), `pan-sendkeys-${process.pid}-${Date.now()}-${randomUUID()}.txt`);
  try {
    writeFileSync(tmpFile, keys);
    tmuxExecSync(['load-buffer', tmpFile]);
    tmuxExecSync(['paste-buffer', '-t', sessionName]);
    execSync('sleep 0.3');
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
 * Wait for Claude Code to reach its interactive prompt (❯) in a tmux session.
 * Polls tmux output until the prompt appears or timeout is reached.
 */
export async function waitForClaudePrompt(sessionName: string, timeoutMs: number = 15000): Promise<boolean> {
  const start = Date.now();
  const poll = 500;
  while (Date.now() - start < timeoutMs) {
    const output = await capturePaneAsync(sessionName, 10);
    const lines = output.split('\n').filter(l => l.trim());
    const lastLine = lines[lines.length - 1] || '';
    if (lastLine.includes('❯')) return true;
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
  const beforeLineCount = outputBefore.split('\n').filter(l => l.trim()).length;

  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, poll));
    const after = await capturePaneAsync(sessionName, 50);
    const afterLines = after.split('\n').filter(l => l.trim());
    const afterLineCount = afterLines.length;

    if (afterLineCount > beforeLineCount + 1) return true;

    const newOutput = afterLines.slice(beforeLineCount).join('\n');
    if (
      newOutput.includes('●') || newOutput.includes('⎿') || newOutput.includes('Read') ||
      newOutput.includes('✻') || newOutput.includes('·') || newOutput.includes('✶') ||
      newOutput.includes('✽') || newOutput.includes('✢') || newOutput.includes('Generating') ||
      newOutput.includes('thinking') || newOutput.includes('thought for')
    ) return true;
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
