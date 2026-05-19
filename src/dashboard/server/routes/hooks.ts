/**
 * Claude Code hooks ingestion route
 *
 * POST /api/hooks/permission-event
 *   Receives PermissionRequest, PostToolUse, and Stop hook payloads from
 *   Claude Code sessions and emits conversation.permission_changed events
 *   so the dashboard can show a "waiting for permission" indicator in real-time.
 *
 * The hook payload always includes `session_id` (Claude session UUID) and
 * `hook_event_name`. We look up the conversation by claude_session_id and
 * emit an in-memory-only event via emitOnly().
 */

import { stat } from 'fs/promises';
import { basename, dirname, resolve } from 'path';
import type { MemoryIdentity } from '@panctl/contracts';
import { Effect, Layer, Result, Schema } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { getEventStore } from '../event-store.js';
import { getAgentRuntimeStateAsync, getAgentStateAsync, listRunningAgentsAsync, type AgentState } from '../../../lib/agents.js';
import { sessionFilePath } from '../../../lib/paths.js';
import { assertMemorySafeSegment } from '../../../lib/memory/paths.js';
import { hasDashboardInternalToken } from './dashboard-auth.js';
import { ReadModelService } from '../read-model.js';
import { getConversationByClaudeSessionId } from '../../../lib/database/conversations-db.js';
import { injectPromptTimeMemory } from '../../../lib/memory/injection.js';
import type { ExtractFromTranscriptDeltaInput } from '../../../lib/memory/pipeline.js';
import { registerTranscriptForPolling } from '../../../lib/memory/poller.js';
import { areMemoryObservationsEnabled } from '../../../lib/memory/settings.js';
import { isSubagentHookPayload } from '../../../lib/memory/subagent-filter.js';
import { enqueueMemoryPipelineJob } from '../../../lib/memory/worker-pool.js';

const CLEAR_ON = new Set([
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
  'PermissionDenied',
])

const MemoryTurnHookPayload = Schema.Struct({
  session_id: Schema.String,
  transcript_path: Schema.String,
  stop_hook_active: Schema.optional(Schema.Boolean),
  identity: Schema.optional(Schema.Unknown),
  from_offset: Schema.optional(Schema.Number),
  to_offset: Schema.optional(Schema.Number),
});

const MemorySessionStartHookPayload = Schema.Struct({
  session_id: Schema.String,
  transcript_path: Schema.String,
  identity: Schema.optional(Schema.Unknown),
});

type MemoryTurnHookPayload = typeof MemoryTurnHookPayload.Type;
type MemorySessionStartHookPayload = typeof MemorySessionStartHookPayload.Type;

export interface HandleMemoryTurnBodyOptions {
  resolveIdentity?: (body: Record<string, unknown>, sessionId: string) => Promise<MemoryIdentity | null>;
  getTranscriptSize?: (transcriptPath: string) => Promise<number>;
  enqueuePipeline?: (input: ExtractFromTranscriptDeltaInput) => void;
  areObservationsEnabled?: () => boolean | Promise<boolean>;
  resolveTranscriptPath?: (body: Record<string, unknown>, sessionId: string) => Promise<string | null>;
  resolveAgentIdBySessionId?: (sessionId: string) => Promise<string | null>;
}

export interface HandleMemorySessionStartBodyOptions {
  resolveIdentity?: (body: Record<string, unknown>, sessionId: string) => Promise<MemoryIdentity | null>;
  statTranscript?: (transcriptPath: string) => Promise<{ size: number; mtimeMs: number }>;
  registerTranscript?: typeof registerTranscriptForPolling;
  areObservationsEnabled?: () => boolean | Promise<boolean>;
  resolveTranscriptPath?: (body: Record<string, unknown>, sessionId: string) => Promise<string | null>;
  resolveAgentIdBySessionId?: (sessionId: string) => Promise<string | null>;
}

export type HandleMemoryTurnBodyResult =
  | { status: 'subagent' }
  | { status: 'disabled' }
  | { status: 'accepted'; pipelineInput: ExtractFromTranscriptDeltaInput }
  | { status: 'error'; statusCode: 400 | 422; error: string };

export type HandleMemorySessionStartBodyResult =
  | { status: 'subagent' }
  | { status: 'disabled' }
  | { status: 'accepted'; sessionId: string }
  | { status: 'error'; statusCode: 400 | 422; error: string };

export function memoryTurnHookResponse(body: unknown): typeof HttpServerResponse.Type | null {
  if (!isSubagentHookPayload(body)) return null;
  return HttpServerResponse.text('', { status: 204 });
}

export async function handleMemoryTurnBody(
  body: Record<string, unknown>,
  options: HandleMemoryTurnBodyOptions = {},
): Promise<HandleMemoryTurnBodyResult> {
  if (isSubagentHookPayload(body)) return { status: 'subagent' };
  if (!await (options.areObservationsEnabled ?? areMemoryObservationsEnabled)()) return { status: 'disabled' };

  const payloadResult = Schema.decodeUnknownResult(MemoryTurnHookPayload)(body);
  if (payloadResult._tag === 'Failure') {
    return { status: 'error', statusCode: 400, error: 'invalid memory turn payload' };
  }

  const payload = Result.getOrThrow(payloadResult) as MemoryTurnHookPayload;
  const sessionId = payload.session_id.trim();
  const transcriptPath = payload.transcript_path.trim();
  if (!sessionId || !transcriptPath) {
    return { status: 'error', statusCode: 400, error: 'session_id and transcript_path are required' };
  }

  const payloadIdentity = parseMemoryIdentity(payload.identity, sessionId);
  let agentState: AgentState | null = null;
  const trustedTranscriptPath = options.resolveTranscriptPath
    ? await options.resolveTranscriptPath(body, sessionId)
    : resolveTrustedTranscriptPathFromState(agentState = await resolveAgentState(body, sessionId, options.resolveAgentIdBySessionId), sessionId);
  if (!trustedTranscriptPath || resolve(transcriptPath) !== trustedTranscriptPath) {
    return { status: 'error', statusCode: 422, error: 'transcript path could not be verified' };
  }

  if (!payloadIdentity && !options.resolveIdentity && !agentState) {
    agentState = await resolveAgentState(body, sessionId, options.resolveAgentIdBySessionId);
  }
  const identity = payloadIdentity
    ?? (options.resolveIdentity
      ? await options.resolveIdentity(body, sessionId)
      : resolveMemoryIdentityFromState(agentState, sessionId));
  if (!identity) {
    return { status: 'error', statusCode: 422, error: 'memory identity could not be resolved' };
  }

  const fromOffset = validOffset(payload.from_offset) ? payload.from_offset : undefined;
  const toOffset = validOffset(payload.to_offset)
    ? payload.to_offset
    : await (options.getTranscriptSize ?? getTranscriptSize)(trustedTranscriptPath);

  const pipelineInput: ExtractFromTranscriptDeltaInput = {
    sessionId,
    transcriptPath: trustedTranscriptPath,
    ...(fromOffset === undefined ? {} : { fromOffset }),
    toOffset,
    identity,
    trigger: 'stop-hook',
    hookPayload: body,
  };

  (options.enqueuePipeline ?? enqueueMemoryTurnPipeline)(pipelineInput);
  return { status: 'accepted', pipelineInput };
}

export async function handleMemorySessionStartBody(
  body: Record<string, unknown>,
  options: HandleMemorySessionStartBodyOptions = {},
): Promise<HandleMemorySessionStartBodyResult> {
  if (isSubagentHookPayload(body)) return { status: 'subagent' };
  if (!await (options.areObservationsEnabled ?? areMemoryObservationsEnabled)()) return { status: 'disabled' };

  const payloadResult = Schema.decodeUnknownResult(MemorySessionStartHookPayload)(body);
  if (payloadResult._tag === 'Failure') {
    return { status: 'error', statusCode: 400, error: 'invalid memory session start payload' };
  }

  const payload = Result.getOrThrow(payloadResult) as MemorySessionStartHookPayload;
  const sessionId = payload.session_id.trim();
  const transcriptPath = payload.transcript_path.trim();
  if (!sessionId || !transcriptPath) {
    return { status: 'error', statusCode: 400, error: 'session_id and transcript_path are required' };
  }

  const trustedTranscriptPath = options.resolveTranscriptPath
    ? await options.resolveTranscriptPath(body, sessionId)
    : await resolveTrustedTranscriptPath(body, sessionId, options.resolveAgentIdBySessionId);
  if (!trustedTranscriptPath || resolve(transcriptPath) !== trustedTranscriptPath) {
    return { status: 'error', statusCode: 422, error: 'transcript path could not be verified' };
  }

  const identity = parseMemoryIdentity(payload.identity, sessionId)
    ?? (options.resolveIdentity
      ? await options.resolveIdentity(body, sessionId)
      : await resolveMemoryIdentity(body, sessionId, options.resolveAgentIdBySessionId));
  if (!identity) {
    return { status: 'error', statusCode: 422, error: 'memory identity could not be resolved' };
  }

  const fileStat = await (options.statTranscript ?? getTranscriptStat)(trustedTranscriptPath);
  (options.registerTranscript ?? registerTranscriptForPolling)({
    agentId: stringField(body.agentId) ?? stringField(body.agent_id) ?? identity.runId,
    sessionId,
    transcriptPath: trustedTranscriptPath,
    identity,
    harness: identity.agentHarness,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
  });

  return { status: 'accepted', sessionId };
}

export interface HandleMemoryInjectBodyOptions {
  injectMemory?: typeof injectPromptTimeMemory;
  resolveAgentIdBySessionId?: (sessionId: string) => Promise<string | null>;
}

export async function handleMemoryInjectBody(
  body: Record<string, unknown>,
  options: HandleMemoryInjectBodyOptions = {},
) {
  const prompt = typeof body.prompt === 'string'
    ? body.prompt
    : typeof body.userPrompt === 'string'
      ? body.userPrompt
      : null;
  const sessionId = typeof body.sessionId === 'string'
    ? body.sessionId
    : typeof body.session_id === 'string'
      ? body.session_id
      : null;

  if (!prompt || !sessionId) {
    return { error: 'prompt and sessionId are required', status: 400 } as const;
  }

  const identity = parseMemoryIdentity(body.identity, sessionId)
    ?? await resolveMemoryIdentity(body, sessionId, options.resolveAgentIdBySessionId);
  if (!identity) {
    return { error: 'memory identity could not be resolved', status: 202 } as const;
  }

  return await (options.injectMemory ?? injectPromptTimeMemory)({ prompt, identity });
}

const postMemoryInjectRoute = HttpRouter.add(
  'POST',
  '/api/memory/inject',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (!hasDashboardInternalToken(request)) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
    const rawBody = yield* request.text;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'invalid JSON' }, { status: 400 });
    }

    const readModel = yield* ReadModelService;
    const result = yield* Effect.promise(() => handleMemoryInjectBody(body, {
      resolveAgentIdBySessionId: async (sessionId) => Effect.runPromise(readModel.getAgentIdBySessionId(sessionId)),
    }));
    if ('error' in result) return jsonResponse({ ok: false, error: result.error }, { status: result.status });
    return jsonResponse({ ok: true, ...result });
  })),
);

const postMemorySessionStartRoute = HttpRouter.add(
  'POST',
  '/api/memory/session/start',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (!hasDashboardInternalToken(request)) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
    const rawBody = yield* request.text;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'invalid JSON' }, { status: 400 });
    }

    const readModel = yield* ReadModelService;
    const result = yield* Effect.promise(() => handleMemorySessionStartBody(body, {
      resolveAgentIdBySessionId: async (sessionId) => Effect.runPromise(readModel.getAgentIdBySessionId(sessionId)),
    }));
    if (result.status === 'subagent' || result.status === 'disabled') return HttpServerResponse.text('', { status: 204 });
    if (result.status === 'error') return jsonResponse({ ok: false, error: result.error }, { status: result.statusCode });

    return jsonResponse({ ok: true }, { status: 202 });
  })),
);

const postMemoryTurnRoute = HttpRouter.add(
  'POST',
  '/api/memory/turn',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (!hasDashboardInternalToken(request)) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
    const rawBody = yield* request.text;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'invalid JSON' }, { status: 400 });
    }

    const readModel = yield* ReadModelService;
    const result = yield* Effect.promise(() => handleMemoryTurnBody(body, {
      resolveAgentIdBySessionId: async (sessionId) => Effect.runPromise(readModel.getAgentIdBySessionId(sessionId)),
    }));
    if (result.status === 'subagent' || result.status === 'disabled') return HttpServerResponse.text('', { status: 204 });
    if (result.status === 'error') return jsonResponse({ ok: false, error: result.error }, { status: result.statusCode });

    return jsonResponse({ ok: true }, { status: 202 });
  })),
);

const postPermissionEventRoute = HttpRouter.add(
  'POST',
  '/api/hooks/permission-event',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const rawBody = yield* request.text;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'invalid JSON' }, { status: 400 });
    }

    const sessionId = typeof body.session_id === 'string' ? body.session_id : null;
    const hookEvent = typeof body.hook_event_name === 'string' ? body.hook_event_name : null;
    const toolName = typeof body.tool_name === 'string' ? body.tool_name : undefined;

    if (!sessionId || !hookEvent) {
      return jsonResponse({ ok: true });
    }

    const conv = getConversationByClaudeSessionId(sessionId);
    if (!conv) {
      return jsonResponse({ ok: true });
    }

    const waiting = hookEvent === 'PermissionRequest';
    const clearing = CLEAR_ON.has(hookEvent);

    if (!waiting && !clearing) {
      return jsonResponse({ ok: true });
    }

    console.log(`[hooks] ${hookEvent} session=${sessionId} conv=${conv.name} waiting=${waiting}${toolName ? ` tool=${toolName}` : ''}`);

    getEventStore().emitOnly({
      type: 'conversation.permission_changed',
      timestamp: new Date().toISOString(),
      payload: { conversationName: conv.name, waiting, toolName },
    });

    return jsonResponse({ ok: true, conversationName: conv.name, waiting });
  })),
);

export const hooksRouteLayer = Layer.mergeAll(
  postMemoryInjectRoute,
  postMemorySessionStartRoute,
  postMemoryTurnRoute,
  postPermissionEventRoute,
);

function parseMemoryIdentity(value: unknown, sessionId: string): MemoryIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const identity = value as Record<string, unknown>;
  const projectId = safeIdentityField(identity.projectId, 'projectId');
  const workspaceId = safeIdentityField(identity.workspaceId, 'workspaceId');
  const issueId = safeIdentityField(identity.issueId, 'issueId');
  const runId = safeIdentityField(identity.runId, 'runId');
  const agentRole = stringField(identity.agentRole);
  const agentHarness = safeIdentityField(identity.agentHarness, 'agentHarness');
  if (!projectId || !workspaceId || !issueId || !runId || !agentRole || !agentHarness) return null;
  if (!isRole(agentRole)) return null;
  return { projectId, workspaceId, issueId, runId, sessionId, agentRole, agentHarness };
}

async function resolveMemoryIdentity(
  body: Record<string, unknown>,
  sessionId: string,
  resolveAgentIdBySessionId?: (sessionId: string) => Promise<string | null>,
): Promise<MemoryIdentity | null> {
  return resolveMemoryIdentityFromState(await resolveAgentState(body, sessionId, resolveAgentIdBySessionId), sessionId);
}

function resolveMemoryIdentityFromState(state: AgentState | null, sessionId: string): MemoryIdentity | null {
  if (!state) return null;
  return {
    projectId: inferProjectId(state.workspace),
    workspaceId: basename(state.workspace),
    issueId: state.issueId,
    runId: state.id,
    sessionId,
    agentRole: state.role,
    agentHarness: state.harness ?? 'claude-code',
  };
}

async function resolveTrustedTranscriptPath(
  body: Record<string, unknown>,
  sessionId: string,
  resolveAgentIdBySessionId?: (sessionId: string) => Promise<string | null>,
): Promise<string | null> {
  return resolveTrustedTranscriptPathFromState(await resolveAgentState(body, sessionId, resolveAgentIdBySessionId), sessionId);
}

function resolveTrustedTranscriptPathFromState(state: AgentState | null, sessionId: string): string | null {
  return state ? resolve(sessionFilePath(state.workspace, sessionId)) : null;
}

async function resolveAgentState(
  body: Record<string, unknown>,
  sessionId: string,
  resolveAgentIdBySessionId?: (sessionId: string) => Promise<string | null>,
): Promise<AgentState | null> {
  const agentId = stringField(body.agentId) ?? stringField(body.agent_id);
  return agentId ? await getAgentStateAsync(agentId) : await findAgentStateBySessionId(sessionId, resolveAgentIdBySessionId);
}

async function findAgentStateBySessionId(
  sessionId: string,
  resolveAgentIdBySessionId?: (sessionId: string) => Promise<string | null>,
): Promise<AgentState | null> {
  if (resolveAgentIdBySessionId) {
    const agentId = await resolveAgentIdBySessionId(sessionId);
    return agentId ? await getAgentStateAsync(agentId) : null;
  }

  const agents = await listRunningAgentsAsync();
  for (const agent of agents) {
    if (agent.sessionId === sessionId) return agent;
    if ((await getAgentRuntimeStateAsync(agent.id))?.claudeSessionId === sessionId) return agent;
  }
  return null;
}

function inferProjectId(workspacePath: string): string {
  const workspaceName = basename(workspacePath);
  if (workspaceName.startsWith('feature-')) return basename(dirname(dirname(workspacePath)));
  return basename(workspacePath);
}

function validOffset(value: number | undefined): value is number {
  return Number.isInteger(value) && value >= 0;
}

async function getTranscriptSize(transcriptPath: string): Promise<number> {
  return (await getTranscriptStat(transcriptPath)).size;
}

async function getTranscriptStat(transcriptPath: string): Promise<{ size: number; mtimeMs: number }> {
  const fileStat = await stat(transcriptPath);
  return { size: fileStat.size, mtimeMs: fileStat.mtimeMs };
}

function enqueueMemoryTurnPipeline(input: ExtractFromTranscriptDeltaInput): void {
  enqueueMemoryPipelineJob(input);
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeIdentityField(value: unknown, field: string): string | null {
  const stringValue = stringField(value);
  if (!stringValue) return null;
  try {
    return assertMemorySafeSegment(stringValue, field);
  } catch {
    return null;
  }
}

function isRole(value: string): value is MemoryIdentity['agentRole'] {
  return value === 'plan' || value === 'work' || value === 'review' || value === 'test' || value === 'ship';
}
