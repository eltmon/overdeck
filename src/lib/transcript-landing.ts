import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { sessionFilePath } from './paths.js';

const DEFAULT_TAIL_BYTES = 512 * 1024;

export interface TranscriptUserRecordSnapshot {
  readonly sessionFile: string;
  readonly userRecordCount: number;
  readonly lastUserRecord?: {
    readonly lineNumber: number;
    readonly timestamp?: string;
    readonly uuid?: string;
  };
}

async function readFileTail(filePath: string, maxBytes: number): Promise<string> {
  try {
    const fileStat = await stat(filePath);
    const start = Math.max(0, fileStat.size - maxBytes);
    if (start === 0) return await readFile(filePath, 'utf8');

    return await new Promise<string>((resolve, reject) => {
      const stream = createReadStream(filePath, { start, encoding: 'utf8' });
      let data = '';
      stream.on('data', chunk => { data += chunk; });
      stream.on('end', () => resolve(data));
      stream.on('error', reject);
    });
  } catch {
    return '';
  }
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

export async function captureTranscriptUserRecordSnapshot(
  workspace: string,
  sessionId: string,
  options: { tailBytes?: number } = {},
): Promise<TranscriptUserRecordSnapshot> {
  const sessionFile = sessionFilePath(workspace, sessionId);
  if (!existsSync(sessionFile)) return { sessionFile, userRecordCount: 0 };

  const content = await readFileTail(sessionFile, options.tailBytes ?? DEFAULT_TAIL_BYTES);
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

  return { sessionFile, userRecordCount, ...(lastUserRecord ? { lastUserRecord } : {}) };
}

export function hasNewTranscriptUserRecord(
  before: TranscriptUserRecordSnapshot,
  after: TranscriptUserRecordSnapshot,
): boolean {
  return after.userRecordCount > before.userRecordCount;
}
