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
  signal?: AbortSignal;
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
  encodedStart: number;
  rawOffsetsByDecodedIndex: number[];
}

interface StringToken {
  decoded: string;
  encodedStart: number;
  encodedEnd: number;
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

  for await (const line of readCompleteJsonlLines(options.filePath, options.fromOffset ?? 0, options.toOffset, options.signal)) {
    throwIfAborted(options.signal);
    const parsed = parseTranscriptEntry(line.bytes);
    if (!parsed || parsed.type === 'tool_result') continue;

    const role = extractRole(parsed);
    if (!role) continue;

    const rawLine = line.bytes.toString('utf8');
    const payloads = extractMessagePayloads(parsed.message?.content, rawLine);
    if (payloads.length === 0) continue;

    const ts = extractTimestamp(parsed);
    for (const payload of payloads) {
      const leadingTrimChars = payload.text.length - payload.text.trimStart().length;
      const text = payload.text.trim();
      if (!text) continue;

      for (const window of splitTextIntoWindows(text, maxTokens, overlapTokens)) {
        const decodedStart = leadingTrimChars + window.charStart;
        const decodedEnd = decodedStart + window.charLength;
        const rawStart = payload.encodedStart + (payload.rawOffsetsByDecodedIndex[decodedStart] ?? payload.rawOffsetsByDecodedIndex[payload.rawOffsetsByDecodedIndex.length - 1] ?? 0);
        const rawEnd = payload.encodedStart + (payload.rawOffsetsByDecodedIndex[decodedEnd] ?? payload.rawOffsetsByDecodedIndex[payload.rawOffsetsByDecodedIndex.length - 1] ?? 0);
        yield {
          sessionId: options.sessionId,
          projectId: options.projectId,
          role,
          ts,
          byteOffset: line.byteOffset + Buffer.byteLength(rawLine.slice(0, rawStart), 'utf8'),
          charLength: Buffer.byteLength(rawLine.slice(rawStart, rawEnd), 'utf8'),
          text: window.text,
          tokenCount: window.tokenCount,
          sourceLineEndOffset: line.lineEndOffset,
        };
      }
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
  signal?: AbortSignal,
): Promise<number> {
  let lastCompleteOffset = Math.max(0, fromOffset);
  for await (const line of readCompleteJsonlLines(filePath, fromOffset, toOffset, signal)) {
    lastCompleteOffset = line.lineEndOffset;
  }
  return lastCompleteOffset;
}

async function* readCompleteJsonlLines(
  filePath: string,
  fromOffset: number,
  toOffset?: number,
  signal?: AbortSignal,
): AsyncGenerator<JsonlLine> {
  throwIfAborted(signal);
  const stat = await fs.stat(filePath);
  const start = Math.max(0, Math.min(fromOffset, stat.size));
  const endExclusive = Math.max(start, Math.min(toOffset ?? stat.size, stat.size));
  if (start >= endExclusive) return;

  let lineChunks: Buffer[] = [];
  let lineLength = 0;
  let lineStartOffset = start;
  let skipFirstPartialLine = await startsInsideLine(filePath, start);

  const stream = createReadStream(filePath, { start, end: endExclusive - 1 });
  let chunkStartOffset = start;
  try {
    for await (const rawChunk of stream) {
      throwIfAborted(signal);
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      let segmentStart = 0;

      for (;;) {
        const newlineIndex = chunk.indexOf(0x0a, segmentStart);
        if (newlineIndex === -1) break;

        const segment = chunk.subarray(segmentStart, newlineIndex);
        if (segment.length > 0) {
          lineChunks.push(segment);
          lineLength += segment.length;
        }

        const lineEndOffset = chunkStartOffset + newlineIndex + 1;
        const lineBytes = lineChunks.length === 1 ? lineChunks[0]! : Buffer.concat(lineChunks, lineLength);
        lineChunks = [];
        lineLength = 0;

        if (skipFirstPartialLine) {
          skipFirstPartialLine = false;
        } else if (lineBytes.some((byte) => byte !== 0x20 && byte !== 0x09 && byte !== 0x0d)) {
          yield { byteOffset: lineStartOffset, lineEndOffset, bytes: stripTrailingCarriageReturn(lineBytes) };
        }

        lineStartOffset = lineEndOffset;
        segmentStart = newlineIndex + 1;
      }

      const remainder = chunk.subarray(segmentStart);
      if (remainder.length > 0) {
        lineChunks.push(remainder);
        lineLength += remainder.length;
      }
      chunkStartOffset += chunk.length;
    }
  } finally {
    if (signal?.aborted) stream.destroy(abortError());
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

function extractMessagePayloads(content: unknown, rawLine: string): TextPayload[] {
  if (content === undefined) return [];
  const messageStart = findPropertyValueStart(rawLine, 0, 'message');
  if (messageStart === null) return [];
  const contentStart = findPropertyValueStart(rawLine, messageStart, 'content');
  if (contentStart === null) return [];
  return collectContentPayloads(rawLine, contentStart);
}

function collectContentPayloads(raw: string, valueStart: number): TextPayload[] {
  const index = skipWhitespace(raw, valueStart);
  if (raw[index] === '"') {
    const token = readStringToken(raw, index);
    return token ? [payloadFromStringToken(raw, token)] : [];
  }
  if (raw[index] === '[') return collectPayloadsFromContentArray(raw, index).payloads;
  if (raw[index] === '{') {
    const parsed = collectPayloadsFromContentObject(raw, index);
    return parsed.payloads;
  }
  return [];
}

function collectPayloadsFromContentArray(raw: string, arrayStart: number): { payloads: TextPayload[]; next: number } {
  const payloads: TextPayload[] = [];
  let index = skipWhitespace(raw, arrayStart + 1);
  while (index < raw.length && raw[index] !== ']') {
    const char = raw[index];
    if (char === '"') {
      const token = readStringToken(raw, index);
      if (!token) return { payloads, next: raw.length };
      payloads.push(payloadFromStringToken(raw, token));
      index = token.encodedEnd + 1;
    } else if (char === '{') {
      const parsed = collectPayloadsFromContentObject(raw, index);
      payloads.push(...parsed.payloads);
      index = parsed.next;
    } else if (char === '[') {
      const parsed = collectPayloadsFromContentArray(raw, index);
      payloads.push(...parsed.payloads);
      index = parsed.next;
    } else {
      index = skipJsonValue(raw, index);
    }
    index = skipWhitespace(raw, index);
    if (raw[index] === ',') index = skipWhitespace(raw, index + 1);
  }
  return { payloads, next: raw[index] === ']' ? index + 1 : index };
}

function collectPayloadsFromContentObject(raw: string, objectStart: number): { payloads: TextPayload[]; next: number } {
  let index = skipWhitespace(raw, objectStart + 1);
  let typeValue: string | undefined;
  let textToken: StringToken | null = null;

  while (index < raw.length && raw[index] !== '}') {
    const key = readStringToken(raw, index);
    if (!key) return { payloads: [], next: raw.length };
    index = skipWhitespace(raw, key.encodedEnd + 1);
    if (raw[index] !== ':') return { payloads: [], next: raw.length };
    index = skipWhitespace(raw, index + 1);

    if (key.decoded === 'type' && raw[index] === '"') {
      const token = readStringToken(raw, index);
      if (!token) return { payloads: [], next: raw.length };
      typeValue = token.decoded;
      index = token.encodedEnd + 1;
    } else if (key.decoded === 'text' && raw[index] === '"') {
      const token = readStringToken(raw, index);
      if (!token) return { payloads: [], next: raw.length };
      textToken = token;
      index = token.encodedEnd + 1;
    } else {
      index = skipJsonValue(raw, index);
    }

    index = skipWhitespace(raw, index);
    if (raw[index] === ',') index = skipWhitespace(raw, index + 1);
  }

  const payloads = textToken && (typeValue === undefined || typeValue === 'text')
    ? [payloadFromStringToken(raw, textToken)]
    : [];
  return { payloads, next: raw[index] === '}' ? index + 1 : index };
}

function payloadFromStringToken(raw: string, token: StringToken): TextPayload {
  return {
    text: token.decoded,
    encodedStart: token.encodedStart,
    rawOffsetsByDecodedIndex: buildDecodedRawOffsets(raw.slice(token.encodedStart, token.encodedEnd), token.decoded.length),
  };
}

function buildDecodedRawOffsets(encoded: string, decodedLength: number): number[] {
  const offsets = new Array<number>(decodedLength + 1);
  let decodedIndex = 0;
  for (let rawIndex = 0; rawIndex < encoded.length && decodedIndex < decodedLength;) {
    offsets[decodedIndex] = rawIndex;
    const { decodedUnits, rawEnd } = readEncodedUnit(encoded, rawIndex);
    for (let unit = 1; unit < decodedUnits && decodedIndex + unit < offsets.length; unit += 1) {
      offsets[decodedIndex + unit] = rawIndex;
    }
    decodedIndex += decodedUnits;
    rawIndex = rawEnd;
    offsets[decodedIndex] = rawIndex;
  }
  offsets[decodedLength] = encoded.length;
  return offsets;
}

function findPropertyValueStart(raw: string, objectStart: number, property: string): number | null {
  let index = skipWhitespace(raw, objectStart);
  if (raw[index] !== '{') return null;
  index = skipWhitespace(raw, index + 1);
  while (index < raw.length && raw[index] !== '}') {
    const key = readStringToken(raw, index);
    if (!key) return null;
    index = skipWhitespace(raw, key.encodedEnd + 1);
    if (raw[index] !== ':') return null;
    const valueStart = skipWhitespace(raw, index + 1);
    if (key.decoded === property) return valueStart;
    index = skipJsonValue(raw, valueStart);
    index = skipWhitespace(raw, index);
    if (raw[index] === ',') index = skipWhitespace(raw, index + 1);
  }
  return null;
}

function readStringToken(raw: string, quoteIndex: number): StringToken | null {
  if (raw[quoteIndex] !== '"') return null;
  let index = quoteIndex + 1;
  while (index < raw.length) {
    const char = raw[index];
    if (char === '"') {
      try {
        return {
          decoded: JSON.parse(raw.slice(quoteIndex, index + 1)) as string,
          encodedStart: quoteIndex + 1,
          encodedEnd: index,
        };
      } catch {
        return null;
      }
    }
    if (char === '\\') index += raw[index + 1] === 'u' ? 6 : 2;
    else index += 1;
  }
  return null;
}

function skipJsonValue(raw: string, valueStart: number): number {
  const index = skipWhitespace(raw, valueStart);
  const char = raw[index];
  if (char === '"') {
    const token = readStringToken(raw, index);
    return token ? token.encodedEnd + 1 : raw.length;
  }
  if (char === '{') return skipJsonObject(raw, index);
  if (char === '[') return skipJsonArray(raw, index);
  let cursor = index;
  while (cursor < raw.length && raw[cursor] !== ',' && raw[cursor] !== '}' && raw[cursor] !== ']') cursor += 1;
  return cursor;
}

function skipJsonObject(raw: string, objectStart: number): number {
  let index = skipWhitespace(raw, objectStart + 1);
  while (index < raw.length && raw[index] !== '}') {
    const key = readStringToken(raw, index);
    if (!key) return raw.length;
    index = skipWhitespace(raw, key.encodedEnd + 1);
    if (raw[index] !== ':') return raw.length;
    index = skipJsonValue(raw, index + 1);
    index = skipWhitespace(raw, index);
    if (raw[index] === ',') index = skipWhitespace(raw, index + 1);
  }
  return raw[index] === '}' ? index + 1 : index;
}

function skipJsonArray(raw: string, arrayStart: number): number {
  let index = skipWhitespace(raw, arrayStart + 1);
  while (index < raw.length && raw[index] !== ']') {
    index = skipJsonValue(raw, index);
    index = skipWhitespace(raw, index);
    if (raw[index] === ',') index = skipWhitespace(raw, index + 1);
  }
  return raw[index] === ']' ? index + 1 : index;
}

function skipWhitespace(raw: string, index: number): number {
  let cursor = index;
  while (cursor < raw.length && /\s/.test(raw[cursor]!)) cursor += 1;
  return cursor;
}

function readEncodedUnit(encoded: string, rawIndex: number): { decodedUnits: number; rawEnd: number } {
  if (encoded[rawIndex] !== '\\') return { decodedUnits: 1, rawEnd: rawIndex + 1 };
  const escape = encoded[rawIndex + 1];
  if (escape === 'u') {
    const firstEnd = rawIndex + 6;
    const code = parseInt(encoded.slice(rawIndex + 2, rawIndex + 6), 16);
    if (code >= 0xd800 && code <= 0xdbff && encoded.slice(firstEnd, firstEnd + 2) === '\\u') {
      const low = parseInt(encoded.slice(firstEnd + 2, firstEnd + 6), 16);
      if (low >= 0xdc00 && low <= 0xdfff) return { decodedUnits: 2, rawEnd: firstEnd + 6 };
    }
    return { decodedUnits: 1, rawEnd: firstEnd };
  }
  return { decodedUnits: 1, rawEnd: rawIndex + 2 };
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  return new DOMException('Conversation search indexing aborted', 'AbortError');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
