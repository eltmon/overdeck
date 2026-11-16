/**
 * `pan computer wait`: polls app state until a text/enabled/window-title
 * condition holds (PAN-5452, PRD 3h). Read-only — it never claims the lease,
 * taking and releasing the lock on each poll rather than across the whole
 * wait.
 */
import { ComputerUseError, isComputerUseError } from './errors.js';
import { runComputerOperation as runComputerOperationReal } from './run.js';

const POLL_INTERVAL_MS = 500;
export const DEFAULT_WAIT_TIMEOUT_MS = 10_000;
export const MAX_WAIT_TIMEOUT_MS = 120_000;

export interface WaitOptions {
  app: string;
  text?: string;
  enabled?: string;
  windowTitle?: string;
  timeoutMs?: number;
}

export interface WaitDeps {
  runComputerOperation?: typeof runComputerOperationReal;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function appNotFound(error: unknown): boolean {
  return isComputerUseError(error) && error.message.includes('appNotFound');
}

async function pollOnce(options: WaitOptions, runOp: typeof runComputerOperationReal): Promise<string[] | null> {
  if (options.windowTitle !== undefined) {
    const result = await runOp({ kind: 'read', operation: { tool: 'list_windows', app: options.app } });
    const windows = (result.response as { windows?: { title?: string | null }[] }).windows ?? [];
    const needle = options.windowTitle.toLowerCase();
    const matches = windows.map((w) => w.title ?? '').filter((title) => title.toLowerCase().includes(needle));
    return matches.length > 0 ? matches : null;
  }

  const result = await runOp({ kind: 'read', operation: { tool: 'get_app_state', app: options.app, noScreenshot: true } });
  const treeLines = (result.response as { snapshot?: { treeLines: string[] } }).snapshot?.treeLines ?? [];

  if (options.text !== undefined) {
    const needle = options.text.toLowerCase();
    const matches = treeLines.filter((line) => line.toLowerCase().includes(needle));
    return matches.length > 0 ? matches : null;
  }

  // options.enabled: some line contains it, and none of those lines is marked disabled.
  const needle = (options.enabled as string).toLowerCase();
  const candidates = treeLines.filter((line) => line.toLowerCase().includes(needle));
  if (candidates.length === 0) return null;
  return candidates.some((line) => line.includes(' (disabled)')) ? null : candidates;
}

export async function waitFor(options: WaitOptions, deps: WaitDeps = {}): Promise<string[]> {
  const conditionCount = [options.text, options.enabled, options.windowTitle].filter((v) => v !== undefined).length;
  if (conditionCount !== 1) {
    throw new ComputerUseError('invalid_argument', 'wait needs exactly one of --text, --enabled or --window-title');
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  if (timeoutMs > MAX_WAIT_TIMEOUT_MS) {
    throw new ComputerUseError('invalid_argument', `--timeout cannot exceed ${MAX_WAIT_TIMEOUT_MS}ms (got ${timeoutMs}ms)`);
  }

  const runOp = deps.runComputerOperation ?? runComputerOperationReal;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? defaultSleep;
  const deadline = now() + timeoutMs;

  for (;;) {
    try {
      const matches = await pollOnce(options, runOp);
      if (matches) return matches;
    } catch (error) {
      if (!appNotFound(error)) throw error;
    }
    if (now() >= deadline) {
      throw new ComputerUseError('wait_timeout', `pan computer wait: condition not met within ${timeoutMs}ms`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}
