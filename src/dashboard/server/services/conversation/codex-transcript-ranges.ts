/**
 * PAN-5211: read Codex transcript records by byte range instead of from the parse cache.
 *
 * The parse cache keeps every tool result bounded (`tool-result-bounds.ts`). Expanding a row reads its
 * output record straight from the transcript at the byte location the accumulator recorded, scrubs its
 * image data URLs, and serves the text under the larger expand cap.
 */
import { open, type FileHandle } from 'node:fs/promises';
import { encodeTimelineCursor, type ChatMessage, type TimelineKey, type WorkLogEntry } from '@overdeck/contracts';
import { createCodexConversationAccumulator, extractCodexToolOutput } from '../codex-conversation-parser.js';
import { createTranscriptLineSplitter, pushTranscriptLine } from '../incremental-transcript-reader.js';
import type { ParseResult, RecordLocation } from './types.js';
import {
  boundToolResultText,
  OLDER_PAGE_READ_MAX_BYTES,
  OLDER_PAGE_READ_STEP_BYTES,
  RECORD_FULL_READ_MAX_BYTES,
  scrubImageDataUrls,
  TOOL_BODY_FULL_READ_MAX_CHARS,
} from './tool-result-bounds.js';
import { selectPageBefore, type WindowedRows, type WindowInput } from './window.js';

const RANGE_READ_CHUNK_BYTES = 1024 * 1024;
const LINE_SCAN_BLOCK_BYTES = 64 * 1024;

async function readRange(file: string, location: RecordLocation): Promise<Buffer> {
  const handle = await open(file, 'r');
  try {
    const bytes = Buffer.alloc(location.length);
    const { bytesRead } = await handle.read(bytes, 0, location.length, location.offset);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

interface CodexOutputRecord {
  type?: unknown;
  payload?: { type?: unknown; call_id?: unknown; output?: unknown };
}

/**
 * The entry with its full tool output read from the transcript record at its recorded location.
 * Any mismatch or read failure returns the stored entry unchanged.
 */
export async function withFullToolResult(
  sessionFile: string | undefined,
  locations: ReadonlyMap<string, RecordLocation> | undefined,
  entry: WorkLogEntry,
): Promise<WorkLogEntry> {
  const location = locations?.get(entry.id);
  if (!sessionFile || !location || location.length > RECORD_FULL_READ_MAX_BYTES) return entry;
  try {
    const record = JSON.parse(scrubImageDataUrls(await readRange(sessionFile, location)).toString('utf8')) as CodexOutputRecord;
    const payload = record.payload;
    if (
      record.type !== 'response_item'
      || typeof payload?.type !== 'string'
      || !payload.type.endsWith('_output')
      || payload.call_id !== entry.id
    ) {
      return entry;
    }
    const { text } = boundToolResultText(extractCodexToolOutput(payload.output), TOOL_BODY_FULL_READ_MAX_CHARS);
    // An oversized record was stored as an omitted body (D3); the full read fills it in.
    const { bodyOmitted: _bodyOmitted, resultBytes: _resultBytes, ...stored } = entry;
    return { ...stored, result: text };
  } catch {
    return entry;
  }
}

/** What the tool-body lookup reads: a parse result, or an agent route body plus its server-only fields. */
export interface ToolBodySource {
  readonly workLog: readonly WorkLogEntry[];
  readonly pendingToolUse?: ReadonlyMap<string, WorkLogEntry>;
  readonly toolResultLocations?: ParseResult['toolResultLocations'];
  readonly historyStartOffset?: ParseResult['historyStartOffset'];
}

/**
 * The tool-body routes' lookup: the in-memory entry, with its full output when the transcript has it.
 * PAN-5211 D19: a row from a disk page is not in memory; `seq` (its call record's offset) finds it on disk.
 */
export async function resolveToolBodyEntry(
  sessionFile: string | undefined,
  parsed: ToolBodySource,
  toolUseId: string,
  seq?: number,
): Promise<WorkLogEntry | undefined> {
  const entry = parsed.workLog.find((candidate) => candidate.id === toolUseId) ?? parsed.pendingToolUse?.get(toolUseId);
  if (entry) return withFullToolResult(sessionFile, parsed.toolResultLocations, entry);
  const historyStart = parsed.historyStartOffset ?? 0;
  if (sessionFile && historyStart > 0 && seq !== undefined && seq < historyStart) {
    return findCodexToolEntryFrom(sessionFile, seq, toolUseId);
  }
  return undefined;
}

/**
 * PAN-5211 D19: parse forward from the line start `seq` until the row `toolUseId` has its output, or
 * `OLDER_PAGE_READ_MAX_BYTES` are read, and serve it with its full output. A `seq` that is not a line
 * start, or a row that never appears, returns `undefined`.
 */
export async function findCodexToolEntryFrom(
  sessionFile: string,
  seq: number,
  toolUseId: string,
): Promise<WorkLogEntry | undefined> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(sessionFile, 'r');
    const { size } = await handle.stat();
    if (seq < 0 || seq >= size) return undefined;
    if (seq > 0) {
      const before = Buffer.alloc(1);
      await handle.read(before, 0, 1, seq - 1);
      if (before[0] !== 10) return undefined;
    }
    const parser = createCodexConversationAccumulator(sessionFile, { historyStartOffset: seq });
    const splitter = createTranscriptLineSplitter(seq, (line, location) => pushTranscriptLine(parser, line, location));
    const end = Math.min(size, seq + OLDER_PAGE_READ_MAX_BYTES);
    const chunk = Buffer.alloc(Math.max(1, Math.min(RANGE_READ_CHUNK_BYTES, end - seq)));
    let found: WorkLogEntry | undefined;
    for (let offset = seq; offset < end;) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, end - offset), offset);
      if (bytesRead === 0) break;
      splitter.write(chunk.subarray(0, bytesRead));
      offset += bytesRead;
      found = parser.result(offset, 0).workLog.find((candidate) => candidate.id === toolUseId);
      if (found && (found.result !== undefined || found.bodyOmitted)) break;
    }
    if (!found) return undefined;
    return await withFullToolResult(sessionFile, parser.result(end, 0).toolResultLocations, found);
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

/** The tool-body routes' query: `agentId`, `subagentId`, and `seq` when it is a non-negative integer. */
export function toolBodyQuery(url: string): { agentId?: string; subagentId?: string; seq?: number } {
  const params = new URL(url, 'http://localhost').searchParams;
  const agentId = params.get('agentId');
  const subagentId = params.get('subagentId');
  const rawSeq = params.get('seq');
  const seq = rawSeq !== null && /^\d+$/.test(rawSeq) ? Number(rawSeq) : undefined;
  return {
    ...(agentId !== null ? { agentId } : {}),
    ...(subagentId !== null ? { subagentId } : {}),
    ...(seq !== undefined && Number.isSafeInteger(seq) ? { seq } : {}),
  };
}

export interface DiskPageOptions {
  readonly stepBytes?: number;
  readonly maxBytes?: number;
}

export interface CodexRowsBefore {
  readonly messages: ChatMessage[];
  readonly workLog: WorkLogEntry[];
  /** Byte offset of the first record the range read. */
  readonly rangeStart: number;
}

/** The start of the first line that begins at or after `from` (the byte after a `\n`), or `end`. */
async function lineStartAtOrAfter(handle: FileHandle, from: number, end: number): Promise<number> {
  if (from <= 0) return 0;
  const block = Buffer.alloc(LINE_SCAN_BLOCK_BYTES);
  // A line starts at `from` when the byte before it is a newline.
  for (let offset = from - 1; offset < end; offset += LINE_SCAN_BLOCK_BYTES) {
    const { bytesRead } = await handle.read(block, 0, Math.min(LINE_SCAN_BLOCK_BYTES, end - offset), offset);
    if (bytesRead === 0) break;
    const newline = block.subarray(0, bytesRead).indexOf(10);
    if (newline !== -1) return Math.min(end, offset + newline + 1);
  }
  return end;
}

/** Parse the records in `[start, end)` with a fresh located accumulator. */
async function parseRange(handle: FileHandle, sessionFile: string, start: number, end: number) {
  const parser = createCodexConversationAccumulator(sessionFile, { historyStartOffset: start });
  const splitter = createTranscriptLineSplitter(start, (line, location) => pushTranscriptLine(parser, line, location));
  const chunk = Buffer.alloc(Math.max(1, Math.min(RANGE_READ_CHUNK_BYTES, end - start)));
  for (let offset = start; offset < end;) {
    const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, end - offset), offset);
    if (bytesRead === 0) break;
    splitter.write(chunk.subarray(0, bytesRead));
    offset += bytesRead;
  }
  splitter.flushComplete();
  return parser.result(end, 0);
}

/**
 * PAN-5211 D12: rows from the records just before `beforeOffset`, read from disk. The range starts
 * `stepBytes` back and doubles, up to `maxBytes`, until it holds `minRows` rows or reaches byte 0.
 */
export async function readCodexRowsBefore(
  sessionFile: string,
  beforeOffset: number,
  minRows: number,
  options: DiskPageOptions = {},
): Promise<CodexRowsBefore> {
  const step = options.stepBytes ?? OLDER_PAGE_READ_STEP_BYTES;
  const max = options.maxBytes ?? OLDER_PAGE_READ_MAX_BYTES;
  const handle = await open(sessionFile, 'r');
  try {
    for (let span = Math.min(step, max); ; span = Math.min(span * 2, max)) {
      const rangeStart = await lineStartAtOrAfter(handle, beforeOffset - span, beforeOffset);
      const parsed = await parseRange(handle, sessionFile, rangeStart, beforeOffset);
      const rows = parsed.messages.length + parsed.workLog.length;
      if (rows >= minRows || rangeStart === 0 || span >= max) {
        return { messages: parsed.messages, workLog: parsed.workLog, rangeStart };
      }
    }
  } finally {
    await handle.close();
  }
}

/**
 * PAN-5211 D12: one older page. In-memory rows come first; once they run out, a bounded conversation
 * reads older rows from disk. Pages of a bounded conversation carry `bounded: true`.
 */
export async function selectHistoryPageBefore(
  parsed: WindowInput,
  sessionFile: string | undefined,
  before: TimelineKey,
  limit: number,
  transcript?: string,
  options?: DiskPageOptions,
): Promise<WindowedRows> {
  const page = selectPageBefore(parsed, before, limit, transcript);
  const historyStart = parsed.historyStartOffset ?? 0;
  if (historyStart <= 0) return page;
  if (page.messages.length + page.workLog.length > 0 || !sessionFile) {
    return { ...page, window: { ...page.window, hasOlder: true, bounded: true } };
  }
  const older = await readCodexRowsBefore(sessionFile, Math.min(before[1], historyStart), limit, options);
  const diskPage = selectPageBefore(older, before, limit, transcript);
  const empty = diskPage.messages.length + diskPage.workLog.length === 0;
  return {
    ...diskPage,
    window: {
      ...diskPage.window,
      // An empty page still moves the cursor back past the range it read, so paging never stalls.
      ...(empty && older.rangeStart > 0 ? { cursor: encodeTimelineCursor([before[0], older.rangeStart, 0, '']) } : {}),
      hasOlder: diskPage.window.hasOlder || older.rangeStart > 0,
      bounded: true,
    },
  };
}

