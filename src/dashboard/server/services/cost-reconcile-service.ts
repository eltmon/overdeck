/**
 * Periodic cost reconciliation delegates transcript walking and parsing to the
 * long DB worker lane. The main thread records returned events through the cost
 * write door and persists exact path/mtime/size skip verdicts for later sweeps.
 */
import { Effect } from 'effect';
import { reclassifyUnknownCostEventsSync } from '../../../lib/costs/attribution.js';
import {
  recordCostEventsThroughOverdeck,
  type PiCollectBatch,
  type PiCollectResult,
} from '../../../lib/costs/reconciler.js';
import { CostDoorLive, CostWriter, type CostEvent, type SkipVerdictEntry } from '../../../lib/overdeck/cost.js';
import { recordSkipVerdict } from '../../../lib/costs/skip-cache.js';
import { runDashboardDbJob } from './dashboard-db-task.js';

const RECONCILE_INTERVAL_MS = 5 * 60_000;
const RECONCILE_BATCH_EVENTS = 250;

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;

async function runCostReconcileOnce(reason: 'startup' | 'interval'): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const result = {
      eventsImported: 0,
      duplicatesSkipped: 0,
      cacheSkipped: 0,
      errors: [] as PiCollectResult['errors'],
    };
    const piCollected = await runDashboardDbJob<PiCollectResult>('costReconcileSweep', {
      source: 'pi', maxEvents: RECONCILE_BATCH_EVENTS,
    }, async (progress) => {
      const batch = progress as PiCollectBatch;
      for (const { event, sourceFile } of batch.events) {
        const recorded = await recordCostEventsThroughOverdeck([event], sourceFile);
        result.eventsImported += recorded.inserted;
        result.duplicatesSkipped += recorded.duplicates;
      }
      for (const verdict of batch.verdicts) {
        recordSkipVerdict(verdict.path, verdict.mtimeMs, verdict.size, verdict.verdict);
      }
    });
    result.cacheSkipped += piCollected.stats.cacheSkipped;
    result.errors.push(...piCollected.errors);
    if (result.eventsImported > 0 || result.cacheSkipped > 0 || result.errors.length > 0) {
      console.log(
        `[cost-reconciler] ${reason} sweep: ${result.eventsImported} imported, ` +
        `${result.cacheSkipped} cache-skipped, ${result.duplicatesSkipped} duplicate(s), ` +
        `${result.errors.length} error(s)`,
      );
    }
    if (result.errors.length > 0) {
      for (const err of result.errors.slice(0, 5)) {
        console.warn(`[cost-reconciler] ${err.path}: ${err.error}`);
      }
    }
    const backfillResult = reclassifyUnknownCostEventsSync();
    if (backfillResult.updated > 0) {
      console.log(`[cost-reconciler] ${reason} UNKNOWN backfill: ${backfillResult.updated} updated`);
    }
    try {
      type CodexBatch = {
        events: CostEvent[];
        verdicts: SkipVerdictEntry[];
      };
      let imported = 0;
      const codexResult = await runDashboardDbJob<{
        stats: { scanned: number; cacheSkipped: number };
      }>('costReconcileSweep', {
        source: 'codex', maxEvents: RECONCILE_BATCH_EVENTS,
      }, async (progress) => {
        const batch = progress as CodexBatch;
        for (const event of batch.events) {
          const normalized = { ...event, ts: new Date(event.ts) };
          if (await Effect.runPromise(CostWriter.use(writer => writer.record(normalized)).pipe(
            Effect.provide(CostDoorLive)))) imported++;
        }
        for (const verdict of batch.verdicts) {
          recordSkipVerdict(verdict.path, verdict.mtimeMs, verdict.size, verdict.verdict);
        }
      });
      console.log(
        `[cost-reconciler] ${reason} codex sweep: ${codexResult.stats.scanned} scanned, ` +
        `${codexResult.stats.cacheSkipped} cache-skipped, ${imported} imported`,
      );
    } catch (err) {
      console.warn('[cost-reconciler] codex sweep failed:', err instanceof Error ? err.message : err);
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function startCostReconcileService(): void {
  if (timer) return;
  timer = setInterval(() => {
    void runCostReconcileOnce('interval').catch((err) => {
      console.warn('[cost-reconciler] interval sweep failed:', err instanceof Error ? err.message : err);
    });
  }, RECONCILE_INTERVAL_MS);
  timer.unref?.();
  void runCostReconcileOnce('startup').catch((err) => {
    console.warn('[cost-reconciler] startup sweep failed:', err instanceof Error ? err.message : err);
  });
}

export function stopCostReconcileService(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
