/**
 * `POST /api/workers` (PAN-4649 FR-4) — the HTTP door for starting a
 * registered worker, used by the MCP `start_worker` tool.
 *
 * Auth: `rejectUnsafeDashboardMutationRequest` (a credential, a JSON content
 * type, and CSRF for cookie credentials; a Bearer token skips CSRF). The
 * route-scope table maps it to `operate`. Body: `issueId` and `prompt`
 * (required), optional `model`, `harness`, `effort`, `readOnly`, `name`. It
 * calls the same `startWorker()` core as `pan worker run`, in process, with
 * `parentId: null` (D-4649-11). 200 `{ id, cwd, branch }`; an invalid body or
 * a `startWorker` error answers 400 with the error text `pan worker run`
 * prints.
 *
 * PAN-4651 D-4651-4: two owner routes let a linked machine follow a worker it
 * delegated here. `GET /api/workers/:id/status?after=<seq>` (`read:state`)
 * answers liveness, idle age, the reports newer than `after` (at most 20) and,
 * once the worker is confirmed dead, its last assistant message.
 * `POST /api/workers/:id/stop` (`operate`) stops it; an agent actor on a
 * machine credential may stop only a worker its own machine started
 * (`worker.json` `startedBy`), else 403 `agent-fenced`. Both answer 404
 * `unknown-worker` for an id without a `worker.json`.
 */
import { isEffortLevel } from '@overdeck/contracts';
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';

import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { stopAgent } from '../../../lib/agents/termination.js';
import { idleAgeMs, isAlive, isConfirmedDead, type LivenessVerdict } from '../../../lib/agents/liveness.js';
import { readWorkerFacts, type WorkerFacts } from '../../../lib/agents/worker/facts.js';
import { listWorkerReports, type WorkerReport } from '../../../lib/agents/worker/report.js';
import { startWorker, type StartWorkerOptions } from '../../../lib/agents/worker/start.js';
import type { RuntimeName } from '../../../lib/runtimes/types.js';
import { jsonResponse } from '../http-helpers.js';
import { AGENT_FENCED } from '../link-fence.js';
import { type DashboardCredential, rejectUnsafeDashboardMutationRequest, resolveRequestCredential } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';

/** The `pan worker run --harness` set (`src/cli/commands/worker.ts`). */
const HARNESSES: readonly RuntimeName[] = ['claude-code', 'codex', 'acp', 'kimi-code', 'opencode', 'muse', 'prime-agent'];

export type ParsedStartWorkerBody = { ok: true; value: StartWorkerOptions } | { ok: false; error: string };

/** Validate a parsed JSON body; exported for tests (the Effect route is not unit-testable). */
export function parseStartWorkerBody(body: unknown): ParsedStartWorkerBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'body must be a JSON object' };
  const input = body as Record<string, unknown>;
  const { issueId, prompt, model, harness, effort, readOnly, name } = input;
  if (typeof issueId !== 'string' || !issueId.trim()) return { ok: false, error: 'issueId must be a non-empty string' };
  if (typeof prompt !== 'string' || !prompt.trim()) return { ok: false, error: 'prompt must be a non-empty string' };
  if (model !== undefined && typeof model !== 'string') return { ok: false, error: 'model must be a string' };
  if (harness !== undefined && (typeof harness !== 'string' || !(HARNESSES as readonly string[]).includes(harness))) {
    return { ok: false, error: `harness must be one of ${HARNESSES.join(', ')}` };
  }
  if (effort !== undefined && (typeof effort !== 'string' || !isEffortLevel(effort))) {
    return { ok: false, error: 'effort must be a valid effort level' };
  }
  if (readOnly !== undefined && typeof readOnly !== 'boolean') return { ok: false, error: 'readOnly must be a boolean' };
  if (name !== undefined && typeof name !== 'string') return { ok: false, error: 'name must be a string' };

  const value: StartWorkerOptions = { issueId: issueId.trim(), prompt, parentId: null };
  if (model !== undefined) value.model = model;
  if (harness !== undefined) value.harness = harness as RuntimeName;
  if (effort !== undefined) value.effort = effort;
  if (readOnly !== undefined) value.readOnly = readOnly;
  if (name !== undefined) value.name = name;
  return { ok: true, value };
}

export type StartWorkerRouteResult =
  | { status: 200; body: { id: string; cwd: string; branch: string | null } }
  | { status: 400; body: { error: string } };

/** Validate and start one worker; `start` is injectable for tests. */
export async function startWorkerFromBody(
  body: unknown,
  start: (options: StartWorkerOptions) => Promise<{ id: string; cwd: string; branch: string | null }> = startWorker,
): Promise<StartWorkerRouteResult> {
  const parsed = parseStartWorkerBody(body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  try {
    const { id, cwd, branch } = await start(parsed.value);
    emitActivityEntry({
      source: 'dashboard',
      level: 'info',
      message: `Started worker ${id} for ${parsed.value.issueId}`,
      details: JSON.stringify({ workerId: id }),
    });
    return { status: 200, body: { id, cwd, branch } };
  } catch (error: unknown) {
    return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
  }
}

const postWorkersRoute = HttpRouter.add(
  'POST',
  '/api/workers',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const text = yield* request.text;
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return jsonResponse({ error: 'body must be JSON' }, { status: 400 });
    }
    return yield* Effect.promise(async () => {
      const result = await startWorkerFromBody(body);
      return jsonResponse(result.body, { status: result.status });
    });
  })),
);

/** Reports per status answer; a follower asks again with the last `seq` it mirrored. */
export const WORKER_STATUS_REPORT_LIMIT = 20;

export interface WorkerFollowDeps {
  readFacts: (id: string) => Promise<WorkerFacts | null>;
  isAlive: (id: string) => Promise<LivenessVerdict>;
  idleAgeMs: (id: string) => number | null;
  listReports: (id: string) => Promise<WorkerReport[]>;
  lastAssistantMessage: (id: string) => Promise<string | null>;
  stop: (id: string) => Promise<void>;
}

async function lastAssistantMessageOf(id: string): Promise<string | null> {
  const { buildAgentConversationWindowResult } = await import('./agents/conversation.js');
  const result = await buildAgentConversationWindowResult(id, new URLSearchParams());
  const messages = (result.body as { messages?: Array<{ role?: string; text?: unknown }> } | null)?.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === 'assistant' && typeof message.text === 'string' && message.text.trim()) return message.text;
  }
  return null;
}

const defaultFollowDeps: WorkerFollowDeps = {
  readFacts: readWorkerFacts,
  isAlive: (id) => isAlive(id),
  idleAgeMs: (id) => idleAgeMs(id),
  listReports: listWorkerReports,
  lastAssistantMessage: lastAssistantMessageOf,
  stop: async (id) => { await Effect.runPromise(stopAgent(id, 'operator')); },
};

const unknownWorker = (): HttpServerResponse.HttpServerResponse => jsonResponse({ code: 'unknown-worker', error: 'no such worker' }, { status: 404 });

/** `GET /api/workers/:id/status?after=<seq>`. */
export async function handleWorkerStatus(id: string, after: number, deps: WorkerFollowDeps = defaultFollowDeps): Promise<HttpServerResponse.HttpServerResponse> {
  if (!(await deps.readFacts(id))) return unknownWorker();
  const verdict = await deps.isAlive(id);
  const confirmedDead = isConfirmedDead(verdict);
  // Read reports after liveness: a worker that reported in the moment before it exited is never missed.
  const reports = await deps.listReports(id);
  return jsonResponse({
    id,
    liveness: { alive: verdict.alive, confirmedDead },
    idleAgeMs: deps.idleAgeMs(id),
    reports: reports.filter((report) => report.seq > after).slice(0, WORKER_STATUS_REPORT_LIMIT),
    lastAssistantMessage: confirmedDead ? await deps.lastAssistantMessage(id).catch(() => null) : null,
  });
}

/** `POST /api/workers/:id/stop`; an agent actor stops only what its own machine started. */
export async function handleWorkerStop(
  id: string,
  credential: DashboardCredential | null,
  deps: WorkerFollowDeps = defaultFollowDeps,
): Promise<HttpServerResponse.HttpServerResponse> {
  const facts = await deps.readFacts(id);
  if (!facts) return unknownWorker();
  if (credential?.kind === 'machine' && credential.actor !== 'operator' && facts.startedBy?.environmentId !== credential.environmentId) {
    return jsonResponse({ code: AGENT_FENCED, error: 'An agent on a linked machine can stop only workers its machine started' }, { status: 403 });
  }
  await deps.stop(id);
  emitActivityEntry({ source: 'dashboard', level: 'info', message: `Stopped worker ${id}`, details: JSON.stringify({ workerId: id }) });
  return jsonResponse({ stopped: true });
}

const getWorkerStatusRoute = HttpRouter.add(
  'GET',
  '/api/workers/:id/status',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const url = HttpServerRequest.toURL(request);
    const after = Number.parseInt((Option.isSome(url) ? url.value.searchParams.get('after') : null) ?? '0', 10);
    return yield* Effect.promise(() => handleWorkerStatus(params['id'] ?? '', Number.isFinite(after) ? after : 0));
  })),
);

const postWorkerStopRoute = HttpRouter.add(
  'POST',
  '/api/workers/:id/stop',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const credential = resolveRequestCredential(request);
    // A machine credential arrives as a Bearer header inside a channel: no form can send it, so no CSRF check.
    if (credential?.kind !== 'machine') {
      const authError = rejectUnsafeDashboardMutationRequest(request);
      if (authError) return authError;
    }
    const params = yield* HttpRouter.params;
    return yield* Effect.promise(() => handleWorkerStop(params['id'] ?? '', credential));
  })),
);

export const workersRouteLayer = Layer.mergeAll(postWorkersRoute, getWorkerStatusRoute, postWorkerStopRoute);
