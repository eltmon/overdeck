/**
 * The dashboard's self jobs (PAN-4927 W-SELF1, D-11, D-12): `pan` CLI
 * commands a self route runs asynchronously for the calling agent, and the
 * bounded waits an agent makes on them instead of polling.
 *
 * A job runs one closed verb (`self-job-argv.ts`) through `panCliInvocation`
 * and promisified `execFile`, in the caller's workspace or conversation cwd,
 * with only the caller's identity variables (D-5) and never an MCP token
 * (NFR-4). It keeps the last 16 KiB of each stream; output arrives when the
 * child exits (D-7). Jobs live in memory only: a finished job is dropped one
 * hour after it ends, at most 200 are held (D-6), and a dashboard restart
 * forgets them all. Only the job's owner can read or wait on it. A wait
 * blocks at most `WAIT_CHUNK_MS` and returns early when the job ends or the
 * request is cancelled (D-10). The runner is injected (D-8) so tests never
 * mock `node:child_process`.
 */
import { execFile, type PromiseWithChild } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { WAIT_CHUNK_MS } from '../../../lib/mcp/tool.js';
import { panCliInvocation } from '../../../lib/pan-cli-invocation.js';
import type { SelfCaller } from '../self-caller.js';
import { buildSelfJobArgv, type SelfJobArg, type SelfJobVerb } from './self-job-argv.js';

export const SELF_JOB_TIMEOUT_MS = 15 * 60_000;
export const SELF_JOB_MAX_BUFFER = 4 * 1024 * 1024;
export const SELF_JOB_OUTPUT_TAIL_BYTES = 16_384;
export const SELF_JOB_LIMIT = 200;
export const FINISHED_JOB_TTL_MS = 60 * 60_000;

export interface SelfJobRunInput {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
  maxBuffer: number;
}
export interface SelfJobRunResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  error: string | null;
}
/** Runs one job process. Never rejects. */
export type SelfJobRunner = (input: SelfJobRunInput) => Promise<SelfJobRunResult>;

export interface SelfJobState {
  jobId: string;
  verb: SelfJobVerb;
  status: 'running' | 'done';
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  error: string | null;
}
export type SelfJobAnswer =
  | ({ status: 'done' } & Omit<SelfJobState, 'status'>)
  | { status: 'running'; jobId: string; verb: SelfJobVerb; startedAt: string; next: { tool: 'wait_job'; arguments: { jobId: string } } };

/** D-5: identity variables a job never inherits from the dashboard process. */
const INHERITED_IDENTITY_VARS = [
  'OVERDECK_AGENT_ID',
  'OVERDECK_CONVERSATION',
  'OVERDECK_ISSUE_ID',
  'OVERDECK_CLAIM_ID',
  'OVERDECK_AGENT_STARTED_BY',
  'OVERDECK_MCP_TOKEN',
  'OVERDECK_MCP_TOKEN_FILE',
] as const;

/** The last `maxBytes` bytes of `text` as UTF-8. */
export function tailUtf8(text: string, maxBytes = SELF_JOB_OUTPUT_TAIL_BYTES): string {
  const bytes = Buffer.from(text, 'utf8');
  return bytes.length <= maxBytes ? text : bytes.subarray(bytes.length - maxBytes).toString('utf8');
}

/** The env a job runs with: the dashboard's, minus inherited identity, plus the caller's (D-5). */
export function selfJobEnv(caller: SelfCaller, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const name of INHERITED_IDENTITY_VARS) delete env[name];
  if (caller.agentKind === 'agent') env.OVERDECK_AGENT_ID = caller.agentId;
  else if (caller.tmuxSession !== null) env.OVERDECK_CONVERSATION = caller.tmuxSession;
  if (caller.issueId !== null) env.OVERDECK_ISSUE_ID = caller.issueId;
  env.OVERDECK_DASHBOARD_URL = `http://127.0.0.1:${base.API_PORT ?? base.PORT ?? '3011'}`;
  return env;
}

/** D-2: what a route answers for a job's state; a running job names the next wait call. */
export function selfJobAnswer(state: SelfJobState): SelfJobAnswer {
  if (state.status === 'done') return { ...state, status: 'done' };
  return {
    status: 'running',
    jobId: state.jobId,
    verb: state.verb,
    startedAt: state.startedAt,
    next: { tool: 'wait_job', arguments: { jobId: state.jobId } },
  };
}

const execFileAsync = promisify(execFile);

/** The real runner: `execFile` with stdin, timeout and output cap. Never rejects. */
export async function runPanJob(input: SelfJobRunInput): Promise<SelfJobRunResult> {
  let pending: PromiseWithChild<{ stdout: string; stderr: string }>;
  try {
    pending = execFileAsync(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      timeout: input.timeoutMs,
      maxBuffer: input.maxBuffer,
      encoding: 'utf8',
    });
  } catch (error) {
    return { exitCode: null, signal: null, timedOut: false, stdout: '', stderr: '', error: (error as Error).message };
  }
  // H-4: a child that exits before reading stdin makes the write fail with EPIPE; ignore it.
  pending.child.stdin?.on('error', () => undefined);
  pending.child.stdin?.end(input.stdin ?? '');
  try {
    const { stdout, stderr } = await pending;
    return { exitCode: 0, signal: null, timedOut: false, stdout: tailUtf8(stdout), stderr: tailUtf8(stderr), error: null };
  } catch (raw) {
    const failure = raw as Error & { code?: number | string; signal?: NodeJS.Signals | null; killed?: boolean; stdout?: string; stderr?: string };
    const overflow = failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
    const timedOut = !overflow && failure.killed === true && failure.signal != null;
    return {
      exitCode: typeof failure.code === 'number' ? failure.code : null,
      signal: failure.signal ?? null,
      timedOut,
      stdout: tailUtf8(failure.stdout ?? ''),
      stderr: tailUtf8(failure.stderr ?? ''),
      error: overflow ? 'job output exceeded 4 MiB' : timedOut ? 'job timed out after 15 minutes' : typeof failure.code === 'number' ? null : failure.message,
    };
  }
}

export type StartSelfJobResult = { ok: true; jobId: string } | { ok: false; code: 'too-many-jobs'; error: string };
export interface SelfJobs {
  /** Throws SelfJobArgError on invalid args (later routes answer 400). */
  start(caller: SelfCaller, verb: SelfJobVerb, args?: readonly SelfJobArg[], options?: { stdin?: string }): StartSelfJobResult;
  /** The job's state, or null when it is unknown or not the caller's. */
  get(jobId: string, caller: SelfCaller): SelfJobState | null;
  /** Resolves when the job ends, `timeoutMs` (clamped to 1..WAIT_CHUNK_MS) passes, or `signal` aborts. Null when unknown or not the caller's. */
  wait(jobId: string, caller: SelfCaller, timeoutMs: number, signal?: AbortSignal): Promise<SelfJobState | null>;
}

interface JobRecord {
  state: SelfJobState;
  owner: string;
  endedAtMs: number | null;
  settled: Promise<void>;
}

const ownerKey = (caller: SelfCaller): string => `${caller.agentKind}:${caller.agentId}`;

export function createSelfJobs(deps: { runner?: SelfJobRunner; now?: () => number; newId?: () => string } = {}): SelfJobs {
  const runner = deps.runner ?? runPanJob;
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => randomUUID());
  const jobs = new Map<string, JobRecord>();

  const prune = (): void => {
    const at = now();
    for (const [jobId, record] of jobs) {
      if (record.endedAtMs !== null && at - record.endedAtMs > FINISHED_JOB_TTL_MS) jobs.delete(jobId);
    }
  };

  const owned = (jobId: string, caller: SelfCaller): JobRecord | null => {
    const record = jobs.get(jobId);
    return record && record.owner === ownerKey(caller) ? record : null;
  };

  /** Drops the oldest finished job; false when every held job is running. */
  const dropOldestFinished = (): boolean => {
    for (const [jobId, record] of jobs) {
      if (record.state.status === 'done') {
        jobs.delete(jobId);
        return true;
      }
    }
    return false;
  };

  return {
    start(caller, verb, args = [], options = {}) {
      const argv = buildSelfJobArgv(verb, args);
      prune();
      while (jobs.size >= SELF_JOB_LIMIT) {
        if (!dropOldestFinished()) return { ok: false, code: 'too-many-jobs', error: 'too many self jobs are running; wait for one to finish' };
      }
      const { command, args: commandArgs } = panCliInvocation(argv);
      const jobId = newId();
      const state: SelfJobState = {
        jobId,
        verb,
        status: 'running',
        startedAt: new Date(now()).toISOString(),
        endedAt: null,
        exitCode: null,
        signal: null,
        timedOut: false,
        stdout: '',
        stderr: '',
        error: null,
      };
      const record: JobRecord = { state, owner: ownerKey(caller), endedAtMs: null, settled: Promise.resolve() };
      jobs.set(jobId, record);
      record.settled = runner({
        command,
        args: commandArgs,
        cwd: caller.cwd,
        env: selfJobEnv(caller),
        stdin: options.stdin,
        timeoutMs: SELF_JOB_TIMEOUT_MS,
        maxBuffer: SELF_JOB_MAX_BUFFER,
      })
        .catch((error: unknown): SelfJobRunResult => ({ exitCode: null, signal: null, timedOut: false, stdout: '', stderr: '', error: String(error) }))
        .then((result) => {
          Object.assign(state, result);
          state.status = 'done';
          record.endedAtMs = now();
          state.endedAt = new Date(record.endedAtMs).toISOString();
        });
      return { ok: true, jobId };
    },

    get(jobId, caller) {
      prune();
      const record = owned(jobId, caller);
      return record ? { ...record.state } : null;
    },

    async wait(jobId, caller, timeoutMs, signal) {
      prune();
      const record = owned(jobId, caller);
      if (!record) return null;
      if (record.state.status === 'done') return { ...record.state };
      const ms = Math.min(Math.max(Math.trunc(timeoutMs) || 1, 1), WAIT_CHUNK_MS);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const delay = new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        timer = setTimeout(resolve, ms);
        onAbort = () => resolve();
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      try {
        await Promise.race([record.settled, delay]);
      } finally {
        clearTimeout(timer);
        if (onAbort) signal?.removeEventListener('abort', onAbort);
      }
      return { ...record.state };
    },
  };
}

/** The dashboard's one job store. */
export const selfJobs: SelfJobs = createSelfJobs();
