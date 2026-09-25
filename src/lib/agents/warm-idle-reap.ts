import { Effect } from 'effect';

import type { AgentState as BackendAgentState } from '../terminal-backends/types.js';
import { idleAgeMs, isAlive, isConfirmedDead, type LivenessVerdict } from './liveness.js';
import { stopAgent } from './termination.js';

/** The previous run's `state.json` facts the reap decides on. */
export interface PriorRoleRun {
  readonly role?: string;
  readonly status?: string;
  readonly reviewSubRole?: string;
  /** The harness the run launched with (`state.json` `harness`); picks the transcript reader. */
  readonly harness?: string;
  readonly workspace?: string;
  /** When the run was spawned; a transcript not written since then belongs to an earlier run. */
  readonly startedAt?: string;
}

/** Inputs to `reapWarmIdleRoleRun`; every field except `readRun` is a test seam. */
export interface WarmIdleReapDeps {
  readonly isAlive?: (agentId: string) => Promise<LivenessVerdict>;
  readonly stop?: (agentId: string) => Promise<void>;
  /**
   * The previous run's `state.json`, or undefined when it is missing.
   * Required: the caller passes it because importing agent-state here would
   * close an import cycle through spawn.ts.
   */
  readonly readRun: (agentId: string) => PriorRoleRun | undefined;
  /** Work-activity idle age (liveness.ts `idleAgeMs`); null when no signal exists. */
  readonly idleAgeMs?: (agentId: string) => number | null;
  /** Whether the backend still reports the agent's pane (settle wait after the stop). */
  readonly paneExists?: (agentId: string) => Promise<boolean>;
  /**
   * Whether the run's own transcript says its newest turn finished (#4169);
   * defaults to `roleRunTurnFinished`. Asked only for a live pane Herdr reads
   * as `unknown`.
   */
  readonly turnFinished?: (agentId: string, run: PriorRoleRun) => Promise<boolean>;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Herdr states of a harness that finished its turn and sits at its prompt
 * (PAN-3923). Herdr reads these for any Claude Code pane waiting for input,
 * which is not the same as "done for good", so they only count for a one-shot
 * role with stale work activity on two probes.
 */
const FINISHED_BACKEND_STATES: ReadonlySet<BackendAgentState> = new Set(['idle', 'done']);

/**
 * Roles whose prompt is a single turn that ends the run (PAN-3923 review).
 * The sequencer ranks the backlog, writes it through `pan backlog
 * write-sequence`, and is told never to wait for operator input.
 *
 * Deliberately absent, because they sit idle at their prompt while their work
 * is still in progress: the review synthesis parent (it waits in STANDBY for
 * its reviewers), the tier supervisor (it stays resident between commit
 * deliveries), work and plan runs. Test is absent too: its prompt ends after
 * one verdict signal, but it can end a turn to wait on a long background test
 * run, and nothing tells that idle from finished.
 */
const ONE_SHOT_ROLES: ReadonlySet<string> = new Set(['sequencer']);

/** Work activity must be at least this old before an idle pane counts as finished. */
export const FINISHED_IDLE_MIN_AGE_MS = 60_000;
/** Delay before the second Herdr probe that must still read idle/done. */
export const FINISHED_REPROBE_DELAY_MS = 5_000;
/** How long to wait for the backend to drop the reaped pane's record. */
export const REAP_SETTLE_MS = 3_000;
const REAP_SETTLE_POLL_MS = 200;

/**
 * Whether the run's transcript says its newest turn ended (#4169): the
 * turn-complete marker of a codex, kimi-code, pi/ohmypi, ACP or OpenCode
 * transcript (`transcript-turn.ts`), in a transcript written since the run
 * started. Claude Code and Muse transcripts, a missing transcript, and a run
 * with no `startedAt` answer false.
 */
export async function roleRunTurnFinished(agentId: string, run: PriorRoleRun): Promise<boolean> {
  const startedAtMs = run.startedAt ? new Date(run.startedAt).getTime() : NaN;
  if (!Number.isFinite(startedAtMs)) return false;
  const [{ resolveAgentTranscriptCandidate }, { transcriptTurnFinished }, { stat }] = await Promise.all([
    import('./transcript-resolver.js'),
    import('./transcript-turn.js'),
    import('node:fs/promises'),
  ]);
  const candidate = await resolveAgentTranscriptCandidate(agentId, run.workspace ?? '');
  if (!candidate) return false;
  const mtimeMs = await stat(candidate.path).then((info) => info.mtimeMs, () => null);
  if (mtimeMs === null || mtimeMs < startedAtMs) return false;
  return transcriptTurnFinished(candidate.kind, candidate.path);
}

/**
 * Whether `isFinishedRoleRun` needs the transcript signal for this probe: a
 * live pane Herdr reads as `unknown` (pane-bound, not Claude Code), for a
 * one-shot run that is `running`. Everything else is decided without it.
 */
export function needsTurnSignal(verdict: LivenessVerdict, run: PriorRoleRun | undefined): boolean {
  return verdict.alive
    && verdict.backendState === 'unknown'
    && isOneShotRoleRun(run)
    && run?.status === 'running';
}

/** A one-shot role run (see `ONE_SHOT_ROLES`); a review sub-role is never one. */
export function isOneShotRoleRun(run: PriorRoleRun | undefined): boolean {
  return run?.role !== undefined && ONE_SHOT_ROLES.has(run.role) && !run.reviewSubRole;
}

/**
 * True when one liveness probe says the previous role run is finished
 * (PAN-3923). A run with no `state.json`, an unknown status, or status
 * `starting` is never finished: it may be booting, and its pane can look
 * empty (`runtime-missing`) or idle before the harness takes its prompt.
 *
 * - Confirmed dead (`pane-dead`, `runtime-missing`, `no-session`): finished.
 * - Alive on Herdr and `idle`/`done`: finished only for a one-shot role that
 *   is `running` (its prompt was delivered) with work activity older than
 *   `FINISHED_IDLE_MIN_AGE_MS`, the liveness.ts idleness rule. The Herdr label
 *   alone never counts. `reapWarmIdleRoleRun` also requires a second probe.
 * - Alive on Herdr and `unknown` (a pane-bound harness Herdr does not track,
 *   #4169): the same rule, with `turnFinished` (the run's transcript says its
 *   newest turn ended, `roleRunTurnFinished`) standing in for the label.
 *
 * `working`, `blocked`, `unknown` without a finished turn, a live tmux pane
 * (tmux has no per-pane agent state), and an unprobeable verdict
 * (`runtime-indeterminate`) are active.
 */
export function isFinishedRoleRun(
  verdict: LivenessVerdict,
  run: PriorRoleRun | undefined,
  workIdleAgeMs: number | null,
  turnFinished = false,
): boolean {
  if (run?.status === undefined || run.status === 'starting') return false;
  if (!verdict.alive) return isConfirmedDead(verdict);
  const finishedSignal = verdict.backendState !== undefined
    && (FINISHED_BACKEND_STATES.has(verdict.backendState)
      || (verdict.backendState === 'unknown' && turnFinished));
  return finishedSignal
    && isOneShotRoleRun(run)
    && run.status === 'running'
    && workIdleAgeMs !== null
    && workIdleAgeMs >= FINISHED_IDLE_MIN_AGE_MS;
}

/**
 * Probe twice: a finished verdict from a live (idle) pane must hold on a
 * second probe `FINISHED_REPROBE_DELAY_MS` later, re-reading the state, the
 * activity and, for an `unknown` pane, the transcript. A confirmed death needs
 * no second look.
 */
export async function confirmFinishedRoleRun(agentId: string, deps: WarmIdleReapDeps): Promise<boolean> {
  const probe = deps.isAlive ?? ((id: string) => isAlive(id));
  const readIdleAge = deps.idleAgeMs ?? ((id: string) => idleAgeMs(id));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const readTurn = deps.turnFinished ?? roleRunTurnFinished;
  const check = async (): Promise<{ finished: boolean; alive: boolean }> => {
    const verdict = await probe(agentId).catch((): LivenessVerdict => ({ alive: false, reason: 'runtime-indeterminate' }));
    const run = deps.readRun(agentId);
    const turnFinished = run !== undefined && needsTurnSignal(verdict, run)
      ? await readTurn(agentId, run).catch(() => false)
      : false;
    return { finished: isFinishedRoleRun(verdict, run, readIdleAge(agentId), turnFinished), alive: verdict.alive };
  };
  const first = await check();
  if (!first.finished) return false;
  if (!first.alive) return true;
  await sleep(FINISHED_REPROBE_DELAY_MS);
  const second = await check();
  return second.finished && second.alive;
}

async function defaultPaneExists(agentId: string): Promise<boolean> {
  const { agentPaneExists } = await import('../terminal-backends/launch.js');
  return agentPaneExists(agentId);
}

/**
 * Wait, bounded, for the backend to stop reporting the pane: Herdr drops the
 * record asynchronously, and the relaunch reuses the same agent name.
 */
export async function waitForPaneGone(agentId: string, deps: Pick<WarmIdleReapDeps, 'paneExists' | 'sleep'> = {}): Promise<void> {
  const paneExists = deps.paneExists ?? defaultPaneExists;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + REAP_SETTLE_MS;
  while (Date.now() < deadline) {
    if (!(await paneExists(agentId).catch(() => false))) return;
    await sleep(REAP_SETTLE_POLL_MS);
  }
}

/**
 * PAN-2579 warm-idle reap for a role run whose pane is still there at dispatch.
 *
 * Reaps when `confirmFinishedRoleRun` says the previous run finished; anything
 * else is an active run, and an unprobeable one is treated as active. The reap
 * goes through `stopAgent`, which closes the pane through the host's terminal
 * backend (PAN-3966), then waits for the backend to drop the pane before the
 * caller relaunches under the same name. Role runs do not close their own pane
 * when they finish (warm-by-default, PAN-2579); the next dispatch reaps it here.
 *
 * Returns true when the leftover was reaped and the dispatch may proceed.
 */
export async function reapWarmIdleRoleRun(agentId: string, deps: WarmIdleReapDeps): Promise<boolean> {
  if (!(await confirmFinishedRoleRun(agentId, deps))) return false;
  const stop = deps.stop ?? ((id: string) => Effect.runPromise(stopAgent(id)));
  await stop(agentId).catch(() => {});
  await waitForPaneGone(agentId, deps);
  return true;
}
