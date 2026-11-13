/**
 * PAN-5211: read Codex transcript records by byte range instead of from the parse cache.
 *
 * The parse cache keeps every tool result bounded (`tool-result-bounds.ts`). Expanding a row reads its
 * output record straight from the transcript at the byte location the accumulator recorded, scrubs its
 * image data URLs, and serves the text under the larger expand cap.
 */
import { open } from 'node:fs/promises';
import type { WorkLogEntry } from '@overdeck/contracts';
import { extractCodexToolOutput } from '../codex-conversation-parser.js';
import type { ParseResult, RecordLocation } from './types.js';
import {
  boundToolResultText,
  RECORD_FULL_READ_MAX_BYTES,
  scrubImageDataUrls,
  TOOL_BODY_FULL_READ_MAX_CHARS,
} from './tool-result-bounds.js';

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

/** The tool-body routes' lookup: the in-memory entry, with its full output when the transcript has it. */
export async function resolveToolBodyEntry(
  sessionFile: string | undefined,
  parsed: ToolBodySource,
  toolUseId: string,
): Promise<WorkLogEntry | undefined> {
  const entry = parsed.workLog.find((candidate) => candidate.id === toolUseId) ?? parsed.pendingToolUse?.get(toolUseId);
  return entry ? withFullToolResult(sessionFile, parsed.toolResultLocations, entry) : undefined;
}
