/**
 * Runtime owner of project-creation operations and their clone jobs
 * (PAN-3836 WI-2).
 *
 * Routes call this module; they never keep their own maps. It owns three things
 * that are only correct if exactly one place owns them:
 *
 *   - **Operations.** A client generates an `operationId` once per submission.
 *     A repeat of the *same* id with the *same* input joins the first attempt
 *     instead of starting a second one — which is what makes a lost POST
 *     response safe to retry. The same id with *different* input is a conflict,
 *     not a silent overwrite.
 *   - **Targets.** Two different operations aimed at the same directory cannot
 *     run together, whatever ids they carry, because both would clone into it.
 *   - **Cancellation.** The AbortController belongs to the job, so "cancel
 *     requested" and "cancel confirmed" stay distinct: a clone is only
 *     `cancelled` once the child has actually closed and cleanup has settled.
 *
 * Deadlines follow the same rule. The 30-minute clone deadline starts when
 * preparation is accepted and is **cleared** when the job enters `registering`,
 * because a deadline firing during a write would label a still-writing
 * registration as cancelled and retry-safe, which it is not.
 *
 * The honest limit: these live in memory. After a dashboard restart nothing here
 * can prove whether a clone that was in flight died or finished — that question
 * belongs to `resolveProjectCreateRecovery`, which answers it from canonical
 * state, and its answer may legitimately be "unknown".
 */

import { randomUUID } from 'node:crypto';

import {
  type ResolvedProjectIntent,
  type ProjectCreateResult,
} from '../../../lib/projects/create.js';
import { performProjectCreate } from '../../../lib/projects/create-perform.js';
import {
  ProjectCreateFailureError,
  sanitizeCreationFailure,
  type ProjectCreateFailure,
} from '../../../lib/projects/create-errors.js';

/** How long a settled job's result stays readable before it is pruned. */
export const JOB_TTL_MS = 600_000; // 10 minutes
/** How long a clone may run before it is aborted (D-6). */
export const CLONE_DEADLINE_MS = 1_800_000; // 30 minutes

export type ProjectCreateJobStatus =
  | 'preparing'
  | 'cloning'
  | 'registering'
  | 'cancelling'
  | 'done'
  | 'failed'
  | 'cancelled';

/** The safe, public shape of a job. Never carries the transport URL. */
export interface ProjectCreateJob {
  id: string;
  operationId: string;
  status: ProjectCreateJobStatus;
  phase: string;
  percent: number | null;
  startedAt: number;
  finishedAt?: number;
  result?: ProjectCreateResult;
  /** Structured failure for new clients. */
  failure?: ProjectCreateFailure;
  /** Message-only failure, kept for callers that predate `failure`. */
  error?: string;
}

interface JobRuntime {
  job: ProjectCreateJob;
  controller: AbortController;
  deadline?: NodeJS.Timeout;
  retention?: NodeJS.Timeout;
  /** Set once registration begins: past this point cancellation is refused. */
  registrationStarted: boolean;
  targetPath: string;
}

interface OperationRuntime {
  operationId: string;
  fingerprint: string;
  targetPath: string;
  jobId?: string;
  /** Terminal outcome for the synchronous (existing/new) modes. */
  settled?: { result?: ProjectCreateResult; failure?: ProjectCreateFailure };
  retention?: NodeJS.Timeout;
}

const jobs = new Map<string, JobRuntime>();
const operations = new Map<string, OperationRuntime>();
/** targetPath → operationId currently owning it. */
const targetOwners = new Map<string, string>();

/**
 * A normalized description of what an operation was asked to do.
 *
 * Only runtime memory ever sees this, and it deliberately excludes the transport
 * URL's credentials: two submissions differing only by an embedded token are the
 * same request, and the fingerprint must not become a place secrets accumulate.
 */
export function operationFingerprint(intent: ResolvedProjectIntent): string {
  return JSON.stringify({
    mode: intent.mode,
    path: intent.path,
    name: intent.name,
    prefix: intent.proposedIssuePrefix,
    slug: intent.repoSlug,
  });
}

export type ReserveOutcome =
  /** A fresh operation; the caller should proceed. */
  | { status: 'reserved'; operation: OperationRuntime }
  /** Same id, same input: attach to the attempt already in flight or settled. */
  | { status: 'joined'; operation: OperationRuntime }
  /** Same id, different input — the client changed the request mid-flight. */
  | { status: 'conflict'; reason: string }
  /** A different operation already owns this destination. */
  | { status: 'target-busy'; reason: string };

/**
 * Claim an operation id and its destination before any async work begins.
 *
 * Synchronous on purpose: the guard has to close before the first `await`, or
 * two clicks in the same tick both get past it.
 */
export function reserveProjectCreateOperation(args: {
  operationId: string;
  intent: ResolvedProjectIntent;
}): ReserveOutcome {
  const fingerprint = operationFingerprint(args.intent);
  const targetPath = args.intent.path ?? '';

  const existing = operations.get(args.operationId);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      return {
        status: 'conflict',
        reason: 'This operation id was already used for a different request.',
      };
    }
    return { status: 'joined', operation: existing };
  }

  const owner = targetOwners.get(targetPath);
  if (owner && owner !== args.operationId) {
    return {
      status: 'target-busy',
      reason: `Another project is already being created at ${targetPath}.`,
    };
  }

  const operation: OperationRuntime = { operationId: args.operationId, fingerprint, targetPath };
  operations.set(args.operationId, operation);
  if (targetPath) targetOwners.set(targetPath, args.operationId);
  return { status: 'reserved', operation };
}

/** Record the terminal outcome of a synchronous (existing/new) operation. */
export function settleProjectCreateOperation(
  operationId: string,
  settled: { result?: ProjectCreateResult; failure?: ProjectCreateFailure },
): void {
  const operation = operations.get(operationId);
  if (!operation) return;
  operation.settled = settled;
  releaseTarget(operation);
  scheduleOperationRetention(operation);
}

/** The recorded outcome of an operation, when it has one. */
export function getProjectCreateOperation(operationId: string): OperationRuntime | undefined {
  return operations.get(operationId);
}

/**
 * Start a clone job for a reserved operation.
 *
 * Returns the job id immediately; the work runs in the background and its
 * progress is read back through {@link getProjectCreateJob}.
 */
export function startProjectCreateJob(
  intent: ResolvedProjectIntent,
  options: { operationId?: string } = {},
): string {
  const id = randomUUID();
  const operationId = options.operationId ?? randomUUID();
  const now = Date.now();
  const controller = new AbortController();

  const runtime: JobRuntime = {
    job: {
      id,
      operationId,
      status: 'preparing',
      phase: 'preparing',
      percent: null,
      startedAt: now,
    },
    controller,
    registrationStarted: false,
    targetPath: intent.path ?? '',
  };

  // The deadline starts with preparation and is cleared the moment registration
  // begins; a deadline that fired mid-write would report a registering job as
  // cancelled and retry-safe, and it is neither.
  runtime.deadline = setTimeout(() => {
    if (runtime.registrationStarted) return;
    controller.abort();
  }, CLONE_DEADLINE_MS);
  runtime.deadline.unref?.();

  jobs.set(id, runtime);
  const operation = operations.get(operationId);
  if (operation) operation.jobId = id;

  void runJob(runtime, intent);
  return id;
}

async function runJob(runtime: JobRuntime, intent: ResolvedProjectIntent): Promise<void> {
  const { job, controller } = runtime;
  try {
    const result = await performProjectCreate(intent, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return;
        if (progress.phase === 'registering') {
          // Past this point the clone is complete and we are writing config;
          // cancellation is no longer offered and the deadline is retired.
          runtime.registrationStarted = true;
          clearTimer(runtime.deadline);
          runtime.deadline = undefined;
          job.status = 'registering';
        } else if (job.status !== 'cancelling') {
          job.status = 'cloning';
        }
        job.phase = progress.phase;
        job.percent = progress.percent;
      },
    });
    finishJob(runtime, { status: 'done', result });
  } catch (err) {
    const failure =
      err instanceof ProjectCreateFailureError ? err.failure : sanitizeCreationFailure(err);
    finishJob(runtime, {
      status: failure.code === 'cancelled' ? 'cancelled' : 'failed',
      failure,
    });
  }
}

function finishJob(
  runtime: JobRuntime,
  outcome:
    | { status: 'done'; result: ProjectCreateResult }
    | { status: 'failed' | 'cancelled'; failure: ProjectCreateFailure },
): void {
  const { job } = runtime;
  job.finishedAt = Date.now();
  job.status = outcome.status;
  job.percent = outcome.status === 'done' ? 100 : null;
  job.phase = outcome.status;

  if (outcome.status === 'done') {
    job.result = outcome.result;
    settleProjectCreateOperation(job.operationId, { result: outcome.result });
  } else {
    job.failure = outcome.failure;
    // Older clients read `error`; keep it in step with the structured failure
    // rather than letting the two drift.
    job.error = outcome.failure.message;
    settleProjectCreateOperation(job.operationId, { failure: outcome.failure });
  }

  clearTimer(runtime.deadline);
  runtime.deadline = undefined;
  scheduleJobRetention(runtime);
}

export type CancelOutcome =
  | { status: 'cancelling'; job: ProjectCreateJob }
  | { status: 'terminal'; job: ProjectCreateJob }
  | { status: 'cannot-cancel-setup'; job: ProjectCreateJob }
  | { status: 'unknown-job' };

/**
 * Ask a job to stop. Idempotent.
 *
 * Returns `cancelling`, not `cancelled`: the job is only cancelled once the
 * child has closed and its cleanup has settled, which the caller observes by
 * polling. Reporting cancellation from here would be a claim we cannot back.
 */
export function requestProjectCreateJobCancel(jobId: string): CancelOutcome {
  const runtime = jobs.get(jobId);
  if (!runtime) return { status: 'unknown-job' };

  const { job } = runtime;
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
    return { status: 'terminal', job: { ...job } };
  }
  if (runtime.registrationStarted || job.status === 'registering') {
    // The clone finished and config is being written. Aborting now would strand
    // a half-registered project; the honest answer is "this has to finish".
    return { status: 'cannot-cancel-setup', job: { ...job } };
  }

  job.status = 'cancelling';
  job.phase = 'cancelling';
  runtime.controller.abort();
  return { status: 'cancelling', job: { ...job } };
}

/** Read a job's safe public state, or undefined when this runtime has none. */
export function getProjectCreateJob(id: string): ProjectCreateJob | undefined {
  const runtime = jobs.get(id);
  return runtime ? { ...runtime.job } : undefined;
}

function releaseTarget(operation: OperationRuntime): void {
  if (operation.targetPath && targetOwners.get(operation.targetPath) === operation.operationId) {
    targetOwners.delete(operation.targetPath);
  }
}

function scheduleJobRetention(runtime: JobRuntime): void {
  clearTimer(runtime.retention);
  runtime.retention = setTimeout(() => {
    jobs.delete(runtime.job.id);
  }, JOB_TTL_MS);
  // Unref'd: a settled job's cleanup must never be the reason the process stays
  // alive for another ten minutes.
  runtime.retention.unref?.();
}

function scheduleOperationRetention(operation: OperationRuntime): void {
  clearTimer(operation.retention);
  operation.retention = setTimeout(() => {
    operations.delete(operation.operationId);
  }, JOB_TTL_MS);
  operation.retention.unref?.();
}

function clearTimer(timer: NodeJS.Timeout | undefined): void {
  if (timer) clearTimeout(timer);
}

/** Reset every map and timer. Test-only. */
export function __resetProjectCreateJobsForTests(): void {
  for (const runtime of jobs.values()) {
    clearTimer(runtime.deadline);
    clearTimer(runtime.retention);
  }
  for (const operation of operations.values()) {
    clearTimer(operation.retention);
  }
  jobs.clear();
  operations.clear();
  targetOwners.clear();
}
