/**
 * PAN-5211: shared bounds for transcript tool results and the retained-size estimate.
 *
 * Every parser that stores a tool result (Codex, pi, prime-agent, ohmypi, kimi) passes it through
 * `boundToolResultText`, which replaces image data URLs with a short placeholder and keeps at most
 * `TOOL_RESULT_STORED_MAX_CHARS` characters (head and tail, joined by an "omitted" marker). The cache
 * budgets count retained characters as `estimateParseResultChars` reports them: the `.length` of every
 * string a row holds, plus `ROW_OVERHEAD_CHARS` per row.
 */
import type { ChatMessage, WorkLogEntry } from '@overdeck/contracts';

/** Most content characters a stored tool result keeps. */
export const TOOL_RESULT_STORED_MAX_CHARS = 65_536;
/** Most content characters the tool-body expand route serves. */
export const TOOL_BODY_FULL_READ_MAX_CHARS = 4 * 1024 * 1024;
/** Hard cap on the retained characters of one cached transcript entry. */
export const TRANSCRIPT_ENTRY_MAX_RETAINED_CHARS = 16 * 1024 * 1024;
/** Retained characters an in-memory window shrinks to when it slides. */
export const TRANSCRIPT_WINDOW_TARGET_CHARS = 12 * 1024 * 1024;
/** Total retained-character budget of a transcript cache. */
export const TRANSCRIPT_CACHE_MAX_RETAINED_CHARS = 32 * 1024 * 1024;
/** A cold open of a transcript larger than this reads only its last this-many bytes. */
export const TRANSCRIPT_TAIL_READ_BYTES = 64 * 1024 * 1024;
/** A scrubbed line larger than this is not decoded or parsed whole. */
export const RECORD_PARSE_MAX_BYTES = 8 * 1024 * 1024;
/** How far back each disk-page read steps. */
export const OLDER_PAGE_READ_STEP_BYTES = 8 * 1024 * 1024;
/** The most bytes one disk-page request reads. */
export const OLDER_PAGE_READ_MAX_BYTES = 64 * 1024 * 1024;
/** A record longer than this is never read back for expand. */
export const RECORD_FULL_READ_MAX_BYTES = 64 * 1024 * 1024;

/** Per-row overhead added to the retained-characters estimate. */
export const ROW_OVERHEAD_CHARS = 64;

const IMAGE_PLACEHOLDER_PREFIX = '[image: ';
const IMAGE_DATA_URL_RE = /data:image\/([A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/]*)(={0,2})/g;

export interface BoundedToolResult {
  readonly text: string;
  readonly bounded: boolean;
}

/** `[image: png, 412 KB]`: the decoded size in KiB, rounded, at least 1. */
export function imagePlaceholder(format: string, decodedBytes: number): string {
  const kib = Math.max(1, Math.round(decodedBytes / 1024));
  return `${IMAGE_PLACEHOLDER_PREFIX}${format}, ${kib} KB]`;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Keep the first and last `maxChars / 2` characters, never splitting a surrogate pair. */
function cutHeadAndTail(text: string, maxChars: number): string {
  const half = Math.floor(maxChars / 2);
  let headEnd = half;
  if (headEnd > 0 && isHighSurrogate(text.charCodeAt(headEnd - 1))) headEnd -= 1;
  let tailStart = text.length - half;
  if (tailStart < text.length && isLowSurrogate(text.charCodeAt(tailStart)) && isHighSurrogate(text.charCodeAt(tailStart - 1))) {
    tailStart += 1;
  }
  const omitted = tailStart - headEnd;
  return `${text.slice(0, headEnd)}\n\n… [${omitted.toLocaleString('en-US')} characters omitted] …\n\n${text.slice(tailStart)}`;
}

/** A fresh flat copy, so no sliced string keeps the original alive. */
function detach(text: string): string {
  return Buffer.from(text, 'utf8').toString('utf8');
}

/**
 * Replace image data URLs with placeholders, then cut the text to `maxChars` content characters.
 * An unchanged input without a placeholder comes back as the same reference with `bounded: false`.
 */
export function boundToolResultText(text: string, maxChars: number = TOOL_RESULT_STORED_MAX_CHARS): BoundedToolResult {
  let out = text;
  let changed = false;
  if (out.includes('data:image/')) {
    const replaced = out.replace(IMAGE_DATA_URL_RE, (_match, format: string, payload: string, pad: string) => {
      const len = payload.length + pad.length;
      return imagePlaceholder(format, Math.floor((len * 3) / 4) - pad.length);
    });
    if (replaced !== out) {
      out = replaced;
      changed = true;
    }
  }
  if (out.length > maxChars) {
    out = cutHeadAndTail(out, maxChars);
    changed = true;
  }
  if (changed) return { text: detach(out), bounded: true };
  if (out.includes(IMAGE_PLACEHOLDER_PREFIX)) return { text: detach(out), bounded: true };
  return { text, bounded: false };
}

function stringLength(value: string | undefined): number {
  return value === undefined ? 0 : value.length;
}

/** Lengths of every key and string value in a JSON-shaped value, walked without `JSON.stringify`. */
function estimateValueChars(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) {
    let total = 0;
    for (const item of value) total += estimateValueChars(item);
    return total;
  }
  if (value !== null && typeof value === 'object') {
    let total = 0;
    for (const [key, item] of Object.entries(value)) total += key.length + estimateValueChars(item);
    return total;
  }
  return 0;
}

export function estimateWorkLogEntryChars(entry: WorkLogEntry): number {
  let total = ROW_OVERHEAD_CHARS
    + entry.id.length
    + entry.createdAt.length
    + entry.label.length
    + stringLength(entry.detail)
    + stringLength(entry.result)
    + stringLength(entry.command)
    + stringLength(entry.toolTitle);
  if (entry.changedFiles) for (const file of entry.changedFiles) total += file.length;
  if (entry.toolInput) total += estimateValueChars(entry.toolInput);
  return total;
}

export function estimateMessageChars(message: ChatMessage): number {
  return ROW_OVERHEAD_CHARS
    + message.id.length
    + message.text.length
    + stringLength(message.turnId)
    + message.createdAt.length
    + stringLength(message.completedAt);
}

export function estimateParseResultChars(r: {
  readonly messages: readonly ChatMessage[];
  readonly workLog: readonly WorkLogEntry[];
}): number {
  let total = 0;
  for (const message of r.messages) total += estimateMessageChars(message);
  for (const entry of r.workLog) total += estimateWorkLogEntryChars(entry);
  return total;
}
