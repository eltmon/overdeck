/**
 * Cost Event Retention Management
 *
 * Handles cleanup of old cost events while preserving aggregated data.
 * Implements a 90-day rolling retention window for raw event logs.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { COSTS_DIR } from '../paths.js';
import { CostEvent } from './types.js';
import { readEvents, getEventLogStats } from './events.js';
import { rebuildFromEvents } from './aggregator.js';

// Retention policy: keep events for 90 days
const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Event log file path
const EVENTS_FILE = join(COSTS_DIR, 'events.jsonl');
const LOCK_FILE = join(COSTS_DIR, 'events.lock');

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
const RETENTION_MARKER_FILE = join(COSTS_DIR, 'last-retention-cleanup.txt');

/**
 * Get the last time retention cleanup was run
 */
export function getLastRetentionCleanup(): Date | null {
  if (!existsSync(RETENTION_MARKER_FILE)) {
    return null;
  }

  try {
    const content = readFileSync(RETENTION_MARKER_FILE, 'utf-8').trim();
    return new Date(content);
  } catch {
    return null;
  }
}

/**
 * Mark retention cleanup as completed
 */
function markRetentionCleanup(): void {
  writeFileSync(RETENTION_MARKER_FILE, new Date().toISOString(), 'utf-8');
}

/**
 * Check if retention cleanup is needed
 *
 * Returns true if:
 * - Never run before, OR
 * - Last run was more than 24 hours ago
 */
export function isRetentionCleanupNeeded(): boolean {
  const lastCleanup = getLastRetentionCleanup();
  if (!lastCleanup) {
    return true;
  }

  const hoursSinceLastCleanup = (Date.now() - lastCleanup.getTime()) / (1000 * 60 * 60);
  return hoursSinceLastCleanup >= 24;
}

/**
 * Clean old events from the event log
 *
 * Removes events older than 90 days while preserving aggregated data.
 * The aggregation cache ensures we don't lose historical cost totals.
 *
 * @returns Object with cleanup statistics
 */
export async function cleanOldEvents(): Promise<{
  totalEventsBefore: number;
  totalEventsAfter: number;
  eventsRemoved: number;
  oldestEventBefore?: string;
  oldestEventAfter?: string;
  bytesFreed: number;
}> {
  console.log('[retention] Starting event log cleanup (90-day retention)...');

  // Get initial stats
  const statsBefore = getEventLogStats();
  if (!statsBefore.exists || statsBefore.totalEvents === 0) {
    console.log('[retention] No events to clean up');
    markRetentionCleanup();
    return {
      totalEventsBefore: 0,
      totalEventsAfter: 0,
      eventsRemoved: 0,
      bytesFreed: 0,
    };
  }

  // Calculate cutoff date (90 days ago)
  const cutoffDate = new Date(Date.now() - RETENTION_MS);
  console.log(`[retention] Removing events older than ${cutoffDate.toISOString()}`);

  // CRITICAL: Rebuild aggregation cache BEFORE removing events
  // This ensures we preserve historical cost totals even after event deletion
  console.log('[retention] Ensuring aggregation cache is up-to-date...');
  rebuildFromEvents();

  // Read all events and filter out old ones
  const allEvents = readEvents();
  const recentEvents: CostEvent[] = [];

  for (const event of allEvents) {
    try {
      const eventDate = new Date(event.ts);
      if (eventDate >= cutoffDate) {
        recentEvents.push(event);
      }
    } catch {
      // Keep events with invalid timestamps (they're likely recent)
      recentEvents.push(event);
    }
  }

  const eventsRemoved = allEvents.length - recentEvents.length;

  if (eventsRemoved === 0) {
    console.log('[retention] No events older than 90 days, skipping cleanup');
    markRetentionCleanup();
    return {
      totalEventsBefore: statsBefore.totalEvents,
      totalEventsAfter: statsBefore.totalEvents,
      eventsRemoved: 0,
      oldestEventBefore: statsBefore.oldestEvent,
      oldestEventAfter: statsBefore.oldestEvent,
      bytesFreed: 0,
    };
  }

  console.log(`[retention] Removing ${eventsRemoved} events (keeping ${recentEvents.length})`);

  // Acquire lock before writing
  const lockStart = Date.now();
  while (existsSync(LOCK_FILE)) {
    if (Date.now() - lockStart > 5000) {
      console.warn('[retention] Lock timeout, forcing cleanup');
      break;
    }
    // Wait for 100ms before checking again
    await sleep(100);
  }

  try {
    // Create lock
    writeFileSync(LOCK_FILE, `${process.pid}`, 'utf-8');

    // Write filtered events back to file
    const newContent = recentEvents.map(e => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(EVENTS_FILE, newContent, 'utf-8');

    // Release lock
    writeFileSync(LOCK_FILE, '', 'utf-8');

    // Get final stats
    const statsAfter = getEventLogStats();
    const bytesFreed = statsBefore.fileSize - statsAfter.fileSize;

    console.log(`[retention] Cleanup complete. Freed ${bytesFreed} bytes`);

    // Mark cleanup as complete
    markRetentionCleanup();

    return {
      totalEventsBefore: statsBefore.totalEvents,
      totalEventsAfter: statsAfter.totalEvents,
      eventsRemoved,
      oldestEventBefore: statsBefore.oldestEvent,
      oldestEventAfter: statsAfter.oldestEvent,
      bytesFreed,
    };
  } catch (error: any) {
    console.error('[retention] Cleanup failed:', error.message);
    // Release lock on error
    try {
      if (existsSync(LOCK_FILE)) {
        writeFileSync(LOCK_FILE, '', 'utf-8');
      }
    } catch {
      // Ignore
    }
    throw error;
  }
}

/**
 * Run retention cleanup if needed
 *
 * Safe to call on every dashboard startup - checks if cleanup is needed first.
 */
export async function runRetentionCleanupIfNeeded(): Promise<void> {
  if (!isRetentionCleanupNeeded()) {
    console.log('[retention] Skipping cleanup - last run was within 24 hours');
    return;
  }

  try {
    await cleanOldEvents();
  } catch (error: any) {
    console.error('[retention] Failed to run cleanup:', error.message);
    // Don't throw - retention is a background task that shouldn't block startup
  }
}
