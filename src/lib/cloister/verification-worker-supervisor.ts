import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { getOverdeckHome, packageRoot } from '../paths.js';
import type { VerificationRunnerOutcome, WorkspaceInfo } from './verification-types.js';

type WorkerState = {
  runId: string;
  issueId: string;
  workspacePath: string;
  pid: number;
  startedAt: string;
  resultPath: string;
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
    const parsed = JSON.parse(readFileSync(statePath(issueId), 'utf8')) as WorkerState;
    return parsed.issueId === issueId && Number.isInteger(parsed.pid) ? parsed : null;
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

async function waitForResult(state: WorkerState): Promise<VerificationRunnerOutcome> {
  const deadline = Date.now() + MAX_RUN_MS;
  while (Date.now() < deadline) {
    if (existsSync(state.resultPath)) {
      return JSON.parse(readFileSync(state.resultPath, 'utf8')) as VerificationRunnerOutcome;
    }
    if (!isProcessAlive(state.pid)) {
      return { outcome: 'error', message: `Verification worker ${state.pid} exited before writing a result` };
    }
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
  }
  return { outcome: 'error', message: `Verification worker ${state.pid} exceeded ${MAX_RUN_MS}ms` };
}

export async function runSupervisedVerification(
  issueId: string,
  workspacePath: string,
  workspaceInfo: WorkspaceInfo,
  logPrefix: string,
  options: { syncTargetBranch?: boolean } = {},
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
  };
  writeJsonAtomic(statePath(issueId), state);
  child.unref();
  console.log(`[${logPrefix}] Verification worker ${child.pid} supervising ${issueId}`);
  return waitForResult(state);
}
