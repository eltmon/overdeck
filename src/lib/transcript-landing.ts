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

export interface TranscriptWatchProbe {
  /** A landed user record whose content contains the watched message text. */
  matchedUserRecord: boolean;
  /** compact_boundary records observed at/after the probe's start offset. */
  compactBoundaryCount: number;
}

const MATCH_PREFIX_CHARS = 120;

function normalizeForContentMatch(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Harness-meta user records the matcher must never treat as the user's own
 * message landing. Compaction itself writes user-type records (the
 * continuation summary, `<command-name>`/`<local-command-*>` entries), and a
 * continuation summary can even quote the watched message — counting any of
 * these as a landing would mask exactly the eaten-by-compaction case the
 * probe exists to detect (PAN-1635 / PAN-1769).
 */
const META_USER_CONTENT_PREFIXES = [
  'This session is being continued',
  '<command-name>',
  '<local-command-',
  'Caveat: The messages below',
];

function userRecordText(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as { type?: unknown; message?: { role?: unknown; content?: unknown } };
  if (record.type !== 'user' || record.message?.role !== 'user') return null;
  const content = record.message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  return content
    .filter((item): item is { type?: unknown; text?: unknown } => !!item && typeof item === 'object')
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('\n');
}

function isCompactBoundaryRecord(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const record = entry as { type?: unknown; subtype?: unknown };
  return record.type === 'system' && record.subtype === 'compact_boundary';
}

/**
 * Scan the transcript from `fromByteOffset` for (a) a user record carrying
 * `messageText` and (b) compact boundaries. Backs the eaten-by-compaction
 * watcher: a boundary appearing without the message means Claude Code's
 * submit-time compaction dropped the just-delivered prompt.
 */
export async function probeTranscriptSince(
  workspace: string,
  sessionId: string,
  fromByteOffset: number,
  messageText: string,
): Promise<TranscriptWatchProbe> {
  const needle = normalizeForContentMatch(messageText).slice(0, MATCH_PREFIX_CHARS);
  const sessionFile = sessionFilePath(workspace, sessionId);
  if (!needle || !existsSync(sessionFile)) {
    return { matchedUserRecord: false, compactBoundaryCount: 0 };
  }

  try {
    const fileStat = await stat(sessionFile);
    const start = Math.min(Math.max(0, fromByteOffset), fileStat.size);
    const content = await readFileRange(sessionFile, start, fileStat.size);
    let matchedUserRecord = false;
    let compactBoundaryCount = 0;
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as unknown;
        if (isCompactBoundaryRecord(entry)) {
          compactBoundaryCount += 1;
          continue;
        }
        const text = userRecordText(entry);
        if (text === null) continue;
        if (META_USER_CONTENT_PREFIXES.some((prefix) => text.startsWith(prefix))) continue;
        if (normalizeForContentMatch(text).includes(needle)) matchedUserRecord = true;
      } catch {
        // Partial trailing line mid-append; the next probe sees it complete.
      }
    }
    return { matchedUserRecord, compactBoundaryCount };
  } catch {
    return { matchedUserRecord: false, compactBoundaryCount: 0 };
  }
}
