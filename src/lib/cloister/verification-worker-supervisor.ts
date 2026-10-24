import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfigSync } from '../config-yaml/load.js';
import { getOverdeckHome, packageRoot } from '../paths.js';
import { snapshotWorkspaceHeads, type HeadAnchor } from '../git-utils.js';
import { classifyWorkspaceVerificationHead, isSameVerificationHead } from './verification-head.js';
import type { VerificationRunnerOptions, VerificationRunnerOutcome, WorkspaceInfo } from './verification-types.js';
import { buildVerificationWorkerLaunch, launchVerificationWorker } from './verification-worker-launcher.js';

type SupervisedOptions = Pick<VerificationRunnerOptions, 'syncTargetBranch' | 'skipPlanChecklist'>;

export type WorkerState = {
  runId: string;
  issueId: string;
  workspacePath: string;
  pid: number;
  startedAt: string;
  resultPath: string;
  phase: 'queued' | 'running';
  admittedAt: string | null;
  headAnchor?: HeadAnchor;
  systemdUnit?: string;
  currentGate?: string;
  currentAttempt?: number;
  /** PAN-4532: the door that launched the worker (`request-review`, `review`, `merge-verify`). */
  logPrefix?: string;
  /** PAN-4532: the options the worker runs with; a result is adopted only for the same options. */
  options?: SupervisedOptions;
  /** PAN-4532: when a waiter took this run's result. A result is consumed at most once. */
  resultConsumedAt?: string;
};

const POLL_MS = 250;
const MAX_RUN_MS = 65 * 60 * 1000;
const WORKER_EXIT_POLL_MS = 50;
const WORKER_EXIT_GRACE_MS = 1_000;

function safeIssueId(issueId: string): string {
  return issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

function workerDir(issueId: string): string {
  return join(getOverdeckHome(), 'verification-workers', safeIssueId(issueId));
}

function statePath(issueId: string): string {
  return join(workerDir(issueId), 'state.json');
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill an expired worker and its gate children. The worker is spawned
 * detached, so it leads its own process group — signal the group first so a
 * mid-gate `npm`/`bun` child dies with it, falling back to the bare pid.
 * Wait for the worker to exit before returning so timeout recovery cannot
 * overlap a fresh verification run with the expired worker.
 */
async function killWorkerProcessGroup(pid: number): Promise<boolean> {
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    try {
      process.kill(-pid, signal);
    } catch {
      try { process.kill(pid, signal); } catch { /* already gone */ }
    }
    const deadline = Date.now() + WORKER_EXIT_GRACE_MS;
    while (isProcessAlive(pid) && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, WORKER_EXIT_POLL_MS));
    }
    if (!isProcessAlive(pid)) return true;
  }
  return false;
}

export function readVerificationWorkerState(issueId: string): WorkerState | null {
  try {
    const parsed = JSON.parse(readFileSync(statePath(issueId), 'utf8')) as Partial<WorkerState>;
    if (
      typeof parsed.issueId !== 'string' || parsed.issueId.toUpperCase() !== issueId.toUpperCase()
      || !Number.isInteger(parsed.pid)
      || typeof parsed.runId !== 'string'
      || typeof parsed.workspacePath !== 'string'
      || typeof parsed.startedAt !== 'string'
      || typeof parsed.resultPath !== 'string'
    ) return null;
    return {
      ...parsed,
      runId: parsed.runId,
      issueId,
      workspacePath: parsed.workspacePath,
      pid: parsed.pid!,
      startedAt: parsed.startedAt,
      resultPath: parsed.resultPath,
      phase: parsed.phase === 'queued' ? 'queued' : 'running',
      admittedAt: parsed.admittedAt === undefined ? parsed.startedAt : parsed.admittedAt,
    };
  } catch {
    return null;
  }
}

export function isVerificationWorkerActive(issueId: string): boolean {
  const state = readVerificationWorkerState(issueId);
  return !!state && isProcessAlive(state.pid) && !existsSync(state.resultPath);
}

/**
 * PAN-4532: workers launched by `logPrefix` that a restarted dashboard should
 * re-attach to — still running with no result, or finished with a result no
 * waiter consumed. An `error` result is never adopted.
 */
export function listAdoptableVerificationWorkers(logPrefix: string): WorkerState[] {
  const root = join(getOverdeckHome(), 'verification-workers');
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const adoptable: WorkerState[] = [];
  for (const entry of entries) {
    let issueId: unknown;
    try {
      issueId = (JSON.parse(readFileSync(join(root, entry, 'state.json'), 'utf8')) as { issueId?: unknown }).issueId;
    } catch {
      continue;
    }
    if (typeof issueId !== 'string' || safeIssueId(issueId) !== entry) continue;
    const state = readVerificationWorkerState(issueId);
    if (!state || state.logPrefix !== logPrefix) continue;
    const finished = existsSync(state.resultPath);
    if (!finished && isProcessAlive(state.pid)) {
      adoptable.push(state);
    } else if (finished && !state.resultConsumedAt) {
      const result = readResult(state.resultPath);
      if (result && result.outcome !== 'error') adoptable.push(state);
    }
  }
  return adoptable;
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

function verificationWorkerDeadline(state: WorkerState): number | null {
  if (state.phase !== 'running' || !state.admittedAt) return null;
  const admittedAt = Date.parse(state.admittedAt);
  return Number.isFinite(admittedAt) ? admittedAt + MAX_RUN_MS : null;
}

export function markVerificationWorkerAdmissionPhase(
  issueId: string,
  update: {
    phase: 'queued' | 'running';
    gateName: string;
    attempt: number;
    admittedAt?: string;
  },
): void {
  const state = readVerificationWorkerState(issueId);
  if (!state || state.pid !== process.pid) return;
  writeJsonAtomic(statePath(issueId), {
    ...state,
    phase: update.phase,
    admittedAt: update.phase === 'running' ? update.admittedAt ?? null : null,
    currentGate: update.gateName,
    currentAttempt: update.attempt,
  });
}

/** Record that `runId`'s result has a consumer, unless a newer run replaced the state. */
function markResultConsumed(issueId: string, runId: string): void {
  const state = readVerificationWorkerState(issueId);
  if (!state || state.runId !== runId) return;
  try {
    writeJsonAtomic(statePath(issueId), { ...state, resultConsumedAt: new Date().toISOString() });
  } catch { /* best-effort: an unrecorded consumption costs one re-run, never a lost result */ }
}

function readResult(path: string): VerificationRunnerOutcome | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as VerificationRunnerOutcome;
  } catch {
    return null;
  }
}

async function waitForResult(state: WorkerState): Promise<VerificationRunnerOutcome> {
  for (;;) {
    if (existsSync(state.resultPath)) {
      const result = JSON.parse(readFileSync(state.resultPath, 'utf8')) as VerificationRunnerOutcome;
      markResultConsumed(state.issueId, state.runId);
      return result;
    }
    if (!isProcessAlive(state.pid)) {
      return { outcome: 'error', message: `Verification worker ${state.pid} exited before writing a result` };
    }
    const current = readVerificationWorkerState(state.issueId) ?? state;
    const deadline = verificationWorkerDeadline(current);
    if (deadline !== null && Date.now() >= deadline) {
      // PAN-3674 follow-up: kill the expired worker — it outlived its budget.
      // Leaving it alive stranded PAN-3668 on 2026-08-13: every later attempt
      // re-joined the zombie registration and instantly re-failed on the same
      // deadline, and no fresh worker ever started.
      await killWorkerProcessGroup(state.pid);
      return { outcome: 'error', message: `Verification worker ${state.pid} exceeded ${MAX_RUN_MS}ms after CPU admission` };
    }
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
  }
}

const activeSupervisorRuns = new Map<string, Promise<VerificationRunnerOutcome>>();

/**
 * PAN-4527: is `existing` still verifying `headAnchor`? Review verification
 * moves HEAD with its own target-branch sync merge, and that still counts as
 * the launch head; an agent commit since launch does not. Merge verification
 * never syncs, so only its exact anchor counts.
 */
async function workerVerifiesHead(
  existing: WorkerState,
  issueId: string,
  workspacePath: string,
  headAnchor: HeadAnchor | undefined,
  options: SupervisedOptions,
): Promise<boolean> {
  const relation = await classifyWorkspaceVerificationHead(issueId, workspacePath, existing.headAnchor, headAnchor);
  return options.syncTargetBranch === false ? relation === 'same' : isSameVerificationHead(relation);
}

function sameOptions(a: SupervisedOptions | undefined, b: SupervisedOptions): boolean {
  return (a?.syncTargetBranch !== false) === (b.syncTargetBranch !== false)
    && !!a?.skipPlanChecklist === !!b.skipPlanChecklist;
}

/**
 * PAN-4532: a finished result nobody consumed — its waiter died with the
 * previous dashboard process — is the answer for the same head, so it is
 * adopted instead of re-running every gate. An `error` result is not adopted.
 */
async function adoptUnconsumedResult(
  existing: WorkerState,
  issueId: string,
  workspacePath: string,
  headAnchor: HeadAnchor | undefined,
  options: SupervisedOptions,
): Promise<VerificationRunnerOutcome | null> {
  if (existing.resultConsumedAt || existing.workspacePath !== workspacePath || !existsSync(existing.resultPath)) return null;
  if (!existing.options || !sameOptions(existing.options, options)) return null;
  const result = readResult(existing.resultPath);
  if (!result || result.outcome === 'error') return null;
  if (!await workerVerifiesHead(existing, issueId, workspacePath, headAnchor, options)) return null;
  markResultConsumed(issueId, existing.runId);
  return result;
}

async function runSupervisedVerificationInternal(
  issueId: string,
  workspacePath: string,
  workspaceInfo: WorkspaceInfo,
  logPrefix: string,
  options: SupervisedOptions = {},
): Promise<VerificationRunnerOutcome> {
  const headAnchor = await snapshotWorkspaceHeads(issueId, workspacePath);
  const existing = readVerificationWorkerState(issueId);
  const adopted = existing ? await adoptUnconsumedResult(existing, issueId, workspacePath, headAnchor, options) : null;
  if (adopted) {
    console.log(`[${logPrefix}] Adopting the unconsumed ${adopted.outcome} result of verification worker ${existing!.pid} for ${issueId}`);
    return adopted;
  }
  // Never join a worker past its deadline: its result (if it ever lands) is
  // for a stale gate run, and waitForResult would re-fail on the same deadline
  // forever. Kill it and fall through to a fresh worker.
  if (existing && existing.workspacePath === workspacePath && isProcessAlive(existing.pid) && !existsSync(existing.resultPath)) {
    const existingDeadline = verificationWorkerDeadline(existing);
    // PAN-4527: join only a worker that is still verifying the requested head.
    const sameHead = await workerVerifiesHead(existing, issueId, workspacePath, headAnchor, options);
    if (sameHead && (existingDeadline === null || Date.now() < existingDeadline)) {
      console.log(`[${logPrefix}] Joining live verification worker ${existing.pid} for ${issueId}`);
      return waitForResult(existing);
    }
    const reason = sameHead ? 'past its deadline' : 'for a different workspace HEAD';
    console.warn(`[${logPrefix}] Verification worker ${existing.pid} for ${issueId} is ${reason} — killing it and starting fresh`);
    if (!await killWorkerProcessGroup(existing.pid)) {
      return {
        outcome: 'error',
        message: `Verification worker ${existing.pid} is ${reason} but still alive; refusing to start an overlapping worker`,
      };
    }
  }

  const dir = workerDir(issueId);
  mkdirSync(dir, { recursive: true });
  const runId = `${Date.now()}-${process.pid}`;
  const resultPath = join(dir, `result-${runId}.json`);
  const logPath = join(dir, `worker-${runId}.log`);
  const workerPath = process.env.OVERDECK_VERIFICATION_WORKER_PATH
    || join(packageRoot, 'dist', 'verification-worker.js');
  if (!existsSync(workerPath)) {
    return { outcome: 'error', message: `Verification worker bundle missing at ${workerPath}; run npm run build` };
  }

  const request = JSON.stringify({ issueId, workspacePath, workspaceInfo, logPrefix, options, runId, resultPath });
  const launch = buildVerificationWorkerLaunch(
    issueId,
    runId,
    workerPath,
    request,
    process.env,
    process.platform,
    loadConfigSync().config.resources.verificationCpuWeight,
  );
  const logFd = openSync(logPath, 'a');
  const child = launchVerificationWorker(
    launch,
    logFd,
    { ...process.env, OVERDECK_VERIFICATION_WORKER: '1' },
  );
  closeSync(logFd);
  if (!child.pid) return { outcome: 'error', message: 'Failed to spawn verification worker' };

  const state: WorkerState = {
    runId,
    issueId,
    workspacePath,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    resultPath,
    phase: 'queued',
    admittedAt: null,
    logPrefix,
    options,
    ...(headAnchor ? { headAnchor } : {}),
    ...(launch.systemdUnit ? { systemdUnit: launch.systemdUnit } : {}),
  };
  writeJsonAtomic(statePath(issueId), state);
  child.unref();
  console.log(`[${logPrefix}] Verification worker ${child.pid} supervising ${issueId}`);
  return waitForResult(state);
}

export function runSupervisedVerification(
  issueId: string,
  workspacePath: string,
  workspaceInfo: WorkspaceInfo,
  logPrefix: string,
  options: SupervisedOptions = {},
): Promise<VerificationRunnerOutcome> {
  const key = issueId.toUpperCase();
  const active = activeSupervisorRuns.get(key);
  if (active) return active;

  const run = runSupervisedVerificationInternal(issueId, workspacePath, workspaceInfo, logPrefix, options)
    .finally(() => activeSupervisorRuns.delete(key));
  activeSupervisorRuns.set(key, run);
  return run;
}
