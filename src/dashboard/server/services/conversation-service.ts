/**
 * Conversation Service (PAN-451)
 *
 * Provides JSONL session file discovery, parsing, and file watching for
 * structured conversation message rendering in Mission Control.
 *
 * All file I/O uses fs/promises (no sync calls).
 */

import { readdir, readFile, stat, watch, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ChatMessage, CompactBoundary, ContextUsage, ProposedPlan, WorkLogEntry } from '@overdeck/contracts';
import { calculateCostSync, getPricingSync, type AIProvider } from '../../../lib/cost.js';
import { MODEL_CAPABILITIES, resolveModelIdSync } from '../../../lib/model-capabilities.js';
import { encodeClaudeProjectDir } from '../../../lib/paths.js';
import { getHarnessBehavior } from '../../../lib/runtimes/behavior.js';
import { parseCodexConversationMessages } from './codex-conversation-parser.js';
import { summarizeToolInputForWorkLog } from './format-tool-input.js';
import { isPiSessionFile, parsePiConversationMessages } from './pi-conversation-parser.js';
import { isOhmypiSessionFile, parseOhmypiConversationMessages } from './ohmypi-conversation-parser.js';

type ModelCapability = (typeof MODEL_CAPABILITIES)[keyof typeof MODEL_CAPABILITIES];

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
  /** Total estimated cost in USD computed from assistant message usage data (cache-discount aware). */
  totalCost: number;
  /** Total token throughput (input + output + cache read + cache write) across assistant messages. */
  totalTokens: number;
  /** Last assistant usage observed after the active compact boundary. */
  latestAssistantUsage: LatestAssistantUsage | null;
  /** Byte offset of the active compact boundary used for context-window usage. */
  contextBoundaryOffset: number;
  /** Bytes from the active compact boundary through EOF. */
  contextActiveBytes: number;
  /** Unpaired tool_use entries waiting for tool_result (persist across incremental calls). */
  pendingToolUse: Map<string, WorkLogEntry>;
  /** Pre-arrived tool_result entries waiting for tool_use (persist across incremental calls). */
  unresolvedResults: Map<string, { resultText?: string; isError: boolean; rawContent: unknown }>;
  /** Last sequence number assigned (persist across incremental calls). */
  lastSequence: number;
  /** File modification time in ms from the stat call made during parsing. */
  mtimeMs: number;
  /** Active proposed plan (ExitPlanMode with no matching tool_result yet). */
  proposedPlan?: ProposedPlan;
  /** ExitPlanMode tool_use IDs (persist across incremental calls). */
  planToolUseIds?: Set<string>;
  /** Compact boundary markers detected in the JSONL. */
  compactBoundaries?: CompactBoundary[];
  /** Current permission mode (plan/default/bypassPermissions/acceptEdits). */
  permissionMode?: string;
  /** Map assistant message ID → file paths touched by file-modifying tool_use calls. */
  fileEditsByAssistantId?: Map<string, Array<{ tool: string; filePath: string }>>;
  /** ID of the current pendingAssistant message (carried across incremental parses for file-edit tracking). */
  pendingAssistantId?: string;
  /** Orphaned tool_use entry UUIDs awaiting re-keying (carried across incremental parses). */
  orphanToolUseIds?: Set<string>;
  /**
   * Request/message IDs whose usage has already been counted into totalCost/totalTokens.
   * Claude Code writes one API response across several JSONL lines (text block, tool_use
   * block, …) that each repeat the same `usage`; counting every line double-counts cost.
   * Carried across incremental parses so a response split across read boundaries is counted once.
   */
  countedUsageIds?: Set<string>;
}

/** State carried across incremental parseConversationMessages calls. */
export interface ParseState {
  pendingToolUse: Map<string, WorkLogEntry>;
  unresolvedResults: Map<string, { resultText?: string; isError: boolean; rawContent: unknown }>;
  lastSequence: number;
  planToolUseIds?: Set<string>;
  proposedPlan?: ProposedPlan;
  /** Latest assistant usage observed after the active compact boundary. */
  latestAssistantUsage?: LatestAssistantUsage | null;
  /** Byte offset of the active compact boundary used for context-window usage. */
  contextBoundaryOffset?: number;
  /** Current permission mode (plan/default/bypassPermissions/acceptEdits). */
  permissionMode?: string;
  /** Map assistant message ID → file paths touched by file-modifying tool_use calls in that turn. */
  fileEditsByAssistantId?: Map<string, Array<{ tool: string; filePath: string }>>;
  /** ID of the current pendingAssistant message (carried across incremental parses for file-edit tracking). */
  pendingAssistantId?: string;
  /** Orphaned tool_use entry UUIDs awaiting re-keying (carried across incremental parses). */
  orphanToolUseIds?: Set<string>;
  /** Request/message IDs already counted into cost/tokens (see ParseResult.countedUsageIds). */
  countedUsageIds?: Set<string>;
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

/** Maximum bytes to read in a single incremental chunk (10 MB). */
const MAX_READ_BYTES = 10 * 1024 * 1024;
const MAX_FALLBACK_BYTES = 5 * 1024 * 1024;

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
  /** Claude Code per-API-request id. Stable across the multiple JSONL lines of one response. */
  requestId?: string;
}

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
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

function unwrapChannelMessage(text: string): string | null {
  const match = text.match(/^<channel\b[^>]*>\n?([\s\S]*?)\n?<\/channel>$/);
  return match ? match[1] : null;
}

function renderableUserText(text: string): string | null {
  const channelText = unwrapChannelMessage(text);
  if (channelText !== null) return channelText;
  return isSystemInjection(text) ? null : text;
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
  let fileStats: Awaited<ReturnType<typeof stat>>;
  try {
    fileStats = await stat(sessionFile);
  } catch {
    // The transcript file does not exist yet — a freshly-spawned conversation
    // whose runtime has not written its first JSONL line. Treat this as an empty
    // transcript (0 messages) instead of throwing, so a live subscriber can
    // attach the instant the conversation row exists and self-populate once the
    // file appears (watchConversation polls until it does). Mirrors the empty
    // result the truncation branch below returns.
    return {
      messages: [],
      workLog: [],
      byteOffset: 0,
      streaming: false,
      totalCost: 0,
      totalTokens: 0,
      latestAssistantUsage: null,
      contextBoundaryOffset: 0,
      contextActiveBytes: 0,
      pendingToolUse: priorState?.pendingToolUse ?? new Map(),
      unresolvedResults: priorState?.unresolvedResults ?? new Map(),
      lastSequence: priorState?.lastSequence ?? 0,
      mtimeMs: 0,
      permissionMode: priorState?.permissionMode,
      fileEditsByAssistantId: new Map(),
    };
  }
  const fileSize = fileStats.size;

  // File was truncated or rotated since last read — signal reset to caller
  if (fromByteOffset > fileSize) {
    return {
      messages: [],
      workLog: [],
      byteOffset: 0,
      streaming: false,
      totalCost: 0,
      totalTokens: 0,
      latestAssistantUsage: null,
      contextBoundaryOffset: 0,
      contextActiveBytes: fileStats.size,
      pendingToolUse: priorState?.pendingToolUse ?? new Map(),
      unresolvedResults: priorState?.unresolvedResults ?? new Map(),
      lastSequence: priorState?.lastSequence ?? 0,
      mtimeMs: fileStats.mtimeMs,
      permissionMode: priorState?.permissionMode,
      fileEditsByAssistantId: new Map(),
    };
  }

  if (fromByteOffset === 0 && !priorState && fileSize > MAX_READ_BYTES) {
    return parseEntireConversation(sessionFile);
  }

  const toRead = Math.max(0, Math.min(fileSize - fromByteOffset, MAX_READ_BYTES));
  const isIncremental = fromByteOffset > 0;

  let newText = '';
  let newByteOffset = fromByteOffset;

  if (toRead > 0) {
    const fh = await open(sessionFile, 'r');
    try {
      const buf = Buffer.alloc(toRead);
      const { bytesRead } = await fh.read(buf, 0, toRead, fromByteOffset);

      if (bytesRead > 0) {
        const lastNewline = buf.lastIndexOf('\n', bytesRead - 1);

        if (lastNewline !== -1) {
          // At least one complete line — advance only past complete lines
          newText = buf.toString('utf-8', 0, lastNewline + 1);
          newByteOffset = fromByteOffset + lastNewline + 1;
        } else if (!isIncremental && fromByteOffset + bytesRead >= fileSize) {
          // Full parse at EOF with no trailing newline — include trailing bytes
          newText = buf.toString('utf-8', 0, bytesRead);
          newByteOffset = fromByteOffset + bytesRead;
        } else if (fromByteOffset + bytesRead >= fileSize) {
          // Incremental parse at EOF with no newline — don't advance, wait for completion
          newByteOffset = fromByteOffset;
        } else {
          // No newline in a full chunk and more file remains (line exceeds MAX_READ_BYTES).
          // Read more to find a newline boundary, but cap to avoid OOM on pathological files.
          const remaining = Math.min(fileSize - fromByteOffset, MAX_FALLBACK_BYTES);
          const fullBuf = Buffer.alloc(remaining);
          const { bytesRead: fullBytesRead } = await fh.read(fullBuf, 0, remaining, fromByteOffset);
          const fullLastNewline = fullBuf.lastIndexOf('\n', fullBytesRead - 1);
          if (fullLastNewline !== -1) {
            newText = fullBuf.toString('utf-8', 0, fullLastNewline + 1);
            newByteOffset = fromByteOffset + fullLastNewline + 1;
          } else if (!isIncremental) {
            newText = fullBuf.toString('utf-8', 0, fullBytesRead);
            newByteOffset = fromByteOffset + fullBytesRead;
          } else {
            newByteOffset = fromByteOffset;
          }
        }
      }
    } finally {
      await fh.close();
    }
  }

  const lines = newText.split('\n');

  const messages: ChatMessage[] = [];
  const workLog: WorkLogEntry[] = [];
  let totalCost = 0;
  let totalTokens = 0;
  let latestAssistantUsage = priorState?.latestAssistantUsage ?? null;
  let maxObservedInputTokens = latestAssistantUsage?.maxObservedInputTokens ?? 0;
  let contextBoundaryOffset = priorState?.contextBoundaryOffset ?? 0;

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
  // Plan mode: track ExitPlanMode tool_use id → ProposedPlan
  let proposedPlan: ProposedPlan | undefined = priorState?.proposedPlan;
  // Set of ExitPlanMode tool_use IDs so we can match tool_results to plans
  const planToolUseIds = priorState?.planToolUseIds ?? new Set<string>();
  // Compact boundary markers
  const compactBoundaries: CompactBoundary[] = [];
  // Track permission mode across incremental parses
  let permissionMode: string | undefined = priorState?.permissionMode;
  // Track file-modifying tool_use calls per assistant message for diff computation
  const fileEditsByAssistantId = new Map<string, Array<{ tool: string; filePath: string }>>();
  const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
  // Tool_use entries arrive with their own UUID, separate from the text entry that follows.
  // We track these UUIDs so we can re-key edits when the text entry merges them into one message.
  const orphanToolUseIds = priorState?.orphanToolUseIds
    ? new Set(priorState.orphanToolUseIds)
    : new Set<string>();
  // Request/message IDs whose usage has already been counted, so a response spread across
  // multiple JSONL lines (or across incremental read boundaries) is counted exactly once.
  const countedUsageIds = priorState?.countedUsageIds ?? new Set<string>();
  // Carry the prior assistant ID for file-edit association only. Do not
  // materialize it as a ChatMessage: a later flush before user/tool-result lines
  // would emit an invalid ID-only assistant delta.
  const pendingAssistantIdForEdits = priorState?.pendingAssistantId;

  let lineByteOffset = fromByteOffset;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const currentLineByteOffset = lineByteOffset;
    lineByteOffset += Buffer.byteLength(line, 'utf-8') + (i < lines.length - 1 ? 1 : 0);
    if (!line.trim()) continue;

    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line.replace(/\r$/, '')) as JsonlEntry;
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
        const text = renderableUserText(rawContent);
        if (text !== null) {
          const ts = entry.timestamp ?? new Date().toISOString();
          lastUserTimestamp = ts;
          messages.push({
            id: entry.uuid ?? `user-${messages.length}`,
            role: 'user',
            text,
            createdAt: ts,
            sequence: lineSequence,
          });
        }
      } else if (Array.isArray(rawContent)) {
        // Collect tool_result blocks first (they complete pending WorkLogEntries)
        for (const block of rawContent as ContentBlock[]) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            let resultText: string | undefined;
            if (typeof block.content === 'string') {
              resultText = block.content;
            } else if (Array.isArray(block.content)) {
              resultText = (block.content as Array<{ type?: string; text?: string }>)
                .filter(b => b.type === 'text' && b.text)
                .map(b => b.text)
                .join('\n');
            }
            if (planToolUseIds.has(block.tool_use_id)) {
              if (proposedPlan && proposedPlan.id === block.tool_use_id) {
                const text = resultText ?? '';
                if (text.includes('approved')) {
                  proposedPlan = { ...proposedPlan, status: 'approved', resolvedAt: entry.timestamp ?? new Date().toISOString() };
                } else if (text.includes("doesn't want to proceed") || text.includes('does not want')) {
                  proposedPlan = { ...proposedPlan, status: 'rejected', resolvedAt: entry.timestamp ?? new Date().toISOString() };
                }
              }
            } else {
              const pending = pendingToolUse.get(block.tool_use_id);
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
                unresolvedResults.set(block.tool_use_id, {
                  resultText,
                  isError: block.is_error ?? false,
                  rawContent: block.content,
                });
              }
            }
          }
        }

        // Collect all text blocks, joining with newlines to preserve multiline input
        const textBlocks: string[] = [];
        for (const block of rawContent as ContentBlock[]) {
          if (block.type === 'text' && block.text) {
            const text = renderableUserText(block.text);
            if (text !== null) textBlocks.push(text);
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

      if (msg.usage) {
        const input = msg.usage.input_tokens ?? 0;
        const cacheRead = msg.usage.cache_read_input_tokens ?? 0;
        const cacheCreate = msg.usage.cache_creation_input_tokens ?? 0;
        const turnInput = input + cacheRead + cacheCreate;
        if (turnInput > maxObservedInputTokens) maxObservedInputTokens = turnInput;
        latestAssistantUsage = {
          lastInputTokens: input,
          lastCacheReadTokens: cacheRead,
          lastCacheCreationTokens: cacheCreate,
          maxObservedInputTokens,
          lastModel: msg.model ?? null,
          lastTimestamp: entry.timestamp ?? null,
        };
      }

      // Accumulate cost and token throughput from usage data.
      // Claude Code repeats the same `usage` on every JSONL line of one API response
      // (the text line, each tool_use line, …); dedup on requestId/message.id so each
      // response is counted once, otherwise multi-block turns inflate cost ~2-3×.
      const usageId = entry.requestId ?? msg.id;
      if (msg.usage && (usageId === undefined || !countedUsageIds.has(usageId))) {
        if (usageId !== undefined) countedUsageIds.add(usageId);
        totalTokens +=
          (msg.usage.input_tokens ?? 0) +
          (msg.usage.output_tokens ?? 0) +
          (msg.usage.cache_read_input_tokens ?? 0) +
          (msg.usage.cache_creation_input_tokens ?? 0);
        if (msg.model) {
          const pricing = getPricingSync(providerFromModel(msg.model), msg.model);
          if (pricing) {
            totalCost += calculateCostSync({
              inputTokens: msg.usage.input_tokens ?? 0,
              outputTokens: msg.usage.output_tokens ?? 0,
              cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
              cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
            }, pricing);
          }
        }
      }

      let assistantText = '';
      let blockIndex = 0;
      for (const block of content as ContentBlock[]) {
        if (block.type === 'text' && block.text) {
          assistantText += block.text;
        } else if (block.type === 'thinking' && block.thinking) {
          workLog.push({
            id: `${entry.uuid ?? msg.id ?? `asst-${messages.length}`}-thinking-${blockIndex}`,
            createdAt: entry.timestamp ?? new Date().toISOString(),
            label: 'thinking',
            detail: block.thinking,
            tone: 'thinking',
            sequence: lineSequence,
          });
        } else if (block.type === 'tool_use' && block.id) {
          if (block.name === 'ExitPlanMode') {
            const input = block.input as Record<string, unknown> | undefined;
            const planText = typeof input?.plan === 'string' ? input.plan : '';
            const planFilePath = typeof input?.planFilePath === 'string' ? input.planFilePath : undefined;
            proposedPlan = {
              id: block.id,
              plan: planText,
              planFilePath,
              status: 'pending',
              createdAt: entry.timestamp ?? new Date().toISOString(),
            };
            planToolUseIds.add(block.id);
            const unresolved = unresolvedResults.get(block.id);
            if (unresolved) {
              unresolvedResults.delete(block.id);
              const resultText = unresolved.resultText ?? '';
              if (resultText.includes('approved')) {
                proposedPlan = { ...proposedPlan, status: 'approved', resolvedAt: entry.timestamp ?? new Date().toISOString() };
              } else if (resultText.includes("doesn't want to proceed") || resultText.includes('does not want')) {
                proposedPlan = { ...proposedPlan, status: 'rejected', resolvedAt: entry.timestamp ?? new Date().toISOString() };
              }
            }
          } else if (block.name === 'EnterPlanMode') {
            // Skip — don't add to workLog
          } else {
            // Track file-modifying tools for diff computation
            if (block.name && FILE_EDIT_TOOLS.has(block.name) && block.input) {
              const input = block.input as Record<string, unknown>;
              const filePath = typeof input.file_path === 'string' ? input.file_path : undefined;
              if (filePath) {
                const asstId = pendingAssistant?.id ?? pendingAssistantIdForEdits ?? entry.uuid ?? msg.id ?? `asst-${messages.length}`;
                // If no pendingAssistant, this tool_use UUID is orphaned — the text entry
                // will merge it into the final message with a different UUID.
                if (!pendingAssistant) {
                  orphanToolUseIds.add(asstId);
                }
                let edits = fileEditsByAssistantId.get(asstId);
                if (!edits) {
                  edits = [];
                  fileEditsByAssistantId.set(asstId, edits);
                }
                if (!edits.some(e => e.filePath === filePath)) {
                  edits.push({ tool: block.name!, filePath });
                }
              }
            }
            // WorkLogEntry for the tool call. We pass the raw input dict
            // through as `toolInput` so the frontend can render per-tool
            // (Bash command as a fenced shell block, file tools as chips,
            // etc.) and pre-compute a short one-line summary for the
            // collapsed row via summarizeToolInputForWorkLog. See PAN-1459.
            const inputDict =
              block.input && typeof block.input === 'object' && !Array.isArray(block.input)
                ? (block.input as Record<string, unknown>)
                : undefined;
            const toolEntry: WorkLogEntry = {
              id: block.id,
              createdAt: entry.timestamp ?? new Date().toISOString(),
              label: block.name ?? 'tool',
              tone: 'tool',
              toolTitle: block.name,
              detail: summarizeToolInputForWorkLog(block.name, inputDict),
              toolInput: inputDict,
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
        blockIndex++;
      }

      if (assistantText) {
        const newId = entry.uuid ?? msg.id ?? `asst-${messages.length}`;
        // Flush previous pending assistant
        if (pendingAssistant) {
          messages.push(pendingAssistant);
          // Re-key file edits from old pendingAssistant UUID
          const oldId = pendingAssistant.id;
          if (oldId !== newId) {
            const edits = fileEditsByAssistantId.get(oldId);
            if (edits) {
              fileEditsByAssistantId.delete(oldId);
              fileEditsByAssistantId.set(newId, edits);
            }
          }
        }
        // Re-key orphaned tool_use UUIDs into the merged message's UUID
        for (const orphanId of orphanToolUseIds) {
          if (orphanId !== newId) {
            const edits = fileEditsByAssistantId.get(orphanId);
            if (edits) {
              fileEditsByAssistantId.delete(orphanId);
              const existing = fileEditsByAssistantId.get(newId);
              if (existing) {
                for (const e of edits) {
                  if (!existing.some(x => x.filePath === e.filePath)) existing.push(e);
                }
              } else {
                fileEditsByAssistantId.set(newId, edits);
              }
            }
          }
        }
        orphanToolUseIds.clear();
        pendingAssistant = {
          id: entry.uuid ?? msg.id ?? `asst-${messages.length}`,
          role: 'assistant',
          text: assistantText,
          // createdAt = when the assistant response was generated (preserves
          // chronological order for interleaving with work log entries).
          // Duration start is computed separately in session-logic.ts.
          createdAt: entry.timestamp ?? new Date().toISOString(),
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
    } else if (entry.type === 'system' && (entry as Record<string, unknown>).subtype === 'compact_boundary') {
      contextBoundaryOffset = currentLineByteOffset;
      latestAssistantUsage = null;
      maxObservedInputTokens = 0;
      const meta = (entry as Record<string, unknown>).compactMetadata as Record<string, unknown> | undefined;
      compactBoundaries.push({
        id: (entry as Record<string, unknown>).uuid as string ?? `compact-${lineSequence}`,
        timestamp: entry.timestamp ?? new Date().toISOString(),
        trigger: typeof meta?.trigger === 'string' ? meta.trigger : undefined,
        preTokens: typeof meta?.preTokens === 'number' ? meta.preTokens : undefined,
        model: typeof meta?.model === 'string' ? meta.model : undefined,
      });
    } else if (entry.type === 'permission-mode') {
      // Track permission mode transitions. Exiting 'plan' mode is an approval
      // signal when no explicit plan_mode_exit attachment was emitted.
      const newMode = (entry as Record<string, unknown>).permissionMode as string | undefined;
      if (newMode && permissionMode === 'plan' && newMode !== 'plan') {
        if (proposedPlan && proposedPlan.status === 'pending') {
          proposedPlan = { ...proposedPlan, status: 'approved', resolvedAt: entry.timestamp ?? new Date().toISOString() };
        }
      }
      permissionMode = newMode;
    } else if (entry.type === 'attachment') {
      // Claude Code 2.1.121+ attachment-based plan mode protocol.
      // The agent writes the plan to ~/.claude/plans/<slug>.md and the runtime
      // emits a `plan_file_reference` attachment with the full content. Approval
      // is signalled by a subsequent `plan_mode_exit` attachment.
      const attachment = (entry as Record<string, unknown>).attachment as Record<string, unknown> | undefined;
      if (attachment?.type === 'plan_file_reference') {
        const planContent = typeof attachment.planContent === 'string' ? attachment.planContent : '';
        if (planContent) {
          const planFilePath = typeof attachment.planFilePath === 'string' ? attachment.planFilePath : undefined;
          const id = ((entry as Record<string, unknown>).uuid as string | undefined) ?? `plan-${lineSequence}`;
          // If permission mode has already exited 'plan', auto-approve since the
          // user already approved before this attachment arrived (or no exit was emitted).
          const alreadyApproved = permissionMode !== 'plan' && permissionMode !== undefined;
          proposedPlan = {
            id,
            plan: planContent,
            planFilePath,
            status: alreadyApproved ? 'approved' : 'pending',
            createdAt: entry.timestamp ?? new Date().toISOString(),
            ...(alreadyApproved ? { resolvedAt: entry.timestamp ?? new Date().toISOString() } : {}),
          };
        }
      } else if (attachment?.type === 'plan_mode_exit') {
        if (proposedPlan && proposedPlan.status === 'pending') {
          proposedPlan = { ...proposedPlan, status: 'approved', resolvedAt: entry.timestamp ?? new Date().toISOString() };
        }
      } else if (attachment?.type === 'plan_mode') {
        // Claude Code plan_mode attachment: agent called EnterPlanMode, plan written
        // to an external file. Always start as 'pending' — the permission-mode
        // transition handler (plan → other) will mark it approved when that fires.
        const planFilePath = typeof attachment.planFilePath === 'string' ? attachment.planFilePath : undefined;
        if (planFilePath) {
          try {
            const planContent = (await readFile(planFilePath, 'utf-8')).trim();
            if (planContent) {
              const id = ((entry as Record<string, unknown>).uuid as string | undefined) ?? `plan-${lineSequence}`;
              proposedPlan = {
                id,
                plan: planContent,
                planFilePath,
                status: 'pending',
                createdAt: entry.timestamp ?? new Date().toISOString(),
              };
            }
          } catch {
            // Plan file not yet written — will show once the agent finishes planning
          }
        }
      } else if (attachment?.type === 'queued_command' && attachment?.commandMode === 'prompt') {
        // User message sent as an interrupt while Claude was running — stored as
        // queued_command instead of a regular user entry. Render it in the timeline.
        const prompt = attachment.prompt;
        let text = '';
        if (typeof prompt === 'string') {
          text = prompt;
        } else if (Array.isArray(prompt)) {
          text = (prompt as Array<{ type?: string; text?: string }>)
            .filter((b) => b.type === 'text' && b.text)
            .map((b) => b.text)
            .join('\n');
        }
        const renderableText = text ? renderableUserText(text) : null;
        if (renderableText !== null) {
          if (pendingAssistant) {
            messages.push(pendingAssistant);
            pendingAssistant = null;
          }
          const ts = entry.timestamp ?? new Date().toISOString();
          lastUserTimestamp = ts;
          messages.push({
            id: ((entry as Record<string, unknown>).uuid as string | undefined) ?? `queued-${lineSequence}`,
            role: 'user',
            text: renderableText,
            createdAt: ts,
            sequence: lineSequence,
          });
        }
      } else if (attachment?.type === 'command_permissions') {
        // Session start / resume record — contains the allowedTools list.
        // Render as a system message so the user can see what permissions are in effect.
        const rawTools = Array.isArray(attachment.allowedTools)
          ? (attachment.allowedTools as unknown[]).filter((t) => typeof t === 'string') as string[]
          : [];
        const tools = rawTools.length > 0 ? rawTools.join(', ') : 'None';
        const ts = entry.timestamp ?? new Date().toISOString();
        messages.push({
          id: ((entry as Record<string, unknown>).uuid as string | undefined) ?? `perm-${lineSequence}`,
          role: 'system',
          text: tools,
          createdAt: ts,
          sequence: lineSequence,
        });
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
    for (const [id, entry] of pendingToolUse) {
      if (!planToolUseIds.has(id)) {
        workLog.push(entry);
      }
    }
    pendingToolUse.clear();
  }

  // Sort by (createdAt, sequence) so the conversation view matches terminal order.
  // Use direct string comparison (not localeCompare) — ISO 8601 timestamps sort lexicographically.
  // For incremental parses (the hot path), messages arrive in file order and are already
  // sorted — skip the O(n log n) sort entirely.
  if (!isIncremental) {
    messages.sort((a, b) => {
      if (a.createdAt < b.createdAt) return -1;
      if (a.createdAt > b.createdAt) return 1;
      return (a.sequence ?? 0) - (b.sequence ?? 0);
    });
    workLog.sort((a, b) => {
      if (a.createdAt < b.createdAt) return -1;
      if (a.createdAt > b.createdAt) return 1;
      return (a.sequence ?? 0) - (b.sequence ?? 0);
    });
  }

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
    totalTokens,
    latestAssistantUsage,
    contextBoundaryOffset,
    contextActiveBytes: Math.max(0, fileStats.size - contextBoundaryOffset),
    pendingToolUse,
    unresolvedResults,
    lastSequence: sequence,
    mtimeMs: fileStats.mtimeMs,
    proposedPlan,
    planToolUseIds,
    compactBoundaries,
    permissionMode,
    fileEditsByAssistantId,
    pendingAssistantId: pendingAssistant?.id ?? pendingAssistantIdForEdits,
    orphanToolUseIds: orphanToolUseIds.size > 0 ? orphanToolUseIds : undefined,
    countedUsageIds,
  };
}

/**
 * Parse an ENTIRE JSONL transcript, regardless of size.
 *
 * `parseConversationMessages(file, offset, state)` reads at most MAX_READ_BYTES
 * (10 MB) in a single incremental call. This helper loops the same parser in
 * bounded chunks for callers that need a complete transcript snapshot.
 *
 * ParseState is threaded from the first chunk so tool_use/tool_result pairs can
 * span chunk boundaries. Per-chunk totals are safe to sum because
 * `countedUsageIds` is threaded, so a response split across a read boundary is
 * counted once.
 */
export async function parseEntireConversation(
  sessionFile: string,
  options: { flushPendingToolUse?: boolean } = {},
): Promise<ParseResult> {
  let offset = 0;
  let priorState: ParseState = {
    pendingToolUse: new Map(),
    unresolvedResults: new Map(),
    lastSequence: 0,
  };
  const messages: ChatMessage[] = [];
  const workLog: WorkLogEntry[] = [];
  const compactBoundaries: CompactBoundary[] = [];
  let totalCost = 0;
  let totalTokens = 0;
  let last: ParseResult | null = null;

  // Bounded loop: at 10 MB/chunk this covers a 10 GB transcript. The real exit
  // is "byteOffset stopped advancing" (EOF or an incomplete trailing line).
  for (let guard = 0; guard < 1024; guard++) {
    const result = await parseConversationMessages(sessionFile, offset, priorState);
    messages.push(...result.messages);
    workLog.push(...result.workLog);
    if (result.compactBoundaries?.length) compactBoundaries.push(...result.compactBoundaries);
    totalCost += result.totalCost;
    totalTokens += result.totalTokens;
    last = result;

    if (result.byteOffset <= offset) break; // no progress → EOF
    offset = result.byteOffset;
    priorState = {
      pendingToolUse: result.pendingToolUse,
      unresolvedResults: result.unresolvedResults,
      lastSequence: result.lastSequence,
      planToolUseIds: result.planToolUseIds,
      proposedPlan: result.proposedPlan,
      latestAssistantUsage: result.latestAssistantUsage,
      contextBoundaryOffset: result.contextBoundaryOffset,
      permissionMode: result.permissionMode,
      fileEditsByAssistantId: result.fileEditsByAssistantId,
      pendingAssistantId: result.pendingAssistantId,
      orphanToolUseIds: result.orphanToolUseIds,
      countedUsageIds: result.countedUsageIds,
    };
  }

  if (!last) return parseConversationMessages(sessionFile, 0);

  if (options.flushPendingToolUse ?? true) {
    for (const [id, entry] of last.pendingToolUse) {
      if (!last.planToolUseIds?.has(id)) {
        workLog.push(entry);
      }
    }
    last.pendingToolUse.clear();
  }

  // Take terminal state (byteOffset, boundary offsets, pending maps, mtime, …)
  // from the final chunk; replace the accumulating fields with the full totals.
  return { ...last, messages, workLog, compactBoundaries, totalCost, totalTokens };
}

/**
 * PAN-1635: a conversation whose JSONL hasn't been written in this long is no
 * longer "working" — even if its last entry is a trailing user/meta line (e.g. a
 * post-compaction summary whose follow-up prompt was eaten by the compaction).
 * Generous enough not to flap a slow-but-live turn; finite so a stranded session
 * can't spin forever.
 */
const WORKING_STALENESS_MS = 180_000;

/** In-memory cache mapping sessionFile path → { mtimeMs, size, summary } */
const ACTIVITY_SUMMARY_CACHE_MAX = 100;
const activitySummaryCache = new Map<string, { mtimeMs: number; size: number; summary: ConversationActivitySummary }>();

export async function summarizeConversationActivity(
  sessionFile: string,
  options: { harness?: string | null } = {},
): Promise<ConversationActivitySummary> {
  const fileStats = await stat(sessionFile);
  const cacheKey = `${options.harness ?? 'claude-code'}:${sessionFile}`;
  const behavior = getHarnessBehavior(options.harness as Parameters<typeof getHarnessBehavior>[0]);
  const cached = activitySummaryCache.get(cacheKey);
  if (cached && cached.mtimeMs === fileStats.mtimeMs && cached.size === fileStats.size) {
    return cached.summary;
  }

  const parsed = behavior.transcriptKind === 'codex-rollout-jsonl' ? await parseCodexConversationMessages(sessionFile)
    : behavior.transcriptKind === 'ohmypi-jsonl' || isOhmypiSessionFile(sessionFile) ? await parseOhmypiConversationMessages(sessionFile)
    : isPiSessionFile(sessionFile) ? await parsePiConversationMessages(sessionFile)
      // Parse from the last compact boundary instead of the full file — avoids
      // re-reading potentially megabytes of history on every list enrichment tick.
      // Pass an empty priorState so pendingToolUse stays populated rather than being
      // flushed into workLog. This lets us detect genuinely pending tools.
      : await parseFromLastCompactBoundary(
          sessionFile,
          { pendingToolUse: new Map(), unresolvedResults: new Map(), lastSequence: 0 },
        );
  const { messages, streaming, pendingToolUse, workLog, mtimeMs } = parsed;
  const lastMsg = messages[messages.length - 1];
  // Agent is idle only when the last message is an assistant message with a terminal
  // completedAt (stop_reason was end_turn/max_tokens/stop_sequence). Any other state
  // — empty history, last message is user (tool result or prompt), or last message is
  // an assistant still streaming / waiting on tool_use — means the agent is working.
  //
  // PAN-1635: guard on file recency. After a compaction the only post-boundary
  // entries are user-role meta lines (compact summary, /compact echoes) with no
  // following assistant turn, so the raw heuristic below pegs isWorking true
  // forever. A session whose JSONL has been idle for WORKING_STALENESS_MS is not
  // working — mirrors the `fileRecent` guards on `streaming` and `currentTool`.
  // The window is generous (covers a long compaction / deep think that writes
  // nothing for a while); during a real in-progress compaction the PreCompact
  // hook's activity event keeps the card "working" independently.
  const workingFileRecent = Date.now() - mtimeMs < WORKING_STALENESS_MS;
  const isWorking = workingFileRecent && (
    messages.length === 0 ||
    lastMsg?.role === 'user' ||
    (lastMsg?.role === 'assistant' && !lastMsg.completedAt));

  // Find the most recent pending tool (tool_use sent but tool_result not yet received).
  // pendingToolUse holds the actual unpaired tool_uses, so this works correctly for
  // parallel tool calls where multiple tools are in flight simultaneously.
  // Time-bound: if the file hasn't been modified in 30s, the agent has likely crashed
  // and pending tools are stale — don't report a stale currentTool.
  const fileRecent = Date.now() - mtimeMs < 30_000;

  let currentTool: string | null = null;
  if (fileRecent) {
    let maxSequence = -1;
    for (const entry of pendingToolUse.values()) {
      if (entry.toolTitle && (entry.sequence ?? -1) > maxSequence) {
        maxSequence = entry.sequence ?? -1;
        currentTool = entry.toolTitle;
      }
    }
    if (!currentTool && behavior.transcriptKind === 'codex-rollout-jsonl') {
      for (const entry of workLog) {
        if (entry.tone === 'tool' && !entry.result && (entry.sequence ?? -1) > maxSequence) {
          maxSequence = entry.sequence ?? -1;
          currentTool = entry.label;
        }
      }
    }
  }

  const summary: ConversationActivitySummary = { messages, streaming, isWorking, currentTool };
  activitySummaryCache.set(cacheKey, { mtimeMs, size: fileStats.size, summary });
  if (activitySummaryCache.size > ACTIVITY_SUMMARY_CACHE_MAX) {
    const firstKey = activitySummaryCache.keys().next().value;
    if (firstKey !== undefined) {
      activitySummaryCache.delete(firstKey);
    }
  }
  return summary;
}

// ─── Compact boundary offset cache ───────────────────────────────────────────

/**
 * In-memory cache mapping JSONL file path → last compact_boundary byte offset
 * and the byte offset up to which we've scanned complete lines.
 * Persists across requests so we don't re-scan the entire file each time.
 */
const COMPACT_OFFSET_CACHE_MAX = 100;
const compactOffsetCache = new Map<string, { boundaryOffset: number; scannedUpTo: number }>();

function setCompactOffsetCache(sessionFile: string, value: { boundaryOffset: number; scannedUpTo: number }): void {
  compactOffsetCache.set(sessionFile, value);
  if (compactOffsetCache.size > COMPACT_OFFSET_CACHE_MAX) {
    const firstKey = compactOffsetCache.keys().next().value;
    if (firstKey !== undefined) {
      compactOffsetCache.delete(firstKey);
    }
  }
}

/**
 * Find the byte offset of the last `compact_boundary` system entry in a JSONL file.
 *
 * Uses an in-memory cache keyed by file path. When the file grows beyond
 * the cached scan position, only the new portion is scanned. Returns 0 if no boundary found.
 */
export async function findLastCompactBoundary(sessionFile: string): Promise<number> {
  const fileStats = await stat(sessionFile);
  const fileSize = fileStats.size;

  const cached = compactOffsetCache.get(sessionFile);

  // If file hasn't grown since last scan, return cached offset without reading
  if (cached && cached.scannedUpTo === fileSize) {
    return cached.boundaryOffset;
  }

  // No cache or file shrank — scan entire file in capped chunks
  if (!cached || fileSize < cached.scannedUpTo) {
    let lastBoundaryOffset = 0;
    let scanPos = 0;
    const fh = await open(sessionFile, 'r');
    try {
      while (scanPos < fileSize) {
        const toRead = Math.min(fileSize - scanPos, MAX_READ_BYTES);
        let buf: Buffer;
        let bytesRead: number;
        try {
          buf = Buffer.alloc(toRead);
          const result = await fh.read(buf, 0, toRead, scanPos);
          bytesRead = result.bytesRead;
        } catch {
          break;
        }

        if (bytesRead === 0) break;

        let scanBytes = bytesRead;
        const lastNewline = buf.lastIndexOf('\n', bytesRead - 1);

        if (lastNewline !== -1) {
          scanBytes = lastNewline + 1;
        } else if (scanPos + bytesRead < fileSize) {
          // No newline in chunk and more file remains — read more, capped
          const remaining = Math.min(fileSize - scanPos, MAX_FALLBACK_BYTES);
          const fullBuf = Buffer.alloc(remaining);
          let fullBytesRead: number;
          try {
            const result = await fh.read(fullBuf, 0, remaining, scanPos);
            fullBytesRead = result.bytesRead;
          } catch {
            break;
          }
          const fullLastNewline = fullBuf.lastIndexOf('\n', fullBytesRead - 1);
          if (fullLastNewline !== -1) {
            scanBytes = fullLastNewline + 1;
            buf = fullBuf;
          } else {
            scanBytes = fullBytesRead;
            buf = fullBuf;
          }
        }

        const text = buf.toString('utf-8', 0, scanBytes);
        let bytePos = scanPos;
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const cleanLine = line.replace(/\r$/, '');
              const entry = JSON.parse(cleanLine);
              if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
                lastBoundaryOffset = bytePos;
              }
            } catch { /* skip invalid lines */ }
          }
          bytePos += Buffer.byteLength(line, 'utf-8') + 1; // +1 for \n
        }

        scanPos += scanBytes;
      }
    } finally {
      await fh.close();
    }

    setCompactOffsetCache(sessionFile, { boundaryOffset: lastBoundaryOffset, scannedUpTo: fileSize });
    return lastBoundaryOffset;
  }

  // File grew — read only the new portion, respecting complete-line boundaries
  const newBytes = fileSize - cached.scannedUpTo;
  const toRead = Math.min(newBytes, MAX_READ_BYTES);
  const fh = await open(sessionFile, 'r');
  try {
    let buf: Buffer;
    let bytesRead: number;
    try {
      buf = Buffer.alloc(toRead);
      const result = await fh.read(buf, 0, toRead, cached.scannedUpTo);
      bytesRead = result.bytesRead;
    } catch {
      setCompactOffsetCache(sessionFile, { boundaryOffset: cached.boundaryOffset, scannedUpTo: fileSize });
      return cached.boundaryOffset;
    }

    let scanBytes = 0;
    if (bytesRead > 0) {
      const lastNewline = buf.lastIndexOf('\n', bytesRead - 1);
      if (lastNewline !== -1) {
        scanBytes = lastNewline + 1;
      } else if (cached.scannedUpTo + bytesRead < fileSize) {
        // No newline in chunk and more file remains — read to EOF, capped
        const remaining = Math.min(fileSize - cached.scannedUpTo, MAX_FALLBACK_BYTES);
        const fullBuf = Buffer.alloc(remaining);
        let fullBytesRead: number;
        try {
          const result = await fh.read(fullBuf, 0, remaining, cached.scannedUpTo);
          fullBytesRead = result.bytesRead;
        } catch {
          setCompactOffsetCache(sessionFile, { boundaryOffset: cached.boundaryOffset, scannedUpTo: fileSize });
          return cached.boundaryOffset;
        }
        const fullLastNewline = fullBuf.lastIndexOf('\n', fullBytesRead - 1);
        if (fullLastNewline !== -1) {
          scanBytes = fullLastNewline + 1;
          buf = fullBuf;
        } else {
          // No newline even at EOF — don't scan partial trailing line
          setCompactOffsetCache(sessionFile, { boundaryOffset: cached.boundaryOffset, scannedUpTo: fileSize });
          return cached.boundaryOffset;
        }
      } else {
        // At EOF with no newline — don't scan partial trailing line
        setCompactOffsetCache(sessionFile, { boundaryOffset: cached.boundaryOffset, scannedUpTo: fileSize });
        return cached.boundaryOffset;
      }
    }

    const text = buf.toString('utf-8', 0, scanBytes);

    let lastBoundaryOffset = cached.boundaryOffset;
    let bytePos = cached.scannedUpTo;
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        try {
          const cleanLine = line.replace(/\r$/, '');
          const entry = JSON.parse(cleanLine);
          if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
            lastBoundaryOffset = bytePos;
          }
        } catch { /* skip invalid lines */ }
      }
      bytePos += Buffer.byteLength(line, 'utf-8') + 1; // +1 for \n
    }

    setCompactOffsetCache(sessionFile, { boundaryOffset: lastBoundaryOffset, scannedUpTo: cached.scannedUpTo + scanBytes });
    return lastBoundaryOffset;
  } finally {
    await fh.close();
  }
}

/**
 * Compute "how full is the context window right now?" from the JSONL.
 *
 * Approach (matches Claude Code's terminal indicator):
 *   1. Find the last compact boundary so we only count tokens in the current
 *      window (post-compaction). For never-compacted sessions, scan the whole
 *      file.
 *   2. Find the last assistant message after the boundary with `usage` data.
 *   3. Sum `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
 *      from that message — those are the tokens the model actually saw on
 *      its most recent turn, i.e. the live context size.
 *   4. Compare against the model's context window. If observed input ever
 *      exceeded the model's default (e.g. Claude Code 1M extended-context
 *      mode for Opus / Sonnet), promote the effective window to 1M.
 *
 * Previous implementation used `fileBytes / 4` as a token estimate. That
 * counts every byte of every tool result, MCP payload, and cached file
 * content in the JSONL, which routinely overshoots actual `input_tokens` by
 * 4-10x. Removed.
 *
 * Returns null when the model is unknown. Returns a zero-token snapshot when
 * the active window has no assistant usage yet.
 */
function resolveContextCapability(model: string | null): ModelCapability | null {
  const normalizedModel = model?.trim();
  if (!normalizedModel) return null;

  const resolvedModel = resolveModelIdSync(normalizedModel);
  return Object.prototype.hasOwnProperty.call(MODEL_CAPABILITIES, resolvedModel)
    ? MODEL_CAPABILITIES[resolvedModel as keyof typeof MODEL_CAPABILITIES]
    : null;
}

function buildContextUsage(
  capability: ModelCapability,
  activeBytes: number,
  usageSummary: LatestAssistantUsage | null,
): ContextUsage {
  if (!usageSummary) {
    // No assistant message with usage yet — return zeros against the
    // declared window so the meter renders an empty ring instead of nothing.
    return {
      activeBytes,
      estimatedTokens: 0,
      contextWindow: capability.contextWindow,
      percentUsed: 0,
    };
  }

  // input + cache_read + cache_creation = total context the model received
  // on the last turn. output_tokens is the next-turn input from the model's
  // perspective, but for "how full is my window NOW?" the input side is the
  // honest answer — Claude Code's terminal uses the same convention.
  const liveContextTokens =
    usageSummary.lastInputTokens +
    usageSummary.lastCacheReadTokens +
    usageSummary.lastCacheCreationTokens;

  // 1M-context detection. Claude Code's extended-context mode (the
  // `context-1m-2025-08-07` beta) lets Opus / Sonnet see up to 1,000,000
  // tokens. We can't read the request headers, but if we've ever seen the
  // model accept more than its default window we know extended context is
  // active. Round up to the next plausible tier rather than guessing.
  const observedCeiling = Math.max(usageSummary.maxObservedInputTokens, liveContextTokens);
  const effectiveContextWindow =
    observedCeiling > capability.contextWindow
      ? Math.max(1_000_000, capability.contextWindow)
      : capability.contextWindow;

  const percentUsed = Math.min(
    100,
    Math.max(0, (liveContextTokens / effectiveContextWindow) * 100),
  );

  return {
    activeBytes,
    estimatedTokens: liveContextTokens,
    contextWindow: effectiveContextWindow,
    percentUsed,
    lastInputTokens: usageSummary.lastInputTokens,
    lastCacheReadTokens: usageSummary.lastCacheReadTokens,
    lastCacheCreationTokens: usageSummary.lastCacheCreationTokens,
    maxObservedInputTokens: usageSummary.maxObservedInputTokens,
    lastModel: usageSummary.lastModel,
    lastTurnAt: usageSummary.lastTimestamp,
  };
}

export function contextUsageFromParseResult(
  result: Pick<ParseResult, 'contextActiveBytes' | 'latestAssistantUsage'>,
  model: string | null,
): ContextUsage | null {
  const capability = resolveContextCapability(model);
  if (!capability) return null;
  return buildContextUsage(capability, result.contextActiveBytes, result.latestAssistantUsage);
}

export async function computeContextUsage(sessionFile: string, model: string | null): Promise<ContextUsage | null> {
  const capability = resolveContextCapability(model);
  if (!capability) return null;

  const boundaryOffset = await findLastCompactBoundary(sessionFile);
  const fileStats = await stat(sessionFile);
  const activeBytes = Math.max(0, fileStats.size - boundaryOffset);

  const usageSummary = await readLatestAssistantUsage(sessionFile, boundaryOffset, activeBytes);
  return buildContextUsage(capability, activeBytes, usageSummary);
}

export interface LatestAssistantUsage {
  lastInputTokens: number;
  lastCacheReadTokens: number;
  lastCacheCreationTokens: number;
  maxObservedInputTokens: number;
  lastModel: string | null;
  lastTimestamp: string | null;
}

/**
 * Stream the JSONL between `boundaryOffset` and EOF, returning usage data
 * from the most recent assistant message + the highest input_tokens ever
 * observed (used for 1M-context detection).
 *
 * Async, line-buffered. Skips malformed lines silently.
 */
async function readLatestAssistantUsage(
  sessionFile: string,
  boundaryOffset: number,
  activeBytes: number,
): Promise<LatestAssistantUsage | null> {
  if (activeBytes <= 0) return null;
  const fh = await open(sessionFile, 'r');
  try {
    const buffer = Buffer.alloc(activeBytes);
    await fh.read(buffer, 0, activeBytes, boundaryOffset);
    const lines = buffer.toString('utf-8').split('\n');

    let result: LatestAssistantUsage | null = null;
    let maxObservedInputTokens = 0;

    for (const line of lines) {
      if (!line.trim()) continue;
      let entry: JsonlEntry;
      try {
        entry = JSON.parse(line.replace(/\r$/, '')) as JsonlEntry;
      } catch {
        continue;
      }
      if (entry.type !== 'assistant' || !entry.message?.usage) continue;
      const u = entry.message.usage;
      const input = u.input_tokens ?? 0;
      const cacheRead = u.cache_read_input_tokens ?? 0;
      const cacheCreate = u.cache_creation_input_tokens ?? 0;
      // Track ceiling across the whole window so a one-off >200k turn flips
      // us to 1M-mode even if the latest turn dropped back down.
      const turnInput = input + cacheRead + cacheCreate;
      if (turnInput > maxObservedInputTokens) maxObservedInputTokens = turnInput;
      // Always replace — we want the *last* one in file order.
      result = {
        lastInputTokens: input,
        lastCacheReadTokens: cacheRead,
        lastCacheCreationTokens: cacheCreate,
        maxObservedInputTokens,
        lastModel: entry.message.model ?? null,
        lastTimestamp: entry.timestamp ?? null,
      };
    }

    if (result) result.maxObservedInputTokens = maxObservedInputTokens;
    return result;
  } finally {
    await fh.close();
  }
}

export async function parseFromLastCompactBoundary(
  sessionFile: string,
  priorState?: ParseState,
): Promise<ParseResult> {
  const boundaryOffset = await findLastCompactBoundary(sessionFile);
  return parseConversationMessages(sessionFile, boundaryOffset, priorState);
}

// ─── Append-only snapshot guard (PAN-1642) ───────────────────────────────────

/**
 * Decide whether a live-stream emission may be sent as an authoritative
 * `snapshot:true` (full transcript replace) or must be downgraded to a
 * non-destructive merge (`snapshot:false`).
 *
 * Root-cause context: claude-code session transcripts are **append-only at a
 * fixed path**. `claude --resume <id>` reuses the same session UUID/file
 * (PAN-830), and both claude-native and Overdeck-native compaction *append*
 * a `compact_boundary` marker rather than truncating. A read that shows the
 * file SHRINK is therefore never a real content reset — it is a transient
 * truncate-rewrite window (a respawn re-writing the resumed file, a read that
 * landed mid-write, or a partial read under load). Emitting that smaller read
 * as `snapshot:true` makes the client replace its populated transcript with the
 * partial/empty one, blanking the view to "How can I help you?" or only the
 * last few messages even while the operator is just reading (PAN-1642).
 *
 * The watcher only sets `fileWasReset` when it observed the file shrink and
 * re-parsed from byte 0, so `newMessageCount` here is a FULL transcript count.
 * We keep a per-subscription high-water mark of the largest full transcript we
 * have emitted and only allow a snapshot that does not shrink it. A shrinking
 * reset is suppressed to a merge; the subsequent appends re-flow normally and
 * `mergeById` on the client dedupes the overlap. Erring toward merge can never
 * lose history — the only failure mode it forgoes is replacing on a genuine
 * smaller session, which cannot happen for an append-only claude-code file on a
 * stable subscription.
 */
export function gateSnapshotEmission(
  fileWasReset: boolean,
  newMessageCount: number,
  highWaterCount: number,
): { snapshot: boolean; highWaterCount: number; suppressedShrink: boolean } {
  if (!fileWasReset) {
    // Normal incremental delta — always a merge, never touches the high-water mark.
    return { snapshot: false, highWaterCount, suppressedShrink: false };
  }
  if (newMessageCount < highWaterCount) {
    // Transient truncate-rewrite read — downgrade to merge so the client keeps
    // its history. Do not lower the high-water mark.
    return { snapshot: false, highWaterCount, suppressedShrink: true };
  }
  // A genuine, non-shrinking full re-parse — safe to assert as the snapshot.
  return { snapshot: true, highWaterCount: newMessageCount, suppressedShrink: false };
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
  callback: (result: ParseResult) => void | Promise<void>,
  options: { byteOffset?: number; priorState?: ParseState } = {},
): ConversationWatchHandle {
  let byteOffset = options.byteOffset ?? 0;
  let priorState: ParseState | undefined = options.priorState;
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
            planToolUseIds: fullResult.planToolUseIds,
            proposedPlan: fullResult.proposedPlan,
            latestAssistantUsage: fullResult.latestAssistantUsage,
            contextBoundaryOffset: fullResult.contextBoundaryOffset,
            permissionMode: fullResult.permissionMode,
            countedUsageIds: fullResult.countedUsageIds,
            fileEditsByAssistantId: fullResult.fileEditsByAssistantId,
            pendingAssistantId: fullResult.pendingAssistantId,
            orphanToolUseIds: fullResult.orphanToolUseIds,
          };
          // Include in-flight tools so the live view shows pending work
          const workLog = [...fullResult.workLog, ...fullResult.pendingToolUse.values()];
          await callback({ ...fullResult, workLog });
        }
      } else if (result.byteOffset > byteOffset) {
        byteOffset = result.byteOffset;
        priorState = {
          pendingToolUse: result.pendingToolUse,
          unresolvedResults: result.unresolvedResults,
          lastSequence: result.lastSequence,
          planToolUseIds: result.planToolUseIds,
          proposedPlan: result.proposedPlan,
          latestAssistantUsage: result.latestAssistantUsage,
          contextBoundaryOffset: result.contextBoundaryOffset,
          permissionMode: result.permissionMode,
          countedUsageIds: result.countedUsageIds,
          fileEditsByAssistantId: result.fileEditsByAssistantId,
          pendingAssistantId: result.pendingAssistantId,
          orphanToolUseIds: result.orphanToolUseIds,
        };
        // Include in-flight tools so the live view shows pending work
        const workLog = [...result.workLog, ...result.pendingToolUse.values()];
        await callback({ ...result, workLog });
      }
    } catch {
      // File may have been rotated or is temporarily unavailable
    } finally {
      isParsing = false;
    }
  }

  // Try fs.watch first (inotify on Linux)
  // Create AbortController synchronously so stop() can always abort,
  // even if called before the async startWatch() body runs.
  abortController = new AbortController();

  async function startWatch(): Promise<void> {
    try {
      const watcher = watch(sessionFile, { signal: abortController!.signal });
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

  // Start watch; polling is only a fallback when fs.watch itself fails.
  startWatch();

  return {
    stop() {
      stopped = true;
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
