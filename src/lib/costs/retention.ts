/**
 * Event Retention Management for Cost Tracking
 *
 * Manages the rolling 90-day retention window for cost events.
 */

import { readEvents, replaceEventsFile, getLastEventMetadata, CostEvent } from './events.js';
import { rebuildCache } from './aggregator.js';

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
export function pruneOldEvents(retentionDays: number = 90): RetentionStats {
  console.log(`Pruning events older than ${retentionDays} days...`);

  // Calculate cutoff date
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffTs = cutoffDate.toISOString();

  // Read all events
  const allEvents = readEvents();
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
    replaceEventsFile(retainedEvents);

    // Rebuild cache after pruning
    console.log('Rebuilding cache after pruning...');
    rebuildCache();

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
export function needsPruning(retentionDays: number = 90): boolean {
  const allEvents = readEvents();

  if (allEvents.length === 0) {
    return false;
  }

  // Check oldest event
  const oldestEvent = allEvents[0];
  const oldestDate = new Date(oldestEvent.ts);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  return oldestDate < cutoffDate;
}

/**
 * Get retention status
 */
export function getRetentionStatus(retentionDays: number = 90): {
  totalEvents: number;
  oldestEventTs: string | null;
  oldestEventAge: number; // days
  needsPruning: boolean;
  eventsToRemove: number;
} {
  const allEvents = readEvents();

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

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffTs = cutoffDate.toISOString();

  const eventsToRemove = allEvents.filter(e => e.ts < cutoffTs).length;

  return {
    totalEvents: allEvents.length,
    oldestEventTs: oldestEvent.ts,
    oldestEventAge,
    needsPruning: oldestEventAge > retentionDays,
    eventsToRemove,
  };
}
