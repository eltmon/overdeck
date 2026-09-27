/**
 * PAN-4264: `runGh`, the metered `gh` exec door.
 *
 * Every migrated `gh` caller execs through here instead of calling
 * `execFile('gh', …)` directly. One call:
 *
 *   1. resolves the caller (`opts.caller`, else the `withGitHubCaller` context,
 *      else `other`) and the bucket the subcommand spends;
 *   2. checks the pause gate, so a non-essential caller skips GitHub while its
 *      user-pool bucket is paused (throws `GitHubQuotaPausedError`);
 *   3. execs `gh` asynchronously;
 *   4. appends one ledger line, or on a rate-limit refusal records the pause
 *      and throws `GitHubRateLimitedError`. Any other failure is rethrown
 *      unchanged (callers read `stdout`/`stderr` off it).
 *
 * Promise-only by design: no Effect wrapper and no sync twin (NFR-5).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitHubQuotaBucket, GitHubQuotaCaller } from '@overdeck/contracts';
import { currentGitHubCaller } from './caller-context.js';
import { classifyGitHubRefusal } from './classify.js';
import { queueLedgerEntry, type LedgerEntry, type LedgerEntryInput } from './ledger.js';
import { assertGitHubCallAllowed, GitHubRateLimitedError, recordGitHubRefusal } from './pause-gate.js';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;

export interface GhExecOptions {
  cwd?: string;
  timeout: number;
  maxBuffer: number;
}

/** The injectable exec seam; the default is async `execFile('gh', args)`. */
export type GhExecFn = (args: string[], options: GhExecOptions) => Promise<{ stdout: string }>;

export interface RunGhOptions {
  caller?: GitHubQuotaCaller;
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  exec?: GhExecFn;
  /** Extra ledger fields read from a successful stdout (e.g. GraphQL `rateLimit`). */
  onSuccess?: (stdout: string) => Partial<LedgerEntry>;
}

/**
 * `OVERDECK_GH_METERED=1` tells the agent `gh` shim (launcher-git-guard.ts)
 * that this call is already metered, so a `pan` command run from an agent
 * shell is not counted twice.
 */
function defaultExec(args: string[], options: GhExecOptions): Promise<{ stdout: string }> {
  return execFileAsync('gh', args, {
    encoding: 'utf-8',
    ...options,
    env: { ...process.env, OVERDECK_GH_METERED: '1' },
  });
}

/** `gh api` flags that consume the following argument. */
const GH_API_VALUE_FLAGS = new Set([
  '-H', '--header', '-f', '--raw-field', '-F', '--field', '-q', '--jq', '-t', '--template',
  '-X', '--method', '--input', '--hostname', '--cache', '-p', '--preview',
]);

function ghApiEndpoint(args: string[]): string | undefined {
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i]!;
    if (GH_API_VALUE_FLAGS.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) continue;
    return arg;
  }
  return undefined;
}

/**
 * Which user-pool bucket a `gh` invocation spends, and whether its cost of 1
 * is an estimate. `gh pr|issue|repo|release …` run on GraphQL with no visible
 * cost; `gh api <path>` is one REST request (more with `--paginate`);
 * `gh run …` is REST.
 */
export function classifyGhInvocation(args: readonly string[]): { bucket: GitHubQuotaBucket; estimated: boolean } {
  const [command] = args;
  if (command === 'api') {
    const endpoint = ghApiEndpoint([...args]);
    if (endpoint === 'graphql') return { bucket: 'graphql', estimated: true };
    return { bucket: 'rest', estimated: args.includes('--paginate') };
  }
  if (command === 'pr' || command === 'issue' || command === 'repo' || command === 'release') {
    return { bucket: 'graphql', estimated: true };
  }
  return { bucket: 'rest', estimated: true };
}

interface GhExecFailure {
  message?: string;
  stderr?: unknown;
}

/** Exec `gh` through the quota meter and pause gate. */
export async function runGh(args: string[], opts: RunGhOptions = {}): Promise<{ stdout: string }> {
  const caller = opts.caller ?? currentGitHubCaller() ?? 'other';
  const { bucket, estimated } = classifyGhInvocation(args);
  assertGitHubCallAllowed(caller, 'user', bucket);

  const exec = opts.exec ?? defaultExec;
  const base: LedgerEntryInput = { kind: 'call', caller, pool: 'user', bucket, cost: 1, estimated, outcome: 'ok' };

  let result: { stdout: string };
  try {
    result = await exec(args, {
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      timeout: opts.timeout ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
    });
  } catch (error) {
    // Classify on stderr, not on the exec message: the message repeats the
    // command line, whose arguments may contain arbitrary text.
    const { message, stderr } = (error ?? {}) as GhExecFailure;
    const refusal = typeof stderr === 'string'
      ? classifyGitHubRefusal({ stderr })
      : classifyGitHubRefusal({ message: typeof message === 'string' ? message : String(error) });
    if (refusal) {
      const pause = await recordGitHubRefusal({ pool: 'user', bucket, caller, refusal });
      throw new GitHubRateLimitedError(pause, { cause: error });
    }
    queueLedgerEntry({ ...base, outcome: 'error' });
    throw error;
  }

  let extra: Partial<LedgerEntry> = {};
  if (opts.onSuccess) {
    try {
      extra = opts.onSuccess(result.stdout);
    } catch {
      // NFR-2: a metering parse failure never fails the call.
    }
  }
  queueLedgerEntry({ ...base, ...extra, kind: 'call', caller, pool: 'user', bucket, outcome: 'ok' });
  return result;
}
