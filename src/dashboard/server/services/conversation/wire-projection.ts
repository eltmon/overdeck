import { TOOL_BODY_INLINE_MAX_BYTES, TOOL_BODY_PREVIEW_CHARS, type WorkLogEntry } from '@overdeck/contracts';

// ─── Wire projection (PAN-4558) ──────────────────────────────────────────────
//
// Large tool bodies leave the wire before an entry is sent to the browser: a
// big `result` is replaced by its byte length, and an oversized `detail` or
// `toolInput` string is cut to a short preview. The full entry stays in the
// server's parse result; the dashboard fetches it from the tool-body route on
// expand.

function exceedsInlineLimit(value: string): boolean {
  if (value.length > TOOL_BODY_INLINE_MAX_BYTES) return true;
  // A UTF-16 code unit encodes to at most 3 UTF-8 bytes.
  if (value.length * 3 <= TOOL_BODY_INLINE_MAX_BYTES) return false;
  return Buffer.byteLength(value, 'utf8') > TOOL_BODY_INLINE_MAX_BYTES;
}

function preview(value: string): string {
  let end = TOOL_BODY_PREVIEW_CHARS;
  // Never split a surrogate pair.
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${value.slice(0, end)}…`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Returns the same reference when nothing inside needed cutting. */
function projectValue(value: unknown): unknown {
  if (typeof value === 'string') return exceedsInlineLimit(value) ? preview(value) : value;
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const projected = projectValue(item);
      if (projected !== item) changed = true;
      return projected;
    });
    return changed ? next : value;
  }
  if (isPlainObject(value)) {
    let next: Record<string, unknown> | null = null;
    for (const [key, item] of Object.entries(value)) {
      const projected = projectValue(item);
      if (projected !== item) {
        next ??= { ...value };
        next[key] = projected;
      }
    }
    return next ?? value;
  }
  return value;
}

/** FR-7: elide oversized tool bodies. Returns the same entry when nothing changes. */
export function projectWorkLogEntry(entry: WorkLogEntry): WorkLogEntry {
  const resultTooLarge = entry.result !== undefined && exceedsInlineLimit(entry.result);
  const detail = entry.detail !== undefined && exceedsInlineLimit(entry.detail) ? preview(entry.detail) : entry.detail;
  const toolInput = entry.toolInput === undefined
    ? undefined
    : projectValue(entry.toolInput) as Record<string, unknown>;
  if (!resultTooLarge && detail === entry.detail && toolInput === entry.toolInput) return entry;

  const projected: WorkLogEntry = { ...entry, detail, toolInput, bodyOmitted: true };
  if (detail === undefined) delete (projected as { detail?: string }).detail;
  if (toolInput === undefined) delete (projected as { toolInput?: unknown }).toolInput;
  if (resultTooLarge) {
    delete (projected as { result?: string }).result;
    (projected as { resultBytes?: number }).resultBytes = Buffer.byteLength(entry.result!, 'utf8');
  }
  return projected;
}

export function projectWorkLog(entries: readonly WorkLogEntry[]): WorkLogEntry[] {
  return entries.map(projectWorkLogEntry);
}
