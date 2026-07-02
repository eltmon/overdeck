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
import { existsSync, createReadStream, readFileSync } from 'node:fs';
import { mkdir, writeFile, readFile, stat, realpath, rename, rm, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

import { readLauncherPinnedSessionId, resolveAgentHarness, resolveClaudeSessionId, resolveCodexRolloutPath, resolvePiSessionPath } from './jsonl-resolver.js';
import { validateOrigin, validateOriginHeaders, getHeaderFromMap, type HeaderMap } from './origin-validation.js';
import { parseRelativeTime } from '../../../lib/conversations/search.js';
import { getProjectSync } from '../../../lib/projects.js';
import * as self from './conversations.js';
import { getDefaultCwd } from '../../../lib/default-cwd.js';
import { modelSupportsImagesSync } from '../../../lib/model-capabilities.js';
import {
  findCommitAtTime,
  diffSinceCommit,
  diffFilesAgainstHead,
  diffPatchSinceCommit,
  diffPatchFilesAgainstHead,
  type TurnDiffFileChange,
} from '../../../lib/checkpoint/checkpoint-manager.js';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import * as Multipart from 'effect/unstable/http/Multipart';

import {
  listConversations,
  getConversationLedgerCosts,
  listArchivedConversationsWithEnrichment,
  getStuckForks,
  incrementForkRetryCount,
  getConversationByName,
  getConversationByClaudeSessionId,
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
  updateConversationDeliveryMethod,
  updateConversationForkFallbackReason,
  setForkRequest,
  recordConversationHandoff,
  backfillConversationModel,
  archiveConversation,
  unarchiveConversation,
  canReplaceTitle,
  listFavoritedIds,
  setFavorite,
  removeFavorite,
  updateForkStatus,
  updateSpawnError,
  hasOtherActiveConversationOnTmuxSession,
  type ArchivedConversationListOptions,
  type ArchivedConversationWithEnrichment,
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
import { deliverAgentMessage, writeChannelsBridgeMcpConfig, dismissDevChannelsDialog, injectPiConversationMemory, waitForReadySignal, clearReadySignal } from '../../../lib/agents.js';
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

/** The configured conversation-title model (PAN-1589) — falls back to the
 * module default when config is unavailable. */
function configuredTitleModel(): string {
  try {
    return loadConfigSync().config.conversations.titleModel || CONVERSATION_TITLE_MODEL;
  } catch {
    return CONVERSATION_TITLE_MODEL;
  }
}
import { isBackgroundFeatureEnabled } from '../../../lib/background-ai/features.js';
import { writePtyToken } from '../../../lib/pty-token.js';
import { canUseHarnessSync } from '../../../lib/harness-policy.js';
import { resolveHarness } from '../../../lib/harness-resolve.js';
import { getProviderForModelSync, piProviderForModel } from '../../../lib/providers.js';
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
  computeContextUsage,
  parseConversationMessages,
  parseFromLastCompactBoundary,
  summarizeConversationActivity,
  type ParseState,
} from '../services/conversation-service.js';
import { resolveConversationGitInfo } from '../services/git-info.js';
import { resolveConversationMessageLocator } from '../services/conversation-message-resolver.js';
import { watchForEatenConversationMessage } from '../services/conversation-eaten-message-watcher.js';
import { captureTranscriptUserRecordSnapshot } from '../../../lib/transcript-landing.js';
import { isPiSessionFile, parsePiConversationMessages } from '../services/pi-conversation-parser.js';
import { isOhmypiSessionFile, parseOhmypiConversationMessages } from '../services/ohmypi-conversation-parser.js';
import { parseCodexConversationMessages } from '../services/codex-conversation-parser.js';
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
  CONVERSATION_TITLE_MODEL,
  fallbackTranscriptTitle,
  serializeConversationTranscript,
  summarizeFirstMessageTitle,
  summarizeTranscriptTitle,
  summarizeTranscriptAbout,
} from '../../../lib/conversations/transcript-summary.js';
import {
  ensureConversationAttachmentDir,
  getConversationAttachmentsRoot,
  extractConversationAttachmentPaths,
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
const MAX_FILENAME_LENGTH = 255;
const PTY_SUPERVISOR_SOCKET_WAIT_MS = 30_000;
const CONVERSATION_LIST_ENRICHMENT_CONCURRENCY = 8;
const PROCESS_CLEANUP_GRACE_MS = 750;

type ProcessTableRow = {
  pid: number;
  ppid: number;
  args: string;
};

function parseProcessTable(output: string): ProcessTableRow[] {
  return output
    .split('\n')
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        args: match[3] ?? '',
      };
    })
    .filter((row): row is ProcessTableRow => row !== null && Number.isFinite(row.pid) && Number.isFinite(row.ppid));
}

async function readProcessTable(): Promise<ProcessTableRow[]> {
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,ppid=,args='], {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return parseProcessTable(stdout);
}

function collectProcessTree(rootPids: number[], rows: ProcessTableRow[]): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const row of rows) {
    const children = childrenByParent.get(row.ppid) ?? [];
    children.push(row.pid);
    childrenByParent.set(row.ppid, children);
  }

  const seen = new Set<number>();
  const ordered: number[] = [];
  const visit = (pid: number) => {
    if (seen.has(pid) || pid === process.pid) return;
    seen.add(pid);
    for (const child of childrenByParent.get(pid) ?? []) visit(child);
    ordered.push(pid);
  };

  for (const pid of rootPids) visit(pid);
  return ordered;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminatePids(pids: number[]): Promise<void> {
  if (pids.length === 0) return;

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }

  await new Promise((resolve) => setTimeout(resolve, PROCESS_CLEANUP_GRACE_MS));

  for (const pid of pids) {
    if (!isProcessAlive(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone or permission denied; callers log the cleanup attempt.
    }
  }
}

export function conversationRuntimeRootPids(conv: Conversation, rows: ProcessTableRow[]): number[] {
  const launcherScript = join(getOverdeckHome(), 'conversations', conv.tmuxSession, 'launcher.sh');
  const sessionId = conv.claudeSessionId?.trim();
  const sessionNeedles = sessionId ? [`--resume ${sessionId}`, `--session-id ${sessionId}`] : [];
  // PAN-1798: never let conversation cmdline matching catch the shared tmux
  // server. If the server was founded implicitly by a conversation, its
  // cmdline embeds that conversation's session name and a pkill/pgrep-style
  // match would destroy every session on the socket. Exclude the live server
  // PID explicitly; teardown already starts with tmux kill-session on the
  // target session, so this cleanup only mops up orphan runtime processes.
  const serverPid = findManagedServerPidSync();

  return rows
    .filter((row) => {
      if (row.pid === process.pid) return false;
      if (serverPid !== undefined && row.pid === serverPid) return false;
      if (row.args.includes(launcherScript)) return true;
      return sessionNeedles.some((needle) => row.args.includes(needle));
    })
    .map((row) => row.pid);
}

async function killConversationRuntimeProcesses(conv: Conversation): Promise<void> {
  const rows = await readProcessTable();
  const rootPids = conversationRuntimeRootPids(conv, rows);
  const pids = collectProcessTree(rootPids, rows);
  await terminatePids(pids);
}

async function stopConversationRuntime(conv: Conversation, name: string): Promise<void> {
  // PAN-1458: post-/clear sibling rows share one tmux pane. If another active
  // conversation still owns that pane, only end this DB row.
  if (hasOtherActiveConversationOnTmuxSession(conv.tmuxSession, name)) {
    return;
  }

  await Effect.runPromise(killSession(conv.tmuxSession).pipe(Effect.catch(() => Effect.succeed(undefined))));

  try {
    await killConversationRuntimeProcesses(conv);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[conversations] failed to cleanup runtime processes for ${name}: ${msg}`);
  }
}

/** Quote a string for safe use in a bash script using single-quote wrapping. */
function shellQuote(str: string): string {
  return "'" + str.replace(/'/g, "'\"'\"'") + "'";
}

const SAFE_MODEL_PATTERN = /^[a-zA-Z0-9_.:\/-]+$/;
const SAFE_EFFORT_PATTERN = /^(low|medium|high)$/;
const PI_CONVERSATION_SOURCE_CONTRACT = [
  'Pi conversation source contract:',
  "A message marked source:'extension' was injected by the Overdeck orchestrator or another agent, not typed by the human operator.",
  'Treat it as coordination guidance; do not attribute it to the human operator.',
].join(' ');

const SAFE_PROJECT_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SAFE_ISSUE_ID_PATTERN = /^[A-Z0-9]+-[0-9]+$/;

export async function resolveAllowedHarness(requested: unknown, model?: string | null): Promise<RuntimeName> {
  // Conversation runtime only honors non-default harnesses when a concrete model is
  // passed through to getAgentRuntimeBaseCommand(). Without a model,
  // spawnConversationSession() intentionally launches the default Claude Code
  // command, so persist the matching default harness as the effective value.
  if (!model) return 'claude-code';
  const explicit: RuntimeName | undefined =
    requested === 'ohmypi' || requested === 'claude-code' || requested === 'codex' ? requested : undefined;
  try {
    return await resolveHarness({ model, explicit });
  } catch {
    return 'claude-code';
  }
}

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

// ─── Messages cache ───────────────────────────────────────────────────────────

const MESSAGES_CACHE_MAX = 100;
const messagesCache = new Map<
  string,
  {
    mtimeMs: number;
    size: number;
    result: Awaited<ReturnType<typeof parseConversationMessages>>;
    byteOffset: number;
    parseState: ParseState | undefined;
  }
>();

async function getCachedMessages(
  sessionFile: string,
  isSpecialist: boolean,
): Promise<Awaited<ReturnType<typeof parseConversationMessages>>> {
  const fileStats = await stat(sessionFile);
  const cacheKey = `${sessionFile}:${isSpecialist}`;
  const cached = messagesCache.get(cacheKey);
  if (cached && cached.mtimeMs === fileStats.mtimeMs && cached.size === fileStats.size && cached.byteOffset >= fileStats.size) {
    return cached.result;
  }

  let result: Awaited<ReturnType<typeof parseConversationMessages>>;

  // Pi sessions use a different JSONL schema than Claude Code. The Pi parser
  // produces the same ParseResult shape and we cache by file path, so the
  // rest of the pipeline (cost rollup, streaming flag, etc.) is unchanged.
  // Pi files don't support the incremental-parse path — we always do a full
  // read; chat sessions are small enough that this is fine.
  if (isCodexSessionFile(sessionFile)) {
    // Codex rollout JSONL (OpenAI schema). Checked before isPiSessionFile
    // because a Codex path (.../agents/<id>/codex-home/sessions/...) also
    // matches the Pi detector's substrings.
    result = await parseCodexConversationMessages(sessionFile);
  } else if (isOhmypiSessionFile(sessionFile)) {
    result = await parseOhmypiConversationMessages(sessionFile);
  } else if (isPiSessionFile(sessionFile)) {
    result = await parsePiConversationMessages(sessionFile);
  } else if (isSpecialist) {
    result = await parseFromLastCompactBoundary(sessionFile);
  } else if (
    cached &&
    cached.parseState &&
    cached.byteOffset <= fileStats.size &&
    cached.size <= fileStats.size
  ) {
    // Incremental parse: file grew, continue from where we left off.
    const incremental = await parseConversationMessages(sessionFile, cached.byteOffset, cached.parseState);
    if (incremental.byteOffset < cached.byteOffset) {
      // File was truncated or rotated — fall back to full parse.
      result = await parseConversationMessages(sessionFile, 0);
    } else {
      // Materialize the merged result once and cache concrete structures.
      // Lazy getters chained across cache entries grew an unbounded wrapper
      // chain across polls and re-allocated the full history on every read.
      const cachedResult = cached.result;
      const mergedMessages = cachedResult.messages.concat(incremental.messages);
      const mergedWorkLog = cachedResult.workLog.concat(incremental.workLog);
      const mergedCompactBoundaries = (cachedResult.compactBoundaries ?? []).concat(incremental.compactBoundaries ?? []);
      const mergedFileEdits = new Map(cachedResult.fileEditsByAssistantId ?? []);
      for (const [k, v] of incremental.fileEditsByAssistantId ?? []) {
        const existing = mergedFileEdits.get(k);
        mergedFileEdits.set(k, existing ? [...existing, ...v] : v);
      }
      result = {
        messages: mergedMessages,
        workLog: mergedWorkLog,
        byteOffset: incremental.byteOffset,
        streaming: incremental.streaming,
        totalCost: cachedResult.totalCost + incremental.totalCost,
        totalTokens: cachedResult.totalTokens + incremental.totalTokens,
        pendingToolUse: incremental.pendingToolUse,
        unresolvedResults: incremental.unresolvedResults,
        lastSequence: incremental.lastSequence,
        mtimeMs: incremental.mtimeMs,
        proposedPlan: incremental.proposedPlan ?? cachedResult.proposedPlan,
        compactBoundaries: mergedCompactBoundaries,
        planToolUseIds: incremental.planToolUseIds,
        permissionMode: incremental.permissionMode ?? cachedResult.permissionMode,
        fileEditsByAssistantId: mergedFileEdits,
        // The incremental set was seeded from the cached parseState, so it already
        // carries every previously-counted id plus any seen in this chunk.
        countedUsageIds: incremental.countedUsageIds,
      };
    }
  } else {
    // Full parse (no cache, file shrank, or first time).
    result = await parseConversationMessages(sessionFile, 0);
  }

  messagesCache.set(cacheKey, {
    mtimeMs: fileStats.mtimeMs,
    size: fileStats.size,
    result,
    byteOffset: result.byteOffset,
    parseState: {
      pendingToolUse: result.pendingToolUse,
      unresolvedResults: result.unresolvedResults,
      lastSequence: result.lastSequence,
      planToolUseIds: result.planToolUseIds,
      proposedPlan: result.proposedPlan,
      permissionMode: result.permissionMode,
      countedUsageIds: result.countedUsageIds,
    },
  });
  if (messagesCache.size > MESSAGES_CACHE_MAX) {
    const firstKey = messagesCache.keys().next().value;
    if (firstKey !== undefined) {
      messagesCache.delete(firstKey);
    }
  }
  return result;
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
 * PAN-1624: a handoff spawned with a cwd that is not inside a git work tree
 * (e.g. the repo's parent directory) produces a session that immediately ends
 * with no tmux session at all — a silent dead conversation. Validate up front
 * so the caller gets a clear error instead of a vanished session.
 */
export async function isInsideGitWorkTree(dir: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync('git rev-parse --is-inside-work-tree', { cwd: dir, encoding: 'utf-8' });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

const ALLOWED_UPLOAD_MIME_TYPES = new Map<string, string>([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
]);

/** Validate image magic bytes match the declared MIME type. */
function validateImageMagicBytes(bytes: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/png':
      return bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
    case 'image/gif':
      return bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
    case 'image/webp':
      return (
        bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
      );
    default:
      return false;
  }
}

/**
 * Wait for Claude Code to show its input prompt (❯) in the tmux pane.
 * Polls every 500ms for up to 30 seconds. Claude Code takes a few seconds to start.
 */
async function waitForClaudeReady(tmuxSession: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const output = await Effect.runPromise(capturePane(tmuxSession, 200));
    if (output.includes('❯')) {
      console.log(`[conversations] Claude Code ready in ${tmuxSession}`);
      return;
    }
    await new Promise<void>((r) => setTimeout(r, 500));
  }
  console.warn(`[conversations] Timed out waiting for Claude Code prompt in ${tmuxSession}`);
}

function isPiTuiInputReady(snapshot: string): boolean {
  return /^\s*[❯›>]\s/m.test(snapshot)
    || /(?:^|\s)0(?:\.\d+)?%\s+context\s+used\b/i.test(snapshot);
}

/**
 * Wait until Pi's TUI is accepting input in the tmux pane.
 *
 * Pi TUI mode does not write a ready.json marker (that was an RPC-mode
 * artifact). Splash/header output can appear before the prompt is wired; wait
 * for the actual prompt/context footer so first-turn handoff delivery is not
 * pasted into a not-yet-ready TUI.
 */
// piProviderForModel moved to src/lib/providers.ts so the work-agent launcher
// (launcher-generator.ts buildPiCommand) and conversations share one source of
// truth for the Pi provider taxonomy (PAN-1799 follow-up).

export async function waitForPiTuiReady(tmuxSession: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await Effect.runPromise(
      capturePane(tmuxSession, 40).pipe(Effect.catch(() => Effect.succeed(''))),
    );
    if (isPiTuiInputReady(snapshot)) {
      console.log(`[conversations] Pi TUI ready for ${tmuxSession}`);
      return true;
    }
    await new Promise<void>((r) => setTimeout(r, 250));
  }
  console.warn(`[conversations] Timed out waiting for Pi TUI to render in ${tmuxSession}`);
  return false;
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

async function resolveSessionFile(conv: Conversation): Promise<string | null> {
  // Pi writes its own JSONL transcript under the per-agent dir using a per-run
  // timestamped filename (not into ~/.claude/projects/<dir>/<id>.jsonl). Pi
  // *conversations* write into the agent's `sessions/` subdir, but Pi *work and
  // review* agents write into the agent-dir ROOT (PAN-1908) — so we must check
  // both. resolvePiSessionPath is the canonical resolver shared with the non-DB
  // specialist fallback below; it checks both locations and skips the
  // cost-events.jsonl / activity.jsonl sidecars.
  if (getHarnessBehavior(conv.harness).transcriptKind === 'ohmypi-jsonl') {
    const piPath = await resolvePiSessionPath(conv.tmuxSession);
    // If the ohmypi path resolves, use it. If not, fall through to the claude-code
    // path — the harness field may be stale (agent was re-run under claude-code
    // after the conversation record was created with harness='ohmypi').
    if (piPath) return piPath;
  }
  // Codex conversations write rollout JSONL under per-agent CODEX_HOME/sessions/.
  // The thread-id stored in codex-thread-id is the session identifier.
  if (getHarnessBehavior(conv.harness).transcriptKind === 'codex-rollout-jsonl') {
    const codexPath = await resolveCodexRolloutPath(conv.tmuxSession);
    if (codexPath) return codexPath;
    // Fall through if codex path not found — same stale-harness recovery.
  }
  // claude-code: the launcher pins `--session-id <id>` (or `--resume <id>`) — the
  // EXACT session the live tmux pane runs. Resolving from that pinned id makes the
  // Conversation tab match the Terminal tab by construction. We deliberately do
  // NOT guess via a JSONL-mtime "freshest" heuristic: a conversation accumulates
  // many session ids in its agent dir's sessions.json (transient relaunches,
  // sub-sessions), and a compaction summary write-back to an OLD session's file
  // bumps its mtime ahead of the live one — so the heuristic renders the wrong
  // transcript while the terminal shows the right one (the reported mismatch bug).
  // conv.claudeSessionId (the conversation_files-recorded canonical id, resolved at
  // the read door) is the secondary for ended conversations whose launcher has been
  // cleaned up — NOT a fall back to the old mtime heuristic.
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
    return found ?? deterministic;
  }
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
export function shouldReportUnresolvedLiveSession(
  conv: Pick<Conversation, 'status' | 'harness'> | null | undefined,
): boolean {
  if (!conv || conv.status !== 'active') return false;
  return getHarnessBehavior(conv.harness).transcriptKind === 'claude-jsonl';
}

/**
 * Detect whether a session file path is a Codex rollout JSONL. Codex writes
 * under $CODEX_HOME/sessions/.../rollout-*.jsonl; in Overdeck the per-agent
 * CODEX_HOME lives at .../agents/<id>/codex-home, so the path also satisfies
 * {@link isPiSessionFile} — codex must therefore be tested first.
 */
function isCodexSessionFile(sessionFile: string): boolean {
  return sessionFile.includes('/codex-home/sessions/') || /\/rollout-[^/]+\.jsonl$/.test(sessionFile);
}

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

export const CONTROL_ACK_TIMEOUT_MS = 10_000;

export interface ConversationControlAck {
  id: string
  ok: boolean
  error?: string
}

interface PendingConversationControlAck {
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pendingConversationControlAcks = new Map<string, PendingConversationControlAck>();

export function registerConversationControlAck(
  commandId: string,
  timeoutMs: number = CONTROL_ACK_TIMEOUT_MS,
): Promise<void> {
  const existing = pendingConversationControlAcks.get(commandId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.reject(new Error(`Replaced pending conversation control ack ${commandId}`));
    pendingConversationControlAcks.delete(commandId);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingConversationControlAcks.delete(commandId);
      reject(new Error(`Timed out waiting for conversation control ack ${commandId}`));
    }, timeoutMs);
    pendingConversationControlAcks.set(commandId, {
      resolve: () => {
        clearTimeout(timer);
        pendingConversationControlAcks.delete(commandId);
        resolve();
      },
      reject: (error: Error) => {
        clearTimeout(timer);
        pendingConversationControlAcks.delete(commandId);
        reject(error);
      },
      timer,
    });
  });
}

export function resolveConversationControlAck(ack: ConversationControlAck): 'resolved' | 'rejected' | 'unknown' {
  const pending = pendingConversationControlAcks.get(ack.id);
  if (!pending) return 'unknown';
  if (ack.ok) {
    pending.resolve();
    return 'resolved';
  }
  pending.reject(new Error(ack.error || `Conversation control command ${ack.id} failed`));
  return 'rejected';
}

export function getPendingConversationControlAckCount(): number {
  return pendingConversationControlAcks.size;
}

export function clearPendingConversationControlAcksForTests(): void {
  for (const pending of pendingConversationControlAcks.values()) {
    clearTimeout(pending.timer);
  }
  pendingConversationControlAcks.clear();
}

export function handleConversationControlAck(
  body: Record<string, unknown>,
): { status: number; body: { ok: true; outcome: 'resolved' | 'rejected' | 'unknown' } | { error: string } } {
  const id = typeof body['id'] === 'string' ? body['id'].trim() : '';
  if (!id) return { status: 400, body: { error: 'id is required' } };
  const ok = body['ok'] === true;
  const error = typeof body['error'] === 'string' ? body['error'] : undefined;
  const outcome = resolveConversationControlAck({ id, ok, ...(error !== undefined ? { error } : {}) });
  return { status: 200, body: { ok: true, outcome } };
}

export function validateConversationControlAckOrigin(
  headers: HeaderMap,
  method = 'POST',
): { ok: true } | { ok: false; error: string } {
  const origin = getHeaderFromMap(headers, 'origin');
  const referer = getHeaderFromMap(headers, 'referer');
  if (!origin && !referer) return { ok: true };
  return validateOriginHeaders(headers, method);
}

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

function safeUploadExtension(filename: string, mimeType: string): string {
  const mimeExtension = ALLOWED_UPLOAD_MIME_TYPES.get(mimeType);
  if (!mimeExtension) return '';
  const originalExtension = extname(filename).toLowerCase();
  return originalExtension === mimeExtension ? originalExtension : mimeExtension;
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

export async function handleConversationImageUpload(
  name: string,
  filename: string,
  bytes: Buffer,
  mimeType: string,
): Promise<ReturnType<typeof jsonResponse>> {
  const conv = getConversationByName(name);
  if (!conv) {
    return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
  }

  if (!filename || !mimeType) {
    return jsonResponse({ error: 'filename and mimeType are required' }, { status: 400 });
  }

  if (filename.length > MAX_FILENAME_LENGTH) {
    return jsonResponse(
      { error: `filename exceeds maximum length of ${MAX_FILENAME_LENGTH} characters` },
      { status: 400 },
    );
  }

  if (!ALLOWED_UPLOAD_MIME_TYPES.has(mimeType)) {
    return jsonResponse({ error: `Unsupported mimeType: ${mimeType}` }, { status: 400 });
  }

  if (bytes.length === 0) {
    return jsonResponse({ error: 'Payload is empty' }, { status: 400 });
  }

  if (bytes.length > MAX_UPLOAD_BYTES) {
    return jsonResponse(
      { error: `Payload exceeds maximum size of ${MAX_UPLOAD_BYTES} bytes` },
      { status: 400 },
    );
  }

  if (!validateImageMagicBytes(bytes, mimeType)) {
    return jsonResponse({ error: 'File content does not match declared MIME type' }, { status: 400 });
  }

  const extension = safeUploadExtension(filename, mimeType)!;

  // Re-verify conversation exists before writing — it may have been deleted or
  // archived during the async validation above.
  const convBeforeWrite = getConversationByName(name);
  if (!convBeforeWrite) {
    return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
  }

  const attachmentDir = await ensureConversationAttachmentDir(name);
  // Pre-write containment: resolve the directory before writing to detect
  // any symlink tampering that would redirect writes outside the intended
  // root. This eliminates the TOCTOU window between write and check.
  let resolvedDir: string;
  let attachmentsRoot: string;
  try {
    resolvedDir = await realpath(attachmentDir);
    attachmentsRoot = await realpath(getConversationAttachmentsRoot());
  } catch (err) {
    console.error('[conversations] Failed to resolve attachment path:', err);
    return jsonResponse({ error: 'Attachment directory is misconfigured' }, { status: 500 });
  }
  if (!resolvedDir.startsWith(`${attachmentsRoot}/`)) {
    return jsonResponse({ error: 'Invalid attachment path' }, { status: 500 });
  }

  const fileName = `${randomUUID()}${extension}`;
  const path = join(resolvedDir, fileName);
  const tmpPath = `${path}.tmp`;
  try {
    await writeFile(tmpPath, bytes);
    await rename(tmpPath, path);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }

  return jsonResponse({ path });
}

export async function handleConversationMessage(
  name: string,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof jsonResponse>> {
  const conv = getConversationByName(name);
  if (!conv) {
    return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
  }

  if (conv.status === 'ended') {
    return jsonResponse({ error: 'Session has ended — start a new run to interact' }, { status: 422 });
  }

  const message = typeof body['message'] === 'string' ? body['message'].trim() : '';
  if (!message) {
    return jsonResponse({ error: 'Message is required' }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return jsonResponse(
      { error: `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters` },
      { status: 400 },
    );
  }

  // Overdeck-native compaction writes Claude-format JSONL records. It must
  // only run on Claude Code conversations — running it on a Pi conversation
  // would corrupt the Pi transcript (P0, 2026-05-14). For Pi, let `/compact`
  // pass through to Pi's own compaction.
  if (getHarnessBehavior(conv.harness).transcriptKind === 'claude-jsonl' && shouldInterceptManualCompact(message)) {
    const compactSessionFile = await resolveSessionFile(conv);
    if (!compactSessionFile || !existsSync(compactSessionFile)) {
      return jsonResponse({ error: `No session file found for conversation ${conv.name}` }, { status: 400 });
    }
    const result = await compactConversationNative(compactSessionFile, conv.name);
    setConversationClaudeSessionId(conv.name, result.forkedSessionId);
    return jsonResponse({ ok: true, compacted: true, mode: 'overdeck-native', model: result.model });
  }

  const allAttachmentPaths = extractConversationAttachmentPaths(message);
  // Validate managed attachments concurrently — each check is independent IO.
  const managedChecks = await Promise.all(
    allAttachmentPaths.map(async (attachmentPath) => {
      const managed = await isManagedConversationAttachmentPath(attachmentPath);
      if (!managed) return { managed: false as const, attachmentPath };
      const hasAttachment = await hasConversationAttachment(conv.name, attachmentPath);
      return { managed: true as const, attachmentPath, hasAttachment };
    }),
  );
  for (const check of managedChecks) {
    if (check.managed && !check.hasAttachment) {
      return jsonResponse({ error: 'One or more attached images are unavailable for this conversation' }, { status: 400 });
    }
    // Unmanaged @paths in prose are allowed to pass through
  }
  const managedAttachmentPaths = managedChecks
    .filter((c): c is { managed: true; attachmentPath: string; hasAttachment: boolean } => c.managed)
    .map((c) => c.attachmentPath);
  const harness: RuntimeName = conv.harness ?? 'claude-code';
  const behavior = getHarnessBehavior(harness);

  // Guard: text-only models (e.g. mimo-v2.5-pro) return 404 on image input,
  // which the harness mistranslates as "model may not exist". Drop the image
  // attachments and continue with the text rather than failing the whole turn.
  // The composer also blocks attach up front; this is the server-side safety
  // net for direct API callers. PAN-1685.
  let outboundMessage = message;
  let effectiveAttachmentPaths = managedAttachmentPaths;
  let droppedImageCount = 0;
  if (managedAttachmentPaths.length > 0 && !modelSupportsImagesSync(conv.model ?? '')) {
    for (const p of managedAttachmentPaths) {
      outboundMessage = outboundMessage.split(`@${p}`).join('');
    }
    outboundMessage = outboundMessage.trim();
    droppedImageCount = managedAttachmentPaths.length;
    effectiveAttachmentPaths = [];
    if (!outboundMessage) {
      return jsonResponse(
        { error: `${conv.model ?? 'This model'} can't read images. Switch to a vision-capable model (e.g. mimo-v2.5) to send images.` },
        { status: 422 },
      );
    }
  }

  let deliveredMessage = transformMessageForHarness(outboundMessage, harness, effectiveAttachmentPaths);

  // PAN-1546: Claude conversations get prompt-time memory via the in-Claude
  // UserPromptSubmit hook; ohmypi has no such hook, so inject server-side here for
  // issue-linked ohmypi conversations (no-op otherwise).
  if (behavior.injectsPromptTimeMemory) {
    deliveredMessage = await injectPiConversationMemory(
      { cwd: conv.cwd, issueId: conv.issueId, conversationName: conv.name },
      deliveredMessage,
    );
  }

  if (isPiControlChannelHarness(harness)) {
    await deliverConversationViaControlChannel(conv, deliveredMessage, {
      source: 'operator',
      deliverAs: pickDeliverAs(conv, body['deliverAs']),
    });
  } else {
    // PAN-1635/PAN-1769: capture the transcript offset BEFORE delivery so the
    // eaten-by-compaction watcher below can tell whether this message ever
    // landed. Claude-only — the probe parses Claude-format JSONL.
    let watchFromByteOffset: number | null = null;
    if (behavior.transcriptKind === 'claude-jsonl' && conv.claudeSessionId) {
      const snapshot = await captureTranscriptUserRecordSnapshot(conv.cwd, conv.claudeSessionId);
      watchFromByteOffset = snapshot.readOffset ?? snapshot.fileSize ?? 0;
    }

    try {
      await deliverAgentMessage(
        conv.tmuxSession,
        deliveredMessage,
        'conversation-message',
        resolveConversationDeliveryMethod(conv),
      );
    } catch (deliveryErr: unknown) {
      const errMsg = deliveryErr instanceof Error ? deliveryErr.message : String(deliveryErr);
      if (errMsg.includes('MessageDeliveryFailed')) {
        return jsonResponse({ error: errMsg.replace('MessageDeliveryFailed: ', '') }, { status: 503 });
      }
      throw deliveryErr;
    }

    // Watch in the background for Claude Code's submit-time compaction eating
    // the just-delivered prompt (compact boundary lands, message doesn't) and
    // redeliver once. The POST already returned ok by the time this matters.
    if (watchFromByteOffset !== null && conv.claudeSessionId) {
      void watchForEatenConversationMessage({
        conversationName: conv.name,
        tmuxSession: conv.tmuxSession,
        cwd: conv.cwd,
        sessionId: conv.claudeSessionId,
        message: deliveredMessage,
        deliveryMethod: resolveConversationDeliveryMethod(conv),
        fromByteOffset: watchFromByteOffset,
      }).then((outcome) => {
        if (outcome === 'redelivered') {
          console.log(`[conversations] ${conv.name}: redelivered message eaten by submit-time compaction (PAN-1635)`);
        }
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[conversations] eaten-message watcher failed for ${conv.name}: ${msg}`);
      });
    }
  }

  // Generate AI title for conversations created via instant-start (no message at creation)
  if (conv.titleSource === 'default') {
    void generateAiTitle(name, message).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[TITLE-GEN-FAILED] AI title generation FAILED for "${name}" — NO RETRY, NO FALLBACK:`, msg);
    });
  }

  return jsonResponse({ ok: true, ...(droppedImageCount > 0 ? { imagesDropped: droppedImageCount } : {}) });
}

/** Generate a default conversation name, e.g. 20260404-1234 */
function generateConversationName(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${date}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

/** Sanitize a user-provided name to be safe for tmux session names */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
}

/** Check if a tmux session exists (async, non-blocking) */
async function tmuxSessionExists(sessionName: string): Promise<boolean> {
  return Effect.runPromise(sessionExists(sessionName));
}

async function waitForTmuxSession(sessionName: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await Effect.runPromise(sessionExists(sessionName))) return;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for tmux session ${sessionName}`);
}

function shouldUseSupervisorForConversation(harness: RuntimeName): boolean {
  return getHarnessBehavior(harness).supportsPtySupervisor && process.env.OVERDECK_DOCKER_WORKSPACE !== '1' && process.env.PAN_DOCKER !== '1';
}

export function resolveConversationDeliveryMethod(conv: Conversation): 'auto' | 'channels' | 'tmux' {
  const harness = conv.harness ?? 'claude-code';
  // No-loss retirement for pi/oh-my-pi message bodies: the old tmux path only
  // provided fire-and-forget text delivery, now replaced by the acknowledged
  // extension control channel. It provided no other pi/oh-my-pi behavior. The
  // WI-7 Escape abort key remains the only sanctioned tmux write for Pi.
  if (isPiControlChannelHarness(harness)) return 'auto';
  return conv.deliveryMethod ?? (getHarnessBehavior(harness).deliveryKind === 'rpc-fifo' ? 'tmux' : 'auto');
}

async function waitForConversationRuntimeReady(tmuxSession: string, harness: RuntimeName, mode: 'spawn' | 'respawn'): Promise<void> {
  const transcriptKind = getHarnessBehavior(harness).transcriptKind;
  if (transcriptKind === 'ohmypi-jsonl') await waitForPiTuiReady(tmuxSession);
  else if (transcriptKind !== 'codex-rollout-jsonl' && mode === 'spawn') {
    await waitForClaudeReady(tmuxSession);
    console.log(`[conversations] Claude ready in ${tmuxSession}`);
  } else if (transcriptKind !== 'codex-rollout-jsonl') await waitForReadySignal(tmuxSession, 30);
}

type ConversationControlDeliverAs = Extract<ControlCommand['type'], 'prompt' | 'steer' | 'follow_up'>;
type ConversationControlCommandInput = Omit<ControlCommand, 'id'>;

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const satisfies readonly ThinkingLevel[];
const PI_CONVERSATION_ABORT_KEY = 'Escape';

function isPiControlChannelHarness(harness: RuntimeName): boolean {
  return harness === 'ohmypi' || harness === 'pi';
}

function parseThinkingLevel(value: unknown): ThinkingLevel | null {
  return typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value)
    ? value as ThinkingLevel
    : null;
}

function isConversationMidTurn(conv: Pick<Conversation, 'tmuxSession'>): boolean {
  const heartbeatPath = join(getOverdeckHome(), 'heartbeats', `${conv.tmuxSession}.json`);
  if (!existsSync(heartbeatPath)) return false;
  try {
    const heartbeat = JSON.parse(readFileSync(heartbeatPath, 'utf8')) as {
      timestamp?: string
      last_action?: string
    };
    if (!heartbeat.timestamp) return false;
    const ageMs = Date.now() - new Date(heartbeat.timestamp).getTime();
    if (!Number.isFinite(ageMs) || ageMs > 60_000) return false;
    return heartbeat.last_action !== 'turn_end';
  } catch {
    return false;
  }
}

export function pickDeliverAs(
  conv: Pick<Conversation, 'tmuxSession'>,
  bodyDeliverAs: unknown,
): ConversationControlDeliverAs {
  if (bodyDeliverAs === 'follow_up') return 'follow_up';
  if (bodyDeliverAs === 'steer') return 'steer';
  return isConversationMidTurn(conv) ? 'steer' : 'prompt';
}

export async function sendConversationControlCommand(
  conv: Pick<Conversation, 'tmuxSession'>,
  commandInput: ConversationControlCommandInput,
): Promise<void> {
  const id = randomUUID();
  const ackPromise = registerConversationControlAck(id);
  const command: ControlCommand = {
    id,
    ...commandInput,
  };

  try {
    await writeConversationControlCommand(conv.tmuxSession, command);
  } catch (err) {
    resolveConversationControlAck({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  await ackPromise;
}

export async function deliverConversationViaControlChannel(
  conv: Pick<Conversation, 'tmuxSession'>,
  message: string,
  options: {
    source: 'operator' | 'orchestrator'
    deliverAs: ConversationControlDeliverAs
  },
): Promise<void> {
  await sendConversationControlCommand(conv, {
    type: options.deliverAs,
    message,
    source: options.source,
  });
}

export async function handleConversationThinkingLevel(
  name: string,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof jsonResponse>> {
  const conv = getConversationByName(name);
  if (!conv) {
    return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
  }

  const harness: RuntimeName = conv.harness ?? 'claude-code';
  if (!isPiControlChannelHarness(harness)) {
    return jsonResponse({ error: 'Thinking level control is only supported for Pi conversations' }, { status: 400 });
  }

  if (conv.status === 'ended') {
    return jsonResponse({ error: 'Session has ended — start a new run to interact' }, { status: 422 });
  }

  const level = parseThinkingLevel(body['level']);
  if (!level) {
    return jsonResponse({ error: 'Invalid thinking level' }, { status: 400 });
  }

  await sendConversationControlCommand(conv, { type: 'set_thinking_level', level });
  setConversationEffort(name, level);
  const updated = getConversationByName(name) ?? conv;
  return jsonResponse({ ok: true, effort: updated.effort ?? level });
}

export async function handleConversationCompact(
  name: string,
): Promise<ReturnType<typeof jsonResponse>> {
  const conv = getConversationByName(name);
  if (!conv) {
    return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
  }

  const harness: RuntimeName = conv.harness ?? 'claude-code';
  if (!isPiControlChannelHarness(harness)) {
    return jsonResponse({ error: 'Compact control endpoint is only supported for Pi conversations' }, { status: 400 });
  }

  if (conv.status === 'ended') {
    return jsonResponse({ error: 'Session has ended — start a new run to interact' }, { status: 422 });
  }

  await sendConversationControlCommand(conv, { type: 'compact' });
  return jsonResponse({ ok: true });
}

export async function handleConversationAbort(
  name: string,
): Promise<ReturnType<typeof jsonResponse>> {
  const conv = getConversationByName(name);
  if (!conv) {
    return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
  }

  const harness: RuntimeName = conv.harness ?? 'claude-code';
  if (!isPiControlChannelHarness(harness)) {
    return jsonResponse({ error: 'Abort control endpoint is only supported for Pi conversations' }, { status: 400 });
  }

  if (conv.status === 'ended') {
    return jsonResponse({ error: 'Session has ended — start a new run to interact' }, { status: 422 });
  }

  // NFR-4: this single TUI interrupt key is the only sanctioned remaining
  // tmux write for pi/oh-my-pi conversations. All message and live-control
  // traffic must use the extension control channel; the extension API exposes
  // no turn-abort primitive, and Escape was verified to cancel a running omp
  // turn while keeping the TUI session alive.
  await sendKeysAsync(conv.tmuxSession, PI_CONVERSATION_ABORT_KEY, 'conversation-abort');
  return jsonResponse({ ok: true, key: PI_CONVERSATION_ABORT_KEY });
}

export async function handleConversationSwitchModel(
  name: string,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof jsonResponse>> {
  const conv = getConversationByName(name);
  if (!conv) {
    return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
  }

  const model = typeof body['model'] === 'string' && body['model'].trim()
    ? body['model'].trim()
    : (conv.model ?? undefined);

  const currentHarness: RuntimeName = conv.harness ?? 'claude-code';
  const requestedHarness = body['harness'];
  let harness: RuntimeName = currentHarness;
  if (requestedHarness === 'ohmypi' || requestedHarness === 'pi' || requestedHarness === 'claude-code' || requestedHarness === 'codex') {
    if (requestedHarness !== currentHarness) {
      const policyModel = model ?? conv.model ?? '';
      const decision = canUseHarnessSync(
        requestedHarness,
        policyModel,
        await getProviderAuthMode(policyModel),
      );
      if (!decision.allowed) {
        return jsonResponse(
          { error: decision.reason ?? 'Harness not allowed for this model' },
          { status: 400 },
        );
      }
    }
    harness = requestedHarness;
  }
  const harnessChanged = harness !== currentHarness;

  if (!(await validateCwdContainment(conv.cwd))) {
    return jsonResponse({ error: 'Invalid cwd' }, { status: 400 });
  }

  if (model && !SAFE_MODEL_PATTERN.test(model)) {
    return jsonResponse({ error: 'Invalid model' }, { status: 400 });
  }

  const livePiSwitch = isPiControlChannelHarness(currentHarness) && conv.status !== 'ended';
  if (conv.claudeSessionId && harnessChanged) {
    return jsonResponse(
      { error: 'Conversation harness is locked once a conversation has started' },
      { status: 409 },
    );
  }
  if (conv.claudeSessionId && !livePiSwitch) {
    return jsonResponse(
      { error: 'Conversation model is locked once a conversation has started' },
      { status: 409 },
    );
  }

  if (model) {
    if (livePiSwitch) {
      await sendConversationControlCommand(conv, { type: 'set_model', model });
    }
    setConversationModel(name, model);
  }
  if (harnessChanged) setConversationHarness(name, harness);

  const updated = getConversationByName(name) ?? conv;
  return jsonResponse({
    ...updated,
    model: model ?? updated.model,
    harness,
    sessionAlive: false,
  });
}

/** Synthetic toolUseId prefix marking a Codex pane-detected approval (PAN-1690). */
const CODEX_APPROVAL_TOOL_PREFIX = 'codex-approval:';

/**
 * PAN-1690 — pending-input detection for Codex conversations.
 *
 * Codex is a TUI: its approval prompts ("Would you like to run the following
 * command?") are not AskUserQuestion tool-use events in the JSONL, so the
 * JSONL scan that powers Claude conversations misses them entirely. Detect them
 * off the live tmux pane instead and fold the result into the same unified
 * pending-input signal (`pendingInputKinds`) the dashboard already renders.
 * When the prompt parses into a numbered menu we also synthesize a
 * `pendingAskUserQuestion` so the existing AskUserQuestion modal can render the
 * options and answer them via the codex-approval endpoint. The pane detector is
 * cached + concurrency-limited, so this is cheap per row.
 */
async function codexConversationPendingInput(
  conv: Conversation,
  sessionAlive: boolean,
  askedAt: string,
): Promise<{ kinds: PendingInputKind[]; approval?: PendingAskUserQuestionSnapshot }> {
  if (!sessionAlive || getHarnessBehavior(conv.harness).transcriptKind !== 'codex-rollout-jsonl') return { kinds: [] };
  try {
    const detection = await Effect.runPromise(
      detectAwaitingInputForAgent(conv.tmuxSession, { isPlanning: false }),
    );
    if (!detection) return { kinds: [] };
    if (detection.reason === 'session_resume') return { kinds: ['sessionResume'] };

    const parsed = parseCodexApprovalPrompt(detection.prompt);
    if (parsed) {
      const approval: PendingAskUserQuestionSnapshot = {
        toolUseId: `${CODEX_APPROVAL_TOOL_PREFIX}${conv.tmuxSession}`,
        askedAt,
        questions: [{
          question: parsed.detail ? `${parsed.header}\n\n${parsed.detail}` : parsed.header,
          header: 'Codex approval',
          multiSelect: false,
          options: parsed.options.map((o) => ({ label: `${o.number}. ${o.label}` })),
        }],
      };
      return { kinds: ['permissionRequest'], approval };
    }
    // Detected an approval but couldn't parse a menu — still flag it.
    return { kinds: ['permissionRequest'] };
  } catch {
    // pane capture failure — non-fatal, treat as no pending input
    return { kinds: [] };
  }
}

/**
 * PAN-1690 — answer a Codex approval menu from the dashboard. Codex select
 * popups default-highlight the first option and confirm on Enter, so option N
 * is reached with Down×(N-1) then Enter (verified against the codex 0.137 TUI).
 * Small delays let the TUI process each keystroke.
 */
async function deliverCodexApprovalChoice(tmuxSession: string, optionNumber: number): Promise<void> {
  for (let i = 1; i < optionNumber; i += 1) {
    await Effect.runPromise(sendRawKeystroke(tmuxSession, 'Down', 'codex-approval'));
    await new Promise((r) => setTimeout(r, 60));
  }
  await Effect.runPromise(sendRawKeystroke(tmuxSession, 'Enter', 'codex-approval'));
}

/** Rewrite an outgoing conversation message so harnesses without Claude Code's
 *  `@`-mention pre-submit parser still surface image attachments to the model.
 *
 *  Claude Code's TUI parses `@/abs/path` tokens at submit time and inlines the
 *  file as vision input — the model sees the image, not the path. Pi (and
 *  similar harnesses) lack that parser; the model sees `@/abs/path` as literal
 *  text and may or may not decide to call its Read tool. Replace the
 *  composer-injected `@path` prefix with an explicit instruction so any
 *  harness with a Read tool will see and process the attachment. PAN-1535. */
export function transformMessageForHarness(
  message: string,
  harness: RuntimeName,
  managedPaths: string[],
): string {
  if (getHarnessBehavior(harness).transcriptKind === 'claude-jsonl') return message;
  if (managedPaths.length === 0) return message;

  // Strip each managed `@<path>` token (exact literal match, escaped for
  // regex metacharacters) so we don't accidentally strip unmanaged prose
  // mentions of similar-looking paths.
  let body = message;
  for (const p of managedPaths) {
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    body = body.replace(new RegExp(`(?<!\\S)@${escaped}`, 'g'), '');
  }
  // Collapse the multiple blank lines left behind by stripping, and trim.
  const rest = body
    .split('\n')
    .map((line) => line.trimEnd())
    .reduce<string[]>((acc, line) => {
      if (line === '' && acc.length > 0 && acc[acc.length - 1] === '') return acc;
      acc.push(line);
      return acc;
    }, [])
    .join('\n')
    .trim();

  const bullets = managedPaths.map((p) => `- ${p}`).join('\n');
  if (!rest) {
    return `Please use your Read tool on the file(s) below and describe what you see.\n\nFiles:\n${bullets}`;
  }
  return `Please use your Read tool on the file(s) below before responding, then answer the message that follows based on what you see.\n\nFiles:\n${bullets}\n\nMessage:\n${rest}`;
}

function resolvePtySupervisorScriptPath(): string {
  return join(packageRoot, 'dist', 'pty-supervisor.js');
}

function getPtySupervisorSocketPath(agentId: string): string {
  return join(getOverdeckHome(), 'sockets', `pty-${agentId}.sock`);
}

async function waitForPtySupervisorSocket(agentId: string, timeoutMs = PTY_SUPERVISOR_SOCKET_WAIT_MS): Promise<void> {
  const socketPath = getPtySupervisorSocketPath(agentId);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const info = await stat(socketPath);
      if ((info.mode & 0o777) === 0o600) return;
    } catch {
      // not bound yet
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for PTY supervisor socket ${socketPath}`);
}

/**
 * Extract the model from a Claude Code JSONL session file by reading
 * until the first assistant message with a model field.
 * Reads line-by-line to avoid loading the entire file into memory.
 */
async function extractModelFromSessionFile(sessionFile: string): Promise<string | null> {
  try {
    if (!existsSync(sessionFile)) return null;
    const stream = createReadStream(sessionFile, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line);
        if (entry.type === 'assistant' && entry.message?.model) {
          return entry.message.model as string;
        }
      }
    } finally {
      rl.close();
      stream.destroy();
    }
  } catch {
    // Corrupt or unreadable file — skip
  }
  return null;
}

let backfillRunning = false;

/**
 * Backfill model column for existing conversations that have a session file
 * but no model stored. Runs once on server startup (async, non-blocking).
 * Guarded against concurrent runs to prevent races.
 */
async function backfillConversationModels(): Promise<void> {
  if (backfillRunning) return;
  backfillRunning = true;
  try {
    const convs = listConversations();
    // Async filter — resolveSessionFile may need to glob the agent dir for Pi.
    const probe = await Promise.all(
      convs.map(async (conv) => (!conv.model ? await resolveSessionFile(conv) : null)),
    );
    const candidates = convs.filter((_, i) => probe[i] !== null);
    const BATCH_SIZE = 10;
    let backfilled = 0;
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (conv) => {
          const sessionFile = await resolveSessionFile(conv);
          if (!sessionFile) return false;
          const model = await extractModelFromSessionFile(sessionFile);
          if (model && SAFE_MODEL_PATTERN.test(model)) {
            backfillConversationModel(conv.name, model);
            return true;
          }
          return false;
        }),
      );
      backfilled += results.filter(Boolean).length;
    }
    if (backfilled > 0) {
      console.log(`[conversations] Backfilled model for ${backfilled} conversation(s)`);
    }
  } finally {
    backfillRunning = false;
  }
}

// Fire-and-forget backfill on module load
void backfillConversationModels().catch((err: unknown) => {
  console.error('[conversations] Model backfill failed:', err);
});

/**
 * Spawn a new tmux session running claude.
 * Uses a minimal launcher script for proper terminal env setup.
 * Accepts a claudeSessionId to deterministically control the JSONL file path.
 */
// ─── Compaction helpers ───────────────────────────────────────────────────────
//
// Dashboard-owned compaction is Overdeck-native. We append the compact
// boundary and continuation summary directly to the JSONL so subsequent
// `--resume` calls load only the summarized context forward.

async function claudeConversationSystemPromptFiles(cwd: string): Promise<string[]> {
  const files: string[] = [];
  const contextFile = workspaceContextFile(cwd);
  try {
    await stat(contextFile);
    files.push(contextFile);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  files.push(await ensureSessionContextBriefingFile());
  return files;
}

async function ensurePiConversationSourceContractFile(): Promise<string> {
  const contextDir = join(getOverdeckHome(), 'context');
  await mkdir(contextDir, { recursive: true });
  const path = join(contextDir, 'pi-conversation-source-contract.md');
  await writeFile(path, `${PI_CONVERSATION_SOURCE_CONTRACT}\n`, 'utf-8');
  return path;
}

// PAN-1566: Pi conversations are launched with --no-context-files and the
// extension fold no-ops (no ctx.appendSystemPrompt), so the global rules layer
// must be delivered as launcher --append-system-prompt files. Mirror the Claude
// conversation files but prepend the Pi-rendered global layer (pi-global.md)
// and the source-attribution contract used by extension-delivered messages.
export async function piConversationSystemPromptFiles(cwd: string): Promise<string[]> {
  const files: string[] = [];
  const globalFile = piGlobalContextFile();
  try {
    await stat(globalFile);
    files.push(globalFile);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  files.push(await ensurePiConversationSourceContractFile());
  const contextFile = workspaceContextFile(cwd);
  try {
    await stat(contextFile);
    files.push(contextFile);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  files.push(await ensureSessionContextBriefingFile());
  return files;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export async function spawnConversationSession(
  tmuxSession: string,
  cwd: string,
  claudeSessionId: string,
  model?: string,
  effort?: string,
  issueId?: string,
  resume = false,
  harness: RuntimeName = 'claude-code',
  plainFork = false,
): Promise<void> {
  const behavior = getHarnessBehavior(harness);
  const stateDir = join(getOverdeckHome(), 'conversations', tmuxSession);
  await mkdir(stateDir, { recursive: true });

  // PAN-1596: clear any stale ready.json before launch so waitForReadySignal()
  // (reattach/fork readiness) only observes the session-start signal from THIS
  // launch. The conversation's session-start hook rewrites it when the new
  // Claude session reaches the prompt.
  clearReadySignal(tmuxSession);

  const launcherScript = join(stateDir, 'launcher.sh');

  const permissionFlags = getClaudePermissionFlagsStringSync();
  let runtimeCommand = `claude ${permissionFlags}`;
  let providerExportsStr = '';
  let providerEnv: Record<string, string> = {};
  let piFields: {
    harness: 'ohmypi';
    piMode: 'tui';
    piExtensionPath: string;
    piSessionDir: string;
    resumeSessionId?: string;
  } | undefined;
  let codexFields: {
    harness: 'codex';
    codexMode: 'tui';
    codexHome: string;
    codexSessionDir: string;
    resumeSessionId?: string;
  } | undefined;
  if (model) {
    if (!SAFE_MODEL_PATTERN.test(model)) {
      throw new Error('Invalid model name');
    }
    runtimeCommand = await getAgentRuntimeBaseCommand(model, undefined, undefined, harness);
    // Defensive permission-flag injection.
    // getAgentRuntimeBaseCommand already emits the correct flags for every code path
    // (direct/CLIProxy/--agent/claudish), so in a healthy build the appends below are
    // no-ops. They exist as a belt-and-braces guard for future code paths that might
    // forget to thread the resolved mode through. The critical safety property:
    // The bypass CLI flag was removed; only --permission-mode is ever appended.
    const mode = resolvePermissionModeSync();
    if (!runtimeCommand.includes('--permission-mode')) {
      runtimeCommand = `${runtimeCommand} --permission-mode ${mode === 'auto' ? 'auto' : BYPASS_PERMISSION_MODE}`;
    }
    providerExportsStr = (await getProviderExportsForModel(model)).trim();
    providerEnv = await getProviderEnvForModel(model);

    if (behavior.transcriptKind === 'ohmypi-jsonl') {
      // Preflight: ohmypi GPT-5.x conversations authenticate with the user's
      // ChatGPT/Codex OAuth (openai-codex). If that credential is dead, omp
      // fails mid-session with the opaque "No API key for provider:
      // openai-codex". Proactively refresh it, and if it can't be revived,
      // fail here with an actionable message. Stays silent (fail-open) when
      // the auth state can't be determined (e.g. omp's OAuth module is absent).
      if (getProviderForModelSync(model).name === 'openai') {
        const auth = await getOhmypiCodexAuthStatus({ refreshIfExpired: true });
        if (auth.status === 'missing' || auth.status === 'expired') {
          throw new Error(
            'ohmypi ChatGPT/Codex login (openai-codex) has expired and could not be refreshed. ' +
            'Re-authenticate with `pan pi-auth login`, then retry.',
          );
        }
      }

      // Conversations run Pi in TUI mode (the default Pi terminal UI). This
      // gives users an actual terminal in the tmux pane — they can type
      // directly into Pi, while dashboard-composer messages and live controls
      // are delivered through the acknowledged extension control channel. Pi
      // still writes JSONL session files to --session-dir, so cost parsing and
      // resume keep working.
      //
      // Work-agents (spawned elsewhere) keep --mode rpc + FIFO because
      // Cloister needs the structured delivery primitive. See PAN-1067.
      const paths = piFifoPaths(tmuxSession);
      const piSessionDir = join(paths.agentDir, 'sessions');
      await mkdir(paths.agentDir, { recursive: true, mode: 0o700 });
      await mkdir(piSessionDir, { recursive: true, mode: 0o700 });
      // No FIFO needed in TUI mode — Pi reads from the pane stdin.
      const storedPiSessionId = resume
        ? (await readFile(join(paths.agentDir, 'session.id'), 'utf-8').then((s) => s.trim()).catch(() => undefined))
        : undefined;
      piFields = {
        harness: 'ohmypi',
        piMode: 'tui',
        piExtensionPath: resolveOhmypiExtensionPath() ?? resolve(process.cwd(), 'packages/ohmypi-extension/dist/index.js'),
        piSessionDir,
        resumeSessionId: storedPiSessionId || undefined,
      };
    } else if (behavior.usesCodexHome) {
      // Codex conversations run in TUI mode — bare `codex` interactive terminal.
      // Users type directly in the pane; dashboard messages arrive via the PTY
      // supervisor when available, with tmux as the delivery fallback.
      //
      // Pre-seed the per-agent config so Codex never shows its first-run
      // "Decide how much autonomy" / folder-trust wizard (which otherwise fires
      // on every fresh CODEX_HOME and blocks the pane). Autonomy follows the
      // codex.permissionMode setting (separate from Claude's permission mode):
      //   read-only   → approval_policy=on-request + sandbox_mode=read-only
      //   workspace   → approval_policy=on-request + sandbox_mode=workspace-write (default)
      //   full-access → approval_policy=never + sandbox_mode=danger-full-access
      // This is the Codex analog of preTrustDirectory(cwd) below, which only
      // pre-accepts Claude Code trust.
      const codexHome = join(getOverdeckHome(), 'agents', tmuxSession, 'codex-home');
      const codexPermMode = loadConfigSync().config.codex?.permissionMode ?? 'workspace';
      const codexApprovalPolicy = codexPermMode === 'full-access' ? 'never' : 'on-request';
      const codexSandboxMode =
        codexPermMode === 'full-access' ? 'danger-full-access'
        : codexPermMode === 'read-only' ? 'read-only'
        : 'workspace-write';
      const codexApprovalsReviewer = codexPermMode === 'auto-review' ? 'auto_review' : undefined;
      const { initCodexHome, extractThreadIdFromRollout } = await import('../../../lib/runtimes/codex.js');
      initCodexHome(codexHome, {
        trustedDir: cwd,
        approvalPolicy: codexApprovalPolicy,
        sandboxMode: codexSandboxMode,
        approvalsReviewer: codexApprovalsReviewer,
      });
      const resumeSessionId = resume
        ? await resolveCodexRolloutPath(tmuxSession, { agentsDirOverride: join(getOverdeckHome(), 'agents') })
          .then((rollout) => rollout ? extractThreadIdFromRollout(rollout) ?? undefined : undefined)
        : undefined;
      codexFields = {
        harness: 'codex',
        codexMode: 'tui',
        codexHome,
        codexSessionDir: join(codexHome, 'sessions'),
        resumeSessionId,
      };
    }
  }

  // Pi's CLI matches `--model <id>` against its full registry; with
  // ambiguous IDs like "gpt-5.4" (which exist under multiple providers),
  // the first registry hit wins — and that hit can be a provider the user
  // has no auth for (e.g. azure-openai-responses). Pass the model as
  // `<pi-provider>/<id>` so Pi's resolveCliModel locks in the intended
  // provider. The user's pi auth (`~/.pi/agent/auth.json`) determines
  // whether the call actually succeeds.
  let launcherModel = model;
  if (behavior.contextLayerKind === 'pi' && model) {
    const piProvider = piProviderForModel(model);
    if (piProvider) launcherModel = `${piProvider}/${model}`;
  }

  if (effort && !SAFE_EFFORT_PATTERN.test(effort)) {
    throw new Error('Invalid effort level');
  }

  const useSupervisor = shouldUseSupervisorForConversation(harness);
  let supervisorScriptPath: string | undefined;
  if (useSupervisor) {
    supervisorScriptPath = resolvePtySupervisorScriptPath();
    if (!existsSync(supervisorScriptPath)) {
      throw new Error('pty-supervisor build artifact missing — run `npm run build`.');
    }
    await writePtyToken(tmuxSession);
  }

  // Channels setup for Claude Code conversations when the experimental flag
  // is on. Writes a per-session bridge token and MCP config so Claude loads
  // the overdeck-bridge stdio server on startup.
  //
  // TRAP — this relay is NOT how conversations handle "Do you want to proceed?".
  // The bridge handles Claude's `notifications/claude/channel/permission_request`
  // (a channel-level event) plus out-of-band message delivery. It does NOT
  // intercept the in-terminal tool-approval prompt. That prompt is governed by
  // the resolved `--permission-mode` (see permissionFlags above): under `auto`
  // it fires and a human at the dashboard terminal answers it; under `bypass`
  // it is suppressed. Either way this bridge is orthogonal — "make a session
  // interactive like a conversation" does not mean "wire this bridge".
  //
  // Plain forks skip channels wiring entirely. Two reasons:
  //   1. The overdeck-bridge MCP server registers its tool schema into
  //      Claude's context budget. On a plain fork the whole source JSONL is
  //      loaded via --resume; pushing borderline-sized conversations across
  //      Claude Code's ~200K auto-compact threshold defeats the entire
  //      purpose of plain fork (pick up exactly where you left off).
  //   2. dismissDevChannelsDialog spams Enter to clear the dev-channels
  //      warning. If the resumed session shows an auto-compact suggestion in
  //      the same window, a stray Enter confirms it — silently triggering
  //      /compact on the brand-new fork.
  // Subsequent messages to the fork can still reach the agent via tmux,
  // which is the channels delivery fallback anyway.
  let channelsBridgeMcpConfig: string | undefined;
  if (
    !piFields &&
    !codexFields &&
    !plainFork &&
    isClaudeCodeChannelsEnabled() &&
    (!model || getProviderForModelSync(model).name === 'anthropic') &&
    process.env.CLAUDE_CODE_USE_BEDROCK !== '1' &&
    process.env.CLAUDE_CODE_USE_VERTEX !== '1' &&
    process.env.CLAUDE_CODE_USE_FOUNDRY !== '1' &&
    process.env.OVERDECK_DOCKER_WORKSPACE !== '1' &&
    process.env.PAN_DOCKER !== '1'
  ) {
    channelsBridgeMcpConfig = join(stateDir, 'agent-mcp.json');
    writeBridgeTokenSync(tmuxSession);
    await writeChannelsBridgeMcpConfig(channelsBridgeMcpConfig, tmuxSession);
  }

  // Atomic write: a concurrent resume/switch-model for the same conversation
  // reuses this exact path. Writing in place lets the other spawn read a
  // half-written launcher; write to a unique temp file then rename (atomic on
  // the same filesystem).
  const launcherTmp = `${launcherScript}.${randomUUID()}.tmp`;
  await writeFile(
    launcherTmp,
    generateLauncherScriptSync({
      role: 'work',
      spawnMode: 'conversation',
      workingDir: cwd,
      setTerminalEnv: true,
      unsetProviderEnv: true,
      overdeckEnv: { ...(issueId ? { issueId } : {}), ...((piFields || codexFields || useSupervisor) ? { agentId: tmuxSession } : {}) },
      // Point the agent's hook/heartbeat POSTs at THIS server's loopback API.
      // Without it the Pi extension falls back to http://localhost:3010
      // (index.ts:120) — which in dev is the Vite dev server, whose /api proxy
      // targets the unresolvable docker host `server`, spamming ENOTFOUND on
      // every tool/turn. Resolve the port exactly as the server does so this is
      // correct in dev (3011) and prod (whatever API_PORT/PORT is set to).
      extraEnvExports: [
        `export OVERDECK_DASHBOARD_URL="http://127.0.0.1:${process.env['API_PORT'] ?? process.env['PORT'] ?? '3011'}"`,
      ],
      providerExports: providerExportsStr || undefined,
      trapHup: true,
      baseCommand: runtimeCommand,
      appendSystemPromptFiles: piFields
        ? await piConversationSystemPromptFiles(cwd)
        : codexFields
          ? []
          : await claudeConversationSystemPromptFiles(cwd),
      model: launcherModel,
      ...(piFields ?? codexFields ?? {
        resumeSessionId: resume ? claudeSessionId : undefined,
        sessionId: resume ? undefined : claudeSessionId,
      }),
      extraArgs: !piFields && effort ? `--effort "${effort}"` : undefined,
      keepAlive: true,
      fileMode: 0o700,
      channelsBridgeMcpConfig,
      useSupervisor,
      supervisorScriptPath,
    }),
    { mode: 0o700 },
  );
  await rename(launcherTmp, launcherScript);

  // Kill any stale session with the same name
  try {
    await Effect.runPromise(killSession(tmuxSession));
  } catch {
    // ignore missing stale session
  }

  console.log(`[claude-invoke] purpose=conversation-session | model=${model || 'default'} | source=conversations.ts:spawnConversationSession | session=${tmuxSession} | resume=${resume} | command="${runtimeCommand}"`);

  // Pre-accept Claude Code's trust + bypass-permissions disclaimers BEFORE
  // spawn so the new claude process reads acceptance from ~/.claude.json on
  // startup and skips both dialogs. Without this, the "Bypass Permissions
  // mode" prompt blocks the session in the tmux pane — its default option
  // is "No, exit", so any Enter (including from dismissDevChannelsDialog)
  // tears the session down and the user sees "Conversation session ended"
  // immediately after launch. Work/specialist spawns already do this in
  // src/lib/agents.ts; conversations were the only spawn path missing it.
  try {
    const { preTrustDirectory } = await import('../../../lib/workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
    preTrustDirectory(cwd);
  } catch { /* non-fatal */ }

  // Spawn the session — blank out provider env vars (ANTHROPIC_BASE_URL,
  // ANTHROPIC_API_KEY, etc.) via tmux -e flags so the launcher script's
  // exports are the sole source of provider configuration. The tmux server
  // inherits the parent's env and -e can only SET, not UNSET, so we set
  // provider vars to empty strings to override stale inherited values.
  try {
    await Effect.runPromise(createSession(tmuxSession, cwd, `bash ${shellQuote(launcherScript)}`, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        TERM: 'xterm-256color',
      },
    }));
  } catch (err) {
    if ((err as { code?: string })?.code === 'ENOENT') {
      throw new Error(
        'tmux is not installed. Install it with: brew install tmux (macOS) or sudo apt-get install tmux (Linux)',
      );
    }
    throw err;
  }

  if (useSupervisor) {
    await waitForPtySupervisorSocket(tmuxSession);
  }

  // For codex TUI conversations, poll for the first rollout JSONL in the
  // background and persist the thread-id so transcript/cost lookups can
  // locate the session. Non-blocking — resolves after codex writes its first
  // rollout, which happens once the user starts the first conversation turn.
  if (behavior.usesCodexHome && codexFields?.codexHome) {
    const codexHomeDir = codexFields.codexHome;
    void (async () => {
      try {
        const { waitForCodexRollout, extractThreadIdFromRollout, writeThreadId } =
          await import('../../../lib/runtimes/codex.js');
        const rollout = await waitForCodexRollout(codexHomeDir, 120_000);
        if (rollout) {
          const threadId = extractThreadIdFromRollout(rollout);
          if (threadId) writeThreadId(tmuxSession, threadId);
        }
      } catch {
        // non-fatal
      }
    })();
  }

  // Channels: dismiss the dev-channels confirmation dialog so the bridge MCP
  // server starts and the socket is created. Fire-and-forget — the helper
  // self-polls for the dialog and presses Enter. Awaiting it here blocked the
  // POST /api/conversations response (and therefore the conversation appearing
  // in the list) for up to 20s. waitForClaudeReady below naturally waits for
  // the prompt, which only appears once this dismissal lands, so the two run
  // concurrently without a race.
  if (channelsBridgeMcpConfig) {
    void dismissDevChannelsDialog(tmuxSession).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[conversations] dismissDevChannelsDialog failed for ${tmuxSession}: ${msg}`);
    });
  }

  // Keep session alive when clients disconnect
  await Effect.runPromise(setOption(tmuxSession, 'destroy-unattached', 'off'));
  await Effect.runPromise(setOption(exactPaneTarget(tmuxSession), 'remain-on-exit', 'on'));
}

/**
 * Generate an AI title for a conversation from its opening message (T3Code pattern).
 * Runs at conversation creation; updates the title only if it hasn't been
 * manually renamed (`canReplaceTitle`). No fallback — if generation fails the
 * error is logged and the existing title is kept.
 *
 * For an explicit, whole-conversation re-title see the retitle route below.
 */
async function generateAiTitle(conversationName: string, firstMessage: string): Promise<void> {
  // Background AI gate: low-cost mode (or the conversationTitles toggle) skips
  // automatic title generation. Manual retitle (below) is unaffected.
  if (!isBackgroundFeatureEnabled('conversationTitles')) return;

  const conv = getConversationByName(conversationName);
  if (!conv || !canReplaceTitle(conv)) {
    return;
  }

  console.log(`[claude-invoke] purpose=conversation-title | model=${CONVERSATION_TITLE_MODEL} | source=conversations.ts:generateAiTitle | conversation=${conversationName} | promptChars=${firstMessage.length}`);

  const sanitized = await summarizeFirstMessageTitle(firstMessage, configuredTitleModel());
  if (!sanitized) {
    console.warn(`[generateAiTitle] Model returned empty title for "${conversationName}"`);
    return;
  }

  // Re-check eligibility (may have been renamed while we waited)
  const freshConv = getConversationByName(conversationName);
  if (!freshConv || !canReplaceTitle(freshConv)) {
    console.log(`[generateAiTitle] Conversation "${conversationName}" was renamed while generating title; skipping update`);
    return;
  }

  updateConversationTitle(conversationName, sanitized, 'ai');
  console.log(`[claude-invoke] SUCCESS purpose=conversation-title | model=${CONVERSATION_TITLE_MODEL} | conversation=${conversationName} | outputChars=${sanitized.length}`);

  // Schedule a one-shot follow-up retitle once the assistant's first complete
  // response has landed. The first-message titler only sees the user's opening
  // prompt; the refined pass uses the whole transcript and almost always
  // produces a better label.
  scheduleTitleRefinement(conversationName);
}

/** Conversations awaiting first-assistant-response title refinement. */
const refinementScheduled = new Set<string>();

/**
 * After the first-message AI title is set, watch the JSONL for the first
 * complete assistant response, then re-title from the whole transcript.
 * Fires at most once per conversation. Skips if the user has manually renamed
 * the conversation in the meantime or the conversation has already been
 * refined. Times out after 10 minutes — large operations or stalled
 * conversations will simply keep the first-message title.
 */
function scheduleTitleRefinement(conversationName: string): void {
  // Background AI gate: low-cost mode (or the titleRefinement toggle) skips the
  // whole-transcript refinement pass.
  if (!isBackgroundFeatureEnabled('titleRefinement')) return;
  if (refinementScheduled.has(conversationName)) return;
  refinementScheduled.add(conversationName);

  const TIMEOUT_MS = 10 * 60 * 1000;
  const POLL_INTERVAL_MS = 1500;
  const startedAt = Date.now();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let done = false;

  const stop = () => {
    done = true;
    if (timer) clearTimeout(timer);
    refinementScheduled.delete(conversationName);
  };

  async function tick(): Promise<void> {
    if (done) return;
    if (running) {
      timer = setTimeout(tick, POLL_INTERVAL_MS);
      return;
    }
    running = true;
    try {
      if (Date.now() - startedAt > TIMEOUT_MS) {
        console.log(`[title-refine] Timed out waiting for first assistant response in "${conversationName}"`);
        stop();
        return;
      }

      const conv = getConversationByName(conversationName);
      if (!conv) {
        stop();
        return;
      }
      // Only refine titles that are still AI-generated from the first message.
      // Manual renames and prior refinements are sacred.
      if (conv.titleSource !== 'ai') {
        stop();
        return;
      }

      const sessionFile = await resolveSessionFile(conv);
      if (!sessionFile || !existsSync(sessionFile)) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }

      const { messages } = await getCachedMessages(sessionFile, false);
      const firstCompleteAssistant = messages.find(
        (m) => m.role === 'assistant' && m.completedAt,
      );
      if (!firstCompleteAssistant) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }

      const transcript = serializeConversationTranscript(messages);
      if (!transcript.trim()) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }

      console.log(`[claude-invoke] purpose=conversation-title-refine | model=${CONVERSATION_TITLE_MODEL} | conversation=${conversationName} | transcriptChars=${transcript.length}`);
      const refined = await summarizeTranscriptTitle(transcript, configuredTitleModel());
      if (!refined) {
        console.warn(`[title-refine] Model returned empty refined title for "${conversationName}"`);
        stop();
        return;
      }

      // Re-check eligibility — user may have renamed during the model call.
      const freshConv = getConversationByName(conversationName);
      if (!freshConv || freshConv.titleSource !== 'ai') {
        console.log(`[title-refine] Conversation "${conversationName}" no longer eligible (source=${freshConv?.titleSource ?? 'missing'}); skipping`);
        stop();
        return;
      }

      updateConversationTitle(conversationName, refined, 'ai-refined');
      console.log(`[claude-invoke] SUCCESS purpose=conversation-title-refine | conversation=${conversationName} | title="${refined}"`);
      stop();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[title-refine] failed for "${conversationName}":`, msg);
      stop();
    } finally {
      running = false;
    }
  }

  timer = setTimeout(tick, POLL_INTERVAL_MS);
}

// ─── Conversation retitle / about summary ─────────────────────────────────────
//
// Both read the conversation's own JSONL transcript on demand. The memory
// Observation pipeline never observes ad-hoc conversations (it watches only
// work-role pipeline agents), so there is no pre-computed data to draw on —
// the transcript itself is the source of truth. A follow-up issue tracks
// extending the observation pipeline to conversations.

/** Conversations with a retitle currently running — guards against double-clicks. */
const retitleInFlight = new Set<string>();
const EXPLICIT_RETITLE_TIMEOUT_MS = 90_000;

function isClaudeInvocationTimeout(error: unknown): boolean {
  return error instanceof Error && /claude invocation timed out after \d+ms/.test(error.message);
}

interface ConversationAboutSummary {
  summary: string;
  messageCount: number;
  generatedAt: string;
}

/** transcript-size-keyed cache so re-opening the About drawer doesn't re-summarize. */
const aboutSummaryCache = new Map<string, { transcriptSize: number; data: ConversationAboutSummary }>();
const ABOUT_SUMMARY_CACHE_MAX = 100;

type ArchivedConversationResponse = {
  id: number;
  source: 'managed-archived';
  conversationName: string;
  jsonlPath: string | null;
  workspacePath: string;
  primaryModel: string | null;
  messageCount: number;
  firstTs: string;
  lastTs: string;
  estimatedCost: number;
  tokenInput: number;
  tokenOutput: number;
  toolsUsed: string[];
  filesTouched: string[];
  tags: string[];
  summary: string | null;
  enrichmentLevel: 0 | 1 | 2 | 3;
  enrichmentFailed: boolean;
  overdeckManaged: true;
  panIssueId: string | null;
  archivedAt: string;
};

function parseStringArrayColumn(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function mapArchivedConversation(row: ArchivedConversationWithEnrichment): ArchivedConversationResponse {
  const canUseClaudePathFallback = row.harness === null || row.harness === 'claude-code';
  return {
    id: row.id,
    source: 'managed-archived',
    conversationName: row.name,
    jsonlPath: row.discoveredJsonlPath ?? (canUseClaudePathFallback && row.claudeSessionId ? sessionFilePath(row.cwd, row.claudeSessionId) : null),
    workspacePath: row.cwd,
    primaryModel: row.primaryModel ?? row.model,
    messageCount: row.messageCount ?? 0,
    firstTs: row.firstTs ?? row.createdAt,
    lastTs: row.lastTs ?? row.archivedAt,
    estimatedCost: row.estimatedCost ?? row.totalCost,
    tokenInput: row.tokenInput ?? 0,
    tokenOutput: row.tokenOutput ?? 0,
    toolsUsed: parseStringArrayColumn(row.toolsUsed),
    filesTouched: parseStringArrayColumn(row.filesTouched),
    tags: parseStringArrayColumn(row.tags),
    summary: row.summary ?? row.title,
    enrichmentLevel: ((row.enrichmentLevel ?? 0) as 0 | 1 | 2 | 3),
    enrichmentFailed: Boolean(row.enrichmentFailed),
    overdeckManaged: true,
    panIssueId: row.issueId,
    archivedAt: row.archivedAt,
  };
}

function parseOptionalNumberParam(params: URLSearchParams, name: string): number | undefined {
  const value = params.get(name);
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseArchivedConversationListOptions(params: URLSearchParams): ArchivedConversationListOptions {
  const options: ArchivedConversationListOptions = {};
  const workspacePath = params.get('workspacePath');
  const primaryModel = params.get('primaryModel');
  const since = params.get('since');
  const tag = params.get('tag');
  const tool = params.get('tool');
  const file = params.get('file');
  const minCost = parseOptionalNumberParam(params, 'minCost');
  const maxCost = parseOptionalNumberParam(params, 'maxCost');
  const enrichmentLevel = parseOptionalNumberParam(params, 'enrichmentLevel');
  const rawLimit = parseOptionalNumberParam(params, 'limit');
  const rawOffset = parseOptionalNumberParam(params, 'offset');

  if (workspacePath) options.workspacePath = workspacePath;
  if (primaryModel) options.primaryModel = primaryModel;
  if (since) options.since = parseRelativeTime(since);
  if (params.get('managed') === 'true') options.managed = true;
  if (params.get('enriched') === 'true') options.enriched = true;
  if (tag) options.tags = [tag];
  if (tool) options.tools = [tool];
  if (file) options.files = [file];
  if (minCost !== undefined) options.minCost = minCost;
  if (maxCost !== undefined) options.maxCost = maxCost;
  if (enrichmentLevel !== undefined) options.enrichmentLevel = enrichmentLevel;
  options.limit = rawLimit === undefined ? 50 : Math.min(Math.max(rawLimit, 0), 100);
  if (rawOffset !== undefined) options.offset = Math.max(rawOffset, 0);
  return options;
}

export async function handleArchivedConversationsList(options: ArchivedConversationListOptions = {}): Promise<ReturnType<typeof jsonResponse>> {
  try {
    const rows = listArchivedConversationsWithEnrichment(options).map(mapArchivedConversation);
    return jsonResponse(rows);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] list archived conversations failed:', msg);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── Route: GET /api/conversations ───────────────────────────────────────────

/** PAN-1520/PAN-1705 — build the AskUserQuestion snapshot from a pending-input
 *  scan. Shared by the enriched list and the lightweight pending-input feed. */
function askUserQuestionSnapshotFromScan(
  scan: Awaited<ReturnType<typeof scanPendingInputsPromise>>,
): PendingAskUserQuestionSnapshot | undefined {
  if (scan.askUserQuestions.length === 0) return undefined;
  const first = scan.askUserQuestions[0];
  return {
    toolUseId: first.toolId,
    askedAt: first.timestamp,
    questions: first.questions.map(q => ({
      question: q.question,
      header: q.header,
      multiSelect: q.multiSelect,
      options: q.options.map(o => ({ label: o.label, description: o.description })),
    })),
  };
}

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

export function conversationSessionAliveFromState(
  conv: Pick<Conversation, 'status' | 'forkStatus'>,
  tmuxSessionAlive: boolean,
): boolean {
  return conv.status === 'active' && !conv.forkStatus && tmuxSessionAlive;
}

export function conversationNeedsRunningRepair(
  conv: Pick<Conversation, 'status' | 'forkStatus'>,
  tmuxSessionAlive: boolean,
  harnessProcessAlive: boolean,
): boolean {
  return conv.status === 'ended' && !conv.forkStatus && tmuxSessionAlive && harnessProcessAlive;
}

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
      try {
        const conversations = listConversations({ limit: 1000 });
        const liveSessionNames = new Set(await Effect.runPromise(listSessionNames()));
        const alive = conversations.filter(
          (conv) => !conv.forkStatus && liveSessionNames.has(conv.tmuxSession),
        );
        const rows = await Effect.runPromise(withConcurrencyLimit(
          alive.map((conv) => Effect.promise(async () => {
            const convSf = await resolveSessionFile(conv);
            let pending: PendingAskUserQuestionSnapshot | undefined;
            let lastActivityAt: string | null = null;
            if (convSf && existsSync(convSf)) {
              try {
                lastActivityAt = new Date((await stat(convSf)).mtimeMs).toISOString();
              } catch {
                // non-fatal — askedAt falls back to now for the codex path
              }
              try {
                pending = askUserQuestionSnapshotFromScan(await scanPendingInputsPromise(convSf));
              } catch {
                // JSONL scan failure — non-fatal
              }
            }
            if (!pending) {
              // PAN-1690 — Codex pane-detected approval fallback.
              const codex = await codexConversationPendingInput(
                conv,
                true,
                lastActivityAt ?? new Date().toISOString(),
              );
              if (codex.approval) pending = codex.approval;
            }
            if (!pending) return null;
            return {
              name: conv.name,
              title: conv.title ?? null,
              issueId: conv.issueId ?? null,
              pendingAskUserQuestion: pending,
            };
          })),
          CONVERSATION_LIST_ENRICHMENT_CONCURRENCY,
        ));
        return jsonResponse(rows.filter((row) => row !== null));
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] pending-input feed failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
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
    return yield* Effect.promise(() => handleArchivedConversationsList(parseArchivedConversationListOptions(url.searchParams)));
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
    const numericId = Number(rawId);
    return yield* Effect.promise(async () => {
      try {
        // The list endpoint deliberately excludes agent/planning/specialist
        // rows (kept out of the human-conversations sidebar), but consumers
        // like AgentOutputPanel still need to fetch a single agent row by
        // name. When the path param looks like a name rather than a number,
        // resolve via getConversationByName instead of getConversationById.
        const conv = !Number.isNaN(numericId) && /^\d+$/.test(rawId)
          ? getConversationById(numericId)
          : getConversationByName(rawId);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }
        const sessionAlive = conversationSessionAliveFromState(conv, await tmuxSessionExists(conv.tmuxSession));
        const convSf = await resolveSessionFile(conv);
        let contextUsage = null;
        if (convSf && existsSync(convSf)) {
          try {
            contextUsage = await computeContextUsage(convSf, conv.model);
          } catch {
            contextUsage = null;
          }
        }
        const gitInfo = await resolveConversationGitInfo(conv.cwd);
        // PAN-1520 — pending-input surfaces for this conv.
        let pendingInputCount = 0;
        let pendingInputKinds: PendingInputKind[] = [];
        let pendingAskUserQuestion: PendingAskUserQuestionSnapshot | undefined;
        if (sessionAlive && convSf && existsSync(convSf)) {
          try {
            const scan = await scanPendingInputsPromise(convSf);
            const kinds: PendingInputKind[] = [];
            if (scan.askUserQuestions.length > 0) {
              kinds.push('askUserQuestion');
              const first = scan.askUserQuestions[0];
              pendingAskUserQuestion = {
                toolUseId: first.toolId,
                askedAt: first.timestamp,
                questions: first.questions.map(q => ({
                  question: q.question,
                  header: q.header,
                  multiSelect: q.multiSelect,
                  options: q.options.map(o => ({ label: o.label, description: o.description })),
                })),
              };
            }
            if (scan.exitPlanModePending) kinds.push('exitPlanMode');
            if (scan.enterPlanModeOpen && !scan.exitPlanModePending) kinds.push('enterPlanMode');
            pendingInputKinds = kinds;
            pendingInputCount = kinds.length;
          } catch { /* non-fatal */ }
        }
        if (pendingInputCount === 0) {
          const codex = await codexConversationPendingInput(conv, sessionAlive, new Date().toISOString());
          if (codex.kinds.length > 0) {
            pendingInputKinds = codex.kinds;
            pendingInputCount = codex.kinds.length;
            if (codex.approval) pendingAskUserQuestion = codex.approval;
          }
        }
        return jsonResponse({
          ...conv,
          sessionAlive,
          contextUsage,
          branch: gitInfo.branch,
          isWorktree: gitInfo.isWorktree,
          pendingInputCount,
          pendingInputKinds,
          pendingAskUserQuestion,
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] get conversation failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
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

    return yield* Effect.promise(async () => {
      try {
        const message = typeof body['message'] === 'string' ? body['message'].trim() : '';
        const model = typeof body['model'] === 'string' ? body['model'].trim() : undefined;
        const effort = typeof body['effort'] === 'string' ? body['effort'].trim() : undefined;
        const harness = await resolveAllowedHarness(body['harness'], model);
        const issueId = typeof body['issueId'] === 'string' ? body['issueId'] : undefined;
        const projectKey = typeof body['projectKey'] === 'string' ? body['projectKey'].trim() : undefined;
        const applyProviderOverride = body['applyProviderOverride'] === true;
        if (issueId && !SAFE_ISSUE_ID_PATTERN.test(issueId)) {
          return jsonResponse({ error: 'Invalid issueId' }, { status: 400 });
        }
        if (model && !SAFE_MODEL_PATTERN.test(model)) {
          return jsonResponse({ error: 'Invalid model' }, { status: 400 });
        }
        if (effort && !SAFE_EFFORT_PATTERN.test(effort)) {
          return jsonResponse({ error: 'Invalid effort' }, { status: 400 });
        }
        let cwd = getDefaultCwd();
        if (projectKey) {
          const projectConfig = getProjectSync(projectKey);
          if (projectConfig?.path && existsSync(projectConfig.path)) {
            cwd = projectConfig.path;
          } else {
            return jsonResponse({ error: `Unknown project: ${projectKey}` }, { status: 400 });
          }
        }

        if (message && message.length > MAX_MESSAGE_LENGTH) {
          return jsonResponse(
            { error: `message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters` },
            { status: 400 },
          );
        }

        // Generate identifiers — retry on UNIQUE collision (extremely unlikely
        // with HHMMSS+random, but cheap insurance against sub-second races).
        let name = generateConversationName();
        for (let i = 0; i < 5 && getConversationByName(name); i++) {
          name = generateConversationName();
        }
        const tmuxSession = `conv-${name}`;
        const claudeSessionId = randomUUID();

        console.log(`[conversations] Creating conversation "${name}" with model=${model ?? 'default'} effort=${effort ?? 'default'} cwd=${cwd}`);

        // Title = truncated first message (T3Code pattern), or default
        const MAX_TITLE_LEN = 60;
        const title = message
          ? message.slice(0, MAX_TITLE_LEN) + (message.length > MAX_TITLE_LEN ? '…' : '')
          : 'New conversation';

        // Create the DB record FIRST — before spawning the tmux session and
        // waiting up to 30s for the runtime to render. Previously the row was
        // inserted last, so a brand-new conversation did not exist in the DB
        // (and could not appear in the list) for the entire spawn+ready window.
        // Insert immediately, emit a realtime event, then spawn.
        const conv = createConversation({
          name,
          tmuxSession,
          cwd,
          issueId,
          claudeSessionId,
          title,
          titleSource: message ? 'auto' : 'default',
          titleSeed: title,
          model,
          effort,
          harness,
        });
        getEventStore().emitOnly({
          type: 'conversation.created',
          timestamp: new Date().toISOString(),
          payload: { conversationName: name },
        });

        // Spawn the tmux session, wait for the runtime to render, and deliver
        // the initial message in the BACKGROUND. The POST returns as soon as
        // the DB row exists so the client can both render AND select the new
        // conversation immediately — previously the response was held for the
        // whole spawn + up-to-30s ready wait, so the conversation appeared in
        // the list but could not be auto-opened until spawn finished.
        void (async () => {
          try {
            await spawnConversationSession(tmuxSession, cwd, claudeSessionId, model, effort, issueId, false, harness);
            console.log(`[conversations] tmux session ${tmuxSession} spawned, sessionId: ${claudeSessionId}`);

            await waitForConversationRuntimeReady(tmuxSession, harness, 'spawn');

            // If a message was provided, send it now that the runtime is ready.
            if (message) {
              await deliverAgentMessage(tmuxSession, message, 'conversation-message', resolveConversationDeliveryMethod(conv));
            }
          } catch (spawnErr: unknown) {
            const msg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
            console.error(`[conversations] background spawn failed for ${tmuxSession}: ${msg}`);
            updateSpawnError(name, msg);
            getEventStore().emitOnly({
              type: 'conversation.created',
              timestamp: new Date().toISOString(),
              payload: { conversationName: name },
            });
          }
        })();

        // Generate AI title in background (non-blocking)
        if (message) {
          void generateAiTitle(name, message).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[TITLE-GEN-FAILED] AI title generation FAILED for "${name}" — NO RETRY, NO FALLBACK:`, msg);
          });
        }

        // sessionAlive is false at response time — the tmux session spawns in
        // the background task above. The list query and terminal panel both
        // pick up liveness on their own once the session exists.
        return jsonResponse({ ...conv, sessionAlive: false }, { status: 201 });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] create conversation failed:', msg);
        return jsonResponse({ error: msg || 'Internal server error' }, { status: 500 });
      }
    });
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
    return yield* Effect.promise(async () => {
      try {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }

        await stopConversationRuntime(conv, name);
        markConversationEnded(name);
        // Fire-and-forget cleanup after a brief pause for in-flight JSONL writes.
        // Do NOT await — attachment pruning can read the entire JSONL and must
        // not block the HTTP response critical path.
        void (async () => {
          await new Promise((r) => setTimeout(r, 500));
          await cleanupUnreferencedConversationAttachments({ name: conv.name, sessionFile: (conv as { sessionFile?: string | null }).sessionFile ?? null });
        })();

        return jsonResponse({ success: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] stop conversation failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
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
    return yield* Effect.promise(async () => {
    try {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }

        // Allow model/effort override from request body; fall back to stored values
        const model = typeof body['model'] === 'string' && body['model'].trim()
          ? body['model'].trim()
          : (conv.model ?? undefined);
        const effort = typeof body['effort'] === 'string' && body['effort'].trim()
          ? body['effort'].trim()
          : (conv.effort ?? undefined);

        // Reattach only when the harness process is genuinely alive. The tmux
        // session existing is NOT sufficient: the launcher's keep-alive loop
        // (`while true; do sleep 60; done`) outlives Claude, so a crashed/exited
        // session lingers as a "corpse" with the same name. Reattaching to that
        // drops the user into a dead shell loop. When Claude is alive we
        // reattach (continue the same session); when it's a corpse we fall
        // through to the respawn branch, which relaunches `claude --resume
        // <sessionId>` into the SAME session/transcript (no history loss) and
        // kills the stale tmux session first. PAN-1637.
        const claudeAlive = await isHarnessProcessAlive(conv.tmuxSession);

        if (claudeAlive) {
          // Reattach: just update last_attached_at and mark active
          updateLastAttached(name);
          markConversationActive(name);
          return jsonResponse({ ...conv, status: 'active', reattached: true });
        }

        // Respawn: resume the previous Claude Code session using --resume
        // Resume must never mutate the JSONL — `claude --resume` loads the full raw
        // transcript. Auto-compaction here would fork the conversation (PAN-802).
        const oldSessionId = conv.claudeSessionId;
        // Harness is PINNED per conversation. A resume must never re-derive it
        // from the model — that silently flipped Pi conversations to Claude Code
        // and orphaned their transcripts (P0, 2026-05-14). Changing the runtime
        // for an existing conversation only happens through the explicit
        // switch-model path, which converts the transcript format.
        const harness: RuntimeName = conv.harness ?? 'claude-code';
        const modelChanged = !!model && model !== conv.model;

        if (!(await validateCwdContainment(conv.cwd))) {
          return jsonResponse({ error: 'Invalid cwd' }, { status: 400 });
        }

        // Validate model before persisting so invalid values never reach the DB.
        if (model && modelChanged && !SAFE_MODEL_PATTERN.test(model)) {
          return jsonResponse({ error: 'Invalid model' }, { status: 400 });
        }

        // Persist the new model so the dropdown reflects what we're respawning
        // with. Harness is unchanged on resume — no write needed.
        if (model && modelChanged) setConversationModel(name, model);

        // Resume only if the transcript actually exists. A conversation with a
        // session id but no resolvable file means its history was lost or
        // orphaned (e.g. an earlier bad harness flip) — log it loudly rather
        // than silently `--resume`-ing into a "No conversation found" error.
        let canResume = !!oldSessionId;
        if (oldSessionId) {
          const resumeFile = await resolveSessionFile(conv);
          if (!resumeFile || !existsSync(resumeFile)) {
            canResume = false;
            console.error(
              `[conversations] SESSION-LOST ${name} harness=${harness} ` +
              `claudeSessionId=${oldSessionId} resolved=${resumeFile ?? 'null'} — ` +
              `resuming with a fresh session`,
            );
          }
        }

        // Mark the session as mid-respawn so terminal WS reconnects landing
        // in the tmux-down window don't get a fatal 4404. The tmux session
        // is already dead here (sessionAlive was false) — this guards the
        // window between now and `waitForTmuxSession` returning.
        const respawn = markRespawnPending(conv.tmuxSession);
        try {
          await spawnConversationSession(conv.tmuxSession, conv.cwd, oldSessionId ?? randomUUID(), model, effort, conv.issueId ?? undefined, canResume, harness);
          await waitForTmuxSession(conv.tmuxSession);
          await waitForConversationRuntimeReady(conv.tmuxSession, harness, 'respawn');

          markConversationActive(name);
          return jsonResponse({ ...conv, status: 'active', model: model ?? conv.model, harness, reattached: false, sessionAlive: true });
        } finally {
          respawn.done();
        }
      }    catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] resume conversation failed:', msg);
        return jsonResponse({ error: msg || 'Internal server error' }, { status: 500 });
        }})
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

// Cache specialist session file lookups to avoid O(n) directory scans.
// TTL ensures restarted sessions (new UUID → new JSONL) don't serve stale data.
const SPECIALIST_SESSION_CACHE_TTL_MS = 10_000;
const specialistSessionFileCache = new Map<string, { path: string; timestamp: number }>();
const SPECIALIST_SESSION_CACHE_MAX = 50;

function getSpecialistSessionCache(name: string): string | undefined {
  const entry = specialistSessionFileCache.get(name);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > SPECIALIST_SESSION_CACHE_TTL_MS) {
    specialistSessionFileCache.delete(name);
    return undefined;
  }
  return entry.path;
}

function setSpecialistSessionCache(name: string, sessionFile: string): void {
  specialistSessionFileCache.set(name, { path: sessionFile, timestamp: Date.now() });
  if (specialistSessionFileCache.size > SPECIALIST_SESSION_CACHE_MAX) {
    const firstKey = specialistSessionFileCache.keys().next().value;
    if (firstKey !== undefined) {
      specialistSessionFileCache.delete(firstKey);
    }
  }
}

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
      try {
        const conv = getConversationByName(name);

        // Fall back to specialist session file when name is a specialist tmux session
        // (e.g. specialist-overdeck-merge-agent) and not in the conversations DB.
        let sessionFile: string | null | undefined = conv ? await resolveSessionFile(conv) : undefined;
        if (!conv) {
          const cached = getSpecialistSessionCache(name);
          if (cached) {
            sessionFile = cached;
          } else if (/^(specialist-|agent-|planning-|strike-|inspect-)|^(flywheel-orchestrator|conv-flywheel-orchestrator)$/.test(name)) {
            // Non-claude harnesses (no Claude session exists): the transcript
            // is the harness's own JSONL under the per-agent dir. Codex
            // (PAN-1805) writes a rollout under CODEX_HOME; pi/kimi (PAN-1908)
            // writes a timestamped session JSONL — work agents put it in the
            // agent-dir root, conversations in the sessions/ subdir.
            try {
              const agentHarness = await resolveAgentHarness(name);
              const agentBehavior = getHarnessBehavior(agentHarness);
              if (agentBehavior.transcriptKind === 'codex-rollout-jsonl') {
                const rollout = await resolveCodexRolloutPath(name);
                if (rollout) {
                  sessionFile = rollout;
                  setSpecialistSessionCache(name, rollout);
                }
              } else if (agentBehavior.transcriptKind === 'ohmypi-jsonl') {
                const piSession = await resolvePiSessionPath(name);
                if (piSession) {
                  sessionFile = piSession;
                  setSpecialistSessionCache(name, piSession);
                }
              }
            } catch { /* fall through to the Claude lookup */ }
            // Resolve JSONL via the unified session-id lookup chain
            // (session.id file → sessions.json → runtime state) in
            // ~/.overdeck/agents/<name>/. Covers work agents, planning
            // agents, and all specialist types (reviewers, test, merge).
            if (!sessionFile) {
              try {
                const claudeSessionId = await resolveClaudeSessionId(name);
                if (claudeSessionId && SAFE_SESSION_ID_PATTERN.test(claudeSessionId)) {
                  const claudeProjects = join(homedir(), '.claude', 'projects');
                  const dirs = await readdir(claudeProjects);
                  const SAFE_DIR_PATTERN = /^[a-zA-Z0-9_.-]+$/;
                  const candidates = dirs
                    .filter((dir) => SAFE_DIR_PATTERN.test(dir))
                    .map((dir) => join(claudeProjects, dir, `${claudeSessionId}.jsonl`));
                  const STAT_BATCH_SIZE = 50;
                  let found: string | null = null;
                  for (let i = 0; i < candidates.length && !found; i += STAT_BATCH_SIZE) {
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
                    found = checks.find((c): c is string => c !== null) ?? null;
                  }
                  if (found) {
                    sessionFile = found;
                    setSpecialistSessionCache(name, found);
                  }
                }
              } catch { /* session resolution failed */ }
            }
          }
          if (!sessionFile) {
            return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
          }
        }

        if (!sessionFile) {
          // For a LIVE claude-code conversation the session file is deterministic
          // from the launcher's pinned --session-id (resolveSessionFile). If it's
          // unresolved, the panel would otherwise silently show an empty or wrong
          // transcript — surface it loudly instead so it gets attention
          // (resolveSessionFile already screamed server-side). Returned with a
          // 200 + `error` field so it flows through the normal data path and the
          // panel can render a banner rather than a generic fetch failure.
          //
          // codex/pi conversations write their transcript JSONL only on the first
          // turn, so a null session file before then is the expected empty state,
          // not an error — they fall through to the benign empty-messages response.
          if (shouldReportUnresolvedLiveSession(conv)) {
            return jsonResponse({
              messages: [],
              workLog: [],
              streaming: false,
              error:
                `Could not resolve the live session for this conversation — its launcher pins ` +
                `no --session-id and no session is recorded. The transcript cannot be shown ` +
                `reliably; this needs attention.`,
            });
          }
          // Ended/legacy conversation, or a codex/pi conversation that has not yet
          // written its first-turn transcript — genuinely empty.
          return jsonResponse({ messages: [], workLog: [], streaming: false });
        }

        try {
          // Always parse the full file — compact boundaries render as visual
          // dividers in MessagesTimeline; truncating at them hides the actual
          // conversation content (root cause of empty reviewer Conversation tab).
          const result = await getCachedMessages(sessionFile, false);

          // Cache cost + tokens in DB so the conversation list can show them without re-parsing
          if (conv && (result.totalCost > 0 || result.totalTokens > 0)) {
            updateConversationCost(name, result.totalCost, result.totalTokens);
          }

          let contextUsage = null;
          if (conv) {
            try {
              contextUsage = await computeContextUsage(sessionFile, conv.model);
            } catch {
              contextUsage = null;
            }
          }

          return jsonResponse({
            messages: result.messages,
            workLog: result.workLog,
            streaming: result.streaming,
            totalCost: result.totalCost,
            totalTokens: result.totalTokens,
            proposedPlan: result.proposedPlan,
            compactBoundaries: (result.compactBoundaries?.length ?? 0) > 0 ? result.compactBoundaries : undefined,
            compacting: isCompacting(sessionFile) || undefined,
            contextUsage,
          });
        } catch (parseErr: unknown) {
          // File may not exist yet — Claude Code is still starting up.
          // Return empty messages rather than 500.
          const code = (parseErr as { code?: string })?.code;
          if (code === 'ENOENT') {
            return jsonResponse({ messages: [], workLog: [], streaming: false });
          }
          throw parseErr;
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] load messages failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
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
      try {
        const conv = getConversationByName(name) ?? getConversationByClaudeSessionId(name);
        if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });

        const sessionFile = await resolveSessionFile(conv);
        if (!sessionFile) return jsonResponse({ error: 'Conversation transcript not found' }, { status: 404 });

        const locator = await resolveConversationMessageLocator(sessionFile, byteOffset);
        if (!locator) return jsonResponse({ error: 'Message not found for byteOffset' }, { status: 404 });
        return jsonResponse(locator);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] resolve message locator failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
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
        return await handleConversationMessage(name, body);
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
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }
        const deliveryMethod = body['deliveryMethod'] ?? body['method'];
        if (deliveryMethod !== 'auto' && deliveryMethod !== 'channels' && deliveryMethod !== 'tmux' && deliveryMethod !== null) {
          return jsonResponse({ error: "deliveryMethod must be 'auto', 'channels', 'tmux', or null" }, { status: 400 });
        }
        updateConversationDeliveryMethod(name, deliveryMethod as 'auto' | 'channels' | 'tmux' | null);
        return jsonResponse({ ok: true, deliveryMethod });
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

const MAX_TITLE_LENGTH = 200;

export function patchConversationTitle(
  name: string,
  body: Record<string, unknown>,
): { status: number; body: { success: true } | { error: string } } {
  const conv = getConversationByName(name);
  if (!conv) {
    return { status: 404, body: { error: 'Conversation not found' } };
  }

  if (typeof body.title === 'string' && body.title.trim()) {
    const trimmed = body.title.trim();
    if (trimmed.length > MAX_TITLE_LENGTH) {
      return { status: 400, body: { error: `Title exceeds maximum length of ${MAX_TITLE_LENGTH} characters` } };
    }
    // User explicitly renamed → mark as 'manual' so AI won't auto-replace
    updateConversationTitle(name, trimmed, 'manual');
  }

  return { status: 200, body: { success: true } };
}

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
    return yield* Effect.promise(async () => {
      try {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }

        await stopConversationRuntime(conv, name);
        markConversationEnded(name);
        archiveConversation(name);
        removeFavorite('conversation', name);
        invalidateFavoritesCache();
        await cleanupConversationAttachments(name);

        return jsonResponse({ success: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] delete conversation failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);

// ─── Route: POST /api/conversations/:name/archive ───────────────────────────

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
      try {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }
        if (conv.archivedAt) {
          return jsonResponse({ error: 'Conversation is already archived' }, { status: 400 });
        }

        await stopConversationRuntime(conv, name);

        // Mark as ended and archived, unfavorite if starred
        markConversationEnded(name);
        archiveConversation(name);
        removeFavorite('conversation', name);
        invalidateFavoritesCache();
        // Unconditionally remove all attachments — archiving is permanent and
        // unsent paste uploads should not leak.
        await cleanupConversationAttachments(name);

        return jsonResponse({ success: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] archive conversation failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
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
      try {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }
        if (!conv.archivedAt) {
          return jsonResponse({ error: 'Conversation is not archived' }, { status: 400 });
        }

        unarchiveConversation(name);
        return jsonResponse({ success: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] unarchive conversation failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
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
    return yield* Effect.promise(async () => {
      try {
        const allConvs = listConversations();
        // Filter to conversations with a live tmux session — use a single
        // listSessionNamesAsync() call instead of N subprocess spawns.
        const liveSessionNames = new Set(await Effect.runPromise(listSessionNames()));
        const convs = allConvs.filter((c) => liveSessionNames.has(c.tmuxSession));
        const results: { name: string; model: string | null; status: string }[] = [];

        for (const conv of convs) {
          // Mark mid-respawn so terminal WS reconnects don't 4404 in the
          // kill→spawn gap. Cleared in finally so failures still release it.
          const respawn = markRespawnPending(conv.tmuxSession);
          try {
            // Kill existing tmux session
            await Effect.runPromise(killSession(conv.tmuxSession).pipe(Effect.catch(() => Effect.succeed(undefined))));

            // Re-spawn with stored model
            const oldSessionId = conv.claudeSessionId;
            const sessionFileForResume = await resolveSessionFile(conv);
            const canResume = !!oldSessionId && !!sessionFileForResume && existsSync(sessionFileForResume);
            const harness = await resolveAllowedHarness(conv.harness, conv.model);
            await spawnConversationSession(
              conv.tmuxSession,
              conv.cwd,
              oldSessionId ?? randomUUID(),
              conv.model ?? undefined,
              conv.effort ?? undefined,
              conv.issueId ?? undefined,
              canResume,
              harness,
            );
            setConversationHarness(conv.name, harness);
            markConversationActive(conv.name);
            results.push({ name: conv.name, model: conv.model, status: 'restarted' });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[conversations] Failed to restart ${conv.name}:`, msg);
            results.push({ name: conv.name, model: conv.model, status: 'failed' });
          } finally {
            respawn.done();
          }
        }

        console.log(`[conversations] Restarted ${results.filter(r => r.status === 'restarted').length}/${convs.length} conversations`);
        return jsonResponse({ restarted: results.length, results });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] restart conversations failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
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
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
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
      try {
        const conv = getConversationByName(name) ?? (/^\d+$/.test(name) ? getConversationById(parseInt(name, 10)) : null);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }

        const sessionFile = await resolveSessionFile(conv);
        if (!sessionFile || !existsSync(sessionFile)) {
          return jsonResponse({ summaries: [] });
        }

        // Parse JSONL for file-modifying tool_use blocks per turn.
        // Works for all conversation types: devroot, in-repo, and worktree.
        // Per-turn git diffs use findCommitAtTime(repoRoot, conv.createdAt) so they
        // capture committed changes too, not just working-tree modifications.
        const parsed = await getCachedMessages(sessionFile, false);
        const { fileEditsByAssistantId } = parsed;
        if (!fileEditsByAssistantId || fileEditsByAssistantId.size === 0) {
          return jsonResponse({ summaries: [] });
        }

        // Group file paths by git repo root, then compute per-file diffs
        const summaries: Array<{
          turnId: string;
          completedAt: string;
          status: string;
          files: TurnDiffFileChange[];
          assistantMessageId: string;
        }> = [];

        // Build a set of assistant messages for timestamp lookup
        const assistantMessages = parsed.messages.filter(m => m.role === 'assistant');
        const assistantById = new Map(assistantMessages.map(m => [m.id, m]));

        // Cache git repo root and base-commit lookups (both keyed by repo root)
        const repoRootCache = new Map<string, string | null>();
        const baseCommitCache = new Map<string, string | null>();

        for (const [assistantId, edits] of fileEditsByAssistantId) {
          const asstMsg = assistantById.get(assistantId);
          const completedAt = asstMsg?.completedAt ?? asstMsg?.createdAt ?? new Date().toISOString();

          // Group files by their git repo
          const filesByRepo = new Map<string, string[]>();

          for (const edit of edits) {
            const filePath = edit.filePath;
            // Find git repo root for this file
            const dir = filePath.substring(0, filePath.lastIndexOf('/')) || filePath;
            let repoRoot = repoRootCache.get(dir);
            if (repoRoot === undefined) {
              try {
                const { stdout } = await promisify(exec)(
                  'git rev-parse --show-toplevel',
                  { cwd: dir, encoding: 'utf-8' },
                );
                repoRoot = stdout.trim();
              } catch {
                repoRoot = null;
              }
              repoRootCache.set(dir, repoRoot);
            }
            if (!repoRoot) continue;

            // Convert absolute path to repo-relative
            const relativePath = filePath.startsWith(repoRoot + '/')
              ? filePath.slice(repoRoot.length + 1)
              : filePath;

            let repoFiles = filesByRepo.get(repoRoot);
            if (!repoFiles) {
              repoFiles = [];
              filesByRepo.set(repoRoot, repoFiles);
            }
            if (!repoFiles.includes(relativePath)) {
              repoFiles.push(relativePath);
            }
          }

          // Compute diffs per repo and merge.
          // Diff against the conversation's base commit (the commit that existed just before
          // the conversation started) so that committed changes are included in the summary —
          // not just uncommitted working-tree changes.
          const allFiles: TurnDiffFileChange[] = [];
          for (const [repoRoot, filePaths] of filesByRepo) {
            try {
              // Resolve base commit once per repo root
              if (!baseCommitCache.has(repoRoot)) {
                baseCommitCache.set(repoRoot, await Effect.runPromise(findCommitAtTime(repoRoot, conv.createdAt)));
              }
              const baseCommit = baseCommitCache.get(repoRoot) ?? null;

              let diffs: TurnDiffFileChange[];
              if (baseCommit) {
                // Diff specific files against the pre-conversation base commit.
                // This captures changes whether committed or still in the working tree.
                const { stdout: numstat } = await promisify(exec)(
                  `git diff --numstat --no-color ${baseCommit} -- ${filePaths.map(p => JSON.stringify(p)).join(' ')}`,
                  { cwd: repoRoot, encoding: 'utf-8' },
                );
                const { stdout: nameStatus } = await promisify(exec)(
                  `git diff --name-status --no-color ${baseCommit} -- ${filePaths.map(p => JSON.stringify(p)).join(' ')}`,
                  { cwd: repoRoot, encoding: 'utf-8' },
                );
                const statusMap = new Map<string, string>();
                for (const line of nameStatus.split('\n')) {
                  if (!line.trim()) continue;
                  const parts = line.split('\t');
                  if (parts.length >= 2) statusMap.set(parts[parts.length - 1], parts[0]);
                }
                diffs = [];
                for (const line of numstat.split('\n')) {
                  if (!line.trim()) continue;
                  const [addStr, delStr, ...pathParts] = line.split('\t');
                  const path = pathParts.join('\t');
                  if (!path) continue;
                  diffs.push({ path, kind: statusMap.get(path), additions: parseInt(addStr, 10) || 0, deletions: parseInt(delStr, 10) || 0 });
                }
              } else {
                // No base commit (repo too new) — fall back to working-tree-vs-HEAD diff
                diffs = await Effect.runPromise(diffFilesAgainstHead(repoRoot, filePaths));
              }
              allFiles.push(...diffs);
            } catch {
              // git diff failed — skip this repo
            }
          }

          if (allFiles.length > 0) {
            summaries.push({
              turnId: `conv-turn-${assistantId}`,
              completedAt,
              status: 'completed',
              files: allFiles,
              assistantMessageId: assistantId,
            });
          }
        }

        return jsonResponse({ summaries });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] diffs failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
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
      try {
        const conv = getConversationByName(name);
        if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });

        const cwd = conv.cwd;
        const isInRepo = existsSync(join(cwd, '.git'));

        if (isInRepo) {
          const baseCommit = await Effect.runPromise(findCommitAtTime(cwd, conv.createdAt));
          if (!baseCommit) return jsonResponse({ diff: '' });
          const diff = await Effect.runPromise(diffPatchSinceCommit(cwd, baseCommit));
          return jsonResponse({ diff });
        }

        // Devroot: aggregate all file edits across all turns
        const sessionFile = await resolveSessionFile(conv);
        if (!sessionFile || !existsSync(sessionFile)) return jsonResponse({ diff: '' });

        const parsed = await getCachedMessages(sessionFile, false);
        const { fileEditsByAssistantId } = parsed;
        if (!fileEditsByAssistantId || fileEditsByAssistantId.size === 0) return jsonResponse({ diff: '' });

        const repoRootCache = new Map<string, string | null>();
        const filesByRepo = new Map<string, string[]>();

        for (const [, edits] of fileEditsByAssistantId) {
          for (const edit of edits) {
            const dir = edit.filePath.substring(0, edit.filePath.lastIndexOf('/')) || edit.filePath;
            let repoRoot = repoRootCache.get(dir);
            if (repoRoot === undefined) {
              try {
                const { stdout } = await promisify(exec)('git rev-parse --show-toplevel', { cwd: dir, encoding: 'utf-8' });
                repoRoot = stdout.trim();
              } catch { repoRoot = null; }
              repoRootCache.set(dir, repoRoot);
            }
            if (!repoRoot) continue;
            const relativePath = edit.filePath.startsWith(repoRoot + '/') ? edit.filePath.slice(repoRoot.length + 1) : edit.filePath;
            let repoFiles = filesByRepo.get(repoRoot);
            if (!repoFiles) { repoFiles = []; filesByRepo.set(repoRoot, repoFiles); }
            if (!repoFiles.includes(relativePath)) repoFiles.push(relativePath);
          }
        }

        const patches: string[] = [];
        for (const [repoRoot, filePaths] of filesByRepo) {
          try {
            const patch = await Effect.runPromise(diffPatchFilesAgainstHead(repoRoot, filePaths));
            if (patch) patches.push(patch);
          } catch { /* file may have been committed */ }
        }

        return jsonResponse({ diff: patches.join('\n') });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] diff full failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
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
      try {
        const conv = getConversationByName(name) ?? (/^\d+$/.test(name) ? getConversationById(parseInt(name, 10)) : null);
        if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });

        const cwd = conv.cwd;
        const isInRepo = existsSync(join(cwd, '.git'));

        if (isInRepo) {
          // For in-repo conversations, try single diff since conversation start.
          // Falls through to per-turn JSONL path if no base commit (cwd is in a repo
          // with no commits before the conversation started).
          const baseCommit = await Effect.runPromise(findCommitAtTime(cwd, conv.createdAt));
          if (baseCommit) {
            const diff = await Effect.runPromise(diffPatchSinceCommit(cwd, baseCommit, fileFilter));
            return jsonResponse({ turnId, diff });
          }
        }

        // Devroot: extract assistant ID from turnId (format: conv-turn-<assistantId>)
        const assistantId = turnId.startsWith('conv-turn-') ? turnId.slice('conv-turn-'.length) : turnId;
        const sessionFile = await resolveSessionFile(conv);
        if (!sessionFile || !existsSync(sessionFile)) return jsonResponse({ diff: '' });

        const parsed = await getCachedMessages(sessionFile, false);
        const edits = parsed.fileEditsByAssistantId?.get(assistantId);
        if (!edits || edits.length === 0) return jsonResponse({ diff: '' });

        const repoRootCache = new Map<string, string | null>();
        const filesByRepo = new Map<string, string[]>();

        for (const edit of edits) {
          const dir = edit.filePath.substring(0, edit.filePath.lastIndexOf('/')) || edit.filePath;
          let repoRoot = repoRootCache.get(dir);
          if (repoRoot === undefined) {
            try {
              const { stdout } = await promisify(exec)('git rev-parse --show-toplevel', { cwd: dir, encoding: 'utf-8' });
              repoRoot = stdout.trim();
            } catch { repoRoot = null; }
            repoRootCache.set(dir, repoRoot);
          }
          if (!repoRoot) continue;
          const relativePath = edit.filePath.startsWith(repoRoot + '/') ? edit.filePath.slice(repoRoot.length + 1) : edit.filePath;
          if (fileFilter && relativePath !== fileFilter) continue;
          let repoFiles = filesByRepo.get(repoRoot);
          if (!repoFiles) { repoFiles = []; filesByRepo.set(repoRoot, repoFiles); }
          if (!repoFiles.includes(relativePath)) repoFiles.push(relativePath);
        }

        const baseCommitByRepo = new Map<string, string | null>();
        const patches: string[] = [];
        for (const [repoRoot, filePaths] of filesByRepo) {
          try {
            if (!baseCommitByRepo.has(repoRoot)) {
              baseCommitByRepo.set(repoRoot, await Effect.runPromise(findCommitAtTime(repoRoot, conv.createdAt)));
            }
            const baseCommit = baseCommitByRepo.get(repoRoot) ?? null;
            let patch: string;
            if (baseCommit) {
              const { stdout } = await promisify(exec)(
                `git diff --patch --minimal --no-color ${baseCommit} -- ${filePaths.map(p => JSON.stringify(p)).join(' ')}`,
                { cwd: repoRoot, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
              );
              patch = stdout;
            } else {
              patch = await Effect.runPromise(diffPatchFilesAgainstHead(repoRoot, filePaths));
            }
            if (patch) patches.push(patch);
          } catch { /* file may have been committed or repo unavailable */ }
        }

        return jsonResponse({ turnId, diff: patches.join('\n') });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] diff turn failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
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
      try {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }
        if (retitleInFlight.has(name)) {
          return jsonResponse(
            { error: 'A title regeneration is already running for this conversation' },
            { status: 409 },
          );
        }
        const sessionFile = await resolveSessionFile(conv);
        if (!sessionFile || !existsSync(sessionFile)) {
          return jsonResponse({ error: 'Conversation has no transcript yet' }, { status: 400 });
        }
        const { messages } = await getCachedMessages(sessionFile, false);
        const transcript = serializeConversationTranscript(messages);
        if (!transcript.trim()) {
          return jsonResponse(
            { error: 'Conversation has no messages to summarize yet' },
            { status: 400 },
          );
        }

        retitleInFlight.add(name);
        try {
          const model = configuredTitleModel();
          console.log(`[claude-invoke] purpose=conversation-retitle | model=${model} | conversation=${name} | transcriptChars=${transcript.length}`);
          let title: string;
          try {
            title = await summarizeTranscriptTitle(transcript, model, EXPLICIT_RETITLE_TIMEOUT_MS);
          } catch (error: unknown) {
            if (!isClaudeInvocationTimeout(error)) {
              throw error;
            }
            title = fallbackTranscriptTitle(transcript);
            if (!title) {
              throw error;
            }
            console.warn(`[conversations] retitle timed out for "${name}"; using deterministic fallback title "${title}"`);
          }
          if (!title) {
            return jsonResponse({ error: 'Title model returned an empty result' }, { status: 502 });
          }
          // Explicit user action — override any prior title, including manual ones.
          updateConversationTitle(name, title, 'ai');
          console.log(`[claude-invoke] SUCCESS purpose=conversation-retitle | conversation=${name} | title="${title}"`);
          return jsonResponse({ title });
        } finally {
          retitleInFlight.delete(name);
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[conversations] retitle failed for "${name}":`, msg);
        return jsonResponse({ error: `Failed to regenerate title: ${msg}` }, { status: 500 });
      }
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
      try {
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }
        const url = new URL(request.url, 'http://localhost');
        const forceRefresh = url.searchParams.get('refresh') === '1';

        const sessionFile = await resolveSessionFile(conv);
        if (!sessionFile || !existsSync(sessionFile)) {
          return jsonResponse({ summary: null, messageCount: 0, generatedAt: null });
        }
        const { size } = await stat(sessionFile);
        const cached = aboutSummaryCache.get(name);
        if (!forceRefresh && cached && cached.transcriptSize === size) {
          return jsonResponse({ ...cached.data, cached: true });
        }

        const { messages } = await getCachedMessages(sessionFile, false);
        const conversational = messages.filter(
          (m) => m.role !== 'system' && typeof m.text === 'string' && m.text.trim().length > 0,
        );
        if (conversational.length === 0) {
          return jsonResponse({ summary: null, messageCount: 0, generatedAt: null });
        }

        const transcript = serializeConversationTranscript(messages);
        const aboutModel = configuredTitleModel();
        console.log(`[claude-invoke] purpose=conversation-about | model=${aboutModel} | conversation=${name} | transcriptChars=${transcript.length}`);
        const summary = await summarizeTranscriptAbout(transcript, aboutModel);
        if (!summary) {
          return jsonResponse({ error: 'Summary model returned an empty result' }, { status: 502 });
        }

        const data: ConversationAboutSummary = {
          summary,
          messageCount: conversational.length,
          generatedAt: new Date().toISOString(),
        };
        aboutSummaryCache.set(name, { transcriptSize: size, data });
        if (aboutSummaryCache.size > ABOUT_SUMMARY_CACHE_MAX) {
          const firstKey = aboutSummaryCache.keys().next().value;
          if (firstKey !== undefined) aboutSummaryCache.delete(firstKey);
        }
        console.log(`[claude-invoke] SUCCESS purpose=conversation-about | conversation=${name} | summaryChars=${summary.length}`);
        return jsonResponse({ ...data, cached: false });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[conversations] about summary failed for "${name}":`, msg);
        return jsonResponse({ error: 'Failed to summarize conversation' }, { status: 500 });
      }
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
