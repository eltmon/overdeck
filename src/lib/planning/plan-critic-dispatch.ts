/**
 * Plan critic dispatch (PAN-4341 FR-4, FR-8, FR-10, FR-11, FR-12).
 *
 * `pan plan finalize` calls `dispatchPlanCritic` when the critique gate
 * reports a missing or stale critique. It starts one read-only `worker` on the
 * configured different-family model, checks the launched harness and model
 * against the resolution, waits for the report, and writes the critique file
 * with the plan digest on line 1. The worker is named `plan-critic-r<N>`, so a
 * re-run waits on a live critic or reuses its finished report instead of
 * starting another one.
 *
 * Only the CLI dispatches; the complete-planning server only verifies.
 */
import { readFile, writeFile as writeFileAsync } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { Effect } from 'effect';

import { getAgentState as readAgentState, type AgentState } from '../agents/agent-state-read.js';
import type { LivenessVerdict } from '../agents/liveness.js';
import { listWorkers as listAllWorkers, type WorkerListing } from '../agents/worker/list.js';
import { startWorker as startRegisteredWorker, type StartWorkerDeps } from '../agents/worker/start.js';
import { waitForWorkerReport as waitForReport, type WaitOptions, type WaitOutcome } from '../agents/worker/wait.js';
import { packageRoot } from '../paths.js';
import { planDigest } from '../xbrief/plan-digest.js';
import { familyOf, type PlanCriticResolution } from './plan-critic-model.js';
import { critiquePathForRound } from './plan-critique-io.js';

export const PLAN_CRITIC_TIMEOUT_MS = 540_000;

export interface DispatchPlanCriticInput {
  issueId: string;
  workspacePath: string;
  prdPath: string;
  doc: unknown;
  round: 1 | 2;
  parentId: string;
  critic: Extract<PlanCriticResolution, { ok: true }>;
  /** Default 540 s: inside a 10-minute foreground Bash call. */
  timeoutMs?: number;
}

export type DispatchPlanCriticResult =
  | { kind: 'written'; path: string; workerId: string }
  | { kind: 'running'; workerId: string; message: string }
  | { kind: 'failed'; workerId: string | null; message: string };

export interface DispatchDeps {
  startWorker?: typeof startRegisteredWorker;
  startWorkerDeps?: StartWorkerDeps;
  waitForWorkerReport?: (id: string, options: WaitOptions) => Promise<WaitOutcome>;
  listWorkers?: (filter: { issueId: string }) => Promise<WorkerListing[]>;
  isAlive?: (id: string) => Promise<LivenessVerdict>;
  getAgentState?: (id: string) => AgentState | null;
  stopWorker?: (id: string) => Promise<void>;
  readRoleText?: () => Promise<string>;
  writeFile?: (path: string, content: string) => Promise<void>;
}

async function defaultIsAlive(id: string): Promise<LivenessVerdict> {
  const { isAlive } = await import('../agents/liveness.js');
  return isAlive(id);
}

async function defaultStopWorker(id: string): Promise<void> {
  const { stopAgent } = await import('../agents/termination.js');
  await Effect.runPromise(stopAgent(id, 'operator'));
}

function defaultReadRoleText(): Promise<string> {
  return readFile(join(packageRoot, 'roles', 'plan-critic.md'), 'utf-8');
}

export function planCriticWorkerName(round: 1 | 2): string {
  return `plan-critic-r${round}`;
}

/** The critic brief: role text, then the issue-specific inputs. Nothing from the planner's session. */
export function buildPlanCriticBrief(input: {
  roleText: string;
  issueId: string;
  round: 1 | 2;
  prdRelPath: string;
  draftJson: string;
}): string {
  return [
    input.roleText.trimEnd(),
    '',
    '---',
    '',
    `Issue: ${input.issueId}`,
    `Critique round: ${input.round}`,
    `PRD: ${input.prdRelPath}`,
    '',
    'Draft xBRIEF:',
    '',
    '```json',
    input.draftJson,
    '```',
  ].join('\n');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function dispatchPlanCritic(
  input: DispatchPlanCriticInput,
  deps: DispatchDeps = {},
): Promise<DispatchPlanCriticResult> {
  const listWorkers = deps.listWorkers ?? listAllWorkers;
  const waitForWorkerReport = deps.waitForWorkerReport ?? waitForReport;
  const isAlive = deps.isAlive ?? defaultIsAlive;
  const getAgentState = deps.getAgentState ?? readAgentState;
  const stopWorker = deps.stopWorker ?? defaultStopWorker;
  const writeFile = deps.writeFile ?? ((path: string, content: string) => writeFileAsync(path, content, 'utf-8'));
  const timeoutMs = input.timeoutMs ?? PLAN_CRITIC_TIMEOUT_MS;
  const name = planCriticWorkerName(input.round);
  const digest = planDigest(input.doc);
  const stop = (id: string) => stopWorker(id).catch(() => {});

  const writeCritique = async (workerId: string, body: string): Promise<DispatchPlanCriticResult> => {
    const path = critiquePathForRound(input.prdPath, input.round);
    await writeFile(path, `plan-digest: ${digest}\n\n${body.trim()}\n`);
    await stop(workerId);
    return { kind: 'written', path, workerId };
  };

  // FR-12: a finished critic's report is used as is; a live one is waited on.
  const existing = (await listWorkers({ issueId: input.issueId })).filter((worker) => worker.facts?.name === name);
  const finished = [...existing].reverse().find((worker) => worker.latestReport?.status === 'done');
  if (finished?.latestReport) return writeCritique(finished.id, finished.latestReport.body);

  let workerId: string | null = null;
  for (const worker of [...existing].reverse()) {
    if (worker.latestReport) continue;
    const verdict = await isAlive(worker.id).catch(() => null);
    if (verdict?.alive === true) {
      workerId = worker.id;
      break;
    }
  }

  if (!workerId) {
    const roleText = await (deps.readRoleText ?? defaultReadRoleText)();
    const brief = buildPlanCriticBrief({
      roleText,
      issueId: input.issueId,
      round: input.round,
      prdRelPath: relative(input.workspacePath, input.prdPath),
      draftJson: JSON.stringify(input.doc, null, 2),
    });
    try {
      const started = await (deps.startWorker ?? startRegisteredWorker)(
        {
          issueId: input.issueId,
          prompt: brief,
          parentId: input.parentId,
          model: input.critic.model,
          harness: input.critic.harness,
          readOnly: true,
          name,
        },
        { resolveWorkspace: () => input.workspacePath, ...deps.startWorkerDeps },
      );
      workerId = started.id;
    } catch (error) {
      const failedId = (error as { workerId?: unknown }).workerId;
      return {
        kind: 'failed',
        workerId: typeof failedId === 'string' ? failedId : null,
        message: `could not start the plan critic: ${errorMessage(error)}`,
      };
    }

    // FR-10: the launched session must be the resolved harness and a different family.
    const state = getAgentState(workerId);
    const launchedHarness = state?.harness ?? 'unknown';
    const launchedModel = state?.model ?? 'unknown';
    if (!state || launchedHarness !== input.critic.harness || familyOf(launchedModel) === input.critic.plannerFamily) {
      await stop(workerId);
      return {
        kind: 'failed',
        workerId,
        message: `critic launched on ${launchedHarness}/${launchedModel}, expected ${input.critic.harness}/${input.critic.model}`,
      };
    }
  }

  const outcome = await waitForWorkerReport(workerId, { afterSeq: 0, timeoutMs });
  if (outcome.kind === 'timeout') {
    return {
      kind: 'running',
      workerId,
      message: `critic ${workerId} still running; re-run pan plan finalize to wait for it`,
    };
  }
  if (outcome.kind !== 'report') {
    await stop(workerId);
    return {
      kind: 'failed',
      workerId,
      message: `critic ${workerId} ${outcome.kind}: ${outcome.lastAssistantMessage ?? 'no last message'}`,
    };
  }
  if (outcome.report.status !== 'done') {
    await stop(workerId);
    return { kind: 'failed', workerId, message: `critic ${workerId} reported ${outcome.report.status}: ${outcome.report.body}` };
  }
  return writeCritique(workerId, outcome.report.body);
}
