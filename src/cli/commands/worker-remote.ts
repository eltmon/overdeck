/**
 * `pan worker run --machine` and waiting on a stand-in (PAN-4651 FR-2,
 * D-4651-6, D-4651-7).
 *
 * `--machine auto` asks `POST /api/fleet/placement` first; when Auto picks this
 * machine (or `--machine` names it) the local path runs unchanged. Otherwise
 * the CLI refuses unpushed commits (unless `--push-first` / `--ignore-unpushed`),
 * posts `POST /api/fleet/workers` with this process's sender (so an agent's
 * delegation reaches the owner as that agent, not the operator), prints
 * `Started <localId> on <label>`, and waits on the stand-in like a local worker.
 *
 * The stand-in wait (`standInWaitDeps`, `waitForAnyWorker`) lives in
 * `src/lib/agents/worker/wait-any.ts` (PAN-4938 D-4) and is re-exported here.
 *
 * `--machine fly` refuses here (PAN-4743 D-4743-1): a worker needs its issue
 * workspace, which a new VM never has. `pan start <id> --machine fly` never
 * reaches this check: `issueCommand` turns it into `--remote`, which starts the
 * work agent on a new Fly machine (PAN-4734). `FLY_CLI_REFUSAL` names both.
 */
import type { PlacementAnswer, PlacementRejection } from '@overdeck/contracts';

import { senderFromEnv } from '../../lib/terminal-backends/prompt-guard.js';
import type { PushCheckOptions, PushCheckResult } from './delegation-push-check.js';

export { standInWaitDeps, waitForAnyWorker } from '../../lib/agents/worker/wait-any.js';

export interface RemoteWorkerCliDeps {
  call: (path: string, init: { method: string; body?: unknown; headers?: Record<string, string> }) => Promise<{ status: number; json: unknown }>;
  senderId: () => string;
  issueOrigin: (issueId: string) => Promise<string | null>;
  pushCheck: (cwd: string, options: PushCheckOptions) => Promise<PushCheckResult>;
}

export const defaultRemoteWorkerCliDeps = (): RemoteWorkerCliDeps => ({
  call: async (path, init) => {
    const { callDashboard } = await import('./dashboard-call.js');
    const response = await callDashboard(path, init);
    return { status: response.status, json: await response.json().catch(() => null) };
  },
  senderId: () => senderFromEnv().id,
  issueOrigin: async (issueId) => {
    const [{ Effect }, { getProjectSync, resolveProjectFromIssue }, { gitOriginOf }] = await Promise.all([
      import('effect'), import('../../lib/projects.js'), import('../../lib/anywhere/project-origin.js'),
    ]);
    const resolved = await Effect.runPromise(resolveProjectFromIssue(issueId)).catch(() => null);
    return gitOriginOf(resolved ? getProjectSync(resolved.projectKey) ?? undefined : undefined);
  },
  pushCheck: async (cwd, options) => (await import('./delegation-push-check.js')).checkUnpushedCommits(cwd, options),
});

/** Comma-separated `--needs` tags. */
export function parseNeedsFlag(raw: string | undefined): string[] {
  return raw ? [...new Set(raw.split(',').map((tag) => tag.trim().toLowerCase()).filter((tag) => tag !== ''))] : [];
}

export function rejectionLine(rejections: readonly PlacementRejection[]): string {
  return `No machine fits: ${rejections.map((rejection) => `${rejection.label}: ${rejection.reason}`).join('; ')}`;
}

const errorOf = (json: unknown, status: number): string => {
  const error = (json as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? error : `HTTP ${status}`;
};

/** Where `--machine` points: this machine (run locally), another machine, or a refusal. */
export type MachineTarget =
  | { kind: 'self'; reason: string | null }
  | { kind: 'remote'; machine: string; label: string; reason: string | null }
  | { kind: 'error'; message: string };

/** PAN-4743 D-4743-6: `--machine fly` refuses for work agents and workers. */
export const FLY_CLI_REFUSAL = '--machine fly starts a new Fly machine for a conversation only: use Fly (new VM) in the new-conversation dialog, or pan machines add-fly --project <key> --message <text>. For a work agent on a new Fly machine, run pan start <id> --remote.';

export async function resolveMachineFlag(
  machine: string,
  needs: readonly string[],
  gitOrigin: string | null,
  deps: Pick<RemoteWorkerCliDeps, 'call'>,
): Promise<MachineTarget> {
  if (machine.toLowerCase() === 'fly') return { kind: 'error', message: FLY_CLI_REFUSAL };
  if (machine.toLowerCase() === 'auto') {
    const answer = await deps.call('/api/fleet/placement', { method: 'POST', body: { gitOrigin, needs } });
    if (answer.status !== 200) return { kind: 'error', message: `Placement failed: ${errorOf(answer.json, answer.status)}` };
    const placement = answer.json as PlacementAnswer;
    if (!placement.ok) return { kind: 'error', message: rejectionLine(placement.rejections) };
    return placement.self
      ? { kind: 'self', reason: placement.reason }
      : { kind: 'remote', machine: placement.environmentId, label: placement.label, reason: placement.reason };
  }
  const listed = await deps.call('/api/machines', { method: 'GET' });
  const body = listed.json as { self?: { environmentId: string; label: string }; links?: Array<{ environmentId: string; label: string }> } | null;
  const wanted = machine.toLowerCase();
  if (body?.self && (machine === body.self.environmentId || wanted === body.self.label.toLowerCase())) return { kind: 'self', reason: null };
  const link = body?.links?.find((candidate) => candidate.environmentId === machine || candidate.label.toLowerCase() === wanted);
  return { kind: 'remote', machine, label: link?.label ?? machine, reason: null };
}

export interface RemoteRunInput {
  machine: string;
  needs: string[];
  issueId: string;
  prompt: string;
  parentId: string | null;
  model?: string;
  harness?: string;
  effort?: string;
  readOnly: boolean;
  name?: string;
  cwd: string;
  pushFirst: boolean;
  ignoreUnpushed: boolean;
}

/** Post the fleet worker route for a remote target; the started stand-in id, or an error line. */
export async function startRemoteWorker(
  input: RemoteRunInput,
  target: Extract<MachineTarget, { kind: 'remote' }>,
  deps: RemoteWorkerCliDeps,
  stderr: (text: string) => void,
): Promise<{ id: string } | { error: string }> {
  const check = await deps.pushCheck(input.cwd, { label: target.label, pushFirst: input.pushFirst, ignoreUnpushed: input.ignoreUnpushed });
  if (!check.ok) return { error: check.message };
  if (check.note) stderr(check.note);
  const body: Record<string, unknown> = { machine: target.machine, issueId: input.issueId, prompt: input.prompt, readOnly: input.readOnly, parentId: input.parentId };
  if (input.needs.length > 0) body.needs = input.needs;
  for (const key of ['model', 'harness', 'effort', 'name'] as const) if (input[key]) body[key] = input[key];
  const answer = await deps.call('/api/fleet/workers', { method: 'POST', body, headers: { 'x-overdeck-sender': deps.senderId() } });
  const id = (answer.json as { id?: unknown } | null)?.id;
  if (answer.status !== 200 || typeof id !== 'string') return { error: `Could not start the worker on ${target.label}: ${errorOf(answer.json, answer.status)}` };
  stderr(`Started ${id} on ${target.label}`);
  if (target.reason) stderr(target.reason);
  return { id };
}

/** `--stop-after-report` for a stand-in: the fleet route forwards the stop to the owner. */
export async function stopRemoteWorker(id: string, deps: Pick<RemoteWorkerCliDeps, 'call' | 'senderId'>): Promise<void> {
  const answer = await deps.call(`/api/fleet/workers/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {}, headers: { 'x-overdeck-sender': deps.senderId() } });
  if (answer.status !== 200) throw new Error(errorOf(answer.json, answer.status));
}
