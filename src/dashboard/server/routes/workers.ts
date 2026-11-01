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
 */
import { isEffortLevel } from '@overdeck/contracts';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { startWorker, type StartWorkerOptions } from '../../../lib/agents/worker/start.js';
import type { RuntimeName } from '../../../lib/runtimes/types.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
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

export const workersRouteLayer = Layer.mergeAll(postWorkersRoute);
