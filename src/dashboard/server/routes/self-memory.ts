/**
 * `POST /api/self/memory/facts` (PAN-4927 W-MEM1, PAN-4940; epic D-10, D-11,
 * D-12): an agent adds a curated memory fact. `POST /api/self/memory/search`
 * (WI-3, mem-search-route) shares this file. Each route needs an agent token
 * and takes the agent and its cwd from the token, never the body; builds argv
 * only from `SelfJobArg` pieces; starts a `pan memory` self job in the
 * caller's cwd, waits up to 50 s and answers 200 with the job answer. No CSRF
 * check: only a header-borne agent token is accepted. Bad bodies are 400
 * `bad-body` / `bad-request`.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { WAIT_CHUNK_MS } from '../../../lib/mcp/tool.js';
import { MEMORY_FACT_DESCRIPTION_MAX, MEMORY_FACT_ID, MEMORY_FACT_TYPES, type MemoryFactType } from '../../../lib/memory/facts/store.js';
import { jsonResponse } from '../http-helpers.js';
import { type SelfCaller, type SelfCallerDeps, selfCallerFromCredential } from '../self-caller.js';
import { type SelfJobArg, SelfJobArgError, type SelfJobVerb } from '../services/self-job-argv.js';
import { selfJobAnswer, selfJobs, type SelfJobs } from '../services/self-jobs.js';
import { type DashboardCredential, resolveRequestCredential } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';
import type { SelfRouteResult } from './self-jobs.js';

export interface SelfMemoryRouteDeps {
  jobs?: SelfJobs;
  caller?: SelfCallerDeps;
}

const MEMORY_FACT_BODY_MAX = 16_384;
const MEMORY_FACT_TITLE_MAX = 200;
const MEMORY_FACT_TAGS_MAX = 20;
const MEMORY_FACT_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

const BAD_BODY = { error: 'body must be a JSON object', code: 'bad-body' } as const;
const UNKNOWN_JOB = { error: 'no such job', code: 'unknown-job' } as const;

function badRequest(error: string): SelfRouteResult {
  return { status: 400, body: { error, code: 'bad-request' } };
}

/** A JSON object, or null for anything else. Never throws, so a parse error cannot quote the body. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** D-1, D-9, D-11: start a job, wait up to WAIT_CHUNK_MS, answer 200 with the job answer. */
async function startMemoryJob(
  jobs: SelfJobs,
  caller: SelfCaller,
  verb: SelfJobVerb,
  args: readonly SelfJobArg[],
  signal?: AbortSignal,
): Promise<SelfRouteResult> {
  let started;
  try {
    started = jobs.start(caller, verb, args);
  } catch (error) {
    if (error instanceof SelfJobArgError) return { status: 400, body: { error: error.message, code: error.code } };
    throw error;
  }
  if (!started.ok) return { status: 429, body: { error: started.error, code: started.code } };
  const state = await jobs.wait(started.jobId, caller, WAIT_CHUNK_MS, signal);
  return state ? { status: 200, body: selfJobAnswer(state) } : { status: 404, body: UNKNOWN_JOB };
}

/** D-6, D-7: `memory_add`'s body into `pan memory add`'s SelfJobArg argv, or the first validation failure. */
export function memoryAddJobArgs(body: Record<string, unknown>): { ok: true; args: SelfJobArg[] } | { ok: false; error: string } {
  const { id, type, store: rawStore, description: rawDescription, title: rawTitle, body: rawBody, tags: rawTags } = body;

  if (typeof id !== 'string' || !MEMORY_FACT_ID.test(id)) return { ok: false, error: 'id must match ^[a-z0-9][a-z0-9-]{0,79}$' };
  if (typeof type !== 'string' || !(MEMORY_FACT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `type must be one of ${MEMORY_FACT_TYPES.join(', ')}` };
  }
  const factType = type as MemoryFactType;

  let store: 'project' | 'user' | 'machine';
  if (rawStore === undefined) {
    store = factType === 'user' ? 'user' : 'project';
  } else if (rawStore === 'project' || rawStore === 'user' || rawStore === 'machine') {
    store = rawStore;
  } else {
    return { ok: false, error: 'store must be project, user or machine' };
  }
  if (factType === 'user' && store === 'project') return { ok: false, error: 'user facts go in the operator store: store must be user or machine' };

  if (typeof rawDescription !== 'string') return { ok: false, error: 'description must be 1 to 200 characters on one line' };
  const description = rawDescription.trim();
  if (description.length < 1 || description.length > MEMORY_FACT_DESCRIPTION_MAX || /[\n\r]/.test(description)) {
    return { ok: false, error: 'description must be 1 to 200 characters on one line' };
  }

  let title: string | undefined;
  if (rawTitle !== undefined) {
    if (typeof rawTitle !== 'string') return { ok: false, error: 'title must be 1 to 200 characters on one line' };
    title = rawTitle.trim();
    if (title.length < 1 || title.length > MEMORY_FACT_TITLE_MAX || /[\n\r]/.test(title)) {
      return { ok: false, error: 'title must be 1 to 200 characters on one line' };
    }
  }

  let factBody: string | undefined;
  if (rawBody !== undefined) {
    if (typeof rawBody !== 'string' || rawBody.length > MEMORY_FACT_BODY_MAX) {
      return { ok: false, error: `body must be a string of at most ${MEMORY_FACT_BODY_MAX} characters` };
    }
    factBody = rawBody;
  }

  let tags: string[] | undefined;
  if (rawTags !== undefined) {
    if (
      !Array.isArray(rawTags)
      || rawTags.length > MEMORY_FACT_TAGS_MAX
      || !rawTags.every((tag) => typeof tag === 'string' && MEMORY_FACT_TAG_PATTERN.test(tag))
    ) {
      return { ok: false, error: `tags must be a list of at most ${MEMORY_FACT_TAGS_MAX} tags matching ^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$` };
    }
    tags = rawTags;
  }

  const args: SelfJobArg[] = [
    { ref: id },
    { flag: 'type', value: factType },
    { flag: 'description', value: description },
    ...(title !== undefined ? [{ flag: 'title', value: title }] : []),
    ...(factBody !== undefined ? [{ flag: 'body', value: factBody }] : []),
    ...(tags !== undefined && tags.length > 0 ? [{ flag: 'tags', value: tags.join(',') }] : []),
    ...(store === 'user' ? [{ switch: 'user' }] : store === 'machine' ? [{ switch: 'machine' }] : []),
    { switch: 'json' },
  ];
  return { ok: true, args };
}

/** `POST /api/self/memory/facts`. */
export async function handleSelfMemoryAdd(
  credential: DashboardCredential | null,
  bodyText: string,
  signal?: AbortSignal,
  deps: SelfMemoryRouteDeps = {},
): Promise<SelfRouteResult> {
  const resolved = selfCallerFromCredential(credential, deps.caller);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };

  const body = parseJsonObject(bodyText);
  if (body === null) return { status: 400, body: BAD_BODY };

  const parsed = memoryAddJobArgs(body);
  if (!parsed.ok) return badRequest(parsed.error);

  return startMemoryJob(deps.jobs ?? selfJobs, resolved.caller, 'memory-add', parsed.args, signal);
}

export function makeSelfMemoryRouteLayer(deps: SelfMemoryRouteDeps = {}) {
  const addRoute = HttpRouter.add(
    'POST',
    '/api/self/memory/facts',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const bodyText = yield* request.text;
      const credential = resolveRequestCredential(request);
      const result = yield* Effect.promise((signal) => handleSelfMemoryAdd(credential, bodyText, signal, deps));
      return jsonResponse(result.body, { status: result.status });
    })),
  );

  return Layer.mergeAll(addRoute);
}

export const selfMemoryRouteLayer = makeSelfMemoryRouteLayer();
