import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { sessionFilePath } from './paths.js';

const DEFAULT_TAIL_BYTES = 512 * 1024;

export interface TranscriptUserRecordSnapshot {
  readonly sessionFile: string;
  readonly userRecordCount: number;
  readonly fileSize?: number;
  /** Byte offset from which this snapshot was parsed. */
  readonly rangeStartByte?: number;
  /** Byte offset after the last complete JSONL line observed by this snapshot. */
  readonly readOffset?: number;
  readonly lastUserRecord?: {
    readonly lineNumber: number;
    readonly timestamp?: string;
    readonly uuid?: string;
  };
}

async function readFileRange(filePath: string, start: number, endExclusive: number): Promise<string> {
  if (endExclusive <= start) return '';

  return await new Promise<string>((resolve, reject) => {
    const stream = createReadStream(filePath, { start, end: endExclusive - 1, encoding: 'utf8' });
    let data = '';
    stream.on('data', chunk => { data += chunk; });
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
  });
}

function dropLeadingPartialLine(content: string): string {
  const firstNewline = content.indexOf('\n');
  if (firstNewline === -1) return '';
  return content.slice(firstNewline + 1);
}

function nextCompleteLineOffset(rangeStartByte: number, rawContent: string, fileSize: number): number {
  if (!rawContent) return fileSize;
  if (rawContent.endsWith('\n')) return fileSize;

  const lastNewline = rawContent.lastIndexOf('\n');
  if (lastNewline === -1) return rangeStartByte;
  return rangeStartByte + Buffer.byteLength(rawContent.slice(0, lastNewline + 1), 'utf8');
}

function isLandedUserRecord(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const record = entry as {
    type?: unknown;
    message?: { role?: unknown; content?: unknown };
  };
  if (record.type !== 'user' || record.message?.role !== 'user') return false;

  const content = record.message.content;
  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content)) return false;

  return content.some((item: unknown) => {
    if (!item || typeof item !== 'object') return false;
    return (item as { type?: unknown }).type !== 'tool_result';
  });
}

function parseLandedUserRecords(content: string): Pick<TranscriptUserRecordSnapshot, 'userRecordCount' | 'lastUserRecord'> {
  let userRecordCount = 0;
  let lastUserRecord: TranscriptUserRecordSnapshot['lastUserRecord'];

  const lines = content.split('\n');
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { timestamp?: unknown; uuid?: unknown };
      if (!isLandedUserRecord(entry)) continue;
      userRecordCount += 1;
      lastUserRecord = {
        lineNumber: index + 1,
        ...(typeof entry.timestamp === 'string' ? { timestamp: entry.timestamp } : {}),
        ...(typeof entry.uuid === 'string' ? { uuid: entry.uuid } : {}),
      };
    } catch {
      // Claude may be appending the JSONL while we read it. Ignore malformed
      // partial lines; the next poll sees the completed record.
    }
  }

  return { userRecordCount, ...(lastUserRecord ? { lastUserRecord } : {}) };
}

export async function captureTranscriptUserRecordSnapshot(
  workspace: string,
  sessionId: string,
  options: { tailBytes?: number; fromByteOffset?: number } = {},
): Promise<TranscriptUserRecordSnapshot> {
  const sessionFile = sessionFilePath(workspace, sessionId);
  if (!existsSync(sessionFile)) {
    return { sessionFile, userRecordCount: 0, fileSize: 0, rangeStartByte: 0, readOffset: 0 };
  }

  try {
    const fileStat = await stat(sessionFile);
    const fileSize = fileStat.size;
    const rangeStartByte = options.fromByteOffset === undefined
      ? Math.max(0, fileSize - (options.tailBytes ?? DEFAULT_TAIL_BYTES))
      : Math.min(Math.max(0, options.fromByteOffset), fileSize);
    const rawContent = await readFileRange(sessionFile, rangeStartByte, fileSize);
    const content = options.fromByteOffset === undefined && rangeStartByte > 0
      ? dropLeadingPartialLine(rawContent)
      : rawContent;
    const parsed = parseLandedUserRecords(content);

    return {
      sessionFile,
      ...parsed,
      fileSize,
      rangeStartByte,
      readOffset: nextCompleteLineOffset(rangeStartByte, rawContent, fileSize),
    };
  } catch {
    return { sessionFile, userRecordCount: 0, fileSize: 0, rangeStartByte: 0, readOffset: 0 };
  }
}

export function hasNewTranscriptUserRecord(
  before: TranscriptUserRecordSnapshot,
  after: TranscriptUserRecordSnapshot,
): boolean {
  if (before.sessionFile !== after.sessionFile) return after.userRecordCount > 0;

  if (
    before.readOffset !== undefined &&
    after.rangeStartByte !== undefined &&
    after.rangeStartByte === before.readOffset
  ) {
    return after.userRecordCount > 0;
  }

  return after.userRecordCount > before.userRecordCount;
}
