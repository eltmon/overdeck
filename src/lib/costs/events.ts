/**
 * Event Log Management
 *
 * Handles reading and writing to the append-only cost event log.
 * Supports concurrent writes with file locking.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { COSTS_DIR } from '../paths.js';
import { CostEvent } from './types.js';

// Event log file path
const EVENTS_FILE = join(COSTS_DIR, 'events.jsonl');
const LOCK_FILE = join(COSTS_DIR, 'events.lock');

/**
 * Append a cost event to the event log
 *
 * Uses simple file locking to prevent concurrent write corruption.
 */
export function appendEvent(event: CostEvent): void {
  // Ensure costs directory exists
  mkdirSync(COSTS_DIR, { recursive: true });

  // Acquire lock (simple implementation - write lock file)
  const lockStart = Date.now();
  while (existsSync(LOCK_FILE)) {
    // Wait for lock to be released (max 1 second)
    if (Date.now() - lockStart > 1000) {
      console.warn('Cost event lock timeout, forcing write');
      break;
    }
    // Busy wait for 10ms
    const waitUntil = Date.now() + 10;
    while (Date.now() < waitUntil) {
      // Spin
    }
  }

  try {
    // Create lock
    writeFileSync(LOCK_FILE, `${process.pid}`, 'utf-8');

    // Append event as JSON line
    const line = JSON.stringify(event) + '\n';
    appendFileSync(EVENTS_FILE, line, 'utf-8');
  } finally {
    // Release lock
    try {
      if (existsSync(LOCK_FILE)) {
        const lockContent = readFileSync(LOCK_FILE, 'utf-8');
        // Only remove if we own the lock
        if (lockContent === `${process.pid}`) {
          writeFileSync(LOCK_FILE, '', 'utf-8');
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Read cost events from the event log
 *
 * @param offset - Line number to start reading from (0-indexed)
 * @param limit - Maximum number of events to read (0 = unlimited)
 * @returns Array of cost events
 */
export function readEvents(offset: number = 0, limit: number = 0): CostEvent[] {
  if (!existsSync(EVENTS_FILE)) {
    return [];
  }

  const content = readFileSync(EVENTS_FILE, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  // Apply offset and limit
  const start = Math.max(0, offset);
  const end = limit > 0 ? start + limit : lines.length;
  const selectedLines = lines.slice(start, end);

  // Parse events
  const events: CostEvent[] = [];
  for (const line of selectedLines) {
    try {
      const event = JSON.parse(line);
      events.push(event);
    } catch (error) {
      console.warn('Failed to parse cost event line:', line, error);
      // Continue processing other events
    }
  }

  return events;
}

/**
 * Get the line number of the last event in the log
 *
 * Returns 0 if the log is empty or doesn't exist.
 */
export function getLastEventLine(): number {
  if (!existsSync(EVENTS_FILE)) {
    return 0;
  }

  const content = readFileSync(EVENTS_FILE, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  return lines.length;
}

/**
 * Get all events since a specific line number
 *
 * Useful for incremental processing of new events.
 */
export function readEventsSince(lastProcessedLine: number): CostEvent[] {
  return readEvents(lastProcessedLine, 0);
}

/**
 * Clear the event log (for testing or manual cleanup)
 *
 * WARNING: This will permanently delete all cost event history.
 */
export function clearEventLog(): void {
  if (existsSync(EVENTS_FILE)) {
    writeFileSync(EVENTS_FILE, '', 'utf-8');
  }
}

/**
 * Get event log statistics
 */
export function getEventLogStats(): {
  exists: boolean;
  totalEvents: number;
  fileSize: number;
  oldestEvent?: string;
  newestEvent?: string;
} {
  if (!existsSync(EVENTS_FILE)) {
    return {
      exists: false,
      totalEvents: 0,
      fileSize: 0,
    };
  }

  const content = readFileSync(EVENTS_FILE, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  let oldestEvent: string | undefined;
  let newestEvent: string | undefined;

  if (lines.length > 0) {
    try {
      const first = JSON.parse(lines[0]);
      oldestEvent = first.ts;
    } catch {
      // Ignore
    }

    try {
      const last = JSON.parse(lines[lines.length - 1]);
      newestEvent = last.ts;
    } catch {
      // Ignore
    }
  }

  return {
    exists: true,
    totalEvents: lines.length,
    fileSize: content.length,
    oldestEvent,
    newestEvent,
  };
}
