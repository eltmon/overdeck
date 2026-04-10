import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import { writeFileSync, chmodSync, appendFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { PANOPTICON_HOME } from './paths.js';

/**
 * Log file for tmux sendKeys operations
 * This helps debug mysterious messages appearing in agent prompts
 */
const SENDKEYS_LOG_FILE = join(PANOPTICON_HOME, 'logs', 'sendkeys.jsonl');

/**
 * Ensure log directory exists
 */
function ensureLogDir(): void {
  const logDir = join(PANOPTICON_HOME, 'logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Log a sendKeys operation for debugging
 */
function logSendKeys(sessionName: string, keys: string, caller?: string): void {
  try {
    ensureLogDir();

    // Get call stack to identify caller if not provided
    const stack = new Error().stack || '';
    const stackLines = stack.split('\n').slice(3, 6); // Skip Error, logSendKeys, sendKeys
    const callerInfo = caller || stackLines.map(l => l.trim()).join(' <- ');

    const entry = {
      timestamp: new Date().toISOString(),
      sessionName,
      keysLength: keys.length,
      keysPreview: keys.length > 200 ? keys.slice(0, 200) + '...' : keys,
      caller: callerInfo,
      pid: process.pid,
    };

    appendFileSync(SENDKEYS_LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8');
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
    const output = execSync('tmux list-sessions -F "#{session_name}|#{session_created}|#{session_attached}|#{session_windows}"', {
      encoding: 'utf8',
    });

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
    return []; // No sessions
  }
}

export function sessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${name} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}


export function createSession(
  name: string,
  cwd: string,
  initialCommand?: string,
  options?: { env?: Record<string, string> }
): void {
  const escapedCwd = cwd.replace(/"/g, '\\"');

  // Build environment variable flags for tmux
  let envFlags = '';
  if (options?.env) {
    for (const [key, value] of Object.entries(options.env)) {
      envFlags += ` -e ${key}="${value.replace(/"/g, '\\"')}"`;
    }
  }

  // For complex commands (with special chars), start session first then send command
  if (initialCommand && (initialCommand.includes('`') || initialCommand.includes('\n') || initialCommand.length > 500)) {
    // Create session without command
    execSync(`tmux new-session -d -s ${name} -c "${escapedCwd}"${envFlags}`);

    // Small delay to let session initialize
    execSync('sleep 0.5');

    // Send the command in chunks if needed (tmux has buffer limits)
    // First, write to a temp file and source it
    const tmpFile = `/tmp/pan-cmd-${name}.sh`;
    writeFileSync(tmpFile, initialCommand);
    chmodSync(tmpFile, '755');

    // Execute the script
    execSync(`tmux send-keys -t ${name} "bash ${tmpFile}"`);
    execSync(`tmux send-keys -t ${name} C-m`);
  } else if (initialCommand) {
    // Simple command - use inline
    const cmd = `tmux new-session -d -s ${name} -c "${escapedCwd}"${envFlags} "${initialCommand.replace(/"/g, '\\"')}"`;
    execSync(cmd);
  } else {
    execSync(`tmux new-session -d -s ${name} -c "${escapedCwd}"${envFlags}`);
  }
}

export function killSession(name: string): void {
  execSync(`tmux kill-session -t ${name}`);
}

const execAsync = promisify(exec);

export async function sessionExistsAsync(name: string): Promise<boolean> {
  try {
    await execAsync(`tmux has-session -t ${name} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send keys to a tmux session (async, non-blocking).
 * Uses load-buffer + paste-buffer for reliable delivery, with a delay before Enter.
 * MUST be used from the dashboard server and any async context.
 */
export async function sendKeysAsync(sessionName: string, keys: string, caller?: string): Promise<void> {
  logSendKeys(sessionName, keys, caller);

  // Use a unique named buffer per call to prevent race conditions.
  // The default (unnamed) paste buffer is global — concurrent load-buffer
  // calls from different specialist wakes clobber each other.
  const bufferName = `pan-${process.pid}-${Date.now()}`;
  const tmpFile = `/tmp/pan-sendkeys-${bufferName}.txt`;
  try {
    writeFileSync(tmpFile, keys);
    await execAsync(`tmux load-buffer -b ${bufferName} ${tmpFile}`);
    await execAsync(`tmux paste-buffer -b ${bufferName} -t ${sessionName} -d`);
    await new Promise(r => setTimeout(r, 300));
    await execAsync(`tmux send-keys -t ${sessionName} C-m`);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
    try { await execAsync(`tmux delete-buffer -b ${bufferName} 2>/dev/null`); } catch {}
  }
}

/**
 * Send keys to a tmux session (sync, blocks event loop).
 * Only use from CLI commands — NEVER from the dashboard server.
 */
export function sendKeys(sessionName: string, keys: string, caller?: string): void {
  logSendKeys(sessionName, keys, caller);

  const tmpFile = `/tmp/pan-sendkeys-${process.pid}-${Date.now()}.txt`;
  try {
    writeFileSync(tmpFile, keys);
    execSync(`tmux load-buffer ${tmpFile}`);
    execSync(`tmux paste-buffer -t ${sessionName}`);
    execSync(`sleep 0.3`);
    execSync(`tmux send-keys -t ${sessionName} C-m`);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

export function capturePane(sessionName: string, lines: number = 50): string {
  try {
    return execSync(`tmux capture-pane -t ${sessionName} -p -S -${lines}`, {
      encoding: 'utf8',
    });
  } catch {
    return '';
  }
}

/**
 * Capture tmux pane output (async, non-blocking).
 * MUST be used from the dashboard server and any async context.
 */
export async function capturePaneAsync(sessionName: string, lines: number = 50): Promise<string> {
  try {
    const { stdout } = await execAsync(`tmux capture-pane -t ${sessionName} -p -S -${lines}`, {
      encoding: 'utf-8',
    });
    return stdout;
  } catch {
    return '';
  }
}

/**
 * Wait for Claude Code to reach its interactive prompt (❯) in a tmux session.
 * Polls tmux output until the prompt appears or timeout is reached.
 *
 * @param sessionName - tmux session name
 * @param timeoutMs - maximum time to wait (default: 15s for fresh start, use 5s for already-running)
 * @returns true if prompt detected, false if timed out
 */
export async function waitForClaudePrompt(sessionName: string, timeoutMs: number = 15000): Promise<boolean> {
  const start = Date.now();
  const POLL = 500;
  while (Date.now() - start < timeoutMs) {
    const output = await capturePaneAsync(sessionName, 10);
    // Claude Code shows ❯ when ready for user input.
    // Check that the LAST non-empty line contains ❯ (not a stale prompt from earlier output).
    const lines = output.split('\n').filter(l => l.trim());
    const lastLine = lines[lines.length - 1] || '';
    if (lastLine.includes('❯')) return true;
    await new Promise(r => setTimeout(r, POLL));
  }
  return false;
}

/**
 * Verify that a message sent to Claude was actually received and processing started.
 * Compares tmux output before and after to detect new activity (tool calls, responses).
 *
 * @param sessionName - tmux session name
 * @param outputBefore - tmux output snapshot taken BEFORE sending the message
 * @param timeoutMs - maximum time to wait for activity (default: 10s)
 * @returns true if new activity detected, false if timed out
 */
export async function confirmDelivery(
  sessionName: string,
  outputBefore: string,
  timeoutMs: number = 10000,
): Promise<boolean> {
  const start = Date.now();
  const POLL = 1000;
  const beforeLineCount = outputBefore.split('\n').filter(l => l.trim()).length;

  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, POLL));
    const after = await capturePaneAsync(sessionName, 50);
    const afterLines = after.split('\n').filter(l => l.trim());
    const afterLineCount = afterLines.length;

    // Claude is processing if: new output lines appeared (tool calls: ●, results: ⎿, etc.)
    if (afterLineCount > beforeLineCount + 1) return true;

    // Or if we can see activity markers in the new output
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
