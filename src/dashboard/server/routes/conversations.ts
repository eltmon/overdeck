import { jsonResponse } from "../http-helpers.js";
import { BLANKED_PROVIDER_ENV } from '../../../lib/child-env.js';
import { getClaudePermissionFlagsStringSync, resolvePermissionModeSync, BYPASS_PERMISSION_MODE } from '../../../lib/claude-permissions.js';
import { exec, execFile, spawn } from 'node:child_process';
import { existsSync, createReadStream } from 'node:fs';
import { mkdir, writeFile, stat, realpath, rename, rm, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { validateOrigin, validateOriginHeaders, getHeaderFromMap, type HeaderMap } from './origin-validation.js';
import * as self from './conversations.js';
import {
  backfillConversationModels,
  conversationRuntimeRootPids,
  handleConversationCreate,
  handleConversationClearForkState,
  handleConversationDelete,
  handleConversationRestartAll,
  handleConversationResume,
  handleConversationStop,
  handleConversationSwitchModel,
  piConversationSystemPromptFiles,
  resolveAllowedHarness,
  shouldReportUnresolvedLiveSession,
  spawnConversationSession,
  startConversationModelBackfill,
  stopConversationRuntime,
  tmuxSessionExists,
  waitForConversationRuntimeReady,
  waitForTmuxSession,
} from '../../../lib/overdeck/conversation-runtime.js';
import { getDefaultCwd } from '../../../lib/default-cwd.js';
import {
  archiveConversationByName,
  handleArchivedConversationsList,
  parseArchivedConversationListOptions,
  unarchiveConversationByName,
} from '../../../lib/overdeck/conversation-archive.js';
import {
  getConversationDiffs,
  getConversationDiffFull,
  getConversationDiffTurn,
} from '../../../lib/overdeck/conversation-diffs.js';
import {
  generateAiTitle,
  getCachedMessages,
  getConversationAbout,
  getConversationMessageLocator,
  getConversationMessagesRead,
  getConversationRead,
  getConversationsPendingInputFeed,
  patchConversationTitle,
  handleConversationMove,
  retitleConversation,
  resolveSessionFile,
} from '../../../lib/overdeck/conversation-reads.js';
import {
  getEnrichedConversationList,
  invalidateConversationFavoritesCache,
  invalidateConversationListEnrichmentCache,
} from '../../../lib/overdeck/conversation-list.js';
import {
  clearPendingConversationControlAcksForTests,
  deliverConversationViaControlChannel,
  getPendingConversationControlAckCount,
  handleConversationAbort,
  handleConversationCompact,
  handleConversationCodexApproval,
  handleConversationControlAck,  handleConversationDeliveryMethod,
  handleConversationPlanAction,
  handleConversationThinkingLevel,
  isPiControlChannelHarness,
  pickDeliverAs,
  resolveConversationControlAck,  resolveConversationDeliveryMethod,
  sendConversationControlCommand,
  validateConversationControlAckOrigin,
} from '../../../lib/overdeck/conversation-delivery.js';
import { handleConversationPaneChoiceAnswer } from '../../../lib/overdeck/conversation-pane-choice.js';
import {
  checkConversationUploadRateLimit,
  handleConversationImageDelete,
  handleConversationImageUploadFile,
  handleConversationMessage,
  MAX_UPLOAD_BYTES,
  resolveConversationUploadClientIp,
} from '../../../lib/overdeck/conversation-message.js';
import {
  handleConversationHandoffDoc,
  handleConversationSummaryFork,
} from '../../../lib/overdeck/conversation-forks.js';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import * as Multipart from 'effect/unstable/http/Multipart';
import {
  getConversationByName,
  getConversationById,
  markConversationEnded,
  markConversationActive,
  updateLastAttached,
  updateConversationTitle,
  updateConversationCost,
  setConversationModel,
  setConversationEffort,
  setConversationHarness,
  setConversationClaudeSessionId,
  backfillConversationModel,
  archiveConversation,
  unarchiveConversation,
  setFavorite,
  removeFavorite,
  updateForkStatus,
  updateSpawnError,
  hasOtherActiveConversationOnTmuxSession,
  type LegacyConversation as Conversation,
} from '../../../lib/overdeck/conversations.js';
import {
  sendRawKeystroke,
  sendKeysAsync,
  MessageDeliveryFailed,
  capturePane,
  isHarnessProcessAlive,
  killSession,
  createSession,
  setOption,
  exactPaneTarget,
  listSessionNames,
  findManagedServerPidSync,
} from '../../../lib/tmux.js';
import { deliverAgentMessage, writeChannelsBridgeMcpConfig, dismissDevChannelsDialog, clearReadySignal } from '../../../lib/agents.js';
import { markRespawnPending } from '../services/pending-respawn.js';
import {
  getAgentRuntimeBaseCommand,
  getProviderExportsForModel,
  getProviderEnvForModel,
  getProviderAuthMode,
} from '../../../lib/agents.js';
import { writeBridgeTokenSync } from '../../../lib/bridge-token.js';
import { isClaudeCodeChannelsEnabled, loadConfigSync } from '../../../lib/config-yaml.js';
import {
  writeConversationControlCommand,
  type ControlCommand,
  type ThinkingLevel,
} from '../../../lib/runtimes/conversation-control.js';
import { writePtyToken } from '../../../lib/pty-token.js';
import { canUseHarnessSync } from '../../../lib/harness-policy.js';
import { resolveHarness } from '../../../lib/harness-resolve.js';
import { getProviderForModelSync, piProviderForModel } from '../../../lib/providers.js';
import { getOhmypiCodexAuthStatus } from '../../../lib/ohmypi-codex-auth.js';
import type { RuntimeName } from '../../../lib/runtimes/types.js';
import { getHarnessBehavior } from '../../../lib/runtimes/behavior.js';
import { piFifoPaths } from '../../../lib/runtimes/pi-fifo.js';
import { generateLauncherScriptSync } from '../../../lib/launcher-generator.js';
import { workspaceContextFile, piGlobalContextFile } from '../../../lib/context-layers/layers.js';
import { ensureSessionContextBriefingFile } from '../../../lib/briefing-freshness.js';
import {
  compactConversationNative,
  shouldInterceptManualCompact,
} from '../services/conversation-compaction.js';
import { encodeClaudeProjectDir, packageRoot, getOverdeckHome, resolveOhmypiExtensionPath } from '../../../lib/paths.js';
import {
  ensureConversationAttachmentDir,
  getConversationAttachmentsRoot,
  hasConversationAttachment,
  isManagedConversationAttachmentPath,
  removeConversationAttachment,
  cleanupUnreferencedConversationAttachments,
  cleanupConversationAttachments,
} from '../services/conversation-attachments.js';
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
function getHeader(
  request: HttpServerRequest.HttpServerRequest,
  name: string,
): string | undefined {
  const value = (request.headers as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(value)) return value[0];
  return value;
}
const conversationReadDependencies = {
  resolveSessionFile,
  tmuxSessionExists,
  listSessionNames: () => Effect.runPromise(listSessionNames()),
  shouldReportUnresolvedLiveSession,
};
const conversationMessageDependencies = {
  resolveSessionFile,
  generateAiTitle: (name: string, message: string) => generateAiTitle(name, message, conversationReadDependencies),
};
startConversationModelBackfill(resolveSessionFile);
function conversationReadJson(response: { body: unknown; status?: number }): ReturnType<typeof jsonResponse> {
  return jsonResponse(response.body, response.status === undefined ? undefined : { status: response.status });
}
const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {} as Record<string, unknown>;
  }
});
const getConversationsRoute = HttpRouter.add(
  'GET',
  '/api/conversations',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    return yield* Effect.promise(async () => {
      try {
        const url = new URL(request.url, 'http://localhost');
        const limitParam = url.searchParams.get('limit');
        const offsetParam = url.searchParams.get('offset');
        const limit = limitParam ? Math.min(parseInt(limitParam, 10), 1000) : 500;
        const offset = offsetParam ? Math.max(parseInt(offsetParam, 10), 0) : 0;
        const enriched = await getEnrichedConversationList(limit, offset);
        return jsonResponse(enriched);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] list conversations failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
// PAN-1705 — lightweight feed for the needs-you modal (PAN-1520). The previous
// implementation polled the full enriched list (≈0.5 MB, full per-row
// enrichment server-side) every 4s per client just to filter for
// pendingAskUserQuestion. Only tmux-alive conversations can have a pending
// blocking surface, so this endpoint scans just those few JSONLs and returns
// only the rows that actually need attention.
const getConversationsPendingInputRoute = HttpRouter.add(
  'GET',
  '/api/conversations/pending-input',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    return yield* Effect.promise(async () => {
      const response = await getConversationsPendingInputFeed(conversationReadDependencies);
      return conversationReadJson(response);
    });
  }),
);
const getArchivedConversationsRoute = HttpRouter.add(
  'GET',
  '/api/conversations/archived',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const url = new URL(request.url, 'http://localhost');
    return yield* Effect.promise(async () => {
      const response = await handleArchivedConversationsList(parseArchivedConversationListOptions(url.searchParams));
      return jsonResponse(response.body, response.status === undefined ? undefined : { status: response.status });
    });
  }),
);
const getConversationRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:id',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const rawId = params['id'] ?? '';
    return yield* Effect.promise(async () => {
      const response = await getConversationRead(rawId, conversationReadDependencies);
      return conversationReadJson(response);
    });
  }),
);
const getConversationHandoffDocRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/handoff-doc',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.promise(() => handleConversationHandoffDoc(name));
  }),
);
//
// Unified spawn + create endpoint. Called on first message from draft mode.
// Spawns Claude Code with selected model/effort, creates DB record, sends message.
// Accepts: { message, model?, effort?, issueId? }
const postConversationRoute = HttpRouter.add(
  'POST',
  '/api/conversations',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const body = yield* readJsonBody;
    // Log request origin to trace who is creating conversations
    const reqOrigin = getHeader(request, 'origin') ?? 'none';
    const reqReferer = getHeader(request, 'referer') ?? 'none';
    const reqUserAgent = getHeader(request, 'user-agent') ?? 'none';
    const reqXff = getHeader(request, 'x-forwarded-for') ?? 'none';
    const reqIp = request.headers['x-real-ip'] ?? 'local';
    console.log(`[conversations] POST /api/conversations origin=${reqOrigin} referer=${reqReferer} ua=${reqUserAgent.slice(0, 80)} xff=${reqXff} ip=${reqIp}`);
    return yield* Effect.promise(async () => handleConversationCreate(body, {
      generateAiTitle: (name: string, message: string) => generateAiTitle(name, message, conversationReadDependencies),
    }));
  }),
);
//
// Stop the agent for a conversation: kill the tmux session and mark the
// conversation ended. The conversation row is preserved — it stays in the list
// (with a gray dot) and can be resumed later. Conversations are NEVER deleted;
// the only removal verb is `archive`.
const postConversationStopRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/stop',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.promise(async () => handleConversationStop(name, {
      resolveSessionFileForCleanup: (conv) => (conv as { sessionFile?: string | null }).sessionFile ?? null,
    }));
  }),
);
const postConversationClearForkStateRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/clear-fork-state',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    return yield* Effect.promise(() => handleConversationClearForkState(params['name'] ?? ''));
  }),
);
const postConversationResumeRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/resume',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => handleConversationResume(name, body, { resolveSessionFile }));
  }),
);
//
// Update the model/harness for a brand-new conversation before any runtime
// session exists. Pi conversations can also receive live model changes through
// the control channel; Claude conversations remain locked after start.
const postConversationSwitchModelRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/switch-model',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => {
      try {
        return await handleConversationSwitchModel(name, body);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] switch model failed:', msg);
        return jsonResponse({ error: msg || 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
const postConversationThinkingLevelRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/thinking-level',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => {
      try {
        return await handleConversationThinkingLevel(name, body);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] set thinking level failed:', msg);
        return jsonResponse({ error: msg || 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
const postConversationCompactRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/compact',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.promise(async () => {
      try {
        return await handleConversationCompact(name);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] compact conversation failed:', msg);
        return jsonResponse({ error: msg || 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
const postConversationAbortRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/abort',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.promise(async () => {
      try {
        return await handleConversationAbort(name);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] abort conversation failed:', msg);
        return jsonResponse({ error: msg || 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
const getConversationMessagesRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/messages',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.promise(async () => {
      const agentId = new URL(request.url, 'http://localhost').searchParams.get('agentId') ?? undefined;
      return conversationReadJson(await getConversationMessagesRead(name, conversationReadDependencies, agentId));
    });
  }),
);
const getConversationMessageLocatorRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/message-locator',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const url = new URL(request.url, 'http://localhost');
    const rawByteOffset = url.searchParams.get('byteOffset');
    const byteOffset = rawByteOffset === null ? NaN : Number(rawByteOffset);
    if (!Number.isInteger(byteOffset) || byteOffset < 0) {
      return jsonResponse({ error: 'byteOffset must be a non-negative integer' }, { status: 400 });
    }
    return yield* Effect.promise(async () => {
      const response = await getConversationMessageLocator(name, byteOffset, conversationReadDependencies);
      return conversationReadJson(response);
    });
  }),
);
const postConversationUploadImageRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/upload-image',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const remoteAddress = resolveConversationUploadClientIp(
      request.remoteAddress,
      getHeader(request, 'x-forwarded-for'),
    );
    if (!checkConversationUploadRateLimit(remoteAddress)) {
      return jsonResponse({ error: 'Rate limit exceeded' }, { status: 429 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const multipart = yield* Effect.provideContext(
      request.multipart,
      Multipart.limitsServices({
        maxFileSize: MAX_UPLOAD_BYTES,
        maxTotalSize: MAX_UPLOAD_BYTES,
        maxParts: 3,
        maxFieldSize: 1024,
      }),
    );
    const files = multipart['file'] as Multipart.PersistedFile[] | undefined;
    const filenameField = multipart['filename'] as string | string[] | undefined;
    const mimeTypeField = multipart['mimeType'] as string | string[] | undefined;
    const file = files?.[0];
    const filenameRaw = Array.isArray(filenameField) ? filenameField[0] : filenameField;
    const mimeTypeRaw = Array.isArray(mimeTypeField) ? mimeTypeField[0] : mimeTypeField;
    if (typeof filenameRaw !== 'string') {
      return jsonResponse({ error: 'filename is required' }, { status: 400 });
    }
    if (typeof mimeTypeRaw !== 'string') {
      return jsonResponse({ error: 'mimeType is required' }, { status: 400 });
    }
    const filename = filenameRaw;
    const mimeType = mimeTypeRaw;
    if (!file || !file.path) {
      return jsonResponse({ error: 'file is required' }, { status: 400 });
    }
    return yield* Effect.promise(async () => {
      try {
        return await handleConversationImageUploadFile(name, filename, file.path, mimeType);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] upload image failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
const postConversationDeleteImageRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/delete-image',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => {
      try {
        return await handleConversationImageDelete(name, body);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] delete image failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
const postConversationMessageRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/message',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => {
      try {
        return await handleConversationMessage(name, body, conversationMessageDependencies);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        // Log the full stack (falls back to message) so a 500's cause is
        // diagnosable after the fact, not just the bare message (PAN-1552).
        console.error('[conversations] send message failed:', error instanceof Error ? (error.stack ?? msg) : msg);
        // MessageDeliveryFailed includes a pane snapshot for debugging
        if (error instanceof Error && error.name === 'MessageDeliveryFailed') {
          return jsonResponse({
            error: 'Message delivery failed — text did not reach the terminal',
            deliveryFailed: true,
            details: msg,
          }, { status: 504 });
        }
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
//
// PAN-1690 — answer a Codex TUI approval menu from the dashboard. The body
// carries the 1-based option number the operator chose in the AskUserQuestion
// modal; we re-detect the live menu (to confirm it's still up and bound the
// choice), then drive the selection with Down×(n-1) + Enter.
const postConversationCodexApprovalRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:id/codex-approval',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const rawId = params['id'] ?? '';
    const body = yield* readJsonBody;
    return yield* Effect.promise(() => handleConversationCodexApproval(rawId, body));
  }),
);
//
// PAN-3113 — answer a claude-code pane choice menu (session-resume gate et
// al.) from the dashboard. The body carries the 0-based option index and the
// menu signature the card was rendered from; the handler re-parses the live
// pane and refuses on any drift before sending Up/Down + Enter keystrokes.
const postConversationPaneChoiceRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:id/pane-choice',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const rawId = params['id'] ?? '';
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => {
      const result = await handleConversationPaneChoiceAnswer(rawId, body);
      return jsonResponse(result.body, { status: result.status });
    });
  }),
);
const postConversationDeliveryMethodRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/delivery-method',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => {
      try {
        return await handleConversationDeliveryMethod(name, body);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] update delivery method failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
const postConversationControlAckRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/control-ack',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateConversationControlAckOrigin(request.headers as HeaderMap, request.method);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => {
      try {
        const result = handleConversationControlAck(body);
        return jsonResponse(result.body, { status: result.status });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] control ack failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
const patchConversationRoute = HttpRouter.add(
  'PATCH',
  '/api/conversations/:name',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => {
      try {
        const result = patchConversationTitle(name, body);
        return jsonResponse(result.body, { status: result.status });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] update conversation failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
const patchConversationMoveRoute = HttpRouter.add(
  'PATCH',
  '/api/conversations/:name/move',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    const body = yield* readJsonBody;
    return yield* Effect.promise(async () => {
      try {
        const result = await handleConversationMove(name, body, {
          invalidateListEnrichmentCache: invalidateConversationListEnrichmentCache,
        });
        return jsonResponse(result.body, { status: result.status });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] move conversation failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
const deleteConversationRoute = HttpRouter.add(
  'DELETE',
  '/api/conversations/:name',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.promise(async () => handleConversationDelete(name, { invalidateFavoritesCache: invalidateConversationFavoritesCache }));
  }),
);
const conversationArchiveDependencies = {
  stopConversationRuntime,
  invalidateFavoritesCache: invalidateConversationFavoritesCache,
  cleanupConversationAttachments,
};
const postConversationArchiveRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/archive',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.promise(async () => {
      const response = await archiveConversationByName(name, conversationArchiveDependencies);
      return jsonResponse(response.body, response.status === undefined ? undefined : { status: response.status });
    });
  }),
);
const postConversationUnarchiveRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/unarchive',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.promise(async () => {
      const response = await unarchiveConversationByName(name);
      return jsonResponse(response.body, response.status === undefined ? undefined : { status: response.status });
    });
  }),
);
//
// Kill all active conversation tmux sessions and re-spawn them with
// their stored model/effort. Useful when model persistence was fixed
// and existing sessions need to pick up the correct model.
const postConversationRestartAllRoute = HttpRouter.add(
  'POST',
  '/api/conversations/restart-all',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    return yield* Effect.promise(async () => handleConversationRestartAll({ resolveSessionFile }));
  }),
);
const postConversationFavoriteRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/favorite',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    return yield* Effect.promise(async () => {
      try {
        const conv = getConversationByName(name);
        if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        setFavorite('conversation', name);
        invalidateConversationFavoritesCache();
        return jsonResponse({ favorited: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] favorite conversation failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
const deleteConversationFavoriteRoute = HttpRouter.add(
  'DELETE',
  '/api/conversations/:name/favorite',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    return yield* Effect.promise(async () => {
      try {
        const conv = getConversationByName(name);
        if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        removeFavorite('conversation', name);
        invalidateConversationFavoritesCache();
        return jsonResponse({ favorited: false });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] unfavorite conversation failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
const postConversationSummaryForkRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/summary-fork',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    const body = yield* readJsonBody;
    return yield* Effect.promise(() => handleConversationSummaryFork(name, body));
  }),
);
const postConversationPlanActionRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/plan-action',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const body = yield* readJsonBody;
    return yield* Effect.promise(() => handleConversationPlanAction(name, body));
  }),
);
const conversationDiffDependencies = {
  resolveSessionFile,
  getCachedMessages,
};
const getConversationDiffsRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/diffs',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.promise(async () => {
      const response = await getConversationDiffs(name, conversationDiffDependencies);
      return jsonResponse(response.body, response.status === undefined ? undefined : { status: response.status });
    });
  }),
);
const getConversationDiffFullRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/diffs/full',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.promise(async () => {
      const response = await getConversationDiffFull(name, conversationDiffDependencies);
      return jsonResponse(response.body, response.status === undefined ? undefined : { status: response.status });
    });
  }),
);
const getConversationDiffTurnRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/diffs/:turnId',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const turnId = params['turnId'] ?? '';
    const reqUrl = new URL(request.url, 'http://localhost');
    const fileFilter = reqUrl.searchParams.get('file') ?? undefined;
    return yield* Effect.promise(async () => {
      const response = await getConversationDiffTurn(name, turnId, fileFilter, conversationDiffDependencies);
      return jsonResponse(response.body, response.status === undefined ? undefined : { status: response.status });
    });
  }),
);
//
// Regenerate the conversation title from the *whole* transcript (not just the
// opening message). This is an explicit user action, so it overrides even a
// manually-set title and records the new title with source 'ai'.
const postConversationRetitleRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/retitle',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.promise(async () => {
      const response = await retitleConversation(name, conversationReadDependencies);
      return conversationReadJson(response);
    });
  }),
);
//
// A few-sentence description of what the conversation has been about, derived
// from the transcript. Cached by transcript size — re-opening the drawer is
// free until the conversation grows. Pass ?refresh=1 to force regeneration.
const getConversationAboutRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/about',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    return yield* Effect.promise(async () => {
        const url = new URL(request.url, 'http://localhost');
        const forceRefresh = url.searchParams.get('refresh') === '1';
        const response = await getConversationAbout(name, forceRefresh, conversationReadDependencies);
        return conversationReadJson(response);
    });
  }),
);
export const conversationsRouteLayer = Layer.mergeAll(
  getConversationsRoute,
  getConversationsPendingInputRoute,
  getArchivedConversationsRoute,
  getConversationRoute,
  getConversationHandoffDocRoute,
  postConversationRoute,
  patchConversationRoute,
  patchConversationMoveRoute,
  deleteConversationRoute,
  postConversationStopRoute,
  postConversationClearForkStateRoute,
  postConversationResumeRoute,
  postConversationSwitchModelRoute,
  postConversationThinkingLevelRoute,
  postConversationCompactRoute,
  postConversationAbortRoute,
  postConversationRestartAllRoute,
  postConversationArchiveRoute,
  postConversationUnarchiveRoute,
  getConversationMessagesRoute,
  getConversationMessageLocatorRoute,
  postConversationUploadImageRoute,
  postConversationDeleteImageRoute,
  postConversationMessageRoute,
  postConversationCodexApprovalRoute,
  postConversationPaneChoiceRoute,
  postConversationDeliveryMethodRoute,
  postConversationControlAckRoute,
  postConversationFavoriteRoute,
  deleteConversationFavoriteRoute,
  postConversationSummaryForkRoute,
  postConversationPlanActionRoute,
  getConversationDiffsRoute,
  getConversationDiffFullRoute,
  getConversationDiffTurnRoute,
  postConversationRetitleRoute,
  getConversationAboutRoute,
);
export default conversationsRouteLayer;
