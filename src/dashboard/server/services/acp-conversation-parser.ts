import { readFile, stat } from 'node:fs/promises';

import type { ChatMessage, WorkLogEntry } from '@overdeck/contracts';

import type {
  AcpTranscriptEntry,
  AcpTranscriptToolCallState,
} from '../../../lib/acp/transcript.js';
import type { ParseResult } from './conversation/types.js';

const TOOL_METADATA_MAX_CHARS = 500;
const STREAMING_RECENCY_MS = 30_000;

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

/**
 * Parse the normalized append-only transcript written by the persistent ACP
 * host into the same full-snapshot shape consumed by the dashboard chat panel.
 */
export async function parseAcpConversationMessages(sessionFile: string): Promise<ParseResult> {
  const fileStats = await stat(sessionFile);
  const raw = await readFile(sessionFile, 'utf-8');
  const messages: ChatMessage[] = [];
  const workLog: WorkLogEntry[] = [];
  const toolIndex = new Map<string, number>();
  const pendingToolUse = new Map<string, WorkLogEntry>();
  let sequence = 0;
  let lastRole: AcpTranscriptEntry['role'] | null = null;
  let currentTurnAssistantIndex: number | undefined;
  let lastTurnCompletedAt: string | undefined;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // The host appends one line at a time. Ignore malformed or partially
      // written tail records and pick them up on the next full snapshot.
      continue;
    }
    if (!isTranscriptEntry(parsed)) continue;

    const entry = parsed;
    const createdAt = entry.timestamp;

    if (entry.event === 'turn_completed') {
      lastTurnCompletedAt = createdAt;
      if (currentTurnAssistantIndex !== undefined) {
        const assistant = messages[currentTurnAssistantIndex];
        if (assistant?.role === 'assistant') {
          messages[currentTurnAssistantIndex] = {
            ...assistant,
            completedAt: createdAt,
            streaming: false,
          };
        }
      }
      pendingToolUse.clear();
      continue;
    }

    if (entry.role === 'assistant') {
      if (!entry.content) continue;
      const previousIndex = messages.length - 1;
      const previous = lastRole === 'assistant' ? messages[previousIndex] : undefined;
      if (previous?.role === 'assistant') {
        messages[previousIndex] = {
          ...previous,
          text: previous.text + entry.content,
        };
      } else {
        sequence += 1;
        messages.push({
          id: `acp-assistant-${sequence}`,
          role: 'assistant',
          text: entry.content,
          createdAt,
          streaming: false,
          sequence,
        });
      }
      currentTurnAssistantIndex = messages.length - 1;
      lastRole = entry.role;
      continue;
    }

    if (entry.role === 'user' || entry.role === 'system') {
      if (entry.role === 'user') {
        currentTurnAssistantIndex = undefined;
        lastTurnCompletedAt = undefined;
      }
      const text = entry.content.trim();
      if (!text) continue;
      sequence += 1;
      messages.push({
        id: `acp-${entry.role}-${sequence}`,
        role: entry.role,
        text,
        createdAt,
        completedAt: createdAt,
        streaming: false,
        sequence,
      });
      lastRole = entry.role;
      continue;
    }

    const toolCalls = Array.isArray(entry.toolCalls)
      ? entry.toolCalls.filter(isToolCall)
      : [];
    for (const toolCall of toolCalls) {
      const existingIndex = toolIndex.get(toolCall.toolCallId);
      if (existingIndex === undefined) {
        sequence += 1;
        const workEntry = toToolEntry(toolCall, entry.content, createdAt, sequence);
        toolIndex.set(toolCall.toolCallId, workLog.length);
        workLog.push(workEntry);
      } else {
        const existing = workLog[existingIndex]!;
        workLog[existingIndex] = {
          ...toToolEntry(toolCall, entry.content, existing.createdAt, existing.sequence ?? 0),
          id: existing.id,
        };
      }

      const current = workLog[toolIndex.get(toolCall.toolCallId)!]!;
      if (toolCall.status === 'pending' || toolCall.status === 'inProgress') {
        pendingToolUse.set(toolCall.toolCallId, current);
      } else {
        pendingToolUse.delete(toolCall.toolCallId);
      }
    }
    lastRole = entry.role;
  }

  const lastMessage = messages[messages.length - 1];
  const streaming = lastTurnCompletedAt === undefined
    && lastRole === 'assistant'
    && lastMessage?.role === 'assistant'
    && Date.now() - fileStats.mtimeMs < STREAMING_RECENCY_MS;
  if (lastMessage?.role === 'assistant' && lastTurnCompletedAt === undefined) {
    messages[messages.length - 1] = streaming
      ? { ...lastMessage, streaming: true }
      : { ...lastMessage, completedAt: lastMessage.createdAt };
  }

  return {
    messages,
    workLog,
    byteOffset: fileStats.size,
    streaming,
    ...(lastTurnCompletedAt ? { lastTurnCompletedAt } : {}),
    totalCost: 0,
    totalTokens: 0,
    latestAssistantUsage: null,
    contextBoundaryOffset: 0,
    contextActiveBytes: fileStats.size,
    pendingToolUse,
    unresolvedResults: new Map(),
    lastSequence: sequence,
    mtimeMs: fileStats.mtimeMs,
    planToolUseIds: new Set(),
    compactBoundaries: [],
    fileEditsByAssistantId: new Map(),
  };
}
