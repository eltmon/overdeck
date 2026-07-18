import { open, stat } from 'node:fs/promises';

import type { ChatMessage, WorkLogEntry } from '@overdeck/contracts';

import type {
  AcpTranscriptEntry,
  AcpTranscriptToolCallState,
} from '../../../lib/acp/transcript.js';
import type { ParseResult } from './conversation/types.js';

const TOOL_METADATA_MAX_CHARS = 500;
const STREAMING_RECENCY_MS = 30_000;

interface AcpParserState {
  readonly messages: ChatMessage[];
  readonly workLog: WorkLogEntry[];
  readonly toolIndex: Map<string, number>;
  readonly pendingToolUse: Map<string, WorkLogEntry>;
  sequence: number;
  lastRole: AcpTranscriptEntry['role'] | null;
  currentTurnAssistantIndex: number | undefined;
  lastTurnCompletedAt: string | undefined;
}

interface AcpParserCacheEntry {
  readonly state: AcpParserState;
  readonly identity: string;
  byteOffset: number;
  pendingTail: Buffer;
  mtimeMs: number;
  bytesRead: number;
}

export const ACP_PARSER_CACHE_MAX_ENTRIES = 16;

const parserCache = new Map<string, AcpParserCacheEntry>();
const parserQueue = new Map<string, Promise<void>>();

function touchParserCache(sessionFile: string, cache: AcpParserCacheEntry): void {
  parserCache.delete(sessionFile);
  parserCache.set(sessionFile, cache);
  while (parserCache.size > ACP_PARSER_CACHE_MAX_ENTRIES) {
    const oldest = parserCache.keys().next().value as string | undefined;
    if (!oldest) break;
    parserCache.delete(oldest);
  }
}

function truncateToolMetadata(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > TOOL_METADATA_MAX_CHARS
    ? `${value.slice(0, TOOL_METADATA_MAX_CHARS)}…`
    : value;
}

function isTranscriptEntry(value: unknown): value is AcpTranscriptEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry['timestamp'] === 'string'
    && typeof entry['content'] === 'string'
    && (entry['role'] === 'user'
      || entry['role'] === 'assistant'
      || entry['role'] === 'tool'
      || entry['role'] === 'system');
}

function isToolCall(value: unknown): value is AcpTranscriptToolCallState {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as Record<string, unknown>)['toolCallId'] === 'string';
}

function toToolEntry(
  toolCall: AcpTranscriptToolCallState,
  content: string,
  createdAt: string,
  sequence: number,
): WorkLogEntry {
  const label = truncateToolMetadata(toolCall.title)
    ?? truncateToolMetadata(toolCall.kind)
    ?? 'Tool';
  const detail = truncateToolMetadata(toolCall.detail)
    ?? truncateToolMetadata(content);
  const command = truncateToolMetadata(toolCall.command);
  const terminal = toolCall.status === 'completed' || toolCall.status === 'failed';

  return {
    id: toolCall.toolCallId,
    createdAt,
    label,
    toolTitle: label,
    tone: toolCall.status === 'failed' ? 'error' : 'tool',
    sequence,
    ...(command ? { command } : {}),
    ...(detail && !terminal ? { detail } : {}),
    ...(detail && terminal ? { result: detail } : {}),
  };
}

function createParserState(): AcpParserState {
  return {
    messages: [],
    workLog: [],
    toolIndex: new Map(),
    pendingToolUse: new Map(),
    sequence: 0,
    lastRole: null,
    currentTurnAssistantIndex: undefined,
    lastTurnCompletedAt: undefined,
  };
}

function processTranscriptEntry(state: AcpParserState, entry: AcpTranscriptEntry): void {
  const createdAt = entry.timestamp;

  if (entry.event === 'prompt_queued') return;

  if (entry.event === 'turn_completed' || entry.event === 'prompt_failed') {
    state.lastTurnCompletedAt = createdAt;
    if (state.currentTurnAssistantIndex !== undefined) {
      const assistant = state.messages[state.currentTurnAssistantIndex];
      if (assistant?.role === 'assistant') {
        state.messages[state.currentTurnAssistantIndex] = {
          ...assistant,
          completedAt: createdAt,
          streaming: false,
        };
      }
    }
    state.pendingToolUse.clear();
    if (entry.event === 'turn_completed') return;
  }

  if (entry.role === 'assistant') {
    if (!entry.content) return;
    const previousIndex = state.messages.length - 1;
    const previous = state.lastRole === 'assistant' ? state.messages[previousIndex] : undefined;
    if (previous?.role === 'assistant') {
      state.messages[previousIndex] = {
        ...previous,
        text: previous.text + entry.content,
      };
    } else {
      state.sequence += 1;
      state.messages.push({
        id: `acp-assistant-${state.sequence}`,
        role: 'assistant',
        text: entry.content,
        createdAt,
        streaming: false,
        sequence: state.sequence,
      });
    }
    state.currentTurnAssistantIndex = state.messages.length - 1;
    state.lastRole = entry.role;
    return;
  }

  if (entry.role === 'user' || entry.role === 'system') {
    if (entry.role === 'user') {
      state.currentTurnAssistantIndex = undefined;
      state.lastTurnCompletedAt = undefined;
    }
    const text = entry.content.trim();
    if (!text) return;
    state.sequence += 1;
    state.messages.push({
      id: `acp-${entry.role}-${state.sequence}`,
      role: entry.role,
      text,
      createdAt,
      completedAt: createdAt,
      streaming: false,
      sequence: state.sequence,
    });
    state.lastRole = entry.role;
    return;
  }

  const toolCalls = Array.isArray(entry.toolCalls)
    ? entry.toolCalls.filter(isToolCall)
    : [];
  for (const toolCall of toolCalls) {
    const existingIndex = state.toolIndex.get(toolCall.toolCallId);
    if (existingIndex === undefined) {
      state.sequence += 1;
      const workEntry = toToolEntry(toolCall, entry.content, createdAt, state.sequence);
      state.toolIndex.set(toolCall.toolCallId, state.workLog.length);
      state.workLog.push(workEntry);
    } else {
      const existing = state.workLog[existingIndex]!;
      state.workLog[existingIndex] = {
        ...toToolEntry(toolCall, entry.content, existing.createdAt, existing.sequence ?? 0),
        id: existing.id,
      };
    }

    const current = state.workLog[state.toolIndex.get(toolCall.toolCallId)!]!;
    if (toolCall.status === 'pending' || toolCall.status === 'inProgress') {
      state.pendingToolUse.set(toolCall.toolCallId, current);
    } else {
      state.pendingToolUse.delete(toolCall.toolCallId);
    }
  }
  state.lastRole = entry.role;
}

function processAppendedBytes(cache: AcpParserCacheEntry, appended: Buffer): void {
  const combined = cache.pendingTail.length > 0
    ? Buffer.concat([cache.pendingTail, appended])
    : appended;
  let lineStart = 0;
  for (let index = 0; index < combined.length; index += 1) {
    if (combined[index] !== 0x0a) continue;
    const line = combined.subarray(lineStart, index).toString('utf-8').trim();
    lineStart = index + 1;
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isTranscriptEntry(parsed)) processTranscriptEntry(cache.state, parsed);
    } catch {
      // A malformed complete record is ignored. Partial tails are retained below.
    }
  }
  cache.pendingTail = Buffer.from(combined.subarray(lineStart));
}

async function readRange(path: string, start: number, length: number): Promise<Buffer> {
  if (length <= 0) return Buffer.alloc(0);
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const result = await handle.read(buffer, offset, length - offset, start + offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    return offset === length ? buffer : buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

function snapshotResult(state: AcpParserState, fileSize: number, mtimeMs: number): ParseResult {
  const messages = state.messages.map((message) => ({ ...message }));
  const workLog = state.workLog.map((entry) => ({ ...entry }));
  const workLogById = new Map(workLog.map((entry) => [entry.id, entry]));
  const lastMessage = messages[messages.length - 1];
  const streaming = state.lastTurnCompletedAt === undefined
    && state.lastRole === 'assistant'
    && lastMessage?.role === 'assistant'
    && Date.now() - mtimeMs < STREAMING_RECENCY_MS;
  if (lastMessage?.role === 'assistant' && state.lastTurnCompletedAt === undefined) {
    messages[messages.length - 1] = streaming
      ? { ...lastMessage, streaming: true }
      : { ...lastMessage, completedAt: lastMessage.createdAt };
  }

  return {
    messages,
    workLog,
    byteOffset: fileSize,
    streaming,
    ...(state.lastTurnCompletedAt ? { lastTurnCompletedAt: state.lastTurnCompletedAt } : {}),
    totalCost: 0,
    totalTokens: 0,
    latestAssistantUsage: null,
    contextBoundaryOffset: 0,
    contextActiveBytes: fileSize,
    pendingToolUse: new Map(
      [...state.pendingToolUse].map(([id, entry]) => [id, workLogById.get(id) ?? { ...entry }]),
    ),
    unresolvedResults: new Map(),
    lastSequence: state.sequence,
    mtimeMs,
    planToolUseIds: new Set(),
    compactBoundaries: [],
    fileEditsByAssistantId: new Map(),
  };
}

/**
 * Incrementally parse the append-only ACP transcript into the full snapshot
 * consumed by the dashboard. Parser state is shared by file path, so multiple
 * open panels read and decode each appended byte only once.
 */
async function parseAcpConversationMessagesUnlocked(sessionFile: string): Promise<ParseResult> {
  const fileStats = await stat(sessionFile);
  const identity = `${fileStats.dev}:${fileStats.ino}`;
  let cache = parserCache.get(sessionFile);
  const rewrittenAtSameSize = cache
    && fileStats.size === cache.byteOffset
    && fileStats.mtimeMs !== cache.mtimeMs;
  if (!cache
    || cache.identity !== identity
    || fileStats.size < cache.byteOffset
    || rewrittenAtSameSize) {
    cache = {
      state: createParserState(),
      identity,
      byteOffset: 0,
      pendingTail: Buffer.alloc(0),
      mtimeMs: fileStats.mtimeMs,
      bytesRead: 0,
    };
    touchParserCache(sessionFile, cache);
  }

  if (fileStats.size > cache.byteOffset) {
    const appended = await readRange(
      sessionFile,
      cache.byteOffset,
      fileStats.size - cache.byteOffset,
    );
    processAppendedBytes(cache, appended);
    cache.byteOffset += appended.length;
    cache.bytesRead += appended.length;
  }
  cache.mtimeMs = fileStats.mtimeMs;
  touchParserCache(sessionFile, cache);
  return snapshotResult(cache.state, fileStats.size, fileStats.mtimeMs);
}

export async function parseAcpConversationMessages(sessionFile: string): Promise<ParseResult> {
  const previous = parserQueue.get(sessionFile) ?? Promise.resolve();
  let result: ParseResult | undefined;
  const operation = previous.then(async () => {
    result = await parseAcpConversationMessagesUnlocked(sessionFile);
  });
  const settled = operation.then(
    () => undefined,
    () => undefined,
  );
  parserQueue.set(sessionFile, settled);
  try {
    await operation;
    return result!;
  } finally {
    if (parserQueue.get(sessionFile) === settled) parserQueue.delete(sessionFile);
  }
}

export function acpParserReadStatsForTests(sessionFile: string): {
  readonly byteOffset: number;
  readonly bytesRead: number;
} | undefined {
  const cache = parserCache.get(sessionFile);
  return cache ? { byteOffset: cache.byteOffset, bytesRead: cache.bytesRead } : undefined;
}
