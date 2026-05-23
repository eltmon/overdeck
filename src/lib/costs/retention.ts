/**
 * Event Retention Management for Cost Tracking
 *
 * Manages the rolling 90-day retention window for cost events.
 */

import { Effect } from 'effect';
import { readEventsSync, replaceEventsFileSync, getLastEventMetadataSync, CostEvent } from './events.js';
import { rebuildCacheSync } from './aggregator.js';
import { FsError } from '../errors.js';

// ============== Types ==============

export interface RetentionStats {
  totalEvents: number;
  eventsRemoved: number;
  eventsRetained: number;
  oldestEventTs: string | null;
  newestEventTs: string | null;
}

// ============== Retention Logic ==============

/**
 * Prune events older than the specified retention period
 * Returns stats about what was pruned
 */
export function pruneOldEventsSync(retentionDays: number = 90): RetentionStats {
  console.log(`Pruning events older than ${retentionDays} days...`);

  // Calculate cutoff date using milliseconds (not setDate, which is DST-sensitive)
  const cutoffTs = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  // Read all events
  const allEvents = readEventsSync();
  const totalEvents = allEvents.length;

  if (totalEvents === 0) {
    return {
      totalEvents: 0,
      eventsRemoved: 0,
      eventsRetained: 0,
      oldestEventTs: null,
      newestEventTs: null,
    };
  }

  // Filter events to keep only those within retention window
  const retainedEvents = allEvents.filter(event => event.ts >= cutoffTs);
  const eventsRemoved = totalEvents - retainedEvents.length;

  // Get timestamps
  const oldestEventTs = retainedEvents.length > 0 ? retainedEvents[0].ts : null;
  const newestEventTs = retainedEvents.length > 0 ? retainedEvents[retainedEvents.length - 1].ts : null;

  // If we removed any events, write the pruned file
  if (eventsRemoved > 0) {
    console.log(`Removing ${eventsRemoved} events older than ${cutoffTs}...`);
    replaceEventsFileSync(retainedEvents);

    // Rebuild cache after pruning
    console.log('Rebuilding cache after pruning...');
    rebuildCacheSync();

    console.log(`Pruning complete: removed ${eventsRemoved} events, retained ${retainedEvents.length} events`);
  } else {
    console.log('No events to prune - all events are within retention window');
  }

  return {
    totalEvents,
    eventsRemoved,
    eventsRetained: retainedEvents.length,
    oldestEventTs,
    newestEventTs,
  };
}

/**
 * Check if pruning is needed based on oldest event
 */
export function needsPruningSync(retentionDays: number = 90): boolean {
  const allEvents = readEventsSync();

  if (allEvents.length === 0) {
    return false;
  }

  // Check oldest event
  const oldestEvent = allEvents[0];
  const oldestDate = new Date(oldestEvent.ts);
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  return oldestDate < cutoffDate;
}

/**
 * Get retention status
 */
export function getRetentionStatusSync(retentionDays: number = 90): {
  totalEvents: number;
  oldestEventTs: string | null;
  oldestEventAge: number; // days
  needsPruning: boolean;
  eventsToRemove: number;
} {
  const allEvents = readEventsSync();

  if (allEvents.length === 0) {
    return {
      totalEvents: 0,
      oldestEventTs: null,
      oldestEventAge: 0,
      needsPruning: false,
      eventsToRemove: 0,
    };
  }

  const oldestEvent = allEvents[0];
  const oldestDate = new Date(oldestEvent.ts);
  const now = new Date();
  const oldestEventAge = Math.floor((now.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24));

  const cutoffTs = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const eventsToRemove = allEvents.filter(e => e.ts < cutoffTs).length;

  return {
    totalEvents: allEvents.length,
    oldestEventTs: oldestEvent.ts,
    oldestEventAge,
    needsPruning: oldestEventAge > retentionDays,
    eventsToRemove,
  };
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Effect variant of pruneOldEvents. */
export const pruneOldEvents = (
  retentionDays: number = 90,
): Effect.Effect<RetentionStats, FsError> =>
  Effect.try({
    try: () => pruneOldEventsSync(retentionDays),
    catch: (cause) => new FsError({ path: '<events>', operation: 'pruneOldEvents', cause }),
  });

/** Effect variant of needsPruning. */
export const needsPruning = (
  retentionDays: number = 90,
): Effect.Effect<boolean, FsError> =>
  Effect.try({
    try: () => needsPruningSync(retentionDays),
    catch: (cause) => new FsError({ path: '<events>', operation: 'needsPruning', cause }),
  });

/** Effect variant of getRetentionStatus. */
export const getRetentionStatus = (
  retentionDays: number = 90,
): Effect.Effect<
  {
    totalEvents: number;
    oldestEventTs: string | null;
    oldestEventAge: number;
    needsPruning: boolean;
    eventsToRemove: number;
  },
  FsError
> =>
  Effect.try({
    try: () => getRetentionStatusSync(retentionDays),
    catch: (cause) => new FsError({ path: '<events>', operation: 'getRetentionStatus', cause }),
  });
