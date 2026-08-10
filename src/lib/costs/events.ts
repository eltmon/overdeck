/**
 * Event Log Management for Cost Tracking
 *
 * Manages the append-only events.jsonl log that records all cost events.
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Effect } from 'effect';
import { insertCostEventSync } from '../overdeck/cost-sync.js';
import { appendToWalSync } from './wal.js';
import { FsError } from '../errors.js';

// ============== Types ==============

export interface CostEvent {
  ts: string;              // ISO timestamp
  type: 'cost';            // Event type (always 'cost' for now)
  agentId: string;         // Agent identifier
  issueId: string;         // Issue identifier (e.g., "PAN-81")
  sessionType: string;     // Session type (e.g., "implementation", "planning")
  source?: string;         // Cost source tag (e.g., "memory-extraction")
  provider: string;        // AI provider (e.g., "anthropic", "openai", "google")
  model: string;           // Model name (e.g., "claude-sonnet-4")
  input: number;           // Input tokens
  output: number;          // Output tokens
  cacheRead: number;       // Cache read tokens
  cacheWrite: number;      // Cache write tokens
  cost: number;            // Cost in USD

  // TLDR metrics — delta since last cost event (PAN-236)
  // Present only when a TLDR daemon is active for the workspace.
  tldrInterceptions?: number;              // TLDR summaries served since last cost event
  tldrBypasses?: number;                  // TLDR bypasses since last cost event
  tldrTokensSaved?: number;               // Estimated tokens saved since last cost event
  tldrBypassReasons?: Record<string, number>; // e.g. { "offset-limit": 3, "recently-edited": 1 }

  requestId?: string;                      // Claude Code transcript request ID — used for precise dedup (PAN-238)
  sessionId?: string;                      // Claude Code session UUID — maps to transcript filename

  // Caveman A/B test variant — set when agents.caveman.ab_test is true (PAN-611)
  cavemanVariant?: 'enabled' | 'disabled' | 'off';
}

export interface EventMetadata {
  lastEventTs: string | null;
  lastEventLine: number;
  totalEvents: number;
  byteOffset: number;
}

export interface ReadEventsOptions {
  issueId?: string;
  agentId?: string;
  provider?: string;
  startDate?: string;      // ISO date string
  endDate?: string;        // ISO date string
  limit?: number;
  offset?: number;
}

// ============== Constants ==============

// Use functions for paths to allow test mocking via process.env.HOME
function getCostsDir(): string {
  return join(process.env.HOME || homedir(), '.overdeck', 'costs');
}

function getEventsFile(): string {
  return join(getCostsDir(), 'events.jsonl');
}

const EVENT_READ_CHUNK_BYTES = 64 * 1024;

type EventLineVisitor = (line: string, lineNumber: number, endOffset: number) => boolean | void;

interface EventScanResult {
  lineCount: number;
  byteOffset: number;
  lastLine: string | null;
}

/**
 * Scan the append-only event log with memory bounded by one chunk and one line.
 * Hot dashboard reads must never materialize the whole log: on a mature install
 * events.jsonl is hundreds of megabytes, and readFileSync + split retained roughly
 * 200 MB of garbage per request until V8 happened to run a major GC.
 */
function scanEventLinesSync(options: {
  startOffset?: number;
  startLine?: number;
  includeTrailingLine?: boolean;
  visitor?: EventLineVisitor;
} = {}): EventScanResult {
  const eventsFile = getEventsFile();
  const startOffset = Math.max(0, options.startOffset ?? 0);
  const startLine = Math.max(0, options.startLine ?? 0);
  if (!existsSync(eventsFile)) {
    return { lineCount: startLine, byteOffset: startOffset, lastLine: null };
  }

  const fd = openSync(eventsFile, 'r');
  const readBuffer = Buffer.allocUnsafe(EVENT_READ_CHUNK_BYTES);
  let carry = Buffer.alloc(0);
  let carryOffset = startOffset;
  let position = startOffset;
  let lineCount = startLine;
  let byteOffset = startOffset;
  let lastLine: string | null = null;
  let stopped = false;

  const visit = (lineBuffer: Buffer, endOffset: number): void => {
    byteOffset = endOffset;
    const line = lineBuffer.toString('utf8');
    if (!line.trim()) return;

    const lineNumber = lineCount;
    lineCount += 1;
    lastLine = line;
    if (options.visitor?.(line, lineNumber, endOffset) === false) stopped = true;
  };

  try {
    while (!stopped) {
      const bytesRead = readSync(fd, readBuffer, 0, readBuffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;

      const chunk = readBuffer.subarray(0, bytesRead);
      const data = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
      let lineStart = 0;
      for (let index = 0; index < data.length; index += 1) {
        if (data[index] !== 0x0a) continue;
        visit(data.subarray(lineStart, index), carryOffset + index + 1);
        lineStart = index + 1;
        if (stopped) break;
      }

      if (stopped) break;
      carry = Buffer.from(data.subarray(lineStart));
      carryOffset += lineStart;
    }

    if (!stopped && options.includeTrailingLine && carry.length > 0) {
      visit(carry, carryOffset + carry.length);
    }
  } finally {
    closeSync(fd);
  }

  return { lineCount, byteOffset, lastLine };
}

function eventTimestampFromLine(line: string | null): string | null {
  if (!line) return null;
  try {
    return (JSON.parse(line) as CostEvent).ts ?? null;
  } catch {
    return null;
  }
}

export function getEventsFileSizeSync(): number {
  try {
    return statSync(getEventsFile()).size;
  } catch {
    return 0;
  }
}

export function forEachCostEventSync(visitor: (event: CostEvent) => void): EventMetadata {
  const scan = scanEventLinesSync({
    visitor: (line) => {
      try {
        visitor(JSON.parse(line) as CostEvent);
      } catch {
        console.warn('Skipping malformed event line:', line.slice(0, 100));
      }
    },
  });
  return {
    lastEventTs: eventTimestampFromLine(scan.lastLine),
    lastEventLine: scan.lineCount,
    totalEvents: scan.lineCount,
    byteOffset: scan.byteOffset,
  };
}

export function readEventsFromByteOffsetSync(startOffset: number): {
  events: CostEvent[];
  newOffset: number;
  linesRead: number;
  lastEventTs: string | null;
} {
  const events: CostEvent[] = [];
  const scan = scanEventLinesSync({
    startOffset,
    visitor: (line) => {
      try {
        events.push(JSON.parse(line) as CostEvent);
      } catch {
        console.warn('Skipping malformed event line:', line.slice(0, 100));
      }
    },
  });
  return {
    events,
    newOffset: scan.byteOffset,
    linesRead: scan.lineCount,
    lastEventTs: eventTimestampFromLine(scan.lastLine),
  };
}

// ============== Initialization ==============

/**
 * Ensure the costs directory and events file exist
 */
function ensureEventsFile(): void {
  const costsDir = getCostsDir();
  const eventsFile = getEventsFile();
  mkdirSync(costsDir, { recursive: true });
  if (!existsSync(eventsFile)) {
    writeFileSync(eventsFile, '', 'utf-8');
  }
}

// ============== Event Writing ==============

/**
 * Append a cost event to the log
 *
 * CONCURRENCY NOTE: This function uses appendFileSync which provides atomicity
 * for individual line writes. Each event is a single line, so concurrent writes
 * from different processes won't interleave within a line. However, the order
 * of events from concurrent processes is non-deterministic.
 *
 * This is acceptable because:
 * 1. Each agent runs in its own process with its own heartbeat-hook
 * 2. Event timestamps provide ordering
 * 3. Aggregation is commutative (order doesn't affect totals)
 */
export function appendCostEventSync(event: CostEvent): void {
  ensureEventsFile();

  // Validate required fields
  if (!event.ts || !event.agentId || !event.issueId || !event.model) {
    throw new Error('Missing required event fields: ts, agentId, issueId, model');
  }

  // Append to log atomically (single write operation, newline-terminated)
  const line = JSON.stringify(event) + '\n';
  appendFileSync(getEventsFile(), line, 'utf-8');

  // Dual-write to SQLite (best-effort — JSONL remains canonical)
  try {
    insertCostEventSync(event);
  } catch (err) {
    console.error('[cost-events] SQLite write failed (continuing with JSONL):', err);
  }

  // Append to per-project WAL file (best-effort — enables multi-developer sync)
  try {
    appendToWalSync(event);
  } catch (err) {
    console.error('[cost-events] WAL write failed (continuing):', err);
  }
}

// ============== Event Reading ==============

/**
 * Read all events from the log with optional filters
 */
export function readEventsSync(options: ReadEventsOptions = {}): CostEvent[] {
  const events: CostEvent[] = [];
  const offset = options.offset ?? 0;
  const limit = options.limit;
  const canPageWhileScanning = offset >= 0 && (limit === undefined || limit > 0);
  let matched = 0;

  scanEventLinesSync({
    includeTrailingLine: true,
    visitor: (line) => {
      let event: CostEvent;
      try {
        event = JSON.parse(line) as CostEvent;
      } catch {
        console.warn('Skipping malformed event line:', line.slice(0, 100));
        return;
      }

      if (options.issueId && event.issueId.toLowerCase() !== options.issueId.toLowerCase()) return;
      if (options.agentId && event.agentId !== options.agentId) return;
      if (options.provider && event.provider !== options.provider) return;
      if (options.startDate && event.ts < options.startDate) return;
      if (options.endDate && event.ts > options.endDate) return;

      if (canPageWhileScanning && matched < offset) {
        matched += 1;
        return;
      }
      events.push(event);
      matched += 1;
      if (canPageWhileScanning && limit !== undefined && events.length >= limit) return false;
    },
  });

  if (canPageWhileScanning) return events;

  let paged = events;
  if (options.offset) paged = paged.slice(options.offset);
  if (options.limit) paged = paged.slice(0, options.limit);
  return paged;
}

/**
 * Get the last N events from the log
 */
export function tailEventsSync(n: number): CostEvent[] {
  const lines: string[] = [];
  scanEventLinesSync({
    includeTrailingLine: true,
    visitor: (line) => {
      lines.push(line);
      if (n > 0 && lines.length > n) lines.shift();
    },
  });

  const selected = n > 0 ? lines : lines.slice(-n);
  const events: CostEvent[] = [];
  for (const line of selected) {
    try {
      events.push(JSON.parse(line) as CostEvent);
    } catch {
      // Skip malformed lines.
    }
  }
  return events;
}

/**
 * Read events starting from a specific line number
 * Useful for incremental processing
 * Returns both events and the new line position to handle malformed lines correctly
 */
export function readEventsFromLineSync(startLine: number): { events: CostEvent[]; newLine: number } {
  if (!existsSync(getEventsFile())) {
    return { events: [], newLine: startLine };
  }

  const events: CostEvent[] = [];
  const scan = scanEventLinesSync({
    includeTrailingLine: true,
    visitor: (line, lineNumber) => {
      if (lineNumber < startLine) return;
      try {
        events.push(JSON.parse(line) as CostEvent);
      } catch {
        console.warn(`Skipping malformed event at line ${lineNumber}`);
      }
    },
  });

  return { events, newLine: scan.lineCount };
}

/**
 * Get metadata about the event log
 */
export function getLastEventMetadataSync(): EventMetadata {
  const scan = scanEventLinesSync({ includeTrailingLine: true });
  return {
    lastEventTs: eventTimestampFromLine(scan.lastLine),
    lastEventLine: scan.lineCount,
    totalEvents: scan.lineCount,
    byteOffset: scan.byteOffset,
  };
}

/**
 * Replace the entire events log with new content
 * Used by retention pruning - DANGEROUS, use with caution
 */
export function replaceEventsFileSync(events: CostEvent[]): void {
  ensureEventsFile();

  // Write to temp file first
  const tempFile = getEventsFile() + '.tmp';
  const content = events.length > 0
    ? events.map(e => JSON.stringify(e)).join('\n') + '\n'
    : '';
  writeFileSync(tempFile, content, 'utf-8');

  // Atomic rename
  renameSync(tempFile, getEventsFile());
}

/**
 * Deduplicate events.jsonl by removing duplicate cost events.
 *
 * Primary strategy (PAN-238): If an event has a `requestId`, deduplicate by
 * exact requestId match. Claude Code's transcript contains multiple entries
 * per API request (same requestId), so each requestId should produce exactly
 * one cost event.
 *
 * Fallback strategy (PAN-220): For events without `requestId` (recorded before
 * PAN-238), use the heuristic 60-second window: events with identical token
 * fields within 60 seconds are considered race-condition duplicates.
 *
 * Returns the number of duplicate events removed.
 */
export function deduplicateEventsSync(): number {
  if (!existsSync(getEventsFile())) {
    return 0;
  }

  const content = readFileSync(getEventsFile(), 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  const kept: CostEvent[] = [];
  // requestId-based dedup: exact match (precise, PAN-238)
  const seenRequestIds = new Set<string>();
  // Legacy heuristic: (key → earliest timestamp ms) for events without requestId
  const seen = new Map<string, number>();

  for (const line of lines) {
    let event: CostEvent;
    try {
      event = JSON.parse(line) as CostEvent;
    } catch {
      // Preserve malformed lines by skipping them (they won't be re-written,
      // which is intentional — replaceEventsFile only writes valid events)
      continue;
    }

    // Primary: requestId-based dedup — precise, no time-window needed
    if (event.requestId) {
      if (seenRequestIds.has(event.requestId)) {
        continue; // Duplicate
      }
      seenRequestIds.add(event.requestId);
      kept.push(event);
      continue;
    }

    // Fallback: 60-second window heuristic for events without requestId
    const key = `${event.agentId}|${event.issueId}|${event.model}|${event.input}|${event.output}|${event.cacheRead}|${event.cacheWrite}`;
    const tsMs = new Date(event.ts).getTime();

    // Compare to the last KEPT event for this key.
    // Two events are duplicates if they have the same token fields and timestamps
    // within 60 seconds of the most recently kept event (race condition window).
    // Strict < preserves events exactly 60 seconds apart as legitimate.
    const lastKeptMs = seen.get(key);
    if (lastKeptMs !== undefined && Math.abs(tsMs - lastKeptMs) < 60_000) {
      continue; // Duplicate within 60-second window
    }

    seen.set(key, tsMs);
    kept.push(event);
  }

  const removed = lines.length - kept.length;
  if (removed > 0) {
    replaceEventsFileSync(kept);
  }
  return removed;
}

/**
 * Check if events file exists
 */
export function eventsFileExists(): boolean {
  return existsSync(getEventsFile());
}

/**
 * Get the path to the events file
 */
export function getEventsFilePath(): string {
  return getEventsFile();
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// These wrap the existing sync APIs in Effect with typed error channels so
// Effect-native callers can compose cost-event IO with other Effect code. They
// do NOT replace the sync variants — existing callers continue to use those.

/**
 * Effect variant of appendCostEvent. Failures surface as typed FsError on the
 * error channel instead of thrown exceptions. SQLite and WAL best-effort
 * writes preserve the same semantics as the sync variant.
 */
export const appendCostEvent = (
  event: CostEvent,
): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => appendCostEventSync(event),
    catch: (cause) => new FsError({ path: getEventsFile(), operation: 'appendCostEvent', cause }),
  });

/** Effect variant of readEvents. */
export const readEvents = (
  options: ReadEventsOptions = {},
): Effect.Effect<CostEvent[], FsError> =>
  Effect.try({
    try: () => readEventsSync(options),
    catch: (cause) => new FsError({ path: getEventsFile(), operation: 'readEvents', cause }),
  });

/** Effect variant of tailEvents. */
export const tailEvents = (
  n: number,
): Effect.Effect<CostEvent[], FsError> =>
  Effect.try({
    try: () => tailEventsSync(n),
    catch: (cause) => new FsError({ path: getEventsFile(), operation: 'tailEvents', cause }),
  });

/** Effect variant of readEventsFromLine. */
export const readEventsFromLine = (
  startLine: number,
): Effect.Effect<{ events: CostEvent[]; newLine: number }, FsError> =>
  Effect.try({
    try: () => readEventsFromLineSync(startLine),
    catch: (cause) => new FsError({ path: getEventsFile(), operation: 'readEventsFromLine', cause }),
  });

/** Effect variant of getLastEventMetadata. */
export const getLastEventMetadata = (): Effect.Effect<EventMetadata, FsError> =>
  Effect.try({
    try: () => getLastEventMetadataSync(),
    catch: (cause) => new FsError({ path: getEventsFile(), operation: 'getLastEventMetadata', cause }),
  });

/** Effect variant of replaceEventsFile. */
export const replaceEventsFile = (
  events: CostEvent[],
): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => replaceEventsFileSync(events),
    catch: (cause) => new FsError({ path: getEventsFile(), operation: 'replaceEventsFile', cause }),
  });

/** Effect variant of deduplicateEvents. */
export const deduplicateEvents = (): Effect.Effect<number, FsError> =>
  Effect.try({
    try: () => deduplicateEventsSync(),
    catch: (cause) => new FsError({ path: getEventsFile(), operation: 'deduplicateEvents', cause }),
  });
