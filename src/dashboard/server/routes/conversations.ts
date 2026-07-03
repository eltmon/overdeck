import { jsonResponse } from "../http-helpers.js";
import { BLANKED_PROVIDER_ENV } from '../../../lib/child-env.js';
import { getClaudePermissionFlagsStringSync, resolvePermissionModeSync, BYPASS_PERMISSION_MODE } from '../../../lib/claude-permissions.js';
/**
 * Conversations route module — Effect HttpRouter.Layer (PAN-416)
 *
 * Implements conversation session management endpoints:
 *   GET    /api/conversations                — list all conversations
 *   POST   /api/conversations                — spawn a new conversation
 *   POST   /api/conversations/:name/stop     — kill session, mark ended (preserves row)
 *   POST   /api/conversations/:name/archive  — kill session and hide from list
 *   DELETE /api/conversations/:name          — cleanup alias: kill and archive, preserve transcript
 *   POST   /api/conversations/:name/resume   — reattach or respawn
 *
 * Conversations are NEVER deleted from the database, and JSONL transcript files are never removed.
 */
import { randomUUID } from 'node:crypto';
import { exec, execFile, spawn } from 'node:child_process';
import { existsSync, createReadStream } from 'node:fs';
import { mkdir, writeFile, readFile, stat, realpath, rename, rm, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { readLauncherPinnedSessionId, resolveCodexRolloutPath, resolvePiSessionPath } from './jsonl-resolver.js';
import { validateOrigin, validateOriginHeaders, getHeaderFromMap, type HeaderMap } from './origin-validation.js';
import * as self from './conversations.js';
import {
  backfillConversationModels,
  conversationNeedsRunningRepair,
  conversationRuntimeRootPids,
  conversationSessionAliveFromState,
  handleConversationCreate,
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
  waitForPiTuiReady,
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
  askUserQuestionSnapshotFromScan,
  generateAiTitle,
  getCachedMessages,
  getConversationAbout,
  getConversationMessageLocator,
  getConversationMessagesRead,
  getConversationRead,
  getConversationsPendingInputFeed,
  patchConversationTitle,
  retitleConversation,
} from '../../../lib/overdeck/conversation-reads.js';
import {
  clearPendingConversationControlAcksForTests,
  codexConversationPendingInput,
  deliverCodexApprovalChoice,
  deliverConversationViaControlChannel,
  getPendingConversationControlAckCount,
  handleConversationAbort,
  handleConversationCompact,
  handleConversationControlAck,
  handleConversationDeliveryMethod,
  handleConversationThinkingLevel,
  isPiControlChannelHarness,
  pickDeliverAs,
  resolveConversationControlAck,
  resolveConversationDeliveryMethod,
  sendConversationControlCommand,
  validateConversationControlAckOrigin,
} from '../../../lib/overdeck/conversation-delivery.js';
import {
  handleConversationImageUpload,
  handleConversationMessage,
} from '../../../lib/overdeck/conversation-message.js';
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import * as Multipart from 'effect/unstable/http/Multipart';
import {
  listConversations,
  getConversationLedgerCosts,
  getStuckForks,
  incrementForkRetryCount,
  getConversationByName,
  getConversationById,
  createConversation,
  markConversationEnded,
  markConversationRunning,
  markConversationActive,
  updateLastAttached,
  updateConversationTitle,
  updateConversationCost,
  setConversationModel,
  setConversationEffort,
  setConversationHarness,
  setConversationClaudeSessionId,
  updateConversationForkFallbackReason,
  setForkRequest,
  recordConversationHandoff,
  backfillConversationModel,
  archiveConversation,
  unarchiveConversation,
  listFavoritedIds,
  setFavorite,
  removeFavorite,
  updateForkStatus,
  updateSpawnError,
  hasOtherActiveConversationOnTmuxSession,
  type LegacyConversation as Conversation,
  type ForkRequest,
} from '../../../lib/overdeck/conversations.js';
import {
  sendRawKeystroke,
  sendKeysAsync,
  MessageDeliveryFailed,
  capturePane,
  sessionExists,
  isHarnessProcessAlive,
  killSession,
  createSession,
  setOption,
  exactPaneTarget,
  listSessionNames,
  findManagedServerPidSync,
} from '../../../lib/tmux.js';
import { deliverAgentMessage, writeChannelsBridgeMcpConfig, dismissDevChannelsDialog, waitForReadySignal, clearReadySignal } from '../../../lib/agents.js';
import { markRespawnPending } from '../services/pending-respawn.js';
import {
  getAgentRuntimeBaseCommand,
  getProviderExportsForModel,
  getProviderEnvForModel,
  getProviderAuthMode,
  getAgentRuntimeStateSync,
} from '../../../lib/agents.js';
import { writeBridgeTokenSync } from '../../../lib/bridge-token.js';
import { isClaudeCodeChannelsEnabled, loadConfigSync } from '../../../lib/config-yaml.js';
import {
  writeConversationControlCommand,
  type ControlCommand,
  type ThinkingLevel,
} from '../../../lib/runtimes/conversation-control.js';
import { resolveDiscoveredSessionFile } from '../../../lib/conversations/discovered-session-file.js';
import { writePtyToken } from '../../../lib/pty-token.js';
import { canUseHarnessSync } from '../../../lib/harness-policy.js';
import { resolveHarness } from '../../../lib/harness-resolve.js';
import { getProviderForModelSync, piProviderForModel, UnknownModelError } from '../../../lib/providers.js';
import { getOhmypiCodexAuthStatus } from '../../../lib/ohmypi-codex-auth.js';
import { withConcurrencyLimit } from '../../../lib/concurrency.js';
import { scanPendingInputsPromise, type PendingAskUserQuestionSnapshot, type PendingInputKind } from '../../../lib/agent-enrichment.js';
import { detectAwaitingInputForAgent, parseCodexApprovalPrompt } from '../../../lib/agent-input-detection.js';
import type { RuntimeName } from '../../../lib/runtimes/types.js';
import { getHarnessBehavior } from '../../../lib/runtimes/behavior.js';
import { piFifoPaths } from '../../../lib/runtimes/pi-fifo.js';
import { generateLauncherScriptSync } from '../../../lib/launcher-generator.js';
import { workspaceContextFile, piGlobalContextFile } from '../../../lib/context-layers/layers.js';
import { ensureSessionContextBriefingFile } from '../../../lib/briefing-freshness.js';
import {
  summarizeConversationActivity,
} from '../services/conversation-service.js';
import { resolveConversationGitInfo } from '../services/git-info.js';
import {
  compactConversationNative,
  shouldInterceptManualCompact,
  isCompacting,
} from '../services/conversation-compaction.js';
import { sessionFilePath, encodeClaudeProjectDir, packageRoot, getOverdeckHome, resolveOhmypiExtensionPath } from '../../../lib/paths.js';
import { getEventStore } from '../event-store.js';
import {
  generateSummaryForFork,
  generateFallbackSummary,
  reserveSummaryForkSession,
  copySessionFromCompactBoundary,
  requestHandoffFromAgent,
  authorHandoffExternal,
  handoffPreconditionFallbackReason,
  handoffFailureReason,
  logHandoffFallback,
  prependFallbackFocus,
  type SummaryForkMode,
  type HandoffAuthor,
} from '../../../lib/conversations/summary-fork.js';
import { getTranscriptAdapter } from '../../../lib/conversations/transcript-adapter.js';
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
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 50_000;
const PTY_SUPERVISOR_SOCKET_WAIT_MS = 30_000;
const CONVERSATION_LIST_ENRICHMENT_CONCURRENCY = 8;
const SAFE_MODEL_PATTERN = /^[a-zA-Z0-9_.:\/-]+$/;
const SAFE_EFFORT_PATTERN = /^(low|medium|high)$/;
const PI_CONVERSATION_SOURCE_CONTRACT = [
  'Pi conversation source contract:',
  "A message marked source:'extension' was injected by the Overdeck orchestrator or another agent, not typed by the human operator.",
  'Treat it as coordination guidance; do not attribute it to the human operator.',
].join(' ');
const SAFE_PROJECT_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SAFE_ISSUE_ID_PATTERN = /^[A-Z0-9]+-[0-9]+$/;
// ─── Rate limiting ────────────────────────────────────────────────────────────
const UPLOAD_RATE_LIMIT_WINDOW_MS = 60_000;
const UPLOAD_RATE_LIMIT_MAX = 10;
const UPLOAD_RATE_LIMIT_MAP_MAX = 1_000;
const uploadRateLimit = new Map<string, { count: number; resetAt: number }>();
function isLoopbackAddress(addr: string): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}
function getHeader(
  request: HttpServerRequest.HttpServerRequest,
  name: string,
): string | undefined {
  const value = (request.headers as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(value)) return value[0];
  return value;
}
function getClientIp(request: HttpServerRequest.HttpServerRequest): string {
  const remoteAddress = Option.getOrElse(request.remoteAddress, () => 'unknown');
  // Only trust X-Forwarded-From when the direct connection comes from a
  // loopback address (i.e. we are behind a local reverse proxy). Otherwise
  // a client can spoof any IP and bypass rate-limiting.
  if (isLoopbackAddress(remoteAddress)) {
    const forwarded = getHeader(request, 'x-forwarded-for');
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
  }
  return remoteAddress;
}
const SAFE_SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
let lastRateLimitPruneAt = 0;
function checkUploadRateLimit(remoteAddress: string): boolean {
  const now = Date.now();
  // Prune stale entries at most once per rate-limit window to avoid O(n)
  // scans on every request. The hard size cap is still enforced after pruning.
  if (now - lastRateLimitPruneAt > UPLOAD_RATE_LIMIT_WINDOW_MS) {
    lastRateLimitPruneAt = now;
    for (const [ip, entry] of uploadRateLimit) {
      if (now > entry.resetAt) {
        uploadRateLimit.delete(ip);
      }
    }
  }
  // If still over cap after pruning stale entries, evict oldest entries
  // (Map iteration order is insertion order).
  while (uploadRateLimit.size >= UPLOAD_RATE_LIMIT_MAP_MAX) {
    const firstKey = uploadRateLimit.keys().next().value;
    if (firstKey !== undefined) {
      uploadRateLimit.delete(firstKey);
    } else {
      break;
    }
  }
  const entry = uploadRateLimit.get(remoteAddress);
  if (!entry || now > entry.resetAt) {
    uploadRateLimit.set(remoteAddress, { count: 1, resetAt: now + UPLOAD_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= UPLOAD_RATE_LIMIT_MAX) {
    return false;
  }
  entry.count++;
  return true;
}
// ─── Favorites cache ───────────────────────────────────────────────────────────
const FAVORITES_CACHE_TTL_MS = 5000;
let favoritesCache: { timestamp: number; ids: Set<string> } | null = null;
function getCachedFavoritedIds(): Set<string> {
  const now = Date.now();
  if (favoritesCache && now - favoritesCache.timestamp < FAVORITES_CACHE_TTL_MS) {
    return favoritesCache.ids;
  }
  const ids = new Set(listFavoritedIds('conversation'));
  favoritesCache = { timestamp: now, ids };
  return ids;
}
function invalidateFavoritesCache(): void {
  favoritesCache = null;
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
// ─── CSRF / Origin validation ────────────────────────────────────────────────
/** Validate a caller-supplied cwd is an existing directory under the user's home. */
async function validateCwdContainment(cwd: string): Promise<boolean> {
  if (!cwd.startsWith('/')) return false;
  const segments = cwd.split('/').filter(Boolean);
  if (segments.includes('..')) return false;
  try {
    const resolved = await realpath(cwd);
    const stats = await stat(resolved);
    if (!stats.isDirectory()) return false;
    const home = homedir();
    // Require the resolved cwd to be under the user's home directory
    if (!resolved.startsWith(`${home}/`) && resolved !== home) return false;
    return true;
  } catch {
    return false;
  }
}
/**
 * Find a Claude Code session JSONL by its (globally-unique) session id, searching
 * every project dir under ~/.claude/projects/. Claude keys session files by the
 * cwd AT RUNTIME, so when a repo directory is renamed (e.g. Projects/panopticon-cli
 * → Projects/overdeck) a conversation's recorded cwd goes stale and the
 * deterministic sessionFilePath(cwd, id) points at a dir that no longer exists,
 * while the JSONL itself lives under the new encoded dir. A by-id search recovers
 * it. Mirrors the cross-dir lookup the non-DB specialist/agent fallback already
 * uses below.
 */
// PAN-2220: memoize by-id lookups. The sweep below stats <sessionId>.jsonl in
// EVERY project dir (~2,200 on this machine), and the conversation-list
// enrichment resolves session files per row per request — for each stale-cwd
// conversation that meant a full sweep on every list build (~1.7s of
// event-loop-adjacent syscall storm). A found path is stable (re-verified
// with one existsSync); a miss is re-swept after a short TTL so a transcript
// that appears later is still discovered.
const sessionFileByIdCache = new Map<string, { path: string | null; ts: number }>();
const SESSION_FILE_MISS_TTL_MS = 60_000;
async function findClaudeSessionFileById(sessionId: string): Promise<string | null> {
  if (!SAFE_SESSION_ID_PATTERN.test(sessionId)) return null;
  const cached = sessionFileByIdCache.get(sessionId);
  if (cached) {
    if (cached.path) {
      if (existsSync(cached.path)) return cached.path;
      sessionFileByIdCache.delete(sessionId);
    } else if (Date.now() - cached.ts < SESSION_FILE_MISS_TTL_MS) {
      return null;
    }
  }
  try {
    const claudeProjects = join(homedir(), '.claude', 'projects');
    const dirs = await readdir(claudeProjects);
    const SAFE_DIR_PATTERN = /^[a-zA-Z0-9_.-]+$/;
    const candidates = dirs
      .filter((dir) => SAFE_DIR_PATTERN.test(dir))
      .map((dir) => join(claudeProjects, dir, `${sessionId}.jsonl`));
    const STAT_BATCH_SIZE = 50;
    for (let i = 0; i < candidates.length; i += STAT_BATCH_SIZE) {
      const batch = candidates.slice(i, i + STAT_BATCH_SIZE);
      const checks = await Promise.all(
        batch.map(async (candidate) => {
          try {
            await stat(candidate);
            return candidate;
          } catch {
            return null;
          }
        }),
      );
      const found = checks.find((c): c is string => c !== null);
      if (found) {
        sessionFileByIdCache.set(sessionId, { path: found, ts: Date.now() });
        return found;
      }
    }
  } catch {
    /* ~/.claude/projects unreadable */
  }
  sessionFileByIdCache.set(sessionId, { path: null, ts: Date.now() });
  return null;
}
export async function resolveSessionFile(conv: Conversation): Promise<string | null> {
  // Pi work/review agents write per-run JSONL in the agent-dir root (PAN-1908);
  // conversations use sessions/. The shared resolver checks both and skips sidecars.
  if (getHarnessBehavior(conv.harness).transcriptKind === 'ohmypi-jsonl') {
    const piPath = await resolvePiSessionPath(conv.tmuxSession);
    // Fall through if the harness is stale from an earlier ohmypi run.
    if (piPath) return piPath;
  }
  // Codex conversations write rollout JSONL under per-agent CODEX_HOME/sessions/.
  if (getHarnessBehavior(conv.harness).transcriptKind === 'codex-rollout-jsonl') {
    const codexPath = await resolveCodexRolloutPath(conv.tmuxSession);
    if (codexPath) return codexPath;
    // Fall through if codex path not found — same stale-harness recovery.
  }
  // claude-code: prefer the launcher's pinned live session id, then the recorded
  // canonical id. Do not guess from JSONL mtime; compaction can make old files
  // newer than the terminal's current transcript.
  const pinned = await readLauncherPinnedSessionId(conv.tmuxSession);
  const sessionId = pinned ?? conv.claudeSessionId;
  if (sessionId) {
    const deterministic = sessionFilePath(conv.cwd, sessionId);
    if (existsSync(deterministic)) return deterministic;
    // conv.cwd may be stale (e.g. the repo dir was renamed after this conversation
    // ran), so the deterministic path points at a dir that no longer exists. Recover
    // the JSONL by its globally-unique session id across all project dirs. If still
    // not found (e.g. a live conversation before its first turn writes the file),
    // return the deterministic path so the live-session banner logic is preserved.
    const found = await findClaudeSessionFileById(sessionId);
    if (found) return found;
    const discovered = await resolveDiscoveredSessionFile(conv.claudeSessionId);
    return discovered ?? deterministic;
  }
  const discovered = await resolveDiscoveredSessionFile(conv.claudeSessionId);
  if (discovered) return discovered;
  // Neither the launcher nor the conversation record yields a session id. For a
  // live conversation this must never happen — scream so it gets attention
  // instead of silently rendering a wrong/empty transcript. The /messages route
  // turns this (for an active conversation) into a visible panel error.
  console.error(
    `[conversations] UNRESOLVED claude-code session for conversation '${conv.name}' ` +
      `(tmux=${conv.tmuxSession}, status=${conv.status}, cwd=${conv.cwd}): no --session-id ` +
      `pinned in launcher.sh and no recorded claudeSessionId. The transcript panel cannot be trusted.`,
  );
  return null;
}
/**
 * Decide whether an unresolved session file should surface the loud
 * "Session could not be resolved — needs attention" banner.
 *
 * Only LIVE claude-code conversations qualify. The claude-code launcher pins
 * `--session-id` synchronously at spawn (resolveSessionFile reads it back), so a
 * null session file for an active conversation means the launcher is broken and
 * the panel would otherwise silently render an empty/wrong transcript — worth a
 * loud banner.
 *
 * codex and pi write their transcript JSONL (codex rollout, pi session file)
 * only on the FIRST turn, so a null session file BEFORE the first turn is the
 * EXPECTED empty state for a freshly-spawned conversation, not an error. They
 * must fall through to the benign empty-messages response so the panel shows the
 * friendly "How can I help you?" first-message state instead of a scary banner
 * (PAN-1919 follow-up: codex/GPT-5.5 conversations flashed the banner on spawn).
 */
// Codex rollout resolution (thread-id fast path + PAN-1690 latest-rollout
// fallback) lives in ./jsonl-resolver.ts as resolveCodexRolloutPath, shared
// with the work-agent transcript resolver (PAN-1805).
async function resolveForkSourceSessionFile(conv: Conversation): Promise<string | null> {
  const claudeSessionFile = await resolveSessionFile(conv);
  if (claudeSessionFile && existsSync(claudeSessionFile)) {
    return claudeSessionFile;
  }
  return claudeSessionFile;
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {} as Record<string, unknown>;
  }
});
export function parseSummaryForkFocus(value: unknown): { ok: true; focus: string | undefined } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, focus: undefined };
  if (typeof value !== 'string') return { ok: false, error: 'focus must be a string' };
  const focus = value.trim();
  if (!focus) return { ok: true, focus: undefined };
  if (focus.length > 500) return { ok: false, error: 'focus must be 500 characters or fewer' };
  if (/[\x00-\x1f\x7f]/u.test(focus)) return { ok: false, error: 'focus must not contain control characters' };
  return { ok: true, focus };
}
export function buildForkRequest(params: ForkRequest): ForkRequest {
  return {
    parentConversationName: params.parentConversationName,
    sessionId: params.sessionId,
    forkMode: params.forkMode,
    ...(params.summaryModel !== undefined ? { summaryModel: params.summaryModel } : {}),
    localSummaryOnly: params.localSummaryOnly,
    ...(params.includeThinkingInSummary !== undefined ? { includeThinkingInSummary: params.includeThinkingInSummary } : {}),
    ...(params.summaryHarness !== undefined ? { summaryHarness: params.summaryHarness } : {}),
    ...(params.handoffFocus !== undefined ? { handoffFocus: params.handoffFocus } : {}),
    handoffAuthor: params.handoffAuthor,
    ...(params.handoffAuthorModel !== undefined ? { handoffAuthorModel: params.handoffAuthorModel } : {}),
    ...(params.handoffAuthorHarness !== undefined ? { handoffAuthorHarness: params.handoffAuthorHarness } : {}),
  };
}
export async function handleConversationHandoffDoc(
  name: string,
): Promise<HttpServerResponse.HttpServerResponse> {
  const conv = getConversationByName(name);
  if (!conv) {
    return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
  }
  if (!conv.handoffDocPath) {
    return jsonResponse({ error: 'Handoff document not found' }, { status: 404 });
  }
  try {
    const docText = await readFile(conv.handoffDocPath, 'utf-8');
    return HttpServerResponse.text(docText, {
      contentType: 'text/markdown',
      headers: {
        'Content-Disposition': `inline; filename="${conv.name}-handoff.md"`,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return jsonResponse({ error: 'Handoff document is no longer available' }, { status: 410 });
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[conversations] failed to read handoff doc for "${name}":`, msg);
    return jsonResponse({ error: 'Failed to read handoff document' }, { status: 500 });
  }
}
// ─── Route: GET /api/conversations ───────────────────────────────────────────
// PAN-1705 — coalesce concurrent list enrichments. Several dashboard clients
// poll this endpoint on overlapping intervals; each request used to run its
// own full per-row enrichment (session-file resolution, stats, JSONL scans
// for alive sessions). Under machine load (verification gates) the
// overlapping enrichments queue-collapsed the event loop and pushed even
// trivial endpoints to 10s+. One enrichment per short window serves all
// concurrent pollers; ≤2s staleness is invisible at the 4-10s poll cadence.
const LIST_ENRICHMENT_TTL_MS = 2_000;
interface ListEnrichmentEntry {
  settledAt: number | null; // null while the enrichment is still running
  promise: Promise<unknown[]>;
}
const listEnrichmentInFlight = new Map<string, ListEnrichmentEntry>();
function getEnrichedConversationList(limit: number, offset: number): Promise<unknown[]> {
  const key = `${limit}:${offset}`;
  const now = Date.now();
  const hit = listEnrichmentInFlight.get(key);
  // Reuse while still running (never two concurrent enrichments per key —
  // that's the whole point) or within the TTL after it settled.
  if (hit && (hit.settledAt === null || now - hit.settledAt < LIST_ENRICHMENT_TTL_MS)) {
    return hit.promise;
  }
  const entry: ListEnrichmentEntry = {
    settledAt: null,
    promise: enrichConversationList(limit, offset),
  };
  listEnrichmentInFlight.set(key, entry);
  entry.promise
    .then(() => { entry.settledAt = Date.now(); })
    // Drop failed enrichments immediately so the next poll retries fresh.
    .catch(() => {
      if (listEnrichmentInFlight.get(key) === entry) listEnrichmentInFlight.delete(key);
    });
  for (const [k, v] of listEnrichmentInFlight) {
    if (k !== key && v.settledAt !== null && now - v.settledAt >= LIST_ENRICHMENT_TTL_MS) {
      listEnrichmentInFlight.delete(k);
    }
  }
  return entry.promise;
}
async function enrichConversationList(limit: number, offset: number): Promise<unknown[]> {
  const conversations = listConversations({ limit, offset });
  const favoritedNames = getCachedFavoritedIds();
  // Cost/tokens come from the canonical cost_events ledger (per session id), not the
  // stale conversations.total_cost cache — see getConversationLedgerCosts. Computed
  // once per list build; conversations with no ledger rows fall back to the cache.
  const ledgerCosts = getConversationLedgerCosts();
  // Enrich with live tmux status
  // Grace period removed (PAN-826): POST /api/conversations now waits for
  // Claude to be ready before returning 201, so newly-created conversations
  // are always live by the time they appear in the list.
  const liveSessionNames = new Set(await Effect.runPromise(listSessionNames()));
  return Effect.runPromise(withConcurrencyLimit(
          conversations.map((conv) => Effect.promise(async () => {
            let row = conv;
            const tmuxSessionAlive = liveSessionNames.has(conv.tmuxSession);
            let sessionAlive = conversationSessionAliveFromState(row, tmuxSessionAlive);
            if (!sessionAlive && row.status === 'ended' && !row.forkStatus && tmuxSessionAlive) {
              const harnessAlive = await isHarnessProcessAlive(row.tmuxSession);
              if (conversationNeedsRunningRepair(row, tmuxSessionAlive, harnessAlive)) {
                markConversationRunning(row.name);
                row = { ...row, status: 'active', endedAt: null };
                sessionAlive = true;
              }
            }
            let isWorking = false;
            let currentTool: string | null = null;
            const convSf = await resolveSessionFile(row);
            // Context usage is intentionally NOT computed here — it requires a
            // full JSONL scan per row (cold cache) and made the list endpoint
            // O(seconds) on dashboards with hundreds of conversations. The
            // single-conversation GET /:id and the /:name/messages stream both
            // compute usage on-demand for the currently-open panel, which is
            // the only place the indicator is actually shown.
            if (sessionAlive) {
              // PAN-1596: prefer the hook-driven runtime mirror — conversations
              // now emit activity to it. 'active' collapses working+thinking
              // (busy); 'idle'/'waiting' are not busy. Falls back to the JSONL
              // transcript scan for sessions whose hooks predate the auth fix
              // and so have no mirror state yet.
              const rt = getAgentRuntimeStateSync(row.tmuxSession);
              if (getHarnessBehavior(row.harness).transcriptKind === 'codex-rollout-jsonl' && convSf && existsSync(convSf)) {
                try {
                  const summary = await summarizeConversationActivity(convSf, { harness: row.harness });
                  isWorking = summary.isWorking;
                  currentTool = summary.currentTool;
                } catch {
                  if (rt && rt.state !== 'uninitialized') {
                    isWorking = rt.state === 'active';
                    currentTool = rt.currentTool ?? null;
                  }
                }
              } else if (rt && rt.state !== 'uninitialized') {
                isWorking = rt.state === 'active';
                currentTool = rt.currentTool ?? null;
              } else if (convSf && existsSync(convSf)) {
                try {
                  const summary = await summarizeConversationActivity(convSf, { harness: row.harness });
                  isWorking = summary.isWorking;
                  currentTool = summary.currentTool;
                } catch {
                  // JSONL parse failure — fall back to defaults
                }
              }
            }
            // PAN-1520 — scan the conv JSONL for any pending blocking surface
            // (AskUserQuestion, ExitPlanMode, EnterPlanMode) so the dashboard
            // can fire the unified indicator/notification/modal for conv
            // sessions, not just work agents.
            let pendingInputCount = 0;
            let pendingInputKinds: PendingInputKind[] = [];
            let pendingAskUserQuestion: PendingAskUserQuestionSnapshot | undefined;
            if (sessionAlive && convSf && existsSync(convSf)) {
              try {
                const scan = await scanPendingInputsPromise(convSf);
                const kinds: PendingInputKind[] = [];
                const auqSnapshot = askUserQuestionSnapshotFromScan(scan);
                if (auqSnapshot) {
                  kinds.push('askUserQuestion');
                  pendingAskUserQuestion = auqSnapshot;
                }
                if (scan.exitPlanModePending) kinds.push('exitPlanMode');
                if (scan.enterPlanModeOpen && !scan.exitPlanModePending) kinds.push('enterPlanMode');
                pendingInputKinds = kinds;
                pendingInputCount = kinds.length;
              } catch {
                // JSONL scan failure — leave as zero/empty; non-fatal
              }
            }
            const compacting = convSf ? isCompacting(convSf) : false;
            const gitInfo = await resolveConversationGitInfo(row.cwd);
            // PAN-1556: surface the transcript's last-write time as the
            // conversation's last-activity signal. The JSONL is appended on
            // every message (including the user's), so its mtime — unlike
            // lastAttachedAt, which only moves on terminal re-attach — bumps
            // when a conversation gets a new reply. The session feed orders on
            // this so an active conversation rises back to the top. A bare
            // stat() is metadata-only (no JSONL scan), so it's cheap per row.
            let lastActivityAt: string | null = null;
            if (convSf && existsSync(convSf)) {
              try {
                lastActivityAt = new Date((await stat(convSf)).mtimeMs).toISOString();
              } catch {
                // non-fatal — fall back to lastAttachedAt/createdAt downstream
              }
            }
            // PAN-1690 — Codex pane-detected approval fallback (TUI prompts
            // aren't in the JSONL). Use the transcript mtime as a stable
            // askedAt so the 4s poll doesn't churn the timestamp.
            if (pendingInputCount === 0) {
              const codex = await codexConversationPendingInput(
                row,
                sessionAlive,
                lastActivityAt ?? new Date().toISOString(),
              );
              if (codex.kinds.length > 0) {
                pendingInputKinds = codex.kinds;
                pendingInputCount = codex.kinds.length;
                if (codex.approval) pendingAskUserQuestion = codex.approval;
              }
            }
            const ledger = ledgerCosts.get(String(row.id));
            return {
              ...row,
              totalCost: ledger ? ledger.cost : row.totalCost,
              totalTokens: ledger ? ledger.tokens : row.totalTokens,
              sessionAlive,
              isWorking,
              currentTool,
              isFavorited: favoritedNames.has(row.name),
              compacting,
              contextUsage: null,
              lastActivityAt,
              branch: gitInfo.branch,
              isWorktree: gitInfo.isWorktree,
              pendingInputCount,
              pendingInputKinds,
              pendingAskUserQuestion,
            };
          })),
          CONVERSATION_LIST_ENRICHMENT_CONCURRENCY,
  ));
}
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
// ─── Route: GET /api/conversations/pending-input ─────────────────────────────
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
// ─── Route: GET /api/conversations/:id ────────────────────────────────────────
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
// ─── Route: GET /api/conversations/:name/handoff-doc ─────────────────────────
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
// ─── Route: POST /api/conversations ──────────────────────────────────────────
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
// ─── Route: POST /api/conversations/:name/stop ────────────────────────────────
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
// ─── Route: POST /api/conversations/:name/resume ─────────────────────────────
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
// ─── Route: POST /api/conversations/:name/switch-model ───────────────────────
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
// ─── Route: GET /api/conversations/:name/messages ────────────────────────────
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
      const response = await getConversationMessagesRead(name, conversationReadDependencies);
      return conversationReadJson(response);
    });
  }),
);
// ─── Route: GET /api/conversations/:name/message-locator ─────────────────────
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
// ─── Route: POST /api/conversations/:name/upload-image ───────────────────────
const postConversationUploadImageRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/upload-image',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const remoteAddress = getClientIp(request);
    if (!checkUploadRateLimit(remoteAddress)) {
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
        const UPLOAD_READ_TIMEOUT_MS = 10_000;
        const bytes = await Promise.race([
          readFile(file.path),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Upload read timeout')), UPLOAD_READ_TIMEOUT_MS),
          ),
        ]);
        return await handleConversationImageUpload(name, filename, bytes, mimeType);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] upload image failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
// ─── Route: POST /api/conversations/:name/message ────────────────────────────
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
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }
        const path = typeof body['path'] === 'string' ? body['path'].trim() : '';
        if (!path) {
          return jsonResponse({ error: 'path is required' }, { status: 400 });
        }
        const removed = await removeConversationAttachment(name, path);
        if (!removed) {
          return jsonResponse({ error: 'Attachment not found for conversation' }, { status: 404 });
        }
        return jsonResponse({ ok: true });
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
// ─── Route: POST /api/conversations/:id/codex-approval ────────────────────────
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
    return yield* Effect.promise(async () => {
      try {
        const optionNumber = Number((body as { optionNumber?: unknown }).optionNumber);
        if (!Number.isInteger(optionNumber) || optionNumber < 1 || optionNumber > 9) {
          return jsonResponse({ error: 'optionNumber must be an integer 1-9' }, { status: 400 });
        }
        const numericId = Number(rawId);
        const conv = !Number.isNaN(numericId) && /^\d+$/.test(rawId)
          ? getConversationById(numericId)
          : getConversationByName(rawId);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }
        if (getHarnessBehavior(conv.harness).transcriptKind !== 'codex-rollout-jsonl') {
          return jsonResponse({ error: 'Not a Codex conversation' }, { status: 400 });
        }
        if (!(await tmuxSessionExists(conv.tmuxSession))) {
          return jsonResponse({ error: 'Conversation session is not running' }, { status: 409 });
        }
        // Re-detect uncached so we only send keystrokes when the menu is still
        // up, and so we can bound optionNumber to the options actually shown.
        const detection = await Effect.runPromise(
          detectAwaitingInputForAgent(conv.tmuxSession, { isPlanning: false, cache: false }),
        );
        const parsed = detection ? parseCodexApprovalPrompt(detection.prompt) : null;
        if (!parsed) {
          return jsonResponse({ error: 'No Codex approval prompt is currently pending' }, { status: 409 });
        }
        if (optionNumber > parsed.options.length) {
          return jsonResponse({ error: `optionNumber out of range (1-${parsed.options.length})` }, { status: 400 });
        }
        await deliverCodexApprovalChoice(conv.tmuxSession, optionNumber);
        return jsonResponse({ ok: true, optionNumber });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] codex approval failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
// ─── Route: POST /api/conversations/:name/delivery-method ─────────────────────
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
// ─── Route: POST /api/conversations/:name/control-ack ────────────────────────
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
// ─── Route: PATCH /api/conversations/:name ────────────────────────────────────
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
    return yield* Effect.promise(async () => handleConversationDelete(name, { invalidateFavoritesCache }));
  }),
);
// ─── Route: POST /api/conversations/:name/archive ───────────────────────────
const conversationArchiveDependencies = {
  stopConversationRuntime,
  invalidateFavoritesCache,
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
// ─── Route: POST /api/conversations/:name/unarchive ─────────────────────────
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
// ─── Route: POST /api/conversations/restart-all ─────────────────────────────
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
// ─── Route: POST /api/conversations/:name/favorite ───────────────────────────
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
        invalidateFavoritesCache();
        return jsonResponse({ favorited: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] favorite conversation failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
// ─── Route: DELETE /api/conversations/:name/favorite ─────────────────────────
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
        invalidateFavoritesCache();
        return jsonResponse({ favorited: false });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] unfavorite conversation failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
// ─── Route: POST /api/conversations/:name/summary-fork ───────────────────────
/**
 * Title a handoff conversation after the WORK it carries (the focus), not the
 * parent's title. A handoff with no focus falls back to "Handoff: <parent>".
 * The focus is collapsed to one line and trimmed to a sane title length; the
 * AI title-refiner can still sharpen it once the successor starts working.
 */
function handoffTitleFromFocus(focus: string | undefined, fallback: string): string {
  const f = focus?.replace(/\s+/g, ' ').trim();
  if (!f) return `Handoff: ${fallback}`;
  const trimmed = f.length > 70 ? `${f.slice(0, 69).trimEnd()}…` : f;
  return `Handoff: ${trimmed}`;
}
type ForkPipelineRuntimeOverrides = Partial<{
  sessionExists: (sessionName: string) => Promise<boolean>;
  isHarnessProcessAlive: (sessionName: string) => Promise<boolean>;
  spawnConversationSession: typeof spawnConversationSession;
  waitForTmuxSession: typeof waitForTmuxSession;
  getAgentRuntimeStateSync: typeof getAgentRuntimeStateSync;
}>;
let forkPipelineRuntimeOverrides: ForkPipelineRuntimeOverrides = {};
export function __setForkPipelineRuntimeOverridesForTest(overrides: ForkPipelineRuntimeOverrides): void {
  forkPipelineRuntimeOverrides = overrides;
}
export function __resetForkPipelineRuntimeOverridesForTest(): void {
  forkPipelineRuntimeOverrides = {};
}
async function forkSessionExists(sessionName: string): Promise<boolean> {
  return forkPipelineRuntimeOverrides.sessionExists
    ? forkPipelineRuntimeOverrides.sessionExists(sessionName)
    : Effect.runPromise(sessionExists(sessionName));
}
async function forkHarnessProcessAlive(sessionName: string): Promise<boolean> {
  return forkPipelineRuntimeOverrides.isHarnessProcessAlive
    ? forkPipelineRuntimeOverrides.isHarnessProcessAlive(sessionName)
    : isHarnessProcessAlive(sessionName);
}
function forkRuntimeState(sessionName: string): ReturnType<typeof getAgentRuntimeStateSync> {
  return forkPipelineRuntimeOverrides.getAgentRuntimeStateSync
    ? forkPipelineRuntimeOverrides.getAgentRuntimeStateSync(sessionName)
    : getAgentRuntimeStateSync(sessionName);
}
async function forkSpawnConversationSession(...args: Parameters<typeof spawnConversationSession>): Promise<void> {
  return (forkPipelineRuntimeOverrides.spawnConversationSession ?? spawnConversationSession)(...args);
}
async function forkWaitForTmuxSession(...args: Parameters<typeof waitForTmuxSession>): Promise<void> {
  return (forkPipelineRuntimeOverrides.waitForTmuxSession ?? waitForTmuxSession)(...args);
}
/**
 * Watch the hook-driven runtime mirror to confirm a delivered fork brief was
 * actually accepted as a prompt. Once a prompt is submitted the agent leaves
 * idle and goes active (UserPromptSubmit hook → 'working'). Returns:
 *   - 'accepted'  : observed active/waiting — the brief landed and was submitted
 *   - 'still-idle': mirror was live and stayed idle for the whole window — the
 *                   paste was dropped (a fresh Claude TUI flushes stdin during
 *                   startup, discarding a paste delivered a beat too early)
 *   - 'unknown'   : mirror never reported a usable state — can't tell, so the
 *                   caller must NOT retry (avoids double-submitting a brief that
 *                   may have landed). No tmux pane scraping — activity hooks only.
 */
export async function confirmForkPromptAccepted(
  tmuxSession: string,
  timeoutMs: number,
): Promise<'accepted' | 'still-idle' | 'unknown'> {
  const deadline = Date.now() + timeoutMs;
  let sawIdle = false;
  do {
    const state = forkRuntimeState(tmuxSession)?.state;
    if (state === 'active' || state === 'waiting-on-human') return 'accepted';
    if (state === 'idle') sawIdle = true;
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  return sawIdle ? 'still-idle' : 'unknown';
}
/**
 * Deliver a forked conversation's brief (summary or handoff doc) into the
 * freshly-spawned successor session, then CONFIRM it actually landed.
 *
 * PAN-1624: a fresh Claude Code TUI drains/flushes its stdin while
 * initializing, so a payload pasted before the input loop is live is silently
 * discarded — the successor sits at an empty welcome screen and never starts.
 * The `ready.json` session-start signal can fire before the input loop has
 * settled, so a single fire-and-forget paste is unreliable. We deliver, then
 * watch the runtime mirror: if it positively reports the agent is still idle
 * after the window, the paste was dropped — re-deliver once. Re-delivery only
 * happens from a confirmed-still-idle state, so a brief that already landed is
 * never double-submitted; when the mirror can't tell us, we fall back to a
 * single delivery (the pre-PAN-1624 behavior).
 */
export async function readExistingHandoffDoc(conv: Pick<Conversation, 'handoffDocPath'>): Promise<string | null> {
  if (!conv.handoffDocPath || !existsSync(conv.handoffDocPath)) return null;
  return readFile(conv.handoffDocPath, 'utf-8');
}
export async function ensureForkSessionReady(
  conv: Conversation,
  sessionId: string,
  resume: boolean,
  plainFork = false,
): Promise<void> {
  const tmuxAlive = await forkSessionExists(conv.tmuxSession);
  if (tmuxAlive) {
    const harnessAlive = await forkHarnessProcessAlive(conv.tmuxSession);
    if (harnessAlive) {
      console.info(`[fork-pipeline] Reusing existing live tmux session ${conv.tmuxSession} for ${conv.name}`);
      return;
    }
    console.warn(`[fork-pipeline] Existing tmux session ${conv.tmuxSession} for ${conv.name} is a keep-alive corpse — recreating`);
  }
  await forkSpawnConversationSession(
    conv.tmuxSession,
    conv.cwd,
    sessionId,
    conv.model ?? undefined,
    conv.effort ?? undefined,
    conv.issueId ?? undefined,
    resume,
    conv.harness ?? 'claude-code',
    plainFork,
  );
  await forkWaitForTmuxSession(conv.tmuxSession);
}
export async function injectForkSummary(conv: Conversation, summary: string, caller: string): Promise<void> {
  updateForkStatus(conv.name, 'injecting');
  const method = resolveConversationDeliveryMethod(conv);
  const behavior = getHarnessBehavior(conv.harness);
  if (behavior.transcriptKind === 'ohmypi-jsonl') {
    await waitForPiTuiReady(conv.tmuxSession, 60000);
    await deliverAgentMessage(conv.tmuxSession, summary, caller, method);
    return;
  }
  const ready = await waitForReadySignal(conv.tmuxSession, 60);
  if (!ready) {
    console.warn(`[${caller}] ready signal not detected for ${conv.name} within 60s — delivering and confirming anyway`);
  }
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await deliverAgentMessage(conv.tmuxSession, summary, caller, method);
    const outcome = await confirmForkPromptAccepted(conv.tmuxSession, 8000);
    if (outcome === 'accepted') return;
    if (outcome === 'unknown') {
      // Runtime mirror not reporting for this session — we cannot distinguish a
      // dropped paste from a slow hook, so do not retry (would risk a double
      // submit). Behaves like the original single delivery.
      console.warn(`[${caller}] delivery to ${conv.name} could not be confirmed (runtime mirror silent) — not retrying`);
      return;
    }
    // outcome === 'still-idle': the mirror is live and the agent never picked
    // up the brief — the TUI dropped the paste during startup.
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`[${caller}] ${conv.name} still idle 8s after delivery (attempt ${attempt}/${MAX_ATTEMPTS}) — TUI likely dropped the paste during startup, re-delivering`);
    } else {
      console.warn(`[${caller}] could not confirm brief delivery for ${conv.name} after ${MAX_ATTEMPTS} attempts — successor may be sitting at an empty prompt`);
    }
  }
}
export function handleForkPipelineFailure(name: string, err: unknown): void {
  console.error(`[fork-pipeline] Failed for ${name}:`, err);
  const msg = err instanceof Error ? err.message : String(err);
  updateForkStatus(name, 'failed', msg);
  markConversationEnded(name);
}
export async function runForkPipeline(
  convName: string,
  parentConv: Conversation,
  sessionId: string,
  summaryModel?: string,
  forkMode: SummaryForkMode = 'summary',
  localSummaryOnly = false,
  includeThinkingInSummary?: boolean,
  summaryHarness?: RuntimeName,
  handoffFocus?: string,
  handoffAuthor: HandoffAuthor = 'external',
  handoffAuthorModel?: string,
  handoffAuthorHarness?: RuntimeName,
): Promise<void> {
  const conv = getConversationByName(convName);
  if (!conv) throw new Error(`Fork conversation ${convName} not found`);
  const parentSessionFile = await resolveForkSourceSessionFile(parentConv);
  if (!parentSessionFile) throw new Error(`Parent has no session file`);
  if (forkMode === 'plain') {
    if (getHarnessBehavior(conv.harness).transcriptKind !== 'claude-jsonl') {
      // Plain forks copy a Claude-format JSONL session file and spawn with --resume.
      // ohmypi and Codex cannot consume Claude JSONL, so a plain fork would silently start
      // empty while the pipeline reported success. The summary-fork route already
      // rejects launchHarness='ohmypi'/'codex'; this guard is defense in depth.
      throw new Error(`Plain forks cannot launch under the ${conv.harness} harness — it cannot consume Claude session history.`);
    }
    const tmuxAlive = await forkSessionExists(conv.tmuxSession);
    const reusableSession = tmuxAlive && await forkHarnessProcessAlive(conv.tmuxSession);
    if (!reusableSession) {
      // Plain Claude Code fork: copy JSONL from last compact boundary into the new
      // session file, then spawn with --resume so Claude Code loads the history
      // directly. A tmux keep-alive corpse is not reusable; ensureForkSessionReady()
      // will recreate it, so refresh the session file before respawning.
      const forkSessionFile = await resolveSessionFile(conv);
      if (!forkSessionFile) throw new Error(`Fork conversation ${convName} has no session file`);
      await Effect.runPromise(copySessionFromCompactBoundary(parentSessionFile, forkSessionFile));
    }
    updateForkStatus(convName, 'spawning');
    await ensureForkSessionReady(
      conv,
      sessionId,
      true, // resume — load the copied JSONL history
      true, // plainFork — skip channels MCP wiring so it doesn't inflate the
            // resumed context past Claude Code's auto-compact threshold
    );
    // No summary injection needed for plain Claude Code forks.
    markConversationActive(convName);
    updateForkStatus(convName, null);
    return;
  }
  let summary: string;
  let effectiveForkMode = forkMode;
  let handoffDocPath: string | null = null;
  let forkFallbackReason: string | null = null;
  const buildSummary = async (): Promise<string> => {
    if (localSummaryOnly) {
      try {
        return await Effect.runPromise(generateFallbackSummary(parentSessionFile));
      } catch (error) {
        console.warn(
          `[fork-pipeline] Heuristic fallback summary failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return '';
      }
    }
    try {
      const result = await generateSummaryForFork(
        parentSessionFile,
        summaryModel,
        includeThinkingInSummary,
        summaryHarness,
        parentConv.harness ?? undefined,
      );
      return result.summary;
    } catch (error) {
      if (!forkFallbackReason) {
        forkFallbackReason = `LLM summary failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      console.warn(
        `[fork-pipeline] LLM summary failed, falling back to heuristic: ${error instanceof Error ? error.message : String(error)}`,
      );
      try {
        return await Effect.runPromise(generateFallbackSummary(parentSessionFile));
      } catch (heuristicError) {
        console.warn(
          `[fork-pipeline] Heuristic fallback also failed: ${heuristicError instanceof Error ? heuristicError.message : String(heuristicError)}`,
        );
        return '';
      }
    }
  };
  if (forkMode === 'handoff') {
    const existingHandoffDoc = await readExistingHandoffDoc(conv);
    if (existingHandoffDoc !== null) {
      summary = existingHandoffDoc;
      handoffDocPath = conv.handoffDocPath;
    } else if (handoffAuthor === 'external') {
      // External authoring: separate session reads the source JSONL and
      // writes the doc; source conversation is never touched.
      try {
        const handoff = await authorHandoffExternal(
          parentConv,
          parentSessionFile,
          handoffFocus,
          handoffAuthorModel,
          handoffAuthorHarness,
        );
        summary = handoff.docText;
        handoffDocPath = handoff.docPath;
      } catch (error) {
        forkFallbackReason = handoffFailureReason(error);
        effectiveForkMode = 'summary';
        logHandoffFallback(parentConv, forkFallbackReason);
        summary = prependFallbackFocus(await buildSummary(), handoffFocus, forkFallbackReason);
      }
    } else {
      // Source authoring (legacy): deliver the prompt to the live source agent.
      const preconditionFallback = await handoffPreconditionFallbackReason(parentConv);
      if (preconditionFallback) {
        forkFallbackReason = preconditionFallback;
        effectiveForkMode = 'summary';
        logHandoffFallback(parentConv, preconditionFallback);
        summary = prependFallbackFocus(await buildSummary(), handoffFocus, preconditionFallback);
      } else {
        try {
          const handoff = await requestHandoffFromAgent(parentConv, handoffFocus);
          summary = handoff.docText;
          handoffDocPath = handoff.docPath;
        } catch (error) {
          forkFallbackReason = handoffFailureReason(error);
          effectiveForkMode = 'summary';
          logHandoffFallback(parentConv, forkFallbackReason);
          summary = prependFallbackFocus(await buildSummary(), handoffFocus, forkFallbackReason);
        }
      }
    }
  } else {
    summary = await buildSummary();
  }
  updateConversationForkFallbackReason(convName, forkFallbackReason);
  updateConversationTitle(
    convName,
    effectiveForkMode === 'handoff'
      ? handoffTitleFromFocus(handoffFocus, parentConv.title || parentConv.name)
      : `Summary Fork: ${parentConv.title || parentConv.name}`,
    'manual',
  );
  if (handoffDocPath) {
    recordConversationHandoff(parentConv.name, convName, handoffDocPath);
  }
  updateForkStatus(convName, 'spawning');
  await self.ensureForkSessionReady(conv, sessionId, false);
  await self.injectForkSummary(conv, summary, effectiveForkMode === 'handoff' ? 'handoff' : 'summary-fork');
  markConversationActive(convName);
  updateForkStatus(convName, null);
}
function parsePersistedForkRequest(raw: string): ForkRequest | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ForkRequest>;
    if (typeof parsed.parentConversationName !== 'string') return null;
    if (typeof parsed.sessionId !== 'string') return null;
    if (parsed.forkMode !== 'summary' && parsed.forkMode !== 'plain' && parsed.forkMode !== 'handoff') return null;
    if (typeof parsed.localSummaryOnly !== 'boolean') return null;
    if (parsed.handoffAuthor !== 'source' && parsed.handoffAuthor !== 'external') return null;
    return parsed as ForkRequest;
  } catch {
    return null;
  }
}
const inFlightForkPipelines = new Set<Promise<void>>();
export function registerInFlightForkPipeline(pipeline: Promise<void>): Promise<void> {
  const tracked = pipeline.finally(() => {
    inFlightForkPipelines.delete(tracked);
  });
  inFlightForkPipelines.add(tracked);
  return tracked;
}
export function getInFlightForkPipelineCount(): number {
  return inFlightForkPipelines.size;
}
export async function waitForInFlightForkPipelines(timeoutMs = 10_000): Promise<{ completed: boolean; count: number }> {
  const pipelines = [...inFlightForkPipelines];
  const count = pipelines.length;
  if (count === 0) return { completed: true, count: 0 };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.allSettled(pipelines).then(() => ({ completed: true, count })),
      new Promise<{ completed: boolean; count: number }>((resolve) => {
        timeout = setTimeout(() => resolve({ completed: false, count }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
export async function recoverStuckForks(): Promise<number> {
  const forks = getStuckForks();
  let recovered = 0;
  for (const fork of forks) {
    try {
      if (!fork.forkRequest) {
        updateForkStatus(fork.name, 'failed', 'Dashboard restarted during fork before recovery metadata was persisted');
        continue;
      }
      const request = parsePersistedForkRequest(fork.forkRequest);
      if (!request) {
        updateForkStatus(fork.name, 'failed', 'Persisted fork request is invalid');
        continue;
      }
      const tmuxAlive = await forkSessionExists(fork.tmuxSession);
      const harnessAlive = tmuxAlive && await forkHarnessProcessAlive(fork.tmuxSession);
      const runtimeState = harnessAlive ? forkRuntimeState(fork.tmuxSession)?.state : undefined;
      if (harnessAlive && (runtimeState === 'active' || runtimeState === 'waiting-on-human')) {
        markConversationActive(fork.name);
        updateForkStatus(fork.name, null);
        recovered += 1;
        continue;
      }
      if (fork.forkRetryCount >= 2) {
        updateForkStatus(fork.name, 'failed', 'Fork recovery retry limit reached');
        continue;
      }
      incrementForkRetryCount(fork.name);
      const parentConv = getConversationByName(request.parentConversationName);
      if (!parentConv) {
        updateForkStatus(fork.name, 'failed', `Parent conversation ${request.parentConversationName} not found`);
        continue;
      }
      await registerInFlightForkPipeline(runForkPipeline(
        fork.name,
        parentConv,
        request.sessionId,
        request.summaryModel,
        request.forkMode,
        request.localSummaryOnly,
        request.includeThinkingInSummary,
        request.summaryHarness,
        request.handoffFocus,
        request.handoffAuthor,
        request.handoffAuthorModel,
        request.handoffAuthorHarness,
      ));
      recovered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[fork-recovery] Failed to recover ${fork.name}:`, error);
      updateForkStatus(fork.name, 'failed', message);
    }
  }
  return recovered;
}
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
    return yield* Effect.promise(async () => {
      try {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }
        const sourceAdapter = getTranscriptAdapter(conv.harness ?? undefined);
        const sourceSessionFile = await sourceAdapter.resolveSessionFile(conv);
        if (!sourceSessionFile || !existsSync(sourceSessionFile)) {
          return jsonResponse({ error: `No session file found for conversation ${conv.name}` }, { status: 400 });
        }
        const model = typeof body['model'] === 'string'
          ? body['model'].trim()
          : undefined;
        const summaryModel = typeof body['summaryModel'] === 'string'
          ? body['summaryModel'].trim()
          : undefined;
        const cwd = typeof body['cwd'] === 'string' && body['cwd'].trim()
          ? body['cwd'].trim()
          : undefined;
        const requestedForkMode = body['forkMode'];
        let forkMode: SummaryForkMode = 'summary';
        if (requestedForkMode !== undefined) {
          if (requestedForkMode !== 'summary' && requestedForkMode !== 'plain' && requestedForkMode !== 'handoff') {
            return jsonResponse({ error: 'Invalid forkMode' }, { status: 400 });
          }
          forkMode = requestedForkMode;
        } else if (body['plain'] === true) {
          console.debug('[summary-fork] legacy plain=true mapped to forkMode=plain');
          forkMode = 'plain';
        }
        const focusResult = parseSummaryForkFocus(body['focus']);
        if (!focusResult.ok) {
          return jsonResponse({ error: focusResult.error }, { status: 400 });
        }
        const handoffFocus = focusResult.focus;
        const requestedHandoffAuthor = body['handoffAuthor'];
        let handoffAuthor: HandoffAuthor = 'external';
        if (requestedHandoffAuthor !== undefined) {
          if (requestedHandoffAuthor !== 'source' && requestedHandoffAuthor !== 'external') {
            return jsonResponse({ error: 'Invalid handoffAuthor (expected "source" or "external")' }, { status: 400 });
          }
          handoffAuthor = requestedHandoffAuthor;
        }
        const handoffAuthorModel = typeof body['handoffAuthorModel'] === 'string'
          ? body['handoffAuthorModel'].trim()
          : undefined;
        if (handoffAuthorModel && !SAFE_MODEL_PATTERN.test(handoffAuthorModel)) {
          return jsonResponse({ error: 'Invalid handoffAuthorModel' }, { status: 400 });
        }
        // Capability gates — the source harness must support the requested
        // fork mode. Plain forks copy raw Claude JSONL and spawn with
        // --resume, so only Claude Code sources work. Source-authored handoff
        // requires the source agent to write a sentinel file in response to a
        // delivered prompt; harnesses without that signaling path (e.g. Pi,
        // see PAN-1134) cannot author handoff docs in-session. Other modes
        // (summary, external-authored handoff) work for any harness whose
        // transcript adapter knows how to read the session file.
        if (forkMode === 'plain' && !sourceAdapter.supportsPlainForkAsSource) {
          return jsonResponse({
            error: `Plain forks are not supported for ${sourceAdapter.name} sources — only Claude Code can be the source of a plain fork. Use a summary or handoff fork instead.`,
          }, { status: 400 });
        }
        if (forkMode === 'handoff' && handoffAuthor === 'source' && !sourceAdapter.supportsSourceAuthoredHandoff) {
          return jsonResponse({
            error: `Source-authored handoffs are not supported for ${sourceAdapter.name} sources because the harness has no signaling channel for the .done sentinel. Use external authoring (handoffAuthor: "external") instead.`,
          }, { status: 400 });
        }
        const localSummaryOnly = body['localSummaryOnly'] === true;
        const includeThinkingInSummary = body['includeThinkingInSummary'] === true;
        const customTitle = typeof body['title'] === 'string' ? body['title'].trim() : undefined;
        if (cwd && !(await validateCwdContainment(cwd))) {
          return jsonResponse({ error: 'Invalid cwd' }, { status: 400 });
        }
        if (typeof body['model'] === 'string' && !model) {
          return jsonResponse({ error: 'model must not be blank' }, { status: 400 });
        }
        if (model && !SAFE_MODEL_PATTERN.test(model)) {
          return jsonResponse({ error: 'Invalid model' }, { status: 400 });
        }
        if (typeof body['summaryModel'] === 'string' && summaryModel && !SAFE_MODEL_PATTERN.test(summaryModel)) {
          return jsonResponse({ error: 'Invalid summaryModel' }, { status: 400 });
        }
        const effectiveCwd = cwd || conv.cwd || process.cwd();
        // PAN-1624: a handoff whose cwd is not a git work tree spawns a session
        // that immediately dies (no tmux, no launcher dir). Fail loudly here.
        if (forkMode === 'handoff' && !(await isInsideGitWorkTree(effectiveCwd))) {
          return jsonResponse({
            error: `Handoff cwd is not inside a git repository: ${effectiveCwd}. Run the handoff from a git working tree.`,
          }, { status: 400 });
        }
        const { sessionId, sessionFile } = await Effect.runPromise(reserveSummaryForkSession(
          effectiveCwd,
        ));
        const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const suffix = randomUUID().slice(0, 4);
        const newName = `${timestamp}-${suffix}`;
        const newTmux = `conv-${newName}`;
        const launchModel = model || conv.model;
        const effectiveSummaryModel = summaryModel || 'claude-sonnet-5';
        const launchHarness = await resolveAllowedHarness(body['harness'], launchModel);
        const summaryHarness = await resolveAllowedHarness(body['summaryHarness'], effectiveSummaryModel);
        const handoffAuthorHarness = body['handoffAuthorHarness'] !== undefined
          ? await resolveAllowedHarness(body['handoffAuthorHarness'], handoffAuthorModel || effectiveSummaryModel)
          : undefined;
        if (forkMode === 'plain' && getHarnessBehavior(launchHarness).transcriptKind !== 'claude-jsonl') {
          // Plain forks copy a Claude-format JSONL session file and spawn with --resume.
          // ohmypi and Codex cannot consume Claude JSONL history, so a plain fork would silently
          // start an empty session. Summary forks are fine.
          return jsonResponse({
            error: `Plain forks cannot launch under ${launchHarness} — it cannot consume Claude session history. Use a summary fork instead.`,
          }, { status: 400 });
        }
        const defaultTitle = forkMode === 'plain'
          ? `Fork: ${conv.title || conv.name}`
          : forkMode === 'handoff'
            ? handoffTitleFromFocus(handoffFocus, conv.title || conv.name)
            : `Summary Fork: ${conv.title || conv.name}`;
        const newConv = createConversation({
          name: newName,
          tmuxSession: newTmux,
          cwd: cwd || conv.cwd || process.cwd(),
          issueId: conv.issueId ?? undefined,
          title: customTitle || defaultTitle,
          titleSource: 'manual',
          titleSeed: forkMode === 'plain'
            ? `Fork of ${conv.name}`
            : forkMode === 'handoff'
              ? `Handoff of ${conv.name}`
              : `Summary Fork of ${conv.name}`,
          claudeSessionId: sessionId,
          model: launchModel ?? undefined,
          effort: conv.effort ?? undefined,
          harness: launchHarness,
          forkStatus: forkMode === 'plain' ? 'spawning' : forkMode === 'handoff' ? 'handoff' : 'summarizing',
        });
        const forkRequest = buildForkRequest({
          parentConversationName: conv.name,
          sessionId,
          forkMode,
          ...(summaryModel !== undefined ? { summaryModel } : {}),
          localSummaryOnly,
          includeThinkingInSummary,
          ...(summaryHarness !== undefined ? { summaryHarness } : {}),
          ...(handoffFocus !== undefined ? { handoffFocus } : {}),
          handoffAuthor,
          ...(handoffAuthorModel !== undefined ? { handoffAuthorModel } : {}),
          ...(handoffAuthorHarness !== undefined ? { handoffAuthorHarness } : {}),
        });
        setForkRequest(newConv.name, JSON.stringify(forkRequest));
        markConversationActive(newConv.name);
        registerInFlightForkPipeline(
          runForkPipeline(newConv.name, conv, sessionId, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, summaryHarness, handoffFocus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness),
        ).catch((err) => {
          handleForkPipelineFailure(newConv.name, err);
        });
        return jsonResponse({
          success: true,
          conversation: newConv,
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] create summary fork failed:', msg);
        return jsonResponse({ error: error instanceof UnknownModelError ? msg : 'Internal server error' }, { status: error instanceof UnknownModelError ? 400 : 500 });
      }
    });
  }),
);
// ─── Route: POST /api/conversations/:name/plan-action ────────────────────────
const PLAN_ACTION_KEYSTROKES: Record<string, string> = {
  'approve-auto': '1',
  'approve-manual': '2',
  'reject-ultraplan': '3',
};
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
    return yield* Effect.promise(async () => {
      try {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }
        const action = typeof body['action'] === 'string' ? body['action'] : '';
        const feedback = typeof body['feedback'] === 'string' ? body['feedback'].trim() : '';
        if (action === 'reject-feedback') {
          await Effect.runPromise(sendRawKeystroke(conv.tmuxSession, '4', 'plan-action-reject'));
          if (feedback) {
            await new Promise(r => setTimeout(r, 300));
            await deliverAgentMessage(conv.tmuxSession, feedback, 'plan-action-feedback', resolveConversationDeliveryMethod(conv));
          }
          return jsonResponse({ ok: true });
        }
        const keystroke = PLAN_ACTION_KEYSTROKES[action];
        if (!keystroke) {
          return jsonResponse({ error: `Invalid action: ${action}` }, { status: 400 });
        }
        await Effect.runPromise(sendRawKeystroke(conv.tmuxSession, keystroke, `plan-action-${action}`));
        return jsonResponse({ ok: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] plan action failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);
// ─── Route: GET /api/conversations/:name/diffs ──────────────────────────────
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
// ─── Route: GET /api/conversations/:name/diffs/full ─────────────────────────
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
// ─── Route: GET /api/conversations/:name/diffs/:turnId ──────────────────────
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
// ─── Route: POST /api/conversations/:name/retitle ────────────────────────────
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
// ─── Route: GET /api/conversations/:name/about ───────────────────────────────
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
// ─── Compose all routes into a single Layer ───────────────────────────────────
export const conversationsRouteLayer = Layer.mergeAll(
  getConversationsRoute,
  getConversationsPendingInputRoute,
  getArchivedConversationsRoute,
  getConversationRoute,
  getConversationHandoffDocRoute,
  postConversationRoute,
  patchConversationRoute,
  deleteConversationRoute,
  postConversationStopRoute,
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
