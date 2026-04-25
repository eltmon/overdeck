import { jsonResponse } from "../http-helpers.js";
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
import { mkdir, writeFile, readFile, stat, realpath, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import type * as Multipart from 'effect/unstable/http/Multipart';

import {
  listConversations,
  getConversationByName,
  getConversationById,
  createConversation,
  markConversationEnded,
  markConversationActive,
  updateLastAttached,
  updateSessionFile,
  updateConversationTitle,
  updateConversationCost,
  updateConversationModel,
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
  capturePaneAsync,
  sessionExistsAsync,
  killSessionAsync,
  createSessionAsync,
  setOptionAsync,
  waitForClaudePrompt,
  listSessionNamesAsync,
} from '../../../lib/tmux.js';
import {
  getAgentRuntimeBaseCommand,
  getProviderExportsForModel,
} from '../../../lib/agents.js';
import {
  parseConversationMessages,
  parseFromLastCompactBoundary,
  type ParseState,
} from '../services/conversation-service.js';
import {
  maybeCompactBeforeRespawn,
  compactConversationNative,
  shouldInterceptManualCompact,
} from '../services/conversation-compaction.js';
import { encodeClaudeProjectDir } from '../../../lib/paths.js';
import { generateSummaryForFork, reserveSummaryForkSession, copySessionFromCompactBoundary } from '../../../lib/conversations/summary-fork.js';
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

const SAFE_MODEL_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const SAFE_EFFORT_PATTERN = /^(low|medium|high)$/;
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
  if (cached && cached.mtimeMs === fileStats.mtimeMs && cached.size === fileStats.size) {
    return cached.result;
  }

  let result: Awaited<ReturnType<typeof parseConversationMessages>>;

  if (isSpecialist) {
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
      result = {
        messages: cached.result.messages.concat(incremental.messages),
        workLog: cached.result.workLog.concat(incremental.workLog),
        byteOffset: incremental.byteOffset,
        streaming: incremental.streaming,
        totalCost: cached.result.totalCost + incremental.totalCost,
        pendingToolUse: incremental.pendingToolUse,
        unresolvedResults: incremental.unresolvedResults,
        lastSequence: incremental.lastSequence,
        mtimeMs: incremental.mtimeMs,
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

// ─── CSRF / Origin validation ────────────────────────────────────────────────

let cachedTrustedOrigins: string[] | undefined;

function getTrustedOrigins(): string[] {
  if (cachedTrustedOrigins !== undefined) {
    return cachedTrustedOrigins;
  }
  const port = parseInt(process.env['API_PORT'] ?? process.env['PORT'] ?? '3011', 10);
  const dashboardUrl = process.env['DASHBOARD_URL'] ?? `http://localhost:${port}`;
  const origins = new Set<string>();
  origins.add(dashboardUrl);
  // Only trust local development origins in development mode
  if (process.env['NODE_ENV'] === 'development') {
    origins.add('http://localhost:3011');
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3011');
    origins.add('http://127.0.0.1:3000');
  }
  cachedTrustedOrigins = Array.from(origins);
  return cachedTrustedOrigins;
}

function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function getHeader(
  request: HttpServerRequest.HttpServerRequest,
  name: string,
): string | undefined {
  const value = (request.headers as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function validateOrigin(request: HttpServerRequest.HttpServerRequest): { ok: true } | { ok: false; error: string } {
  const origin = getHeader(request, 'origin');
  const referer = getHeader(request, 'referer');
  const trusted = getTrustedOrigins();

  // If Origin is present, it must exactly match a trusted origin
  if (origin) {
    const normalized = normalizeOrigin(origin);
    if (normalized && trusted.includes(normalized)) {
      return { ok: true };
    }
    return { ok: false, error: 'Invalid origin' };
  }

  // If no Origin but Referer is present, normalize and check it
  if (referer) {
    const normalized = normalizeOrigin(referer);
    if (normalized && trusted.includes(normalized)) {
      return { ok: true };
    }
    return { ok: false, error: 'Invalid referer' };
  }

  // Require at least one of Origin or Referer for CSRF protection
  return { ok: false, error: 'Missing origin' };
}

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

/** Compute the deterministic JSONL session file path from cwd + session UUID. */
function sessionFilePath(cwd: string, sessionId: string): string {
  const encodedCwd = encodeClaudeProjectDir(cwd);
  return join(homedir(), '.claude', 'projects', encodedCwd, `${sessionId}.jsonl`);
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

  const extension = safeUploadExtension(filename, mimeType);
  if (!extension) {
    return jsonResponse({ error: `Unsupported mimeType: ${mimeType}` }, { status: 400 });
  }

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
  const resolvedDir = await realpath(attachmentDir);
  const attachmentsRoot = await realpath(getConversationAttachmentsRoot()).catch(() =>
    resolve(getConversationAttachmentsRoot()),
  );
  if (!resolvedDir.startsWith(`${attachmentsRoot}/`)) {
    return jsonResponse({ error: 'Invalid attachment path' }, { status: 500 });
  }

  const fileName = `${randomUUID()}${extension}`;
  const path = join(resolvedDir, fileName);
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, bytes);
  await rename(tmpPath, path);

  return jsonResponse({ path });
}

export async function handleConversationMessage(
  name: string,
  body: Record<string, unknown>,
  deliverMessage: typeof sendKeysAsync = sendKeysAsync,
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
    if (!conv.sessionFile || !existsSync(conv.sessionFile)) {
      return jsonResponse({ error: `No session file found for conversation ${conv.name}` }, { status: 400 });
    }
    const result = await compactConversationNative(conv.sessionFile);
    return jsonResponse({ ok: true, compacted: true, mode: 'panopticon-native', model: result.model });
  }

  const allAttachmentPaths = extractConversationAttachmentPaths(message);
  for (const attachmentPath of allAttachmentPaths) {
    const managed = await isManagedConversationAttachmentPath(attachmentPath);
    if (managed) {
      const hasAttachment = await hasConversationAttachment(conv.name, attachmentPath);
      if (!hasAttachment) {
        return jsonResponse({ error: 'One or more attached images are unavailable for this conversation' }, { status: 400 });
      }
    }
    // Unmanaged @paths in prose are allowed to pass through
  }

  await deliverMessage(conv.tmuxSession, message, 'conversation-message');
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
    const candidates = convs.filter((conv) => !conv.model && conv.sessionFile);
    const BATCH_SIZE = 10;
    let backfilled = 0;
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (conv) => {
          const model = await extractModelFromSessionFile(conv.sessionFile!);
          if (model && SAFE_MODEL_PATTERN.test(model)) {
            updateConversationModel(conv.name, model);
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

function sessionIdFromFile(sessionFile: string | null | undefined): string | undefined {
  if (!sessionFile) return undefined;
  return sessionFile.split('/').pop()?.replace('.jsonl', '') ?? undefined;
}

async function spawnConversationSession(
  tmuxSession: string,
  cwd: string,
  claudeSessionId: string,
  model?: string,
  effort?: string,
  issueId?: string,
  resume = false,
): Promise<void> {
  const stateDir = join(homedir(), '.panopticon', 'conversations', tmuxSession);
  await mkdir(stateDir, { recursive: true });

  const launcherScript = join(stateDir, 'launcher.sh');

  const permissionFlags = '--dangerously-skip-permissions --permission-mode bypassPermissions';
  let runtimeCommand = `claude ${permissionFlags}`;
  const providerEnvExports: string[] = [];
  if (model) {
    if (!SAFE_MODEL_PATTERN.test(model)) {
      throw new Error('Invalid model name');
    }
    runtimeCommand = getAgentRuntimeBaseCommand(model);
    if (!runtimeCommand.includes('--dangerously-skip-permissions')) {
      runtimeCommand = `${runtimeCommand} --dangerously-skip-permissions`;
    }
    if (!runtimeCommand.includes('--permission-mode')) {
      runtimeCommand = `${runtimeCommand} --permission-mode bypassPermissions`;
    }
    const providerExports = getProviderExportsForModel(model).trim();
    if (providerExports) {
      providerEnvExports.push(...providerExports.split('\n').filter(Boolean));
    }
  }

  if (effort && !SAFE_EFFORT_PATTERN.test(effort)) {
    throw new Error('Invalid effort level');
  }

  const envExports = [
    `export TERM=xterm-256color`,
    `export COLORTERM=truecolor`,
    `export LANG=C.UTF-8`,
    `export LC_ALL=C.UTF-8`,
    ...(issueId ? [`export PANOPTICON_ISSUE_ID=${shellQuote(issueId)}`] : []),
    ...providerEnvExports,
  ].join('\n');

  const sessionArgs = [
    resume ? `--resume ${shellQuote(claudeSessionId)}` : `--session-id ${shellQuote(claudeSessionId)}`,
    ...(effort ? [`--effort ${shellQuote(effort)}`] : []),
  ].join(' ');

  // Quote each token of the runtime command so paths with spaces are handled
  // safely while preserving the individual arguments.
  const quotedRuntimeCommand = runtimeCommand.split(' ').map(shellQuote).join(' ');

  await writeFile(launcherScript, `#!/bin/bash
${envExports}
cd -- ${shellQuote(cwd)}
trap '' HUP
${quotedRuntimeCommand} ${sessionArgs}
echo ""
echo "Conversation session ended. Close this panel or click Resume to start a new session."
while true; do sleep 60; done
`, { mode: 0o700 });

  // Kill any stale session with the same name
  try {
    await killSessionAsync(tmuxSession);
  } catch {
    // ignore missing stale session
  }

  // Spawn the session
  await createSessionAsync(tmuxSession, cwd, `bash ${shellQuote(launcherScript)}`, {
    env: {
      TERM: 'xterm-256color',
    },
  });

  // Keep session alive when clients disconnect
  await setOptionAsync(tmuxSession, 'destroy-unattached', 'off');
  await setOptionAsync(tmuxSession, 'remain-on-exit', 'on');
}

/**
 * Generate an AI title for a conversation using Claude CLI (T3Code pattern).
 * Runs `claude -p --output-format json --json-schema ...` with the first message
 * as input, then updates the conversation title if it hasn't been manually renamed.
 */
async function generateAiTitle(conversationName: string, firstMessage: string): Promise<void> {
  const conv = getConversationByName(conversationName);
  if (!conv || !canReplaceTitle(conv)) return;

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

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '-p',
        '--output-format', 'json',
        '--json-schema', schema,
        '--model', 'claude-haiku-4-5-20251001',
        '--dangerously-skip-permissions',
        '--permission-mode', 'bypassPermissions',
      ],
      { env: { ...process.env, PATH: process.env.PATH } },
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
  const aiTitle: string | undefined =
    parsed?.structured_output?.title ?? parsed?.title;

  if (!aiTitle || !aiTitle.trim()) return;

  // Sanitize: strip quotes, normalize whitespace, take first line only
  const sanitized = aiTitle
    .trim()
    .split(/\r?\n/)[0]
    ?.trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!sanitized) return;

  // Re-check eligibility (may have been renamed while we waited)
  const freshConv = getConversationByName(conversationName);
  if (!freshConv || !canReplaceTitle(freshConv)) return;

  updateConversationTitle(conversationName, sanitized, 'ai');
  console.log(`[conversations] AI title for "${conversationName}": ${sanitized}`);
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
        const conversations = listConversations({ limit: 500 });
        const favoritedNames = new Set(listFavoritedIds('conversation'));

        // Enrich with live tmux status
        // Grace period: treat recently-created active conversations as alive (tmux may not have
        // started yet — spawn is async). After 30s we fall back to the actual tmux check.
        const SPAWN_GRACE_MS = 30_000;
        const liveSessionNames = new Set(await listSessionNamesAsync());
        const enriched = conversations.map((conv) => {
          const withinGrace =
            conv.status === 'active' &&
            !conv.endedAt &&
            Date.now() - new Date(conv.createdAt).getTime() < SPAWN_GRACE_MS;
          const sessionAlive = !conv.forkStatus && (withinGrace || liveSessionNames.has(conv.tmuxSession));

          return { ...conv, sessionAlive, isWorking: false, currentTool: null, isFavorited: favoritedNames.has(conv.name) };
        });

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
    return yield* Effect.promise(async () => {
      try {
        const message = typeof body['message'] === 'string' ? body['message'].trim() : '';
        const model = typeof body['model'] === 'string' ? body['model'].trim() : undefined;
        const effort = typeof body['effort'] === 'string' ? body['effort'].trim() : undefined;
        const issueId = typeof body['issueId'] === 'string' ? body['issueId'] : undefined;
        if (issueId && !SAFE_ISSUE_ID_PATTERN.test(issueId)) {
          return jsonResponse({ error: 'Invalid issueId' }, { status: 400 });
        }
        const cwd = join(homedir(), 'Projects');

        if (!message) {
          return jsonResponse({ error: 'message is required' }, { status: 400 });
        }
        if (message.length > MAX_MESSAGE_LENGTH) {
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
        const sessionFile = sessionFilePath(cwd, claudeSessionId);

        console.log(`[conversations] Creating conversation "${name}" with model=${model ?? 'default'} effort=${effort ?? 'default'}`);

        // Spawn tmux session with model + effort + deterministic session ID
        await spawnConversationSession(tmuxSession, cwd, claudeSessionId, model, effort, issueId);
        console.log(`[conversations] tmux session ${tmuxSession} spawned, JSONL: ${sessionFile}`);

        // Title = truncated first message (T3Code pattern)
        const MAX_TITLE_LEN = 60;
        const title = message.slice(0, MAX_TITLE_LEN) + (message.length > MAX_TITLE_LEN ? '…' : '');

        // Create DB record
        const conv = createConversation({
          name,
          tmuxSession,
          cwd,
          issueId,
          sessionFile,
          title,
          titleSource: 'auto',
          titleSeed: title,
          model,
          effort,
        });

        // Wait for Claude Code to be ready, send message, and generate title — all async.
        // Don't block the HTTP response; the frontend will poll for messages.
        void (async () => {
          try {
            await waitForClaudeReady(tmuxSession);
            await sendKeysAsync(tmuxSession, message, 'conversation-message');
            void generateAiTitle(name, message).catch((err: unknown) => {
              console.error(`[conversations] AI title generation failed for "${name}":`, err);
            });
          } catch (err) {
            console.error(`[conversations] Failed to send first message to ${tmuxSession}:`, err);
          }
        })();

        return jsonResponse({ ...conv, sessionAlive: true }, { status: 201 });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] create conversation failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
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
        const oldSessionId = sessionIdFromFile(conv.sessionFile);
        const modelChanged = !!model && model !== conv.model;

        if (!(await validateCwdContainment(conv.cwd))) {
          return jsonResponse({ error: 'Invalid cwd' }, { status: 400 });
        }

        // Validate model before persisting so invalid values never reach the DB.
        if (model && modelChanged && !SAFE_MODEL_PATTERN.test(model)) {
          return jsonResponse({ error: 'Invalid model' }, { status: 400 });
        }

        // Persist the new model so the dropdown reflects what we're respawning with.
        if (model && modelChanged) updateConversationModel(name, model);

        await spawnConversationSession(conv.tmuxSession, conv.cwd, oldSessionId ?? randomUUID(), model, effort, conv.issueId ?? undefined, !!oldSessionId);
        await waitForTmuxSession(conv.tmuxSession);
        await waitForClaudePrompt(conv.tmuxSession, 30000).catch(() => false);

        markConversationActive(name);
        return jsonResponse({ ...conv, status: 'active', model: model ?? conv.model, reattached: false, sessionAlive: true });
      }    catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] resume conversation failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
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

        // Always kill the existing session first (if alive) so the model change takes effect
        await killSessionAsync(conv.tmuxSession).catch(() => {});

        if (!(await validateCwdContainment(conv.cwd))) {
          return jsonResponse({ error: 'Invalid cwd' }, { status: 400 });
        }

        // Validate model before persisting so invalid values never reach the DB.
        if (model && !SAFE_MODEL_PATTERN.test(model)) {
          return jsonResponse({ error: 'Invalid model' }, { status: 400 });
        }

        // Persist the new model
        if (model) updateConversationModel(name, model);

        // Extract the session UUID from the existing session file path
        const oldSessionId = sessionIdFromFile(conv.sessionFile);

        // Compact (if needed) then respawn with the new model before reporting success.
        const sessionFile = conv.sessionFile;
        const cwd = conv.cwd;
        const tmuxSession = conv.tmuxSession;
        const effort = conv.effort ?? undefined;
        const issueId = conv.issueId ?? undefined;
        await maybeCompactBeforeRespawn({ sessionFile, cwd, modelChanged: true });
        await spawnConversationSession(tmuxSession, cwd, oldSessionId ?? randomUUID(), model, effort, issueId, !!oldSessionId);
        await waitForTmuxSession(tmuxSession);
        await waitForClaudePrompt(tmuxSession, 30000).catch(() => false);

        markConversationActive(name);
        return jsonResponse({ ...conv, status: 'active', model, reattached: false, sessionAlive: true });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[conversations] switch model failed:', msg);
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  }),
);

// Cache specialist session file lookups to avoid O(n) directory scans.
const specialistSessionFileCache = new Map<string, string>();
const SPECIALIST_SESSION_CACHE_MAX = 50;

function setSpecialistSessionCache(name: string, sessionFile: string): void {
  specialistSessionFileCache.set(name, sessionFile);
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
        let sessionFile: string | null | undefined = conv?.sessionFile;
        if (!conv) {
          const cached = specialistSessionFileCache.get(name);
          if (cached) {
            sessionFile = cached;
          } else {
            const specialistMatch = name.match(/^specialist-(.+)-(review-agent|test-agent|merge-agent)$/);
            if (specialistMatch) {
              const [, project, type] = specialistMatch;
              if (!SAFE_PROJECT_NAME_PATTERN.test(project)) {
                return jsonResponse({ error: 'Invalid conversation name' }, { status: 400 });
              }
              const panHome = process.env['PANOPTICON_HOME'] || join(homedir(), '.panopticon');
              const sessionIdFile = join(panHome, 'specialists', 'projects', project, `${type}.session`);
              try {
                const { readFile, readdir, stat } = await import('node:fs/promises');
                const sessionId = (await readFile(sessionIdFile, 'utf-8')).trim();
                if (sessionId && SAFE_SESSION_ID_PATTERN.test(sessionId)) {
                  const claudeProjects = join(homedir(), '.claude', 'projects');
                  const dirs = await readdir(claudeProjects);
                  // Validate directory names to prevent path traversal before
                  // joining. Only alphanumeric, hyphen, underscore, and dot are
                  // allowed (encoded CWDs use these characters).
                  const SAFE_DIR_PATTERN = /^[a-zA-Z0-9_.-]+$/;
                  // Check all candidates concurrently with async stat instead of
                  // synchronous existsSync in a loop (blocks the event loop).
                  const candidates = dirs
                    .filter((dir) => SAFE_DIR_PATTERN.test(dir))
                    .map((dir) => join(claudeProjects, dir, `${sessionId}.jsonl`));
                  // Batch stat calls to avoid unbounded Promise.all fanout
                  // when .claude/projects has many directories.
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
              } catch { /* session file not found */ }
            }
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
          // Specialists: parse only from the last compact_boundary so the display
          // shows only the current context window, not the full 30-day history.
          const isSpecialist = !conv && /^specialist-/.test(name);
          const result = await getCachedMessages(sessionFile, isSpecialist);

          // Cache cost in DB so the conversation list can show it without re-parsing
          if (result.totalCost > 0 && conv) {
            updateConversationCost(name, result.totalCost);
          }

          return jsonResponse({
            messages: result.messages,
            workLog: result.workLog,
            streaming: result.streaming,
            totalCost: result.totalCost,
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
    const multipart = yield* request.multipart;
    const files = multipart['file'] as Multipart.PersistedFile[] | undefined;
    const filenameField = multipart['filename'] as string | string[] | undefined;
    const mimeTypeField = multipart['mimeType'] as string | string[] | undefined;

    const file = files?.[0];
    const filename = Array.isArray(filenameField) ? filenameField[0] : filenameField;
    const mimeType = Array.isArray(mimeTypeField) ? mimeTypeField[0] : mimeTypeField;

    if (!file || !file.path || !filename || !mimeType) {
      return jsonResponse({ error: 'file, filename, and mimeType are required' }, { status: 400 });
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
        // Guard: if the handler threw what looks like an HTTP response, pass it through
        if (error instanceof Response) {
          return error;
        }
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

        // Kill tmux session if still alive
        await killSessionAsync(conv.tmuxSession).catch(() => {});

        // Mark as ended and archived
        markConversationEnded(name);
        archiveConversation(name);
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
            const oldSessionId = conv.sessionFile
              ? conv.sessionFile.split('/').pop()?.replace('.jsonl', '') ?? undefined
              : undefined;
            await spawnConversationSession(
              conv.tmuxSession,
              conv.cwd,
              oldSessionId ?? randomUUID(),
              conv.model ?? undefined,
              conv.effort ?? undefined,
              conv.issueId ?? undefined,
              !!oldSessionId,
            );
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

async function runForkPipeline(
  convName: string,
  parentConv: Conversation,
  sessionId: string,
  summaryModel?: string,
  plain = false,
): Promise<void> {
  const conv = getConversationByName(convName);
  if (!conv) throw new Error(`Fork conversation ${convName} not found`);

  if (!parentConv.sessionFile) throw new Error(`Parent has no session file`);

  if (plain) {
    // Plain fork: copy JSONL from last compact boundary into the new session file,
    // then spawn with --resume so Claude Code loads the history directly.
    if (!conv.sessionFile) throw new Error(`Fork conversation ${convName} has no session file`);
    await copySessionFromCompactBoundary(parentConv.sessionFile, conv.sessionFile);

    updateForkStatus(convName, 'spawning');
    await spawnConversationSession(
      conv.tmuxSession,
      conv.cwd,
      sessionId,
      conv.model ?? undefined,
      conv.effort ?? undefined,
      conv.issueId ?? undefined,
      true, // resume — load the copied JSONL history
    );
    await waitForTmuxSession(conv.tmuxSession);

    // No summary injection needed for plain fork
    markConversationActive(convName);
    updateForkStatus(convName, null);
    return;
  }

  const { summary } = await generateSummaryForFork(parentConv.sessionFile, summaryModel);

  updateForkStatus(convName, 'spawning');
  await spawnConversationSession(
    conv.tmuxSession,
    conv.cwd,
    sessionId,
    conv.model ?? undefined,
    conv.effort ?? undefined,
    conv.issueId ?? undefined,
  );
  await waitForTmuxSession(conv.tmuxSession);

  updateForkStatus(convName, 'injecting');
  const ready = await waitForClaudePrompt(conv.tmuxSession, 60000).catch(() => false);
  if (!ready) {
    console.warn(`[summary-fork] Prompt not detected in time for ${convName}, sending summary anyway`);
  }
  await sendKeysAsync(conv.tmuxSession, summary, 'summary-fork');

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

        if (!conv.sessionFile || !existsSync(conv.sessionFile)) {
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

        const newConv = createConversation({
          name: newName,
          tmuxSession: newTmux,
          cwd: cwd || conv.cwd || process.cwd(),
          issueId: conv.issueId ?? undefined,
          title: plain
            ? `Fork: ${conv.title || conv.name}`
            : `Summary Fork: ${conv.title || conv.name}`,
          titleSource: 'manual',
          titleSeed: plain
            ? `Fork of ${conv.name}`
            : `Summary Fork of ${conv.name}`,
          sessionFile,
          model: launchModel ?? undefined,
          effort: conv.effort ?? undefined,
          forkStatus: plain ? 'spawning' : 'summarizing',
        });
        markConversationActive(newConv.name);

        runForkPipeline(newConv.name, conv, sessionId, summaryModel, plain).catch((err) => {
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
  postConversationFavoriteRoute,
  deleteConversationFavoriteRoute,
  postConversationSummaryForkRoute,
);

export default conversationsRouteLayer;
