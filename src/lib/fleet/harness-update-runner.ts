/**
 * The process-wide harness CLI update runner (PAN-5108 D8, D10).
 *
 * `runHarnessUpdateCommand` runs one update argv with `execFile` (never a shell)
 * and never rejects. `runExclusiveUpdate` is a serial queue shared by every
 * update path in this process (the background updater, update on refusal and
 * the fleet "Update all" job), so two npm global installs never run at once.
 * A request whose key is already queued or running joins that run.
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
          const timedOut = (error as { killed?: boolean }).killed === true;
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

const inFlight = new Map<string, Promise<unknown>>();
let queueTail: Promise<unknown> = Promise.resolve();

/**
 * Process-wide serial queue (D8). A key already queued or running joins that
 * run; otherwise the job runs after every earlier job settles. A rejected job
 * does not block the next one.
 */
export function runExclusiveUpdate<T>(key: string, job: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const run = queueTail.then(job, job);
  queueTail = run.catch(() => undefined);
  inFlight.set(key, run);
  const clear = (): void => {
    if (inFlight.get(key) === run) inFlight.delete(key);
  };
  run.then(clear, clear);
  return run;
}

export function _resetUpdateQueueForTests(): void {
  inFlight.clear();
  queueTail = Promise.resolve();
}
