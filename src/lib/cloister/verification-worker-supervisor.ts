import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { getOverdeckHome, packageRoot } from '../paths.js';
import type { VerificationRunnerOptions, VerificationRunnerOutcome, WorkspaceInfo } from './verification-types.js';

export type WorkerState = {
  runId: string;
  issueId: string;
  workspacePath: string;
  pid: number;
  startedAt: string;
  resultPath: string;
  phase: 'queued' | 'running';
  admittedAt: string | null;
  currentGate?: string;
  currentAttempt?: number;
};

const POLL_MS = 250;
const MAX_RUN_MS = 65 * 60 * 1000;

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

export function readVerificationWorkerState(issueId: string): WorkerState | null {
  try {
    const parsed = JSON.parse(readFileSync(statePath(issueId), 'utf8')) as Partial<WorkerState>;
    if (
      parsed.issueId !== issueId
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

function writeJsonAtomic(path: string, value: unknown): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

export function verificationWorkerDeadline(state: WorkerState): number | null {
  if (!state.admittedAt) return null;
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
    admittedAt: state.admittedAt ?? update.admittedAt ?? null,
    currentGate: update.gateName,
    currentAttempt: update.attempt,
  });
}

async function waitForResult(state: WorkerState): Promise<VerificationRunnerOutcome> {
  for (;;) {
    if (existsSync(state.resultPath)) {
      return JSON.parse(readFileSync(state.resultPath, 'utf8')) as VerificationRunnerOutcome;
    }
    if (!isProcessAlive(state.pid)) {
      return { outcome: 'error', message: `Verification worker ${state.pid} exited before writing a result` };
    }
    const current = readVerificationWorkerState(state.issueId) ?? state;
    const deadline = verificationWorkerDeadline(current);
    if (deadline !== null && Date.now() >= deadline) {
      return { outcome: 'error', message: `Verification worker ${state.pid} exceeded ${MAX_RUN_MS}ms after CPU admission` };
    }
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export async function runSupervisedVerification(
  issueId: string,
  workspacePath: string,
  workspaceInfo: WorkspaceInfo,
  logPrefix: string,
  options: Pick<VerificationRunnerOptions, 'syncTargetBranch' | 'skipPlanChecklist'> = {},
): Promise<VerificationRunnerOutcome> {
  const existing = readVerificationWorkerState(issueId);
  if (existing && existing.workspacePath === workspacePath && isProcessAlive(existing.pid) && !existsSync(existing.resultPath)) {
    console.log(`[${logPrefix}] Joining live verification worker ${existing.pid} for ${issueId}`);
    return waitForResult(existing);
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

  const logFd = openSync(logPath, 'a');
  const child = spawn(process.execPath, [
    workerPath,
    JSON.stringify({ issueId, workspacePath, workspaceInfo, logPrefix, options, runId, resultPath }),
  ], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, OVERDECK_VERIFICATION_WORKER: '1' },
  });
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
  };
  writeJsonAtomic(statePath(issueId), state);
  child.unref();
  console.log(`[${logPrefix}] Verification worker ${child.pid} supervising ${issueId}`);
  return waitForResult(state);
}
