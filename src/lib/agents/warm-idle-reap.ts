import { Effect } from 'effect';

import { isAlive, type LivenessVerdict } from './liveness.js';
import { stopAgent } from './termination.js';

/** Test seams for `reapWarmIdleRoleRun`. Production callers pass nothing. */
export interface WarmIdleReapDeps {
  readonly isAlive?: (agentId: string) => Promise<LivenessVerdict>;
  readonly stop?: (agentId: string) => Promise<void>;
}

/**
 * PAN-2579 warm-idle reap for a role run whose pane is still there at dispatch.
 *
 * Reaps only when the liveness oracle confirms the pane's process exited
 * (`pane-dead`); a live harness is an active run, and an unprobeable one is
 * treated as active. The reap goes through `stopAgent`, which closes the pane
 * through the host's terminal backend (PAN-3966). It used to read tmux's
 * `#{pane_dead}` and run `kill-session`, which on a Herdr host always answered
 * "not dead", so every re-dispatch was refused as "already running".
 *
 * Returns true when the leftover was reaped and the dispatch may proceed.
 */
export async function reapWarmIdleRoleRun(agentId: string, deps: WarmIdleReapDeps = {}): Promise<boolean> {
  const probe = deps.isAlive ?? ((id: string) => isAlive(id));
  const verdict = await probe(agentId).catch((): LivenessVerdict => ({ alive: false, reason: 'runtime-indeterminate' }));
  if (verdict.alive || verdict.reason !== 'pane-dead') return false;
  const stop = deps.stop ?? ((id: string) => Effect.runPromise(stopAgent(id)));
  await stop(agentId).catch(() => {});
  return true;
}
