import { jsonResponse } from "../http-helpers.js";
import { buildChildEnv, buildChildEnvWithoutTmux, BLANKED_PROVIDER_ENV } from '../../../lib/child-env.js';
import { getClaudePermissionFlagsString, resolvePermissionMode, DSP_FLAG, BYPASS_PERMISSION_MODE } from '../../../lib/claude-permissions.js';
/**
 * Conversations route module — Effect HttpRouter.Layer (PAN-416)
 *
 * Implements conversation session management endpoints:
 *   GET    /api/conversations                — list all conversations
 *   POST   /api/conversations                — spawn a new conversation
 *   POST   /api/conversations/:name/stop     — kill session, mark ended (preserves row)
 *   POST   /api/conversations/:name/archive  — kill session and hide from list
 *   POST   /api/conversations/:name/resume   — reattach or respawn
 *
 * Conversations are NEVER deleted from the database. The only removal verb is `archive`.
 */

import { randomUUID } from 'node:crypto';
import { exec, spawn } from 'node:child_process';
import { existsSync, createReadStream } from 'node:fs';
import { mkdir, writeFile, readFile, stat, realpath, rename, rm, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

import { resolveClaudeSessionId } from './jsonl-resolver.js';
import { validateOrigin } from './origin-validation.js';
import { getProject } from '../../../lib/projects.js';
import {
  findCommitAtTime,
  diffSinceCommit,
  diffFilesAgainstHead,
  diffPatchSinceCommit,
  diffPatchFilesAgainstHead,
  type TurnDiffFileChange,
} from '../../../lib/checkpoint/checkpoint-manager.js';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import * as Multipart from 'effect/unstable/http/Multipart';

import {
  listConversations,
  getConversationByName,
  getConversationById,
  createConversation,
  markConversationEnded,
  markConversationActive,
  updateLastAttached,
  updateConversationTitle,
  updateConversationCost,
  setConversationModel,
  setConversationHarness,
  updateConversationDeliveryMethod,
  backfillConversationModel,
  archiveConversation,
  unarchiveConversation,
  canReplaceTitle,
  listFavoritedIds,
  setFavorite,
  removeFavorite,
  updateForkStatus,
  type Conversation,
} from '../../../lib/database/conversations-db.js';
import {
  sendKeysAsync,
  sendRawKeystrokeAsync,
  MessageDeliveryFailed,
  capturePaneAsync,
  sessionExistsAsync,
  killSessionAsync,
  createSessionAsync,
  setOptionAsync,
  waitForClaudePrompt,
  listSessionNamesAsync,
} from '../../../lib/tmux.js';
import { deliverAgentMessage } from '../../../lib/agents.js';
import {
  getAgentRuntimeBaseCommand,
  getProviderExportsForModel,
  getProviderEnvForModel,
  getProviderAuthMode,
} from '../../../lib/agents.js';
import { canUseHarness } from '../../../lib/harness-policy.js';
import { getProviderForModel } from '../../../lib/providers.js';
import type { RuntimeName } from '../../../lib/runtimes/types.js';
import { piFifoPaths } from '../../../lib/runtimes/pi-fifo.js';
import { generateLauncherScript } from '../../../lib/launcher-generator.js';
import {
  parseConversationMessages,
  parseFromLastCompactBoundary,
  summarizeConversationActivity,
  type ParseState,
} from '../services/conversation-service.js';
import { parsePiConversationMessages } from '../services/pi-conversation-parser.js';
import {
  maybeCompactBeforeRespawn,
  compactConversationNative,
  shouldInterceptManualCompact,
  isCompacting,
} from '../services/conversation-compaction.js';
import { sessionFilePath, encodeClaudeProjectDir } from '../../../lib/paths.js';
import { generateSummaryForFork, generateFallbackSummary, reserveSummaryForkSession, copySessionFromCompactBoundary } from '../../../lib/conversations/summary-fork.js';
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
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 50_000;
const MAX_FILENAME_LENGTH = 255;

/** Quote a string for safe use in a bash script using single-quote wrapping. */
function shellQuote(str: string): string {
  return "'" + str.replace(/'/g, "'\"'\"'") + "'";
}

const SAFE_MODEL_PATTERN = /^[a-zA-Z0-9_.:\/-]+$/;
const SAFE_EFFORT_PATTERN = /^(low|medium|high)$/;
const SAFE_PROJECT_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SAFE_ISSUE_ID_PATTERN = /^[A-Z0-9]+-[0-9]+$/;

async function resolveAllowedHarness(requested: unknown, model?: string | null): Promise<RuntimeName> {
  const harness: RuntimeName = requested === 'pi' || requested === 'claude-code' ? requested : 'claude-code';
  // Conversation runtime only honors non-default harnesses when a concrete model is
  // passed through to getAgentRuntimeBaseCommand(). Without a model,
  // spawnConversationSession() intentionally launches the default Claude Code
  // command, so persist the matching default harness as the effective value.
  if (!model) return 'claude-code';
  const decision = canUseHarness(harness, model, await getProviderAuthMode(model));
  return decision.allowed ? harness : 'claude-code';
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
  if (isPiSessionFile(sessionFile)) {
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
      const mergedCompactBoundaries = cachedResult.compactBoundaries.concat(incremental.compactBoundaries);
      const mergedFileEdits = new Map(cachedResult.fileEditsByAssistantId);
      for (const [k, v] of incremental.fileEditsByAssistantId) {
        const existing = mergedFileEdits.get(k);
        mergedFileEdits.set(k, existing ? [...existing, ...v] : v);
      }
      result = {
        messages: mergedMessages,
        workLog: mergedWorkLog,
        byteOffset: incremental.byteOffset,
        streaming: incremental.streaming,
        totalCost: cachedResult.totalCost + incremental.totalCost,
        pendingToolUse: incremental.pendingToolUse,
        unresolvedResults: incremental.unresolvedResults,
        lastSequence: incremental.lastSequence,
        mtimeMs: incremental.mtimeMs,
        proposedPlan: incremental.proposedPlan ?? cachedResult.proposedPlan,
        compactBoundaries: mergedCompactBoundaries,
        planToolUseIds: incremental.planToolUseIds,
        permissionMode: incremental.permissionMode ?? cachedResult.permissionMode,
        fileEditsByAssistantId: mergedFileEdits,
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
    const output = await capturePaneAsync(tmuxSession, 200);
    if (output.includes('❯')) {
      console.log(`[conversations] Claude Code ready in ${tmuxSession}`);
      return;
    }
    await new Promise<void>((r) => setTimeout(r, 500));
  }
  console.warn(`[conversations] Timed out waiting for Claude Code prompt in ${tmuxSession}`);
}

/**
 * Wait until Pi's TUI has rendered into the tmux pane.
 *
 * Pi TUI mode does not write a ready.json marker (that was an RPC-mode
 * artifact). We instead poll capture-pane for non-empty content, which
 * indicates Pi has drawn at least its title/prompt line. This is the same
 * shape of readiness check we use for Claude Code's interactive prompt.
 */
/**
 * Map a Panopticon model id to the matching Pi-side provider name. Pi has
 * its own provider taxonomy (`pi --list-models`); the IDs differ from our
 * internal {@link getProviderForModel}. Returning `undefined` lets Pi fall
 * back to its registry order.
 *
 * Pi conversations rely on the user's own Pi auth (`~/.pi/agent/auth.json`).
 * We only constrain *which* Pi provider Pi uses; we never inject keys.
 */
function piProviderForModel(modelId: string): string | undefined {
  const provider = getProviderForModel(modelId).name;
  switch (provider) {
    case 'openai':
      return 'openai-codex';
    case 'anthropic':
      return 'anthropic';
    case 'google':
      return 'google';
    case 'minimax':
      return 'minimax';
    case 'zai':
      return 'zai';
    case 'kimi':
      return 'kimi-coding';
    case 'mimo':
      return 'xiaomi';
    default:
      return undefined;
  }
}

async function waitForPiTuiReady(tmuxSession: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await capturePaneAsync(tmuxSession, 10).catch(() => '');
    if (snapshot.trim().length > 0) {
      console.log(`[conversations] Pi TUI ready for ${tmuxSession}`);
      return true;
    }
    await new Promise<void>((r) => setTimeout(r, 250));
  }
  console.warn(`[conversations] Timed out waiting for Pi TUI to render in ${tmuxSession}`);
  return false;
}

async function resolveSessionFile(conv: Conversation): Promise<string | null> {
  // Pi conversations write their own JSONL into the agent's session dir,
  // not into ~/.claude/projects/<dir>/<id>.jsonl. The path uses a per-run
  // timestamped filename, so we resolve by globbing the directory.
  if (conv.harness === 'pi') {
    return resolvePiSessionFile(conv.tmuxSession);
  }
  if (conv.claudeSessionId) {
    return sessionFilePath(conv.cwd, conv.claudeSessionId);
  }
  return null;
}

/**
 * Return the most-recently-written Pi JSONL session file for a conversation,
 * or null if Pi hasn't created one yet (TUI just started, or session reset).
 * The dashboard chat panel uses this to render Pi conversation history.
 */
async function resolvePiSessionFile(tmuxSession: string): Promise<string | null> {
  const sessionDir = join(homedir(), '.panopticon', 'agents', tmuxSession, 'sessions');
  if (!existsSync(sessionDir)) return null;
  try {
    const entries = (await readdir(sessionDir)).filter((name) => name.endsWith('.jsonl'));
    if (entries.length === 0) return null;
    // Filenames are `<iso-timestamp>_<session-id>.jsonl` — newest sorts last.
    entries.sort();
    return join(sessionDir, entries[entries.length - 1]!);
  } catch {
    return null;
  }
}

/** Detect whether a session file path is a Pi conversation JSONL. */
function isPiSessionFile(sessionFile: string): boolean {
  return sessionFile.includes('/.panopticon/agents/') && sessionFile.includes('/sessions/');
}

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

function safeUploadExtension(filename: string, mimeType: string): string {
  const mimeExtension = ALLOWED_UPLOAD_MIME_TYPES.get(mimeType);
  if (!mimeExtension) return '';
  const originalExtension = extname(filename).toLowerCase();
  return originalExtension === mimeExtension ? originalExtension : mimeExtension;
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

  if (shouldInterceptManualCompact(message)) {
    const compactSessionFile = await resolveSessionFile(conv);
    if (!compactSessionFile || !existsSync(compactSessionFile)) {
      return jsonResponse({ error: `No session file found for conversation ${conv.name}` }, { status: 400 });
    }
    const result = await compactConversationNative(compactSessionFile, conv.name);
    return jsonResponse({ ok: true, compacted: true, mode: 'panopticon-native', model: result.model });
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

  // Deliver via deliverAgentMessage so channels eligibility and fallback
  // policy are respected (PAN-1123). For Pi agents this resolves to tmux
  // because channels eligibility requires harness === 'claude-code'.
  try {
    await deliverAgentMessage(
      conv.tmuxSession,
      message,
      'conversation-message',
      conv.deliveryMethod ?? undefined,
    );
  } catch (deliveryErr: unknown) {
    const errMsg = deliveryErr instanceof Error ? deliveryErr.message : String(deliveryErr);
    if (errMsg.includes('MessageDeliveryFailed')) {
      return jsonResponse({ error: errMsg.replace('MessageDeliveryFailed: ', '') }, { status: 503 });
    }
    throw deliveryErr;
  }

  // Generate AI title for conversations created via instant-start (no message at creation)
  if (conv.titleSource === 'default') {
    void generateAiTitle(name, message).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[TITLE-GEN-FAILED] AI title generation FAILED for "${name}" — NO RETRY, NO FALLBACK:`, msg);
    });
  }

  return jsonResponse({ ok: true });
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
  return sessionExistsAsync(sessionName);
}

async function waitForTmuxSession(sessionName: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await sessionExistsAsync(sessionName)) return;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for tmux session ${sessionName}`);
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
// Dashboard-owned compaction is Panopticon-native. We append the compact
// boundary and continuation summary directly to the JSONL so subsequent
// `--resume` calls load only the summarized context forward.

async function spawnConversationSession(
  tmuxSession: string,
  cwd: string,
  claudeSessionId: string,
  model?: string,
  effort?: string,
  issueId?: string,
  resume = false,
  harness: RuntimeName = 'claude-code',
): Promise<void> {
  const stateDir = join(homedir(), '.panopticon', 'conversations', tmuxSession);
  await mkdir(stateDir, { recursive: true });

  const launcherScript = join(stateDir, 'launcher.sh');

  const permissionFlags = getClaudePermissionFlagsString();
  let runtimeCommand = `claude ${permissionFlags}`;
  let providerExportsStr = '';
  let providerEnv: Record<string, string> = {};
  let piFields: {
    harness: 'pi';
    piMode: 'tui';
    piExtensionPath: string;
    piSessionDir: string;
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
    // The DSP literal lives in claude-permissions.ts only; reference it via
    // the imported constants so the lint guard stays tight.
    // NEVER add DSP when the resolved mode is 'auto'. Enterprise users rely
    // on Auto being honored; a silent escalation to bypass is a P0 trust violation.
    const mode = resolvePermissionMode();
    if (mode === 'auto') {
      if (!runtimeCommand.includes('--permission-mode')) {
        runtimeCommand = `${runtimeCommand} --permission-mode auto`;
      }
      // Refuse to run with mixed signals: if the base command already contains DSP
      // while the user explicitly chose Auto, that is a substrate bug that must
      // surface, not be silently downgraded.
      if (runtimeCommand.includes(DSP_FLAG)) {
        throw new Error(
          `Refusing to spawn ${tmuxSession}: resolved mode is 'auto' but base command for model "${model}" contains ${DSP_FLAG}. This is a substrate bug; do not silently bypass user Settings.`,
        );
      }
    } else {
      if (!runtimeCommand.includes(DSP_FLAG)) {
        runtimeCommand = `${runtimeCommand} ${DSP_FLAG}`;
      }
      if (!runtimeCommand.includes('--permission-mode')) {
        runtimeCommand = `${runtimeCommand} --permission-mode ${BYPASS_PERMISSION_MODE}`;
      }
    }
    providerExportsStr = (await getProviderExportsForModel(model)).trim();
    providerEnv = await getProviderEnvForModel(model);

    if (harness === 'pi') {
      // Conversations run Pi in TUI mode (the default Pi terminal UI). This
      // gives users an actual terminal in the tmux pane — they can type
      // directly into Pi, and dashboard-composer messages are delivered via
      // tmux paste-buffer (sendKeysAsync) just like Claude Code. Pi still
      // writes JSONL session files to --session-dir, so cost parsing and
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
        harness: 'pi',
        piMode: 'tui',
        piExtensionPath: resolve(process.cwd(), 'packages/pi-extension/dist/index.js'),
        piSessionDir,
        resumeSessionId: storedPiSessionId || undefined,
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
  if (harness === 'pi' && model) {
    const piProvider = piProviderForModel(model);
    if (piProvider) launcherModel = `${piProvider}/${model}`;
  }

  if (effort && !SAFE_EFFORT_PATTERN.test(effort)) {
    throw new Error('Invalid effort level');
  }

  await writeFile(
    launcherScript,
    generateLauncherScript({
      role: 'work',
      spawnMode: 'conversation',
      workingDir: cwd,
      setTerminalEnv: true,
      unsetProviderEnv: true,
      panopticonEnv: { ...(issueId ? { issueId } : {}), ...(piFields ? { agentId: tmuxSession } : {}) },
      providerExports: providerExportsStr || undefined,
      trapHup: true,
      baseCommand: runtimeCommand,
      model: launcherModel,
      ...(piFields ?? {
        resumeSessionId: resume ? claudeSessionId : undefined,
        sessionId: resume ? undefined : claudeSessionId,
      }),
      extraArgs: !piFields && effort ? `--effort "${effort}"` : undefined,
      keepAlive: true,
      fileMode: 0o700,
    }),
    { mode: 0o700 },
  );

  // Kill any stale session with the same name
  try {
    await killSessionAsync(tmuxSession);
  } catch {
    // ignore missing stale session
  }

  console.log(`[claude-invoke] purpose=conversation-session | model=${model || 'default'} | source=conversations.ts:spawnConversationSession | session=${tmuxSession} | resume=${resume} | command="${runtimeCommand}"`);

  // Spawn the session — blank out provider env vars (ANTHROPIC_BASE_URL,
  // ANTHROPIC_API_KEY, etc.) via tmux -e flags so the launcher script's
  // exports are the sole source of provider configuration. The tmux server
  // inherits the parent's env and -e can only SET, not UNSET, so we set
  // provider vars to empty strings to override stale inherited values.
  try {
    await createSessionAsync(tmuxSession, cwd, `bash ${shellQuote(launcherScript)}`, {
      env: {
        ...BLANKED_PROVIDER_ENV,
        TERM: 'xterm-256color',
      },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === 'ENOENT') {
      throw new Error(
        'tmux is not installed. Install it with: brew install tmux (macOS) or sudo apt-get install tmux (Linux)',
      );
    }
    throw err;
  }

  // Keep session alive when clients disconnect
  await setOptionAsync(tmuxSession, 'destroy-unattached', 'off');
  await setOptionAsync(tmuxSession, 'remain-on-exit', 'on');
}

/**
 * Generate an AI title for a conversation using Claude CLI (T3Code pattern).
 * Runs `claude -p --output-format json --json-schema ...` with the first message
 * as input, then updates the conversation title if it hasn't been manually renamed.
 *
 * Uses the hardcoded haiku model for fast, cheap title generation. No fallback —
 * if generation fails the error is logged and the existing title is kept.
 */
async function generateAiTitle(conversationName: string, firstMessage: string): Promise<void> {
  const conv = getConversationByName(conversationName);
  if (!conv || !canReplaceTitle(conv)) {
    return;
  }

  const titleModel = 'claude-haiku-4-5-20251001';
  console.log(`[claude-invoke] purpose=conversation-title | model=${titleModel} | source=conversations.ts:generateAiTitle | conversation=${conversationName} | promptChars=${firstMessage.length}`);

  const schema = JSON.stringify({
    type: 'object',
    properties: { title: { type: 'string' } },
    required: ['title'],
  });

  const prompt = [
    'You write concise thread titles for coding conversations.',
    'Summarize the user\'s request in 3-8 words.',
    'Avoid quotes, filler, prefixes, and trailing punctuation.',
    '',
    'User message:',
    firstMessage,
  ].join('\n');

  // Build provider-env for the title model (same routing as conversation sessions)
  const providerEnv = await getProviderEnvForModel(titleModel);
  const childEnv = { ...buildChildEnv(), ...providerEnv };

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '-p',
        '--output-format', 'json',
        '--json-schema', schema,
        '--model', titleModel,
      ],
      { env: childEnv },
    );
    let out = '';
    let errOut = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('claude title generation timed out after 30s'));
    }, 30_000);
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (data: string) => { out += data; });
    child.stderr.on('data', (data: string) => { errOut += data; });
    child.on('error', (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(errOut || `claude title generation exited with code ${code}`));
      } else {
        resolve(out);
      }
    });
    try {
      child.stdin.write(prompt, 'utf-8');
      child.stdin.end();
    } catch (err) {
      clearTimeout(timeout);
      child.kill('SIGTERM');
      reject(err);
    }
  });

  // Claude CLI returns { structured_output: { title: "..." }, ... } or { result: "..." }
  const parsed = JSON.parse(stdout.trim());
  const aiTitle = parsed?.structured_output?.title ?? parsed?.title;

  if (!aiTitle || !aiTitle.trim()) {
    console.warn(`[generateAiTitle] Model returned empty title for "${conversationName}"`);
    return;
  }

  // Sanitize: strip quotes, normalize whitespace, take first line only
  const sanitized = aiTitle
    .trim()
    .split(/\r?\n/)[0]
    ?.trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!sanitized) {
    console.warn(`[generateAiTitle] Sanitized title is empty for "${conversationName}"`);
    return;
  }

  // Re-check eligibility (may have been renamed while we waited)
  const freshConv = getConversationByName(conversationName);
  if (!freshConv || !canReplaceTitle(freshConv)) {
    console.log(`[generateAiTitle] Conversation "${conversationName}" was renamed while generating title; skipping update`);
    return;
  }

  updateConversationTitle(conversationName, sanitized, 'ai');
  console.log(`[claude-invoke] SUCCESS purpose=conversation-title | model=${titleModel} | conversation=${conversationName} | outputChars=${sanitized.length}`);
}

// ─── Route: GET /api/conversations ───────────────────────────────────────────

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
        const conversations = listConversations({ limit, offset });
        const favoritedNames = getCachedFavoritedIds();

        // Enrich with live tmux status
        // Grace period removed (PAN-826): POST /api/conversations now waits for
        // Claude to be ready before returning 201, so newly-created conversations
        // are always live by the time they appear in the list.
        const liveSessionNames = new Set(await listSessionNamesAsync());
        const enriched = await Promise.all(conversations.map(async (conv) => {
          const sessionAlive = !conv.forkStatus && liveSessionNames.has(conv.tmuxSession);
          let isWorking = false;
          let currentTool: string | null = null;

          if (sessionAlive) {
            const sf = await resolveSessionFile(conv);
            if (sf && existsSync(sf)) {
              try {
                const summary = await summarizeConversationActivity(sf);
                isWorking = summary.isWorking;
                currentTool = summary.currentTool;
              } catch {
                // JSONL parse failure — fall back to defaults
              }
            }
          }

          const convSf = await resolveSessionFile(conv);
          const compacting = convSf ? isCompacting(convSf) : false;
          return { ...conv, sessionAlive, isWorking, currentTool, isFavorited: favoritedNames.has(conv.name), compacting };
        }));

        return jsonResponse(enriched);
      }    catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] list conversations failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
        }})
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
    const id = Number(params['id']);
    return yield* Effect.promise(async () => {
      try {
        if (isNaN(id)) {
          return jsonResponse({ error: 'Invalid conversation ID' }, { status: 400 });
        }
        const conv = getConversationById(id);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }
        const sessionAlive = await tmuxSessionExists(conv.tmuxSession);
        return jsonResponse({ ...conv, sessionAlive });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] get conversation failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
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
        let cwd = join(homedir(), 'Projects');
        if (projectKey) {
          const projectConfig = getProject(projectKey);
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

        // Spawn tmux session with model + effort + deterministic session ID
        await spawnConversationSession(tmuxSession, cwd, claudeSessionId, model, effort, issueId, false, harness);
        console.log(`[conversations] tmux session ${tmuxSession} spawned, sessionId: ${claudeSessionId}`);

        if (harness === 'pi') {
          await waitForPiTuiReady(tmuxSession);
        } else {
          // Wait for Claude Code to reach its prompt before returning.
          // Bounded by waitForClaudeReady's existing 30s timeout.
          await waitForClaudeReady(tmuxSession);
          console.log(`[conversations] Claude ready in ${tmuxSession}`);
        }

        // If a message was provided (legacy callers), send it now.
        // Both harnesses now use tmux paste-buffer delivery (Pi TUI mode + Claude Code).
        if (message) {
          await sendKeysAsync(tmuxSession, message, 'conversation-message');
        }

        // Title = truncated first message (T3Code pattern), or default
        const MAX_TITLE_LEN = 60;
        const title = message
          ? message.slice(0, MAX_TITLE_LEN) + (message.length > MAX_TITLE_LEN ? '…' : '')
          : 'New conversation';

        // Create DB record
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

        // Generate AI title in background (non-blocking)
        if (message) {
          void generateAiTitle(name, message).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[TITLE-GEN-FAILED] AI title generation FAILED for "${name}" — NO RETRY, NO FALLBACK:`, msg);
          });
        }

        return jsonResponse({ ...conv, sessionAlive: true }, { status: 201 });
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

        await killSessionAsync(conv.tmuxSession).catch(() => {});
        markConversationEnded(name);
        // Fire-and-forget cleanup after a brief pause for in-flight JSONL writes.
        // Do NOT await — attachment pruning can read the entire JSONL and must
        // not block the HTTP response critical path.
        void (async () => {
          await new Promise((r) => setTimeout(r, 500));
          await cleanupUnreferencedConversationAttachments(conv);
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

        const sessionAlive = await tmuxSessionExists(conv.tmuxSession);

        if (sessionAlive) {
          // Reattach: just update last_attached_at and mark active
          updateLastAttached(name);
          markConversationActive(name);
          return jsonResponse({ ...conv, status: 'active', reattached: true });
        }

        // Respawn: resume the previous Claude Code session using --resume
        // Resume must never mutate the JSONL — `claude --resume` loads the full raw
        // transcript. Auto-compaction here would fork the conversation (PAN-802).
        const oldSessionId = conv.claudeSessionId;
        const harness = await resolveAllowedHarness(body['harness'] ?? conv.harness, model ?? conv.model);
        const modelChanged = !!model && model !== conv.model;

        if (!(await validateCwdContainment(conv.cwd))) {
          return jsonResponse({ error: 'Invalid cwd' }, { status: 400 });
        }

        // Validate model before persisting so invalid values never reach the DB.
        if (model && modelChanged && !SAFE_MODEL_PATTERN.test(model)) {
          return jsonResponse({ error: 'Invalid model' }, { status: 400 });
        }

        // Persist the new model/harness so the dropdown reflects what we're respawning with.
        if (model && modelChanged) setConversationModel(name, model);
        setConversationHarness(name, harness);

        await spawnConversationSession(conv.tmuxSession, conv.cwd, oldSessionId ?? randomUUID(), model, effort, conv.issueId ?? undefined, !!oldSessionId, harness);
        await waitForTmuxSession(conv.tmuxSession);
        if (harness === 'pi') {
          await waitForPiTuiReady(conv.tmuxSession);
        } else {
          await waitForClaudePrompt(conv.tmuxSession, 30000).catch(() => false);
        }

        markConversationActive(name);
        return jsonResponse({ ...conv, status: 'active', model: model ?? conv.model, harness, reattached: false, sessionAlive: true });
      }    catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] resume conversation failed:', msg);
        return jsonResponse({ error: msg || 'Internal server error' }, { status: 500 });
        }})
  }),
);

// ─── Route: POST /api/conversations/:name/switch-model ───────────────────────
//
// Kill the current session (if alive), update the model in the DB, and resume.
// Used by the model picker in the sidebar to switch models without going through
// the full resume flow.

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
        const conv = getConversationByName(name);
        if (!conv) {
          return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
        }

        const model = typeof body['model'] === 'string' && body['model'].trim()
          ? body['model'].trim()
          : (conv.model ?? undefined);
        const harness = await resolveAllowedHarness(body['harness'] ?? conv.harness, model);

        // Always kill the existing session first (if alive) so the model change takes effect
        await killSessionAsync(conv.tmuxSession).catch(() => {});

        if (!(await validateCwdContainment(conv.cwd))) {
          return jsonResponse({ error: 'Invalid cwd' }, { status: 400 });
        }

        // Validate model before persisting so invalid values never reach the DB.
        if (model && !SAFE_MODEL_PATTERN.test(model)) {
          return jsonResponse({ error: 'Invalid model' }, { status: 400 });
        }

        // Persist the new model and harness
        if (model) setConversationModel(name, model);
        setConversationHarness(name, harness);

        // Extract the session UUID from the existing session file path
        const oldSessionId = conv.claudeSessionId;

        // Compact (if needed) then respawn with the new model before reporting success.
        const sessionFile = await resolveSessionFile(conv);
        const cwd = conv.cwd;
        const tmuxSession = conv.tmuxSession;
        const effort = conv.effort ?? undefined;
        const issueId = conv.issueId ?? undefined;
        await maybeCompactBeforeRespawn({ sessionFile, cwd, modelChanged: true });
        // Only resume if the session JSONL actually exists — Claude Code's --resume
        // fails with "No conversation found" if the file is missing (e.g., first
        // model switch on a fresh conversation or cross-provider switch).
        const canResume = !!oldSessionId && !!sessionFile && existsSync(sessionFile);
        await spawnConversationSession(tmuxSession, cwd, oldSessionId ?? randomUUID(), model, effort, issueId, canResume, harness);
        await waitForTmuxSession(tmuxSession);
        if (harness === 'pi') {
          await waitForPiTuiReady(tmuxSession);
        } else {
          await waitForClaudePrompt(tmuxSession, 30000).catch(() => false);
        }

        markConversationActive(name);
        return jsonResponse({ ...conv, status: 'active', model, harness, reattached: false, sessionAlive: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] switch model failed:', msg);
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
        // (e.g. specialist-panopticon-cli-merge-agent) and not in the conversations DB.
        let sessionFile: string | null | undefined = conv ? await resolveSessionFile(conv) : undefined;
        if (!conv) {
          const cached = getSpecialistSessionCache(name);
          if (cached) {
            sessionFile = cached;
          } else if (/^(specialist-|agent-|planning-)/.test(name)) {
            // Resolve JSONL via the unified session-id lookup chain
            // (session.id file → sessions.json → runtime state) in
            // ~/.panopticon/agents/<name>/. Covers work agents, planning
            // agents, and all specialist types (reviewers, test, merge).
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
          if (!sessionFile) {
            return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
          }
        }

        if (!sessionFile) {
          // Session file should always be set (deterministic from --session-id).
          // If missing, it's a legacy conversation — return empty.
          return jsonResponse({ messages: [], workLog: [], streaming: false });
        }

        try {
          // Always parse the full file — compact boundaries render as visual
          // dividers in MessagesTimeline; truncating at them hides the actual
          // conversation content (root cause of empty reviewer Conversation tab).
          const result = await getCachedMessages(sessionFile, false);

          // Cache cost in DB so the conversation list can show it without re-parsing
          if (result.totalCost > 0 && conv) {
            updateConversationCost(name, result.totalCost);
          }

          return jsonResponse({
            messages: result.messages,
            workLog: result.workLog,
            streaming: result.streaming,
            totalCost: result.totalCost,
            proposedPlan: result.proposedPlan,
            compactBoundaries: result.compactBoundaries.length > 0 ? result.compactBoundaries : undefined,
            compacting: isCompacting(sessionFile) || undefined,
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
        console.error('[conversations] send message failed:', msg);
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

        // Kill tmux session if still alive
        await killSessionAsync(conv.tmuxSession).catch(() => {});

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
        const liveSessionNames = new Set(await listSessionNamesAsync());
        const convs = allConvs.filter((c) => liveSessionNames.has(c.tmuxSession));
        const results: { name: string; model: string | null; status: string }[] = [];

        for (const conv of convs) {
          try {
            // Kill existing tmux session
            await killSessionAsync(conv.tmuxSession).catch(() => {});

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

async function injectForkSummary(conv: Conversation, summary: string): Promise<void> {
  updateForkStatus(conv.name, 'injecting');
  if (conv.harness === 'pi') {
    await waitForPiTuiReady(conv.tmuxSession, 60000);
    await sendKeysAsync(conv.tmuxSession, summary, 'summary-fork');
    return;
  }

  const ready = await waitForClaudePrompt(conv.tmuxSession, 60000).catch(() => false);
  if (!ready) {
    console.warn(`[summary-fork] Prompt not detected in time for ${conv.name}, sending summary anyway`);
  }
  await sendKeysAsync(conv.tmuxSession, summary, 'summary-fork');
}

async function runForkPipeline(
  convName: string,
  parentConv: Conversation,
  sessionId: string,
  summaryModel?: string,
  plain = false,
  localSummaryOnly = false,
  includeThinkingInSummary?: boolean,
  summaryHarness?: RuntimeName,
): Promise<void> {
  const conv = getConversationByName(convName);
  if (!conv) throw new Error(`Fork conversation ${convName} not found`);

  const parentSessionFile = await resolveForkSourceSessionFile(parentConv);
  if (!parentSessionFile) throw new Error(`Parent has no session file`);

  if (plain) {
    if (conv.harness === 'pi') {
      // Plain forks copy a Claude-format JSONL session file and spawn with --resume.
      // Pi cannot consume Claude JSONL, so a Pi plain fork would silently start
      // empty while the pipeline reported success. The summary-fork route already
      // rejects launchHarness='pi'; this guard is defense in depth so the pipeline
      // itself never produces a "successful" empty Pi session.
      throw new Error('Plain forks cannot launch under the Pi harness — Pi cannot consume Claude session history.');
    }
    // Plain Claude Code fork: copy JSONL from last compact boundary into the new
    // session file, then spawn with --resume so Claude Code loads the history
    // directly.
    const forkSessionFile = await resolveSessionFile(conv);
    if (!forkSessionFile) throw new Error(`Fork conversation ${convName} has no session file`);
    await copySessionFromCompactBoundary(parentSessionFile, forkSessionFile);

    updateForkStatus(convName, 'spawning');
    await spawnConversationSession(
      conv.tmuxSession,
      conv.cwd,
      sessionId,
      conv.model ?? undefined,
      conv.effort ?? undefined,
      conv.issueId ?? undefined,
      true, // resume — load the copied JSONL history
      conv.harness ?? 'claude-code',
    );
    await waitForTmuxSession(conv.tmuxSession);

    // No summary injection needed for plain Claude Code forks.
    markConversationActive(convName);
    updateForkStatus(convName, null);
    return;
  }

  let summary: string;
  if (localSummaryOnly) {
    summary = await generateFallbackSummary(parentSessionFile);
  } else {
    const result = await generateSummaryForFork(parentSessionFile, summaryModel, includeThinkingInSummary, summaryHarness);
    summary = result.summary;
  }

  updateForkStatus(convName, 'spawning');
  await spawnConversationSession(
    conv.tmuxSession,
    conv.cwd,
    sessionId,
    conv.model ?? undefined,
    conv.effort ?? undefined,
    conv.issueId ?? undefined,
    false,
    conv.harness ?? 'claude-code',
  );
  await waitForTmuxSession(conv.tmuxSession);

  await injectForkSummary(conv, summary);

  markConversationActive(convName);
  updateForkStatus(convName, null);
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

        if (conv.harness === 'pi') {
          return jsonResponse({ error: 'Forking Pi conversations is not supported until Pi session transcript export is available.' }, { status: 400 });
        }

        const sourceSessionFile = await resolveForkSourceSessionFile(conv);
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
        const plain = body['plain'] === true;
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

        const { sessionId, sessionFile } = await reserveSummaryForkSession(
          cwd || conv.cwd || process.cwd(),
        );

        const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const suffix = randomUUID().slice(0, 4);
        const newName = `${timestamp}-${suffix}`;
        const newTmux = `conv-${newName}`;
        const launchModel = model || conv.model;
        const effectiveSummaryModel = summaryModel || 'claude-sonnet-4-6';
        const launchHarness = await resolveAllowedHarness(body['harness'], launchModel);
        const summaryHarness = await resolveAllowedHarness(body['summaryHarness'], effectiveSummaryModel);
        if (plain && launchHarness === 'pi') {
          // Plain forks copy a Claude-format JSONL session file and spawn with --resume.
          // Pi cannot consume Claude JSONL history, so a Pi plain fork would silently
          // start an empty session. Summary forks are fine because they inject the
          // generated summary through the Pi FIFO after spawn (see injectForkSummary).
          return jsonResponse({
            error: 'Plain forks cannot launch under Pi — Pi cannot consume Claude session history. Use a summary fork to launch under Pi.',
          }, { status: 400 });
        }
        const defaultTitle = plain
          ? `Fork: ${conv.title || conv.name}`
          : `Summary Fork: ${conv.title || conv.name}`;

        const newConv = createConversation({
          name: newName,
          tmuxSession: newTmux,
          cwd: cwd || conv.cwd || process.cwd(),
          issueId: conv.issueId ?? undefined,
          title: customTitle || defaultTitle,
          titleSource: 'manual',
          titleSeed: plain
            ? `Fork of ${conv.name}`
            : `Summary Fork of ${conv.name}`,
          claudeSessionId: sessionId,
          model: launchModel ?? undefined,
          effort: conv.effort ?? undefined,
          harness: launchHarness,
          forkStatus: plain ? 'spawning' : 'summarizing',
        });
        markConversationActive(newConv.name);

        runForkPipeline(newConv.name, conv, sessionId, summaryModel, plain, localSummaryOnly, includeThinkingInSummary, summaryHarness).catch((err) => {
          console.error(`[fork-pipeline] Failed for ${newConv.name}:`, err);
          updateForkStatus(newConv.name, 'failed', err?.message ?? String(err));
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
          await sendRawKeystrokeAsync(conv.tmuxSession, '4', 'plan-action-reject');
          if (feedback) {
            await new Promise(r => setTimeout(r, 300));
            await sendKeysAsync(conv.tmuxSession, feedback, 'plan-action-feedback');
          }
          return jsonResponse({ ok: true });
        }

        const keystroke = PLAN_ACTION_KEYSTROKES[action];
        if (!keystroke) {
          return jsonResponse({ error: `Invalid action: ${action}` }, { status: 400 });
        }

        await sendRawKeystrokeAsync(conv.tmuxSession, keystroke, `plan-action-${action}`);
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
                baseCommitCache.set(repoRoot, await findCommitAtTime(repoRoot, conv.createdAt));
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
                diffs = await diffFilesAgainstHead(repoRoot, filePaths);
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
          const baseCommit = await findCommitAtTime(cwd, conv.createdAt);
          if (!baseCommit) return jsonResponse({ diff: '' });
          const diff = await diffPatchSinceCommit(cwd, baseCommit);
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
            const patch = await diffPatchFilesAgainstHead(repoRoot, filePaths);
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
          const baseCommit = await findCommitAtTime(cwd, conv.createdAt);
          if (baseCommit) {
            const diff = await diffPatchSinceCommit(cwd, baseCommit, fileFilter);
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
              baseCommitByRepo.set(repoRoot, await findCommitAtTime(repoRoot, conv.createdAt));
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
              patch = await diffPatchFilesAgainstHead(repoRoot, filePaths);
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

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const conversationsRouteLayer = Layer.mergeAll(
  getConversationsRoute,
  getConversationRoute,
  postConversationRoute,
  patchConversationRoute,
  postConversationStopRoute,
  postConversationResumeRoute,
  postConversationSwitchModelRoute,
  postConversationRestartAllRoute,
  postConversationArchiveRoute,
  postConversationUnarchiveRoute,
  getConversationMessagesRoute,
  postConversationUploadImageRoute,
  postConversationDeleteImageRoute,
  postConversationMessageRoute,
  postConversationDeliveryMethodRoute,
  postConversationFavoriteRoute,
  deleteConversationFavoriteRoute,
  postConversationSummaryForkRoute,
  postConversationPlanActionRoute,
  getConversationDiffsRoute,
  getConversationDiffFullRoute,
  getConversationDiffTurnRoute,
);

export default conversationsRouteLayer;
