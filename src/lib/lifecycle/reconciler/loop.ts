import type { ReconcilerConfig, ReconcilerState } from './types.js';

/**
 * Single tick of the reconciler loop.
 * Steps (implemented by sub-modules):
 *   1. push — diff issue_state vs last-synced labels, write deltas
 *   2. pull — list-issues pagination, update local canonical_state on divergence
 *   3. external-merge-sweep — find state=closed + no merged label, enqueue
 *
 * Mutex ensures only one tick runs at a time.
 */
export async function tick(
  _config: ReconcilerConfig,
  state: ReconcilerState
): Promise<void> {
  if (state.mutex) {
    console.log('[reconciler] Tick skipped: previous tick still running');
    return;
  }

  state.mutex = true;
  const start = Date.now();

  try {
    // Step placeholders — implemented in subsequent beads
    // await runPushStep(config);
    // await runPullStep(config);
    // await runExternalMergeSweep(config);
    console.log('[reconciler] Tick completed in', Date.now() - start, 'ms');
  } catch (err) {
    console.warn('[reconciler] Tick failed:', err);
  } finally {
    state.mutex = false;
  }
}

/**
 * Start the fixed-interval tick driver.
 * Returns a cleanup function.
 */
export function startLoop(
  config: ReconcilerConfig,
  state: ReconcilerState
): () => void {
  if (state.running) {
    throw new Error('[reconciler] Already running');
  }

  state.running = true;

  // Run an initial tick immediately
  tick(config, state).catch((err) =>
    console.warn('[reconciler] Initial tick failed:', err)
  );

  state.timer = setInterval(() => {
    tick(config, state).catch((err) =>
      console.warn('[reconciler] Interval tick failed:', err)
    );
  }, config.intervalMs);

  return () => {
    state.running = false;
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  };
}
