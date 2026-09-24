import { Effect } from 'effect';

import type { AgentState as BackendAgentState } from '../terminal-backends/types.js';
import { isAlive, isConfirmedDead, type LivenessVerdict } from './liveness.js';
import { stopAgent } from './termination.js';

/** Inputs to `reapWarmIdleRoleRun`; `isAlive` and `stop` are test seams. */
export interface WarmIdleReapDeps {
  readonly isAlive?: (agentId: string) => Promise<LivenessVerdict>;
  readonly stop?: (agentId: string) => Promise<void>;
  /**
   * The agent's `state.json` status. Required: without it an idle Herdr pane
   * could be a run still booting. The caller passes it because importing
   * agent-state here would close an import cycle through spawn.ts.
   */
  readonly readStatus: (agentId: string) => string | undefined;
}

/**
 * Herdr states of a harness that finished its turn and sits at its prompt
 * (PAN-3923). An interactive role run never exits on its own, so on Herdr a
 * finished run is a live pane in one of these states, not a dead one.
 */
const FINISHED_BACKEND_STATES: ReadonlySet<BackendAgentState> = new Set(['idle', 'done']);

/**
 * True when the liveness verdict proves a role run is finished, not running
 * (PAN-3923):
 *
 * - the oracle confirmed the harness is gone (`pane-dead`, `runtime-missing`,
 *   `no-session`): a pane with no live harness process in it is not a run; or
 * - on Herdr, the harness is alive but `idle` or `done` at its prompt and the
 *   agent's `state.json` is past `starting`. `spawnRun` marks the run `running`
 *   only after its prompt is delivered, so an idle pane past `starting` has
 *   finished that prompt rather than still booting.
 *
 * A `working`, `blocked` or `unknown` Herdr pane, any live tmux pane (tmux
 * reports no per-pane agent state), and an unprobeable one
 * (`runtime-indeterminate`) are active runs.
 */
export function isFinishedRoleRun(verdict: LivenessVerdict, status: string | undefined): boolean {
  if (!verdict.alive) return isConfirmedDead(verdict);
  const backendState = verdict.backendState;
  return backendState !== undefined && FINISHED_BACKEND_STATES.has(backendState) && status !== 'starting';
}

/**
 * PAN-2579 warm-idle reap for a role run whose pane is still there at dispatch.
 *
 * Reaps when `isFinishedRoleRun` says the previous run finished; a working
 * harness is an active run, and an unprobeable one is treated as active. The
 * reap goes through `stopAgent`, which closes the pane through the host's
 * terminal backend (PAN-3966). It used to read tmux's `#{pane_dead}` and run
 * `kill-session`, which on a Herdr host always answered "not dead", so every
 * re-dispatch was refused as "already running". Role runs do not close their
 * own pane when they finish (warm-by-default, PAN-2579); the next dispatch
 * reaps it here.
 *
 * Returns true when the leftover was reaped and the dispatch may proceed.
 */
export async function reapWarmIdleRoleRun(agentId: string, deps: WarmIdleReapDeps): Promise<boolean> {
  const probe = deps.isAlive ?? ((id: string) => isAlive(id));
  const verdict = await probe(agentId).catch((): LivenessVerdict => ({ alive: false, reason: 'runtime-indeterminate' }));
  if (!isFinishedRoleRun(verdict, deps.readStatus(agentId))) return false;
  const stop = deps.stop ?? ((id: string) => Effect.runPromise(stopAgent(id)));
  await stop(agentId).catch(() => {});
  return true;
}
