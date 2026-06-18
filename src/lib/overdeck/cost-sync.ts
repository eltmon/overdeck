/**
 * Sync primitives for overdeck cost_events — used by the hot path
 * appendCostEventSync() in lib/costs/events.ts, which must stay sync
 * (the caller is a fire-and-forget best-effort write after JSONL append).
 *
 * The Effect-based CostWriter.record() path goes through CostArchiveLive;
 * this sync path mirrors only the cache-table insert into overdeck.db.
 */
import type { CostEvent } from '../costs/events.js';
import { getOverdeckDatabaseSync } from './infra.js';

/**
 * Best-effort sync insert of a cost event into overdeck.db.
 * Returns true on success, false if row was a duplicate (request_id conflict).
 * Throws on unexpected errors — caller wraps in try/catch.
 */
export function insertCostEventSync(event: CostEvent): boolean {
  const db = getOverdeckDatabaseSync();
  // overdeck stores ts as integer unix seconds
  const tsSeconds = Math.floor(new Date(event.ts).getTime() / 1000);
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO cost_events
        (ts, issue_id, agent_id, session_id, session_type, provider, model,
         input, output, cache_read, cache_write, cost, request_id, source_file)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      tsSeconds,
      event.issueId ?? null,
      event.agentId ?? null,
      event.sessionId ?? null,
      event.sessionType ?? null,
      event.provider ?? null,
      event.model ?? null,
      event.input,
      event.output,
      event.cacheRead,
      event.cacheWrite,
      event.cost,
      event.requestId ?? null,
      event.source ?? null,
    );
  return result.changes > 0;
}
