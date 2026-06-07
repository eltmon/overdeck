import { createReadStream, promises as fs } from 'node:fs';

export interface ConversationChunkRecord {
  sessionId: string;
  projectId: string;
  role: string;
  ts: string | null;
  /** Byte offset of this chunk's text payload inside the source JSONL file. */
  byteOffset: number;
  /** Byte length of this chunk's source text payload. */
  charLength: number;
  text: string;
  tokenCount: number;
  /** Byte offset immediately after the complete JSONL line that produced this chunk. */
  sourceLineEndOffset: number;
}

export interface ChunkConversationJsonlOptions {
  filePath: string;
  sessionId: string;
  projectId: string;
  /** Start reading at this byte offset. Non-zero offsets are expected to be line boundaries/cursors. */
  fromOffset?: number;
  /** Stop before this byte offset. Defaults to the current file size. */
  toOffset?: number;
  /** Approximate token window size for long messages. Defaults to 512. */
  maxTokens?: number;
  /** Approximate token overlap between long-message windows. Defaults to 64. */
  overlapTokens?: number;
}

interface JsonlLine {
  byteOffset: number;
  lineEndOffset: number;
  bytes: Buffer;
}

interface TranscriptEntry {
  type?: unknown;
  timestamp?: unknown;
  message?: {
    role?: unknown;
    content?: unknown;
    created_at?: unknown;
  };
}

interface TextWindow {
  text: string;
  charStart: number;
  charLength: number;
  tokenCount: number;
}

interface TokenSpan {
  start: number;
  end: number;
}

interface TextPayload {
  text: string;
  byteOffset: number;
}

const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_OVERLAP_TOKENS = 64;

/**
 * Stream a Claude Code JSONL session and emit searchable text chunks.
 *
 * byteOffset is stable across appends because it is derived from the source file's
 * byte position. For split long messages, later windows use offsets inside the
 * same JSONL line so each chunk remains uniquely keyable while still resolving
 * back to the containing message line.
 */
export async function* chunkConversationJsonl(
  options: ChunkConversationJsonlOptions,
): AsyncGenerator<ConversationChunkRecord> {
  const maxTokens = normalizeMaxTokens(options.maxTokens);
  const overlapTokens = normalizeOverlapTokens(options.overlapTokens, maxTokens);

  for await (const line of readCompleteJsonlLines(options.filePath, options.fromOffset ?? 0, options.toOffset)) {
    const parsed = parseTranscriptEntry(line.bytes);
    if (!parsed) continue;

    const role = extractRole(parsed);
    if (!role) continue;

    const payload = extractMessagePayload(line);
    if (!payload) continue;

    const text = payload.text.trim();
    if (!text) continue;

    const leadingTrimChars = payload.text.length - payload.text.trimStart().length;
    const payloadTextStart = payload.byteOffset + Buffer.byteLength(payload.text.slice(0, leadingTrimChars), 'utf8');
    const ts = extractTimestamp(parsed);
    for (const window of splitTextIntoWindows(text, maxTokens, overlapTokens)) {
      const byteOffset = payloadTextStart + Buffer.byteLength(text.slice(0, window.charStart), 'utf8');
      yield {
        sessionId: options.sessionId,
        projectId: options.projectId,
        role,
        ts,
        byteOffset,
        charLength: Buffer.byteLength(window.text, 'utf8'),
        text: window.text,
        tokenCount: window.tokenCount,
        sourceLineEndOffset: line.lineEndOffset,
      };
    }
  }
}

export async function chunkConversationJsonlFile(
  options: ChunkConversationJsonlOptions,
): Promise<ConversationChunkRecord[]> {
  const records: ConversationChunkRecord[] = [];
  for await (const record of chunkConversationJsonl(options)) records.push(record);
  return records;
}

export async function getLastCompleteJsonlOffset(
  filePath: string,
  fromOffset = 0,
  toOffset?: number,
): Promise<number> {
  let lastCompleteOffset = Math.max(0, fromOffset);
  for await (const line of readCompleteJsonlLines(filePath, fromOffset, toOffset)) {
    lastCompleteOffset = line.lineEndOffset;
  }
  return lastCompleteOffset;
}

async function* readCompleteJsonlLines(
  filePath: string,
  fromOffset: number,
  toOffset?: number,
): AsyncGenerator<JsonlLine> {
  const stat = await fs.stat(filePath);
  const start = Math.max(0, Math.min(fromOffset, stat.size));
  const endExclusive = Math.max(start, Math.min(toOffset ?? stat.size, stat.size));
  if (start >= endExclusive) return;

  let pending = Buffer.alloc(0);
  let pendingOffset = start;
  let skipFirstPartialLine = await startsInsideLine(filePath, start);

  const stream = createReadStream(filePath, { start, end: endExclusive - 1 });
  for await (const rawChunk of stream) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);

    let newlineIndex = pending.indexOf(0x0a);
    while (newlineIndex !== -1) {
      const lineBytes = pending.subarray(0, newlineIndex);
      const nextPending = pending.subarray(newlineIndex + 1);
      const lineStartOffset = pendingOffset;
      const lineEndOffset = pendingOffset + newlineIndex + 1;
      pendingOffset = lineEndOffset;
      pending = nextPending;

      if (skipFirstPartialLine) {
        skipFirstPartialLine = false;
      } else if (lineBytes.some((byte) => byte !== 0x20 && byte !== 0x09 && byte !== 0x0d)) {
        yield { byteOffset: lineStartOffset, lineEndOffset, bytes: stripTrailingCarriageReturn(lineBytes) };
      }

      newlineIndex = pending.indexOf(0x0a);
    }
  }

  // Deliberately ignore a trailing partial line. Live Claude sessions append JSONL
  // continuously; indexing only complete lines keeps cursors and byte offsets stable.
}

async function startsInsideLine(filePath: string, offset: number): Promise<boolean> {
  if (offset <= 0) return false;
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(1);
    const { bytesRead } = await handle.read(buffer, 0, 1, offset - 1);
    return bytesRead === 1 && buffer[0] !== 0x0a;
  } finally {
    await handle.close();
  }
}

function stripTrailingCarriageReturn(bytes: Buffer): Buffer {
  if (bytes.length > 0 && bytes[bytes.length - 1] === 0x0d) return bytes.subarray(0, -1);
  return bytes;
}

function parseTranscriptEntry(bytes: Buffer): TranscriptEntry | null {
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    return isRecord(parsed) ? (parsed as TranscriptEntry) : null;
  } catch {
    return null;
  }
}

function extractRole(entry: TranscriptEntry): string | null {
  if (typeof entry.message?.role === 'string' && entry.message.role) return entry.message.role;
  if (typeof entry.type === 'string' && entry.type) return entry.type;
  return null;
}

function extractTimestamp(entry: TranscriptEntry): string | null {
  if (typeof entry.timestamp === 'string' && entry.timestamp) return entry.timestamp;
  if (typeof entry.message?.created_at === 'string' && entry.message.created_at) return entry.message.created_at;
  return null;
}

function extractMessagePayload(line: JsonlLine): TextPayload | null {
  const entry = parseTranscriptEntry(line.bytes);
  if (!entry) return null;
  const text = extractText(entry.message?.content).join('\n');
  if (!text) return null;

  const rawLine = line.bytes.toString('utf8');
  const encoded = JSON.stringify(text).slice(1, -1);
  const encodedIndex = rawLine.indexOf(encoded);
  if (encodedIndex >= 0) {
    return { text, byteOffset: line.byteOffset + Buffer.byteLength(rawLine.slice(0, encodedIndex), 'utf8') };
  }

  // Fallback for multi-part content: locate the first text leaf and use the
  // concatenated decoded text for indexing. This preserves stable line-local
  // keys; common single-text Claude Code messages take the exact path above.
  const firstText = firstTextLeaf(entry.message?.content);
  if (!firstText) return { text, byteOffset: line.byteOffset };
  const firstEncoded = JSON.stringify(firstText).slice(1, -1);
  const firstIndex = rawLine.indexOf(firstEncoded);
  return { text, byteOffset: firstIndex >= 0 ? line.byteOffset + Buffer.byteLength(rawLine.slice(0, firstIndex), 'utf8') : line.byteOffset };
}

function extractText(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(extractText);
  if (!isRecord(value)) return [];

  if (typeof value.text === 'string' && (value.type === undefined || value.type === 'text')) return [value.text];
  if (typeof value.content === 'string') return [value.content];
  return [];
}

function firstTextLeaf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstTextLeaf(item);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (typeof value.text === 'string' && (value.type === undefined || value.type === 'text')) return value.text;
  if (typeof value.content === 'string') return value.content;
  return null;
}

export function splitTextIntoWindows(
  text: string,
  maxTokens = DEFAULT_MAX_TOKENS,
  overlapTokens = DEFAULT_OVERLAP_TOKENS,
): TextWindow[] {
  const normalizedMax = normalizeMaxTokens(maxTokens);
  const normalizedOverlap = normalizeOverlapTokens(overlapTokens, normalizedMax);
  const tokens = tokenizeApprox(text);
  if (tokens.length === 0) return [];
  if (tokens.length <= normalizedMax) {
    return [{ text, charStart: 0, charLength: text.length, tokenCount: tokens.length }];
  }

  const windows: TextWindow[] = [];
  const stride = normalizedMax - normalizedOverlap;
  for (let startToken = 0; startToken < tokens.length; startToken += stride) {
    const endToken = Math.min(startToken + normalizedMax, tokens.length);
    const charStart = tokens[startToken]!.start;
    const charEnd = tokens[endToken - 1]!.end;
    const windowText = text.slice(charStart, charEnd);
    windows.push({
      text: windowText,
      charStart,
      charLength: windowText.length,
      tokenCount: endToken - startToken,
    });
    if (endToken === tokens.length) break;
  }
  return windows;
}

function tokenizeApprox(text: string): TokenSpan[] {
  return Array.from(text.matchAll(/\S+/g), (match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function normalizeMaxTokens(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return DEFAULT_MAX_TOKENS;
  return Math.max(1, Math.floor(value));
}

function normalizeOverlapTokens(value: number | undefined, maxTokens: number): number {
  if (!Number.isFinite(value) || value === undefined) return Math.min(DEFAULT_OVERLAP_TOKENS, maxTokens - 1);
  return Math.max(0, Math.min(Math.floor(value), maxTokens - 1));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
