/**
 * Conversation Service (PAN-451)
 *
 * Provides JSONL session file discovery, parsing, and file watching for
 * structured conversation message rendering in Mission Control.
 *
 * All file I/O uses fs/promises (no sync calls).
 */

import { readdir, stat, readFile, watch, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ChatMessage, WorkLogEntry } from '@panopticon/contracts';
import { calculateCost, getPricing, type AIProvider } from '../../../lib/cost.js';
import { encodeClaudeProjectDir } from '../../../lib/paths.js';

/** Detect AI provider from model name */
function providerFromModel(model: string): AIProvider {
  if (model.includes('gpt')) return 'openai';
  if (model.includes('gemini')) return 'google';
  if (model.includes('kimi') || model.toLowerCase().startsWith('minimax')) return 'custom';
  return 'anthropic';
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParseResult {
  messages: ChatMessage[];
  workLog: WorkLogEntry[];
  /** Byte offset after the last parsed line — pass back for incremental reads. */
  byteOffset: number;
  /** True when the last assistant message has no completedAt and file was modified recently. */
  streaming: boolean;
  /** Total estimated cost in USD computed from assistant message usage data. */
  totalCost: number;
  /** Unpaired tool_use entries waiting for tool_result (persist across incremental calls). */
  pendingToolUse: Map<string, WorkLogEntry>;
  /** Pre-arrived tool_result entries waiting for tool_use (persist across incremental calls). */
  unresolvedResults: Map<string, { resultText?: string; isError: boolean; rawContent: unknown }>;
  /** Last sequence number assigned (persist across incremental calls). */
  lastSequence: number;
}

/** State carried across incremental parseConversationMessages calls. */
export interface ParseState {
  pendingToolUse: Map<string, WorkLogEntry>;
  unresolvedResults: Map<string, { resultText?: string; isError: boolean; rawContent: unknown }>;
  lastSequence: number;
}

export interface ConversationActivitySummary {
  messages: ChatMessage[];
  streaming: boolean;
  isWorking: boolean;
  /** Tool name of the most recently pending tool call, if any (e.g. "Bash", "Read"). */
  currentTool: string | null;
}

// ─── CWD encoding ─────────────────────────────────────────────────────────────

/**
 * Encode a filesystem path to the Claude Code project directory name.
 * Delegates to the shared encodeClaudeProjectDir() which matches
 * Claude Code's actual encoding (all non-alphanumeric chars → hyphens).
 */
function encodeCwdToProjectDir(cwd: string): string {
  return encodeClaudeProjectDir(cwd);
}

/** Returns ~/.claude/projects/<encoded-cwd>/ */
function claudeProjectDir(cwd: string): string {
  return join(homedir(), '.claude', 'projects', encodeCwdToProjectDir(cwd));
}

// ─── Session file discovery ───────────────────────────────────────────────────

/**
 * Snapshot existing JSONL files, then poll for a NEW file that wasn't there before.
 *
 * The old approach checked mtime >= spawnTime, which matched any active session
 * (including the user's own Claude Code conversation). This approach is exact:
 * only a file that didn't exist before the spawn can be the new session.
 *
 * Call snapshotSessionFiles() BEFORE spawning, then pass the result to
 * discoverSessionFile() AFTER spawning.
 */
export async function snapshotSessionFiles(cwd: string): Promise<Set<string>> {
  const projectDir = claudeProjectDir(cwd);
  try {
    const entries = await readdir(projectDir);
    return new Set(entries.filter(e => e.endsWith('.jsonl')));
  } catch {
    return new Set();
  }
}

/**
 * Wait for a new JSONL session file that wasn't in the pre-spawn snapshot.
 *
 * Polls every 500ms for up to 60 seconds. Returns the absolute path when found.
 * Resolves with null if no new file appears within the timeout.
 */
export async function discoverSessionFile(
  cwd: string,
  existingFiles: Set<string>,
  timeoutMs = 60_000,
): Promise<string | null> {
  const projectDir = claudeProjectDir(cwd);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const entries = await readdir(projectDir);
      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;
        if (!existingFiles.has(entry)) {
          return join(projectDir, entry);
        }
      }
    } catch {
      // Project directory doesn't exist yet — Claude hasn't started
    }

    await new Promise<void>((r) => setTimeout(r, 500));
  }

  return null;
}

// ─── JSONL parsing ────────────────────────────────────────────────────────────

interface JsonlUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface JsonlEntry {
  type?: string;
  role?: string;
  message?: {
    id?: string;
    role?: string;
    content?: unknown[] | string;
    model?: string;
    stop_reason?: string | null;
    usage?: JsonlUsage;
  };
  timestamp?: string;
  sessionId?: string;
  uuid?: string;
}

interface ContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

/**
 * Returns true for Claude Code internal injections that should not appear as user messages:
 *   - XML-tagged system context (<system-reminder>, <command-name>, etc.)
 *   - Skill file content injections ("Base directory for this skill: ...")
 *   - Compaction summary injections ("This session is being continued...")
 *   - Memory/hook injections ("Human:" prefix blocks, etc.)
 */
function isSystemInjection(text: string): boolean {
  if (text.startsWith('<')) return true;
  if (text.startsWith('Base directory for this skill:')) return true;
  if (text.startsWith('This session is being continued from a previous conversation')) return true;
  if (text.startsWith('Human:') && text.includes('\n\nAssistant:')) return true;
  return false;
}

/**
 * Parse JSONL session file from a byte offset.
 *
 * Returns parsed messages, work log entries, new byte offset, and streaming status.
 * Safe to call repeatedly — incremental reads avoid re-parsing.
 */
export async function parseConversationMessages(
  sessionFile: string,
  fromByteOffset = 0,
  priorState?: ParseState,
): Promise<ParseResult> {
  // Read only new content from the byte offset — avoids re-reading the entire JSONL every tick
  const fileStats = await stat(sessionFile);
  const newByteOffset = fileStats.size;
  const toRead = Math.max(0, newByteOffset - fromByteOffset);

  let newText = '';
  if (toRead > 0) {
    const fh = await open(sessionFile, 'r');
    try {
      const buf = Buffer.alloc(toRead);
      await fh.read(buf, 0, toRead, fromByteOffset);
      newText = buf.toString('utf-8');
    } finally {
      await fh.close();
    }
  }

  const lines = newText.split('\n').filter((l) => l.trim());

  const messages: ChatMessage[] = [];
  const workLog: WorkLogEntry[] = [];
  let totalCost = 0;

  // Pending assistant message being assembled from content blocks
  let pendingAssistant: ChatMessage | null = null;
  // Track last user message timestamp for duration calculation
  let lastUserTimestamp: string | null = null;
  // Map tool_use id → WorkLogEntry (waiting for tool_result)
  const pendingToolUse = priorState?.pendingToolUse ?? new Map<string, WorkLogEntry>();
  // Map tool_use id → pre-arrived tool_result (waiting for tool_use)
  const unresolvedResults = priorState?.unresolvedResults ?? new Map<string, { resultText?: string; isError: boolean; rawContent: unknown }>();
  // Monotonic sequence counter per JSONL line
  let sequence = priorState?.lastSequence ?? 0;

  for (const line of lines) {
    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line) as JsonlEntry;
    } catch {
      continue;
    }
    const lineSequence = sequence++;

    if (entry.type === 'user' && entry.message) {
      const msg = entry.message;
      const rawContent = msg.content;

      // Flush any pending assistant message
      if (pendingAssistant) {
        messages.push(pendingAssistant);
        pendingAssistant = null;
      }

      // Content can be a string (plain text) or array of content blocks
      if (typeof rawContent === 'string' && rawContent.trim()) {
        // Skip XML system messages and Claude Code skill/context injections
        if (!isSystemInjection(rawContent)) {
          const ts = entry.timestamp ?? new Date().toISOString();
          lastUserTimestamp = ts;
          messages.push({
            id: entry.uuid ?? `user-${messages.length}`,
            role: 'user',
            text: rawContent,
            createdAt: ts,
            sequence: lineSequence,
          });
        }
      } else if (Array.isArray(rawContent)) {
        // Collect tool_result blocks first (they complete pending WorkLogEntries)
        for (const block of rawContent as ContentBlock[]) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const pending = pendingToolUse.get(block.tool_use_id);
            let resultText: string | undefined;
            if (typeof block.content === 'string') {
              resultText = block.content;
            } else if (Array.isArray(block.content)) {
              resultText = (block.content as Array<{ type?: string; text?: string }>)
                .filter(b => b.type === 'text' && b.text)
                .map(b => b.text)
                .join('\n');
            }
            if (pending) {
              pendingToolUse.delete(block.tool_use_id);
              workLog.push({
                ...pending,
                detail: block.is_error
                  ? `Error: ${resultText ?? JSON.stringify(block.content)}`
                  : pending.detail,
                result: resultText,
                tone: block.is_error ? 'error' : pending.tone,
              });
            } else {
              // Cap unresolved results to prevent unbounded growth in long sessions
              if (unresolvedResults.size >= 1000) {
                const firstKey = unresolvedResults.keys().next().value;
                if (firstKey !== undefined) unresolvedResults.delete(firstKey);
              }
              unresolvedResults.set(block.tool_use_id, {
                resultText,
                isError: block.is_error ?? false,
                rawContent: block.content,
              });
            }
          }
        }

        // Collect all text blocks, joining with newlines to preserve multiline input
        const textBlocks: string[] = [];
        for (const block of rawContent as ContentBlock[]) {
          if (block.type === 'text' && block.text && !isSystemInjection(block.text)) {
            textBlocks.push(block.text);
          }
        }
        if (textBlocks.length > 0) {
          const ts = entry.timestamp ?? new Date().toISOString();
          lastUserTimestamp = ts;
          messages.push({
            id: entry.uuid ?? `user-${messages.length}`,
            role: 'user',
            text: textBlocks.join('\n'),
            createdAt: ts,
            sequence: lineSequence,
          });
        }
      }
    } else if (entry.type === 'assistant' && entry.message) {
      const msg = entry.message;
      const content = Array.isArray(msg.content) ? msg.content : [];

      // Accumulate cost from usage data
      if (msg.usage && msg.model) {
        const pricing = getPricing(providerFromModel(msg.model), msg.model);
        if (pricing) {
          totalCost += calculateCost({
            inputTokens: msg.usage.input_tokens ?? 0,
            outputTokens: msg.usage.output_tokens ?? 0,
            cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
          }, pricing);
        }
      }

      let assistantText = '';
      for (const block of content as ContentBlock[]) {
        if (block.type === 'text' && block.text) {
          assistantText += block.text;
        } else if (block.type === 'tool_use' && block.id) {
          // WorkLogEntry for the tool call
          const toolEntry: WorkLogEntry = {
            id: block.id,
            createdAt: entry.timestamp ?? new Date().toISOString(),
            label: block.name ?? 'tool',
            tone: 'tool',
            toolTitle: block.name,
            detail: block.input ? JSON.stringify(block.input) : undefined,
            sequence: lineSequence,
          };
          const unresolved = unresolvedResults.get(block.id);
          if (unresolved) {
            unresolvedResults.delete(block.id);
            workLog.push({
              ...toolEntry,
              detail: unresolved.isError
                ? `Error: ${unresolved.resultText ?? JSON.stringify(unresolved.rawContent)}`
                : toolEntry.detail,
              result: unresolved.resultText,
              tone: unresolved.isError ? 'error' : toolEntry.tone,
            });
          } else {
            pendingToolUse.set(block.id, toolEntry);
          }
        }
      }

      if (assistantText) {
        // Flush previous pending assistant
        if (pendingAssistant) {
          messages.push(pendingAssistant);
        }
        pendingAssistant = {
          id: entry.uuid ?? msg.id ?? `asst-${messages.length}`,
          role: 'assistant',
          text: assistantText,
          // createdAt = when the user sent the request (for duration calculation)
          // completedAt = when this assistant response finished
          createdAt: lastUserTimestamp ?? entry.timestamp ?? new Date().toISOString(),
          // Any terminal stop reason (end_turn, max_tokens, stop_sequence) marks the response as done.
          // tool_use means more exchanges are coming, so leave completedAt unset.
          // Use || fallback in case entry.timestamp is null (not just undefined).
          completedAt: (msg.stop_reason && msg.stop_reason !== 'tool_use')
            ? (entry.timestamp || new Date().toISOString())
            : undefined,
          streaming: !msg.stop_reason,
          sequence: lineSequence,
        };
      }
    }
  }

  // Push any remaining pending assistant
  if (pendingAssistant) {
    messages.push(pendingAssistant);
  }

  // Flush any tool_use entries that never got a result (still running).
  // Only flush on non-incremental parses; incremental callers pass priorState
  // and will receive pendingToolUse back for the next call.
  if (!priorState) {
    for (const [, entry] of pendingToolUse) {
      workLog.push(entry);
    }
    pendingToolUse.clear();
  }

  // Sort by (createdAt, sequence) so the conversation view matches terminal order
  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.sequence ?? 0) - (b.sequence ?? 0));
  workLog.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.sequence ?? 0) - (b.sequence ?? 0));

  // Streaming detection: agent is active if the last assistant message is incomplete,
  // or if there are pending/unresolved tools (mid-turn), or a user message arrived
  // (agent is about to respond), and the file was modified recently.
  let streaming = false;
  const lastMsg = messages[messages.length - 1];
  const assistantIncomplete = lastMsg?.role === 'assistant' && !lastMsg.completedAt;
  const fileRecent = Date.now() - fileStats.mtimeMs < 5000;
  if (assistantIncomplete && fileRecent) {
    streaming = true;
  } else if (lastMsg?.role === 'user' && fileRecent) {
    streaming = true;
  }

  return {
    messages,
    workLog,
    byteOffset: newByteOffset,
    streaming,
    totalCost,
    pendingToolUse,
    unresolvedResults,
    lastSequence: sequence,
  };
}

export async function summarizeConversationActivity(
  sessionFile: string,
): Promise<ConversationActivitySummary> {
  const { messages, workLog, streaming } = await parseConversationMessages(sessionFile);
  const lastMsg = messages[messages.length - 1];
  // Agent is idle only when the last message is an assistant message with a terminal
  // completedAt (stop_reason was end_turn/max_tokens/stop_sequence). Any other state
  // — empty history, last message is user (tool result or prompt), or last message is
  // an assistant still streaming / waiting on tool_use — means the agent is working.
  const isWorking = messages.length === 0 ||
    lastMsg?.role === 'user' ||
    (lastMsg?.role === 'assistant' && !lastMsg.completedAt);

  // Find the most recent pending tool (tool_use sent but tool_result not yet received)
  let currentTool: string | null = null;
  for (let i = workLog.length - 1; i >= 0; i--) {
    const entry = workLog[i];
    if (entry.tone === 'tool' && !entry.result && entry.toolTitle) {
      currentTool = entry.toolTitle;
      break;
    }
  }

  return { messages, streaming, isWorking, currentTool };
}

// ─── Compact boundary offset cache ───────────────────────────────────────────

/**
 * In-memory cache mapping JSONL file path → last compact_boundary byte offset.
 * Persists across requests so we don't re-scan the entire file each time.
 */
const compactOffsetCache = new Map<string, { boundaryOffset: number; fileSize: number }>();

/**
 * Find the byte offset of the last `compact_boundary` system entry in a JSONL file.
 *
 * Uses an in-memory cache keyed by file path + size. When the file grows beyond
 * the cached size, only the new portion is scanned. Returns 0 if no boundary found.
 */
export async function findLastCompactBoundary(sessionFile: string): Promise<number> {
  const fileStats = await stat(sessionFile);
  const fileSize = fileStats.size;

  const cached = compactOffsetCache.get(sessionFile);

  // If file hasn't grown since last scan, return cached offset without reading
  if (cached && cached.fileSize === fileSize) {
    return cached.boundaryOffset;
  }

  // No cache or file shrank — read entire file
  if (!cached || fileSize < cached.fileSize) {
    const buffer = await readFile(sessionFile);
    const text = buffer.toString('utf-8');

    let lastBoundaryOffset = 0;
    let bytePos = 0;
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
            lastBoundaryOffset = bytePos;
          }
        } catch { /* skip invalid lines */ }
      }
      bytePos += Buffer.byteLength(line, 'utf-8') + 1; // +1 for \n
    }

    compactOffsetCache.set(sessionFile, { boundaryOffset: lastBoundaryOffset, fileSize });
    return lastBoundaryOffset;
  }

  // File grew — read only the new portion
  const newBytes = fileSize - cached.fileSize;
  const fh = await open(sessionFile, 'r');
  let buf: Buffer;
  try {
    buf = Buffer.alloc(newBytes);
    await fh.read(buf, 0, newBytes, cached.fileSize);
  } finally {
    await fh.close();
  }

  // If new content starts mid-line, skip to the first complete line
  let scanStart = 0;
  if (buf.length > 0 && buf[0] !== 10 && cached.fileSize > 0) {
    const nlIdx = buf.indexOf(10);
    if (nlIdx !== -1) {
      scanStart = nlIdx + 1;
    } else {
      // No complete line in new content — nothing to scan
      compactOffsetCache.set(sessionFile, { boundaryOffset: cached.boundaryOffset, fileSize });
      return cached.boundaryOffset;
    }
  }

  const scanBuf = buf.slice(scanStart);
  const text = scanBuf.toString('utf-8');

  let lastBoundaryOffset = cached.boundaryOffset;
  let bytePos = cached.fileSize + scanStart;
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.trim()) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
          lastBoundaryOffset = bytePos;
        }
      } catch { /* skip invalid lines */ }
    }
    bytePos += Buffer.byteLength(line, 'utf-8') + 1; // +1 for \n
  }

  compactOffsetCache.set(sessionFile, { boundaryOffset: lastBoundaryOffset, fileSize });
  return lastBoundaryOffset;
}

/**
 * Parse a JSONL session file starting from the last compact boundary.
 *
 * Returns only messages from the current context window — everything after
 * the most recent compaction. For sessions that have never been compacted,
 * returns all messages.
 */
export async function parseFromLastCompactBoundary(
  sessionFile: string,
): Promise<ParseResult> {
  const boundaryOffset = await findLastCompactBoundary(sessionFile);
  return parseConversationMessages(sessionFile, boundaryOffset);
}

// ─── File watcher ─────────────────────────────────────────────────────────────

export interface ConversationWatchHandle {
  stop: () => void;
}

/**
 * Watch a JSONL session file for appends. Calls `callback` with parse results
 * when new content is detected. Uses fs.watch with 500ms polling fallback.
 *
 * Returns a handle with `stop()` to clean up.
 */
export function watchConversation(
  sessionFile: string,
  callback: (result: ParseResult) => void,
): ConversationWatchHandle {
  let byteOffset = 0;
  let priorState: ParseState | undefined;
  let stopped = false;
  let isParsing = false;
  let abortController: AbortController | null = null;
  let pollInterval: ReturnType<typeof setTimeout> | null = null;

  async function handleChange(): Promise<void> {
    if (stopped || isParsing) return;
    isParsing = true;
    try {
      const result = await parseConversationMessages(sessionFile, byteOffset, priorState);
      if (result.byteOffset < byteOffset) {
        // File was truncated or rotated — reset to full re-parse
        byteOffset = 0;
        priorState = undefined;
        const fullResult = await parseConversationMessages(sessionFile, 0);
        if (fullResult.byteOffset > 0) {
          byteOffset = fullResult.byteOffset;
          priorState = {
            pendingToolUse: fullResult.pendingToolUse,
            unresolvedResults: fullResult.unresolvedResults,
            lastSequence: fullResult.lastSequence,
          };
          // Include in-flight tools so the live view shows pending work
          const workLog = [...fullResult.workLog, ...fullResult.pendingToolUse.values()];
          callback({ ...fullResult, workLog });
        }
      } else if (result.byteOffset > byteOffset) {
        byteOffset = result.byteOffset;
        priorState = {
          pendingToolUse: result.pendingToolUse,
          unresolvedResults: result.unresolvedResults,
          lastSequence: result.lastSequence,
        };
        // Include in-flight tools so the live view shows pending work
        const workLog = [...result.workLog, ...result.pendingToolUse.values()];
        callback({ ...result, workLog });
      }
    } catch {
      // File may have been rotated or is temporarily unavailable
    } finally {
      isParsing = false;
    }
  }

  // Try fs.watch first (inotify on Linux)
  async function startWatch(): Promise<void> {
    try {
      abortController = new AbortController();
      const watcher = watch(sessionFile, { signal: abortController.signal });
      for await (const _event of watcher) {
        await handleChange();
      }
    } catch (err) {
      if (!stopped) {
        // Fallback to polling on watch failure
        startPolling();
      }
    }
  }

  function startPolling(): void {
    async function poll(): Promise<void> {
      if (stopped) return;
      await handleChange();
      pollInterval = setTimeout(poll, 500);
    }
    pollInterval = setTimeout(poll, 500);
  }

  // Start watch and fall back to polling if watch fails after 1s
  startWatch();
  const watchTimeout = setTimeout(() => {
    // If watch hasn't reported any changes by now, also start polling as backup
    if (!stopped && pollInterval === null) {
      startPolling();
    }
  }, 1000);

  return {
    stop() {
      stopped = true;
      clearTimeout(watchTimeout);
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      if (pollInterval !== null) {
        clearTimeout(pollInterval);
        pollInterval = null;
      }
    },
  };
}
