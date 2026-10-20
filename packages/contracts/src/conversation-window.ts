/**
 * Conversation window contract shared by the dashboard server and the
 * frontend (PAN-4558). A cold open carries only the newest slice of a
 * transcript; older history is paged in by cursor. The constants bound every
 * open, and the timeline key gives entries one total order on both sides.
 */

/** Most timeline rows a window or page carries. */
export const CONVERSATION_WINDOW_MAX_ROWS = 75
/** Most encoded entry bytes a window carries (960 KiB, leaving 64 KiB for metadata). */
export const CONVERSATION_WINDOW_MAX_BYTES = 983_040
/** Whole-payload ceiling for an initial HTTP body or first WS event. */
export const CONVERSATION_PAYLOAD_BUDGET_BYTES = 1_048_576
/** Default `limit` for a paged read. */
export const CONVERSATION_PAGE_DEFAULT_LIMIT = 75
/** Largest `limit` a paged read accepts; larger values clamp to it. */
export const CONVERSATION_PAGE_MAX_LIMIT = 200
/** A tool `result` (or `detail`/`toolInput` string) above this many UTF-8 bytes leaves the wire. */
export const TOOL_BODY_INLINE_MAX_BYTES = 4096
/** Characters kept from an oversized `detail`/`toolInput` string. */
export const TOOL_BODY_PREVIEW_CHARS = 512
/** Most open entry ids a resume may name. */
export const RESUME_OPEN_IDS_MAX = 200
/** Most open tool calls pinned into a window beyond its contiguous slice. */
export const WINDOW_PINNED_OPEN_TOOLS_MAX = 10

/** `[createdAt, sequence ?? 0, kindRank, id]`; kindRank is 0 for a message, 1 for a work entry. */
export type TimelineKey = readonly [createdAt: string, sequence: number, kindRank: 0 | 1, id: string]

interface TimelineEntryLike {
  createdAt: string
  sequence?: number
  id: string
}

export function timelineKeyOfMessage(m: TimelineEntryLike): TimelineKey {
  return [m.createdAt, m.sequence ?? 0, 0, m.id]
}

export function timelineKeyOfWork(e: TimelineEntryLike): TimelineKey {
  return [e.createdAt, e.sequence ?? 0, 1, e.id]
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Total order: createdAt (string compare), then sequence, then message before work, then id. */
export function compareTimelineKeys(a: TimelineKey, b: TimelineKey): number {
  return compareStrings(a[0], b[0])
    || a[1] - b[1]
    || a[2] - b[2]
    || compareStrings(a[3], b[3])
}

export function encodeTimelineCursor(key: TimelineKey): string {
  return JSON.stringify(key)
}

/** Returns null for anything that is not an encoded 4-tuple of string, finite number, 0|1, string. */
export function decodeTimelineCursor(cursor: string): TimelineKey | null {
  let value: unknown
  try {
    value = JSON.parse(cursor)
  } catch {
    return null
  }
  if (!Array.isArray(value) || value.length !== 4) return null
  const [createdAt, sequence, kindRank, id] = value
  if (typeof createdAt !== "string") return null
  if (typeof sequence !== "number" || !Number.isFinite(sequence)) return null
  if (kindRank !== 0 && kindRank !== 1) return null
  if (typeof id !== "string") return null
  return [createdAt, sequence, kindRank, id]
}

/** A tool entry has a result when it carries one inline or the wire projection elided it. */
export function hasToolResult(e: { result?: string; resultBytes?: number }): boolean {
  return !!e.result || (e.resultBytes ?? 0) > 0
}
