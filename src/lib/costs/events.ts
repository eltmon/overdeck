/**
 * Event Log Management for Cost Tracking
 *
 * Manages the append-only events.jsonl log that records all cost events.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Effect } from 'effect';
import { insertCostEvent } from '../database/cost-events-db.js';
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
  return join(process.env.HOME || homedir(), '.panopticon', 'costs');
}

function getEventsFile(): string {
  return join(getCostsDir(), 'events.jsonl');
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
    insertCostEvent(event);
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
  if (!existsSync(getEventsFile())) {
    return [];
  }

  const content = readFileSync(getEventsFile(), 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  let events: CostEvent[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as CostEvent;
      events.push(event);
    } catch (err) {
      // Skip malformed lines
      console.warn('Skipping malformed event line:', line.slice(0, 100));
    }
  }

  // Apply filters
  if (options.issueId) {
    events = events.filter(e => e.issueId.toLowerCase() === options.issueId!.toLowerCase());
  }

  if (options.agentId) {
    events = events.filter(e => e.agentId === options.agentId);
  }

  if (options.provider) {
    events = events.filter(e => e.provider === options.provider);
  }

  if (options.startDate) {
    events = events.filter(e => e.ts >= options.startDate!);
  }

  if (options.endDate) {
    events = events.filter(e => e.ts <= options.endDate!);
  }

  // Apply offset and limit
  if (options.offset) {
    events = events.slice(options.offset);
  }

  if (options.limit) {
    events = events.slice(0, options.limit);
  }

  return events;
}

/**
 * Get the last N events from the log
 */
export function tailEventsSync(n: number): CostEvent[] {
  if (!existsSync(getEventsFile())) {
    return [];
  }

  const content = readFileSync(getEventsFile(), 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  const lastLines = lines.slice(-n);
  const events: CostEvent[] = [];

  for (const line of lastLines) {
    try {
      events.push(JSON.parse(line) as CostEvent);
    } catch {
      // Skip malformed lines
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

  const content = readFileSync(getEventsFile(), 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  const events: CostEvent[] = [];

  for (let i = startLine; i < lines.length; i++) {
    try {
      events.push(JSON.parse(lines[i]) as CostEvent);
    } catch {
      // Skip malformed lines but track position
      console.warn(`Skipping malformed event at line ${i}`);
    }
  }

  return { events, newLine: lines.length };
}

/**
 * Get metadata about the event log
 */
export function getLastEventMetadataSync(): EventMetadata {
  if (!existsSync(getEventsFile())) {
    return {
      lastEventTs: null,
      lastEventLine: 0,
      totalEvents: 0,
    };
  }

  const content = readFileSync(getEventsFile(), 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  let lastEventTs: string | null = null;

  if (lines.length > 0) {
    try {
      const lastEvent = JSON.parse(lines[lines.length - 1]) as CostEvent;
      lastEventTs = lastEvent.ts;
    } catch {
      // Can't parse last event
    }
  }

  return {
    lastEventTs,
    lastEventLine: lines.length,
    totalEvents: lines.length,
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
