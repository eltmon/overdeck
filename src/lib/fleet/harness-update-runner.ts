/**
 * The process-wide harness CLI update runner (PAN-5108 D8, D10).
 *
 * `runHarnessUpdateCommand` runs one update argv with `execFile` (never a shell)
 * and never rejects. `runExclusiveUpdate` is a serial queue shared by every
 * update path in this process (the background updater, update on refusal and
 * the fleet "Update all" job), so two npm global installs never run at once.
 * A request whose key is already queued or running joins that run.
 *
 * Every path shares one key space (a user-writable npm Claude Code install
 * gives the launch path and the background path the same argv), so every job
 * yields the same type, `QueuedUpdateResult`, and a joiner from any path can
 * read it. `null` means the job ran no command because its own pre-check found
 * nothing to do; a joiner then decides for itself (`runQueuedUpdateCommand`
 * queues its own run).
 */
import { execFile } from 'node:child_process';

/** An update result keeps this much of the command output. */
export const UPDATE_OUTPUT_TAIL_CHARS = 2_000;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

export interface UpdateCommandResult {
  code: number;
  output: string;
}

export interface RunUpdateCommandOptions {
  timeoutMs: number;
  /** Prepended to PATH, so an nvm-installed `npm` finds its `node` (D10). */
  pathDir?: string;
}

function tail(text: string): string {
  return text.length > UPDATE_OUTPUT_TAIL_CHARS ? text.slice(-UPDATE_OUTPUT_TAIL_CHARS) : text;
}

/**
 * Runs one update argv via execFile (never a shell). Never rejects: a spawn
 * error, a non-zero exit or a timeout resolves with -1 or the exit code and
 * the output tail.
 */
export function runHarnessUpdateCommand(argv: string[], opts: RunUpdateCommandOptions): Promise<UpdateCommandResult> {
  const env = opts.pathDir ? { ...process.env, PATH: `${opts.pathDir}:${process.env.PATH ?? ''}` } : process.env;
  return new Promise((resolve) => {
    try {
      const child = execFile(
        argv[0]!,
        argv.slice(1),
        { timeout: opts.timeoutMs, maxBuffer: MAX_BUFFER_BYTES, encoding: 'utf8', env },
        (error, stdout, stderr) => {
          const output = `${stdout ?? ''}${stderr ?? ''}`;
          if (!error) {
            resolve({ code: 0, output: tail(output) });
            return;
          }
          // Node also sets `killed` when it kills the child for a maxBuffer overflow; that is not a timeout.
          const overflow = (error as { code?: unknown }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
          const timedOut = !overflow && (error as { killed?: boolean }).killed === true;
          const message = timedOut ? `timed out after ${Math.round(opts.timeoutMs / 1000)} seconds` : error.message;
          const code = typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : -1;
          resolve({ code: timedOut ? -1 : code, output: tail(`${output}\n${message}`) });
        },
      );
      // Update commands never read input; close stdin so a prompt cannot wait for the timeout.
      child.stdin?.end();
    } catch (error) {
      resolve({ code: -1, output: tail(error instanceof Error ? error.message : String(error)) });
    }
  });
}

/** What a queued job yields: the command's result, or null when the job ran no command. */
export type QueuedUpdateResult = UpdateCommandResult | null;

const inFlight = new Map<string, Promise<QueuedUpdateResult>>();
let queueTail: Promise<unknown> = Promise.resolve();

/**
 * Process-wide serial queue (D8). A key already queued or running joins that
 * run and receives its result, whichever path started it; otherwise the job
 * runs after every earlier job settles. A rejected job does not block the
 * next one.
 */
export function runExclusiveUpdate(key: string, job: () => Promise<QueuedUpdateResult>): Promise<QueuedUpdateResult> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const run = queueTail.then(job, job);
  queueTail = run.catch(() => undefined);
  inFlight.set(key, run);
  const clear = (): void => {
    if (inFlight.get(key) === run) inFlight.delete(key);
  };
  run.then(clear, clear);
  return run;
}

/**
 * Runs `argv` through the queue and always returns a command result. When the
 * run it joined ran no command (another caller's pre-check skipped it), it
 * queues its own run once.
 */
export async function runQueuedUpdateCommand(argv: string[], opts: RunUpdateCommandOptions): Promise<UpdateCommandResult> {
  const key = argv.join(' ');
  const job = (): Promise<QueuedUpdateResult> => runHarnessUpdateCommand(argv, opts);
  const joined = await runExclusiveUpdate(key, job);
  if (joined) return joined;
  return (await runExclusiveUpdate(key, job)) ?? { code: 0, output: 'skipped: another queued update found nothing to install' };
}

export function _resetUpdateQueueForTests(): void {
  inFlight.clear();
  queueTail = Promise.resolve();
}
