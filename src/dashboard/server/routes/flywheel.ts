import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Effect, Layer, Option, Schema } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { FlywheelRunId, FlywheelStatus } from '@panctl/contracts';
import { httpHandler } from './http-handler.js';
import { validateOrigin } from './origin-validation.js';
import {
  getFlywheelRunDetail,
  isFlywheelRunId,
  listFlywheelRuns,
  writeLatestFlywheelStatus,
  type FlywheelRunListOptions,
  type FlywheelRunStateOptions,
} from '../services/flywheel-run-state.js';
import { openFlywheelRunReport, pauseFlywheelRun, resumeFlywheelRun, startFlywheelRun } from '../../../cli/commands/flywheel.js';
import { getConversationByName } from '../../../lib/database/conversations-db.js';
import { sessionExistsAsync } from '../../../lib/tmux.js';

const DEFAULT_BRIEF_PATH = 'docs/flywheel-brief.md';
const FLYWHEEL_CONVERSATION_NAME = 'flywheel-orchestrator';

interface BriefRequestBody {
  content?: unknown;
  path?: unknown;
}

interface StartRequestBody {
  brief?: unknown;
}

interface ReportOpenRequestBody {
  runId?: unknown;
}

interface FlywheelStatusResponse {
  status: number;
  body: { ok: true; runId: string } | { error: string; details: string[] };
}

const decodeFlywheelStatus = Schema.decodeUnknownSync(FlywheelStatus);
const decodeFlywheelRunId = Schema.decodeUnknownSync(FlywheelRunId);

function requireTrustedOrigin(request: HttpServerRequest.HttpServerRequest) {
  const originCheck = validateOrigin(request);
  return originCheck.ok ? null : jsonResponse({ error: originCheck.error }, { status: 403 });
}

function isInsideRoot(projectRoot: string, candidate: string): boolean {
  const relativePath = relative(projectRoot, candidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function parseRunIdParam(runId: string): { ok: true; runId: string } | { ok: false; error: string } {
  try {
    return { ok: true, runId: decodeFlywheelRunId(runId) };
  } catch {
    return { ok: false, error: 'Flywheel run id must match RUN-<number>' };
  }
}

function parseRunsLimit(value: string | null): number | undefined {
  if (value === null) return undefined;
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined;
}

export function resolveFlywheelBriefPath(projectRoot: string, requestedPath?: string): { ok: true; path: string } | { ok: false; error: string } {
  const rawPath = requestedPath?.trim() || DEFAULT_BRIEF_PATH;
  if (rawPath.includes('\0')) {
    return { ok: false, error: 'Brief path is invalid' };
  }

  const root = resolve(projectRoot);
  const resolvedPath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(root, rawPath);
  if (!isInsideRoot(root, resolvedPath)) {
    return { ok: false, error: 'Brief path must stay inside the project root' };
  }

  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  const displayPath = resolvedPath === root ? '.' : relative(root, resolvedPath);
  return { ok: true, path: resolvedPath.startsWith(normalizedRoot) ? displayPath : resolvedPath };
}

function resolveBriefAbsolutePath(projectRoot: string, requestedPath?: string): { ok: true; absolutePath: string; displayPath: string } | { ok: false; error: string } {
  const resolved = resolveFlywheelBriefPath(projectRoot, requestedPath);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    absolutePath: resolve(projectRoot, resolved.path),
    displayPath: resolved.path,
  };
}

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return { ok: true as const, body: text ? (JSON.parse(text) as BriefRequestBody) : {} };
  } catch {
    return { ok: false as const, error: 'Request body must be valid JSON' };
  }
});

const readUnknownJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return { ok: true as const, body: text ? (JSON.parse(text) as unknown) : {} };
  } catch {
    return { ok: false as const, error: 'Request body must be valid JSON' };
  }
});

export async function postFlywheelStatusPayload(payload: unknown, options: FlywheelRunStateOptions = {}): Promise<FlywheelStatusResponse> {
  try {
    const status = decodeFlywheelStatus(payload);
    await writeLatestFlywheelStatus(status, options);
    return { status: 200, body: { ok: true, runId: status.runId } };
  } catch (error) {
    return {
      status: 400,
      body: {
        error: 'Invalid FlywheelStatus payload',
        details: [error instanceof Error ? error.message : String(error)],
      },
    };
  }
}

export async function getFlywheelRunsPayload(options: FlywheelRunListOptions = {}) {
  return listFlywheelRuns(options);
}

export async function getFlywheelRunPayload(runId: string, options: FlywheelRunStateOptions = {}) {
  if (!isFlywheelRunId(runId)) return null;
  return getFlywheelRunDetail(runId, options);
}

export async function getFlywheelConversationPayload() {
  const conversation = getConversationByName(FLYWHEEL_CONVERSATION_NAME);
  if (!conversation) return null;
  const sessionAlive = await sessionExistsAsync(conversation.tmuxSession);
  return { ...conversation, sessionAlive };
}

interface FlywheelActionDeps {
  start?: typeof startFlywheelRun;
  pause?: typeof pauseFlywheelRun;
  resume?: typeof resumeFlywheelRun;
  openReport?: typeof openFlywheelRunReport;
}

export async function postFlywheelStartPayload(payload: unknown, deps: FlywheelActionDeps = {}) {
  const body = (payload ?? {}) as StartRequestBody;
  if (body.brief !== undefined && typeof body.brief !== 'string') {
    return { status: 400, body: { error: 'brief must be a string when provided' } };
  }
  const result = await (deps.start ?? startFlywheelRun)({ cwd: process.cwd(), brief: body.brief });
  return { status: 200, body: { ok: true, runId: result.runId } };
}

export async function postFlywheelPausePayload(deps: FlywheelActionDeps = {}) {
  const result = await (deps.pause ?? pauseFlywheelRun)();
  return { status: 200, body: { ok: true, changed: result.changed } };
}

export async function postFlywheelResumePayload(deps: FlywheelActionDeps = {}) {
  const result = await (deps.resume ?? resumeFlywheelRun)();
  return { status: 200, body: { ok: true, changed: result.changed } };
}

export async function postFlywheelReportOpenPayload(payload: unknown, deps: FlywheelActionDeps = {}) {
  const body = (payload ?? {}) as ReportOpenRequestBody;
  if (body.runId !== undefined && typeof body.runId !== 'string') {
    return { status: 400, body: { error: 'runId must be a string when provided' } };
  }
  if (typeof body.runId === 'string') {
    const parsed = parseRunIdParam(body.runId);
    if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  }
  const result = await (deps.openReport ?? openFlywheelRunReport)({ runId: body.runId });
  return { status: 200, body: { ok: true, runId: result.runId, path: result.path } };
}

const getFlywheelRunsRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/runs',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const limit = HttpServerRequest.toURL(request).pipe(Option.match({
      onNone: () => undefined,
      onSome: (url) => parseRunsLimit(url.searchParams.get('limit')),
    }));
    return yield* Effect.promise(async () => jsonResponse(await getFlywheelRunsPayload({ limit })));
  })),
);

const getFlywheelRunRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/runs/:id',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const runId = params['id'] ?? '';
    const parsed = parseRunIdParam(runId);
    if (!parsed.ok) return jsonResponse({ error: parsed.error, runId }, { status: 400 });
    const run = yield* Effect.promise(() => getFlywheelRunPayload(parsed.runId));
    if (!run) return jsonResponse({ error: 'Flywheel run not found', runId: parsed.runId }, { status: 404 });
    return jsonResponse(run);
  })),
);

const getFlywheelConversationRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/conversation',
  httpHandler(Effect.gen(function* () {
    return yield* Effect.promise(async () => jsonResponse(await getFlywheelConversationPayload()));
  })),
);

const postFlywheelStatusRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/status',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    const parsed = yield* readUnknownJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error, details: [] }, { status: 400 });

    const result = yield* Effect.promise(() => postFlywheelStatusPayload(parsed.body));
    return jsonResponse(result.body, { status: result.status });
  })),
);

const postFlywheelStartRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/start',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    const parsed = yield* readUnknownJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });

    try {
      const result = yield* Effect.promise(() => postFlywheelStartPayload(parsed.body));
      return jsonResponse(result.body, { status: result.status });
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  })),
);

const postFlywheelPauseRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/pause',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    try {
      const result = yield* Effect.promise(() => postFlywheelPausePayload());
      return jsonResponse(result.body, { status: result.status });
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  })),
);

const postFlywheelResumeRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/resume',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    try {
      const result = yield* Effect.promise(() => postFlywheelResumePayload());
      return jsonResponse(result.body, { status: result.status });
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  })),
);

const postFlywheelReportOpenRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/report/open',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    const parsed = yield* readUnknownJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });

    try {
      const result = yield* Effect.promise(() => postFlywheelReportOpenPayload(parsed.body));
      return jsonResponse(result.body, { status: result.status });
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  })),
);

const getFlywheelBriefRoute = HttpRouter.add(
  'GET',
  '/api/flywheel/brief',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const requestedPath = HttpServerRequest.toURL(request).pipe(Option.match({
      onNone: () => undefined,
      onSome: (url) => url.searchParams.get('path') ?? undefined,
    }));
    const resolved = resolveBriefAbsolutePath(process.cwd(), requestedPath);
    if (!resolved.ok) return jsonResponse({ error: resolved.error }, { status: 400 });

    return yield* Effect.promise(async () => {
      try {
        const content = await readFile(resolved.absolutePath, 'utf8');
        return jsonResponse({ path: resolved.displayPath, content });
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
        if (code === 'ENOENT') {
          return jsonResponse({ error: 'Flywheel brief not found', path: resolved.displayPath }, { status: 404 });
        }
        throw error;
      }
    });
  })),
);

const postFlywheelBriefRoute = HttpRouter.add(
  'POST',
  '/api/flywheel/brief',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    const parsed = yield* readJsonBody;
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
    const body = parsed.body;
    if (typeof body.content !== 'string') {
      return jsonResponse({ error: 'content must be a string' }, { status: 400 });
    }
    if (body.path !== undefined && typeof body.path !== 'string') {
      return jsonResponse({ error: 'path must be a string when provided' }, { status: 400 });
    }

    const resolved = resolveBriefAbsolutePath(process.cwd(), body.path);
    if (!resolved.ok) return jsonResponse({ error: resolved.error }, { status: 400 });

    return yield* Effect.promise(async () => {
      await mkdir(dirname(resolved.absolutePath), { recursive: true });
      await writeFile(resolved.absolutePath, body.content, 'utf8');
      return jsonResponse({ ok: true, path: resolved.displayPath });
    });
  })),
);

export const flywheelRouteLayer = Layer.mergeAll(
  getFlywheelRunsRoute,
  getFlywheelRunRoute,
  getFlywheelConversationRoute,
  postFlywheelStatusRoute,
  postFlywheelStartRoute,
  postFlywheelPauseRoute,
  postFlywheelResumeRoute,
  postFlywheelReportOpenRoute,
  getFlywheelBriefRoute,
  postFlywheelBriefRoute,
);

export default flywheelRouteLayer;
