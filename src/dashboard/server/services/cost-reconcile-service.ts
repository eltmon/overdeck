import { reconcilePiTranscripts } from '../../../lib/costs/reconciler.js';

const RECONCILE_INTERVAL_MS = 5 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;

async function runCostReconcileOnce(reason: 'startup' | 'interval'): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const result = await reconcilePiTranscripts();
    if (result.eventsImported > 0 || result.errors.length > 0) {
      console.log(
        `[cost-reconciler] ${reason} sweep: ${result.eventsImported} imported, ` +
        `${result.duplicatesSkipped} duplicate(s), ${result.errors.length} error(s)`,
      );
    }
    if (result.errors.length > 0) {
      for (const err of result.errors.slice(0, 5)) {
        console.warn(`[cost-reconciler] ${err.path}: ${err.error}`);
      }
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
