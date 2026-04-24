import { createGitHubClient } from './github-client.js';
import { runPushStep } from './push.js';
import { runPullStep } from './pull.js';
import { runExternalMergeSweep } from './external-merge-sweep.js';
import { resolvePrefix } from './pull.js';
import { backfillIssueState } from './backfill.js';
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
  config: ReconcilerConfig,
  state: ReconcilerState
): Promise<void> {
  if (state.mutex) {
    console.log('[reconciler] Tick skipped: previous tick still running');
    return;
  }

  state.mutex = true;
  const start = Date.now();

  try {
    // Re-backfill on every tick to catch issues created since boot / last tick.
    // INSERT OR IGNORE makes this idempotent and cheap for already-tracked rows.
    backfillIssueState();

    const gh = createGitHubClient(config);
    const prefix = resolvePrefix(config);

    // Step 1: push local changes to GitHub
    await runPushStep(config, gh);

    // Step 2: pull remote state and reconcile local canonical_state
    await runPullStep(config, gh, prefix);

    // Step 3: detect externally-merged issues and enqueue label writes
    await runExternalMergeSweep(config, gh, prefix);
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
