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
import type { MemoryIdentity } from '@overdeck/contracts';
import { Effect, Layer, Result, Schema } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { getEventStore } from '../event-store.js';
import { getAgentRuntimeState, getAgentState, listRunningAgents, type AgentState } from '../../../lib/agents.js';
import { sessionFilePath } from '../../../lib/paths.js';
import { assertMemorySafeSegment } from '../../../lib/memory/paths.js';
import { hasDashboardInternalToken } from './dashboard-auth.js';
import { ReadModelService } from '../read-model.js';
import { clearConversationFailureState, getConversationByClaudeSessionId, markConversationActive, updateConversationTitle, type LegacyConversation } from '../../../lib/overdeck/conversations.js';
import { getWorkspaceById } from '../../../lib/workspaces/resolver.js';
import { derivePromptTitle } from '../../../lib/conversations/transcript-summary.js';
import { generateAiTitle, resolveSessionFile } from '../../../lib/overdeck/conversation-reads.js';
import { handleTurnComplete } from '../../../lib/overdeck/title-refinement.js';
import { appendFreshBriefingUpdate, recordBriefingSessionStart } from '../../../lib/briefing-freshness.js';
import {
  claimSessionBriefing,
  composeSessionStartBriefing,
  recordSessionBriefingSize,
} from '../../../lib/memory/session-briefing.js';
import { resolveComplianceAdvisoryWarning } from '../../../lib/compliance/advisory-warning.js';
import { injectPromptTimeMemory } from '../../../lib/memory/injection.js';
import type { ExtractFromTranscriptDeltaInput } from '../../../lib/memory/pipeline.js';
import { registerTranscriptForPolling } from '../../../lib/memory/poller.js';
import { areMemoryObservationsEnabled } from '../../../lib/memory/settings.js';
import { isSubagentHookPayload } from '../../../lib/memory/subagent-filter.js';
import { enqueueMemoryPipelineJob } from '../../../lib/memory/worker-pool.js';
import { buildDocsInjectionContext } from '../../../lib/docs/injection.js';
import type { NormalizedDocsConfig } from '../../../lib/config-yaml.js';
import { loadConfigSync } from '../../../lib/config-yaml/load.js';
import type { DocsPathOverrides } from '../../../lib/paths.js';

const MEMORY_INJECT_FAST_RESPONSE_TIMEOUT_MS = 750;

const CLEAR_ON = new Set([
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
  'PermissionDenied',
])

/**
 * A hook arriving from a conversation's own Claude session is affirmative
 * evidence the harness is alive and executing turns. If the fork/handoff
 * pipeline previously marked this conversation failed (the submit-confirmation
 * check can false-negative: pane echo of the submitted summary keeps the
 * composer match positive after a successful Enter), heal the verdict. The
 * dashboard treats forkStatus='failed' as terminal — gray dot, no composer —
 * so a stale verdict leaves an alive, working session uninteractable.
 */
function healFailedForkVerdictOnLiveActivity(conv: LegacyConversation): void {
  if (conv.forkStatus !== 'failed') return;
  console.log(`[hooks] clearing fork failure for ${conv.name} — hook activity proves the session is alive (was: ${conv.forkError ?? 'failed'})`);
  clearConversationFailureState(conv.name);
  markConversationActive(conv.name);
}

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
  recordBriefingSessionStart?: typeof recordBriefingSessionStart;
  areObservationsEnabled?: () => boolean | Promise<boolean>;
  resolveTranscriptPath?: (body: Record<string, unknown>, sessionId: string) => Promise<string | null>;
  resolveAgentIdBySessionId?: (sessionId: string) => Promise<string | null>;
  claimSessionBriefing?: typeof claimSessionBriefing;
  composeSessionStartBriefing?: typeof composeSessionStartBriefing;
  recordSessionBriefingSize?: typeof recordSessionBriefingSize;
  now?: Date;
}

export type HandleMemoryTurnBodyResult =
  | { status: 'subagent' }
  | { status: 'disabled' }
  | { status: 'accepted'; pipelineInput: ExtractFromTranscriptDeltaInput }
  | { status: 'error'; statusCode: 400 | 422; error: string };

export type HandleMemorySessionStartBodyResult =
  | { status: 'subagent' }
  | { status: 'disabled' }
  /** `briefing` is the rendered SessionStart briefing when this session id has not been briefed yet (PAN-3286 FR-10). */
  | { status: 'accepted'; sessionId: string; briefing?: string }
  /** Poller registration was skipped (transcript not written yet), but a briefing may still be owed. */
  | { status: 'transcript-missing'; sessionId: string; briefing?: string }
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
    : resolveTrustedTranscriptPathFromState(agentState = await resolveAgentState(body, sessionId, options.resolveAgentIdBySessionId), sessionId)
      ?? resolveTrustedTranscriptPathFromConversation(sessionId);
  if (!trustedTranscriptPath || resolve(transcriptPath) !== trustedTranscriptPath) {
    return { status: 'error', statusCode: 422, error: 'transcript path could not be verified' };
  }

  if (!payloadIdentity && !options.resolveIdentity && !agentState) {
    agentState = await resolveAgentState(body, sessionId, options.resolveAgentIdBySessionId);
  }
  const identity = payloadIdentity
    ?? (options.resolveIdentity
      ? await options.resolveIdentity(body, sessionId)
      : resolveMemoryIdentityFromState(agentState, sessionId) ?? resolveMemoryIdentityFromConversation(sessionId));
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

  const recordBriefingStart = options.recordBriefingSessionStart ?? recordBriefingSessionStart;
  await recordBriefingStart(options.now ? { sessionId, now: options.now } : { sessionId }).catch(() => {});
  if (!await (options.areObservationsEnabled ?? areMemoryObservationsEnabled)()) return { status: 'disabled' };

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

  // PAN-3286 FR-10: hand the hook a rendered standing briefing to emit as
  // SessionStart additionalContext. Claim-then-compose so a second (or
  // concurrent) SessionStart for the same session id gets nothing, and so any
  // composition failure degrades to the briefing-less response.
  //
  // This runs BEFORE the transcript stat on purpose. The briefing describes
  // workspace memory, not the transcript, and SessionStart legitimately fires
  // before the harness writes the transcript's first line (see below) — a
  // genuinely fresh session is exactly the case that most needs the briefing,
  // and there is no guaranteed later SessionStart request to carry it.
  const briefing = await composeBriefingForSessionStart(identity, sessionId, options);

  // The SessionStart hook can fire before the harness writes the transcript's
  // first line (and stale hooks can name a deleted transcript). A missing file
  // is a skip, not a 500 — the memory-reconciliation sweep registers the
  // transcript once it exists. ENOENT only skips poller registration; the
  // briefing composed above still rides back on the response.
  let fileStat: { size: number; mtimeMs: number };
  try {
    fileStat = await (options.statTranscript ?? getTranscriptStat)(trustedTranscriptPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return briefing
        ? { status: 'transcript-missing', sessionId, briefing }
        : { status: 'transcript-missing', sessionId };
    }
    throw error;
  }
  (options.registerTranscript ?? registerTranscriptForPolling)({
    agentId: stringField(body.agentId) ?? stringField(body.agent_id) ?? identity.runId,
    sessionId,
    transcriptPath: trustedTranscriptPath,
    identity,
    harness: identity.agentHarness,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
  });

  return briefing ? { status: 'accepted', sessionId, briefing } : { status: 'accepted', sessionId };
}

/**
 * Claim the session, compose the briefing, then record its size. Returns null
 * whenever the briefing must not be delivered: already claimed, nothing to say,
 * or any failure — never throws, so the SessionStart hook keeps its current
 * behavior (PAN-3286 FR-10).
 */
async function composeBriefingForSessionStart(
  identity: MemoryIdentity,
  sessionId: string,
  options: HandleMemorySessionStartBodyOptions,
): Promise<string | null> {
  try {
    const claim = options.claimSessionBriefing ?? claimSessionBriefing;
    if (!await claim({ identity, sessionId, now: options.now })) return null;

    const compose = options.composeSessionStartBriefing ?? composeSessionStartBriefing;
    const briefing = await compose({ identity, sessionId, now: options.now });
    if (!briefing) return null;

    await (options.recordSessionBriefingSize ?? recordSessionBriefingSize)({
      identity,
      sessionId,
      byteSize: briefing.byteSize,
      now: options.now,
    }).catch(() => {});
    return briefing.context;
  } catch (error) {
    console.error('[memory] SessionStart briefing composition failed:', error);
    return null;
  }
}

export interface HandleMemoryInjectBodyOptions {
  injectMemory?: typeof injectPromptTimeMemory;
  injectBriefing?: typeof appendFreshBriefingUpdate;
  resolveComplianceWarning?: typeof resolveComplianceAdvisoryWarning;
  resolveAgentIdBySessionId?: (sessionId: string) => Promise<string | null>;
  docsConfig?: Pick<NormalizedDocsConfig, 'enabled' | 'promptInjectionEnabled' | 'trigger' | 'budget'>;
  docsPaths?: DocsPathOverrides;
  buildDocsInjectionContext?: typeof buildDocsInjectionContext;
  docsAbortSignal?: AbortSignal;
  now?: Date;
}

export interface HandleMemoryInjectFastPathOptions extends HandleMemoryInjectBodyOptions {
  timeoutMs?: number;
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

  const [memoryResult, complianceWarning] = await Promise.all([
    (options.injectMemory ?? injectPromptTimeMemory)({ prompt, identity }),
    (options.resolveComplianceWarning ?? resolveComplianceAdvisoryWarning)({ identity }).catch(() => null),
  ]);
  const briefing = await (options.injectBriefing ?? appendFreshBriefingUpdate)(
    options.now ? { sessionId, context: memoryResult.context, now: options.now } : { sessionId, context: memoryResult.context },
  );
  const docsResult = options.docsConfig || options.docsPaths || options.buildDocsInjectionContext
    ? await (options.buildDocsInjectionContext ?? buildDocsInjectionContext)({
      prompt,
      sessionId,
      config: options.docsConfig,
      paths: options.docsPaths,
      now: options.now,
      signal: options.docsAbortSignal,
    })
    : { context: null };

  return {
    ...memoryResult,
    context: [complianceWarning, briefing.context, docsResult.context].filter((part): part is string => !!part).join('\n\n'),
  };
}

export async function handleMemoryInjectFastPathBody(
  body: Record<string, unknown>,
  options: HandleMemoryInjectFastPathOptions = {},
): Promise<{ ok: true; context: string }> {
  const docsAbortController = new AbortController();
  const resultPromise = handleMemoryInjectBody(body, {
    resolveAgentIdBySessionId: options.resolveAgentIdBySessionId,
    resolveComplianceWarning: options.resolveComplianceWarning,
    injectMemory: options.injectMemory,
    injectBriefing: options.injectBriefing,
    docsConfig: options.docsConfig,
    docsPaths: options.docsPaths,
    buildDocsInjectionContext: options.buildDocsInjectionContext,
    docsAbortSignal: docsAbortController.signal,
    now: options.now,
  });
  const result = await resolveWithTimeout(
    resultPromise,
    options.timeoutMs ?? MEMORY_INJECT_FAST_RESPONSE_TIMEOUT_MS,
    () => docsAbortController.abort(),
  ).catch(() => ({ timedOut: true as const }));
  if (result.timedOut) return { ok: true, context: '' };
  if ('error' in result.value) return { ok: true, context: '' };
  return { ok: true, context: result.value.context };
}

async function resolveWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  if (timeoutMs <= 0) {
    onTimeout?.();
    return { timedOut: true };
  }
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise.then((value) => ({ timedOut: false as const, value })),
      new Promise<{ timedOut: true }>((resolveTimeout) => {
        timeout = setTimeout(() => {
          onTimeout?.();
          resolveTimeout({ timedOut: true });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
    const resolveAgentIdBySessionId = async (sessionId: string) => Effect.runPromise(readModel.getAgentIdBySessionId(sessionId));
    const result = yield* Effect.promise(() => handleMemoryInjectFastPathBody(body, {
      resolveAgentIdBySessionId,
      docsConfig: loadConfigSync().config.docs,
    }));
    return jsonResponse(result, { status: 202 });
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
    if (result.status === 'subagent' || result.status === 'disabled') {
      return HttpServerResponse.text('', { status: 204 });
    }
    if (result.status === 'error') return jsonResponse({ ok: false, error: result.error }, { status: result.statusCode });
    // A transcript that is not written yet stays a 204 no-op UNLESS a briefing
    // was composed for it — a fresh session is precisely when the transcript is
    // most likely missing, so dropping the body here would lose the briefing
    // entirely (PAN-3286 FR-10).
    if (result.status === 'transcript-missing' && !result.briefing) {
      return HttpServerResponse.text('', { status: 204 });
    }

    // `briefing` is what the local SessionStart hook script emits as
    // hookSpecificOutput.additionalContext (PAN-3286 FR-10). Absent when this
    // session id was already briefed or there was nothing to say.
    return jsonResponse(
      result.briefing ? { ok: true, briefing: result.briefing } : { ok: true },
      { status: 202 },
    );
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

    healFailedForkVerdictOnLiveActivity(conv);

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

export interface HandleUserPromptSubmitBodyOptions {
  resolveSessionFile?: (conv: LegacyConversation) => Promise<string | null>;
  generateAiTitle?: typeof generateAiTitle;
}

export async function handleUserPromptSubmitBody(
  body: Record<string, unknown>,
  options: HandleUserPromptSubmitBodyOptions = {},
): Promise<{ ok: boolean; conversationName?: string; updated?: boolean }> {
  const sessionId = typeof body.session_id === 'string' ? body.session_id : null;
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!sessionId) {
    return { ok: true };
  }

  const conv = getConversationByClaudeSessionId(sessionId);
  if (!conv) {
    return { ok: true };
  }

  healFailedForkVerdictOnLiveActivity(conv);

  if (conv.titleSource === 'default') {
    const derivedTitle = derivePromptTitle(prompt);
    if (derivedTitle) {
      updateConversationTitle(conv.name, derivedTitle, 'auto');
    }
    const doGenerateAiTitle = options.generateAiTitle ?? generateAiTitle;
    void doGenerateAiTitle(conv.name, prompt, { resolveSessionFile: options.resolveSessionFile ?? resolveSessionFile }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[hooks/user-prompt-submit] AI title generation failed for "${conv.name}":`, msg);
    });
  }

  return { ok: true, conversationName: conv.name, updated: conv.titleSource === 'default' };
}

const postUserPromptSubmitRoute = HttpRouter.add(
  'POST',
  '/api/hooks/user-prompt-submit',
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

    const result = yield* Effect.promise(() => handleUserPromptSubmitBody(body));
    return jsonResponse(result);
  })),
);

export async function handleTurnCompleteBody(
  body: Record<string, unknown>,
  options: { handleTurnComplete?: typeof handleTurnComplete } = {},
): Promise<{ ok: boolean; conversationName?: string }> {
  const sessionId = typeof body.session_id === 'string' ? body.session_id : null;
  if (!sessionId) {
    return { ok: true };
  }

  const conv = getConversationByClaudeSessionId(sessionId);
  if (!conv) {
    return { ok: true };
  }

  const doHandleTurnComplete = options.handleTurnComplete ?? handleTurnComplete;
  void doHandleTurnComplete(conv, { resolveSessionFile }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[hooks/turn-complete] title refinement failed for "${conv.name}":`, msg);
  });

  return { ok: true, conversationName: conv.name };
}

const postTurnCompleteRoute = HttpRouter.add(
  'POST',
  '/api/hooks/turn-complete',
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

    const result = yield* Effect.promise(() => handleTurnCompleteBody(body));
    return jsonResponse(result);
  })),
);

export const hooksRouteLayer = Layer.mergeAll(
  postMemoryInjectRoute,
  postMemorySessionStartRoute,
  postMemoryTurnRoute,
  postPermissionEventRoute,
  postUserPromptSubmitRoute,
  postTurnCompleteRoute,
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
  const state = await resolveAgentState(body, sessionId, resolveAgentIdBySessionId);
  return resolveMemoryIdentityFromState(state, sessionId) ?? resolveMemoryIdentityFromConversation(sessionId);
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

/**
 * PAN-1990: a conversation (no work agent, no issue) still has a memory
 * identity when its row carries workspace_id — a main/scratch workspace
 * turn (PRD D-6). issueId is null; runId is the conversation's tmux session
 * name (mirrors how the agent-state path uses the agent's own id).
 */
function resolveMemoryIdentityFromConversation(sessionId: string): MemoryIdentity | null {
  const conversation = getConversationByClaudeSessionId(sessionId);
  if (!conversation?.workspaceId) return null;
  const workspace = getWorkspaceById(conversation.workspaceId);
  if (!workspace) return null;
  return {
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    issueId: null,
    runId: conversation.tmuxSession,
    sessionId,
    agentRole: 'conversation',
    agentHarness: conversation.harness ?? 'claude-code',
  };
}

async function resolveTrustedTranscriptPath(
  body: Record<string, unknown>,
  sessionId: string,
  resolveAgentIdBySessionId?: (sessionId: string) => Promise<string | null>,
): Promise<string | null> {
  const state = await resolveAgentState(body, sessionId, resolveAgentIdBySessionId);
  return resolveTrustedTranscriptPathFromState(state, sessionId) ?? resolveTrustedTranscriptPathFromConversation(sessionId);
}

function resolveTrustedTranscriptPathFromState(state: AgentState | null, sessionId: string): string | null {
  return state ? resolve(sessionFilePath(state.workspace, sessionId)) : null;
}

function resolveTrustedTranscriptPathFromConversation(sessionId: string): string | null {
  const conversation = getConversationByClaudeSessionId(sessionId);
  return conversation ? resolve(sessionFilePath(conversation.cwd, sessionId)) : null;
}

async function resolveAgentState(
  body: Record<string, unknown>,
  sessionId: string,
  resolveAgentIdBySessionId?: (sessionId: string) => Promise<string | null>,
): Promise<AgentState | null> {
  const agentId = stringField(body.agentId) ?? stringField(body.agent_id);
  return agentId ? await Effect.runPromise(getAgentState(agentId)) : await findAgentStateBySessionId(sessionId, resolveAgentIdBySessionId);
}

async function findAgentStateBySessionId(
  sessionId: string,
  resolveAgentIdBySessionId?: (sessionId: string) => Promise<string | null>,
): Promise<AgentState | null> {
  if (resolveAgentIdBySessionId) {
    const agentId = await resolveAgentIdBySessionId(sessionId);
    return agentId ? await Effect.runPromise(getAgentState(agentId)) : null;
  }

  const agents = await Effect.runPromise(listRunningAgents());
  for (const agent of agents) {
    if (agent.sessionId === sessionId) return agent;
    if ((await Effect.runPromise(getAgentRuntimeState(agent.id)))?.claudeSessionId === sessionId) return agent;
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
