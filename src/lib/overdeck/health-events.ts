/**
 * health-events.ts — Sync accessors for health_events in overdeck.db.
 *
 * Replaces direct `getDatabase()` calls in:
 *   src/lib/database/health-events-db.ts
 *
 * Live consumers (service.ts): writeHealthEvent, getLatestHealthEvent.
 * Pattern follows src/lib/overdeck/review-status-sync.ts.
 *
 * NOTE: overdeck stores timestamps as INTEGER milliseconds.
 * The old health_events-db used ISO strings. This module preserves the
 * ISO-string contract for callers so no call-site changes are needed.
 */

import { getOverdeckDatabaseSync } from './infra.js';
import type { HealthState } from '../runtimes/types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HealthEvent {
  id?: number;
  agentId: string;
  timestamp: string; // ISO-8601
  state: HealthState;
  source?: string;
  metadata?: string;
}

export interface HealthEventWithMetadata extends Omit<HealthEvent, 'metadata'> {
  metadata?: Record<string, unknown>;
}

// ── Internal ─────────────────────────────────────────────────────────────────

function parseMetadata(row: HealthEvent): HealthEventWithMetadata {
  const { metadata, ...rest } = row;
  return {
    ...rest,
    metadata: metadata
      ? (JSON.parse(metadata) as Record<string, unknown>)
      : undefined,
  };
}

function toMs(isoOrDate: string | Date): number {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  return d.getTime();
}

function fromMs(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  return new Date(ms).toISOString();
}

// ── Write ─────────────────────────────────────────────────────────────────────

/** Drop-in for writeHealthEvent() from database/health-events-db.ts. */
export function writeHealthEvent(event: Omit<HealthEvent, 'id'>): number {
  const db = getOverdeckDatabaseSync();
  const result = db.prepare(`
    INSERT INTO health_events (agent_id, timestamp, state, source, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    event.agentId,
    toMs(event.timestamp),
    event.state,
    event.source ?? null,
    event.metadata ?? null,
  );
  return result.lastInsertRowid as number;
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** Drop-in for getLatestHealthEvent() from database/health-events-db.ts. */
export function getLatestHealthEvent(agentId: string): HealthEventWithMetadata | null {
  const db = getOverdeckDatabaseSync();
  const row = db.prepare(`
    SELECT id, agent_id, timestamp, state, source, metadata
    FROM health_events
    WHERE agent_id = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `).get(agentId) as {
    id: number;
    agent_id: string;
    timestamp: number | null;
    state: string;
    source: string | null;
    metadata: string | null;
  } | undefined;

  if (!row) return null;

  const event: HealthEvent = {
    id: row.id,
    agentId: row.agent_id,
    timestamp: fromMs(row.timestamp) ?? new Date().toISOString(),
    state: row.state as HealthState,
    source: row.source ?? undefined,
    metadata: row.metadata ?? undefined,
  };
  return parseMetadata(event);
}

/**
 * Drop-in for getHealthHistory() from the legacy database/health-events-db.ts —
 * reads overdeck.db (the single source of truth). Accepts ISO start/end (the
 * route passes ISO), converts to the INTEGER-ms column, and returns events with
 * ISO timestamps ascending. PAN-1979 Bug 1: the route used to import the legacy
 * panopticon.db module here, so the chart was always empty.
 */
export function getHealthHistory(
  agentId: string,
  startTime: string,
  endTime: string,
): HealthEventWithMetadata[] {
  const db = getOverdeckDatabaseSync();
  const rows = db.prepare(`
    SELECT id, agent_id, timestamp, state, source, metadata
    FROM health_events
    WHERE agent_id = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(agentId, toMs(startTime), toMs(endTime)) as Array<{
    id: number;
    agent_id: string;
    timestamp: number | null;
    state: string;
    source: string | null;
    metadata: string | null;
  }>;
  return rows.map((row) => parseMetadata({
    id: row.id,
    agentId: row.agent_id,
    timestamp: fromMs(row.timestamp) ?? new Date().toISOString(),
    state: row.state as HealthState,
    source: row.source ?? undefined,
    metadata: row.metadata ?? undefined,
  }));
}
