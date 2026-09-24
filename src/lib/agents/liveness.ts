/**
 * PAN-3849 (W32): the single liveness oracle — one module answers "is this
 * agent alive" and "is this agent idle"; every caller uses it (FR-23).
 *
 * Before this module, four private predicates disagreed: a bare tmux
 * `has-session` (which a remain-on-exit dead shell passes), a pane-dead flag
 * check, a harness-process subtree walk, and the runtime mirror's `idle`
 * label. The remain-on-exit zombie pane looked alive to feedback routing
 * (pipeline-reliability-review F12, last bullet), and a working agent looked
 * idle to the nudge patrol.
 *
 * Alive means ALL of:
 *   1. the tmux session exists (`no-session` otherwise),
 *   2. at least one pane is not dead (`pane-dead` otherwise), and
 *   3. the expected harness process is in a live pane's process subtree
 *      (`runtime-missing` when the tree is cleanly observed without it,
 *      `runtime-indeterminate` when the ps/pgrep probe itself failed — not
 *      death; see `isConfirmedDead`).
 *
 * Idle (FR-5) means: work activity — the hook-driven runtime mirror timestamp
 * plus the transcript heartbeat, never tmux pane repaints and never the
 * mirror's label alone — is older than a threshold (PAN-3846 rule, moved here
 * from cloister/agent-idle.ts).
 *
 * Process identity is established by walking the pane's real process tree
 * (`ps`/`pgrep` on actual pids rooted at `#{pane_pid}`), never by substring
 * matching on `pgrep -f` — a substring pattern self-matches the probing
 * process and reports a dead agent alive.
 */

/**
 * Sync twins (PAN-3958). Each `…Sync` function below has an async twin and exists only because
 * these callers run in synchronous contexts (sync functions, sync callbacks, or dependency slots typed
 * as sync) and cannot await:
 * - `isAliveSync` (async: `isAlive`): src/lib/parked/resolver.ts:258, src/lib/work-agent-lifecycle.ts:104. Owned
 *   by the PAN-3845 liveness seam work; its semantics are not changed here.
 * Do not add new synchronous callers; server-reachable code uses the async variants.
 */

import { Effect } from 'effect';

import { listPaneValues, listPaneValuesSync, sessionExists, sessionExistsSync } from '../tmux.js';
import type { RuntimeName } from '../runtimes/types.js';
import { hostTerminalBackendName } from '../terminal-backends/select.js';
import type { HerdrLivenessProbe } from '../terminal-backends/herdr.js';
import type { TerminalBackendName } from '../terminal-backends/types.js';
import { getAgentStateSync } from './agent-state.js';
import { getAgentRuntimeStateSync } from './runtime-state.js';
import {
  LEGACY_TMUX_PROBE_TIMEOUT_MS,
  queryTmuxSession,
  type TmuxSessionAnswer,
} from './tmux-session-query.js';
import {
  findAgentRuntimePidInSubtree,
  findAgentRuntimePidInSubtreeSync,
  type RuntimePidProbeResult,
} from './runtime-pid-probe.js';

/**
 * The transcript-heartbeat lookup behind the idle verdicts. liveness.ts lives
 * under src/lib/agents/ and is imported by messaging.ts, so it must NOT
 * import the runtimes barrel (agents.ts → messaging → liveness →
 * runtimes/index closes a module cycle). runtimes/index.ts registers
 * getRuntimeForAgent here at module load — the same registration pattern as
 * registerPipelineTelemetryAgentReader in agent-state.ts. When no lookup is
 * registered (a process that never loads the runtime registry), the idle
 * signals degrade to the runtime mirror alone, the pre-PAN-3677 behavior.
 */
export type LivenessHeartbeatLookup = (agentId: string) => { timestamp: Date } | null;

let heartbeatLookup: LivenessHeartbeatLookup | null = null;

export function registerLivenessHeartbeatLookup(lookup: LivenessHeartbeatLookup | null): void {
  heartbeatLookup = lookup;
}

function getTranscriptHeartbeatMs(agentId: string): number | null {
  if (!heartbeatLookup) return null;
  try {
    const heartbeat = heartbeatLookup(agentId);
    if (!heartbeat?.timestamp) return null;
    const ms = heartbeat.timestamp.getTime();
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

export type LivenessVerdict =
  | { alive: true; paneAlive: true; runtimePid?: number }
  | { alive: false; reason: 'no-session' | 'pane-dead' | 'runtime-missing' | 'runtime-indeterminate' };

/**
 * Remediation gate: true only when the oracle CONFIRMED the runtime is
 * gone. `runtime-indeterminate` (the ps/pgrep probe itself failed) is NOT
 * death — a broken probe must never trigger a kill, relaunch, or resume.
 * Default to "not dead".
 */
export function isConfirmedDead(verdict: LivenessVerdict): boolean {
  return !verdict.alive && verdict.reason !== 'runtime-indeterminate';
}

interface PaneRow {
  pid: string;
  dead: boolean;
}

function parsePaneRows(values: readonly string[]): PaneRow[] {
  const rows: PaneRow[] = [];
  for (const value of values) {
    const [pid = '', deadRaw = ''] = value.split('\t');
    if (!pid.trim()) continue;
    rows.push({ pid: pid.trim(), dead: deadRaw.trim() === '1' });
  }
  return rows;
}

/** Test seams for the async probe. Production callers pass nothing. */
export interface LivenessAsyncDeps {
  sessionExists?: (agentId: string) => Promise<boolean>;
  listPaneRows?: (agentId: string) => Promise<PaneRow[]>;
  findRuntimePid?: (rootPid: string, harness: RuntimeName) => Promise<RuntimePidProbeResult>;
  readHarness?: (agentId: string) => RuntimeName;
  /** Terminal backend to probe. Defaults to the host's selection (D10). */
  backend?: TerminalBackendName;
  /** Herdr probe seam; defaults to the adapter's `probeHerdrAgentLiveness`. */
  probeHerdr?: (agentId: string) => Promise<HerdrLivenessProbe>;
  /**
   * Three-part tmux session probe for the legacy check on a Herdr host.
   * Defaults to a bounded `has-session`; a `sessionExists` seam, when given,
   * stands in for it (and can only answer exists or missing).
   */
  queryTmuxSession?: (agentId: string) => Promise<TmuxSessionAnswer>;
  /** Bound on the legacy tmux check; defaults to `LEGACY_TMUX_LIVENESS_TIMEOUT_MS`. */
  legacyTmuxTimeoutMs?: number;
}

/** Test seams for the sync probe (the lifecycle classifier's variant). */
export interface LivenessSyncDeps {
  sessionExistsSync?: (agentId: string) => boolean;
  listPaneRowsSync?: (agentId: string) => PaneRow[];
  findRuntimePidSync?: (rootPid: string, harness: RuntimeName) => RuntimePidProbeResult;
  readHarness?: (agentId: string) => RuntimeName;
}

function readHarnessDefault(agentId: string): RuntimeName {
  return getAgentStateSync(agentId)?.harness ?? 'claude-code';
}

async function sessionExistsDefault(agentId: string): Promise<boolean> {
  return Effect.runPromise(sessionExists(agentId)).catch(() => false);
}

async function listPaneRowsDefault(agentId: string): Promise<PaneRow[]> {
  const values = await listPaneValues(agentId, '#{pane_pid}\t#{pane_dead}').catch(() => [] as string[]);
  return parsePaneRows(values);
}

function listPaneRowsSyncDefault(agentId: string): PaneRow[] {
  return parsePaneRows(listPaneValuesSync(agentId, '#{pane_pid}\t#{pane_dead}'));
}

/**
 * Async liveness verdict for whichever backend this host runs on (PAN-3917
 * W12). On tmux it is the three-check probe below; on Herdr the backend itself
 * is the oracle — a Herdr agent has no tmux session at all, so the tmux probe
 * would answer `no-session` for every healthy agent and the remediators would
 * reap the fleet.
 */
export async function isAlive(agentId: string, deps: LivenessAsyncDeps = {}): Promise<LivenessVerdict> {
  const backend = deps.backend ?? (await hostTerminalBackendName());
  if (backend !== 'herdr') return isAliveOnTmux(agentId, deps);
  const verdict = await isAliveOnHerdr(agentId, deps);
  if (verdict.alive || verdict.reason !== 'no-session') return verdict;
  // Review of #3992 (M3): an agent launched before the host moved to Herdr
  // still runs in its tmux session, which Herdr knows nothing about. Herdr's
  // `absent` must not become a death for it — recover and resume would kill a
  // live agent and relaunch it. A live (or unprobeable) legacy session answers.
  const legacy = await isAliveOnLegacyTmux(agentId, deps);
  if (legacy.alive || legacy.reason === 'runtime-indeterminate') return legacy;
  return verdict;
}

/** Upper bound on the whole legacy tmux check (has-session, list-panes, ps). */
const LEGACY_TMUX_LIVENESS_TIMEOUT_MS = LEGACY_TMUX_PROBE_TIMEOUT_MS + 1_000;

const INDETERMINATE: LivenessVerdict = { alive: false, reason: 'runtime-indeterminate' };

/**
 * The legacy tmux check behind a Herdr `absent` (review of #4018, L2). The
 * session probe answers in three parts — a tmux error is indeterminate, never
 * "no session" — and the whole check is bounded, so a hung tmux server cannot
 * stall `isAlive` on a Herdr host: it answers indeterminate instead.
 */
async function isAliveOnLegacyTmux(agentId: string, deps: LivenessAsyncDeps): Promise<LivenessVerdict> {
  const legacySessionExists = deps.sessionExists;
  const query = deps.queryTmuxSession
    ?? (legacySessionExists
      ? async (id: string): Promise<TmuxSessionAnswer> => ((await legacySessionExists(id)) ? 'exists' : 'missing')
      : (id: string) => queryTmuxSession(id));
  const check = (async (): Promise<LivenessVerdict> => {
    const answer = await query(agentId).catch((): TmuxSessionAnswer => 'error');
    if (answer === 'missing') return { alive: false, reason: 'no-session' };
    if (answer === 'error') return INDETERMINATE;
    return isAliveOnTmux(agentId, { ...deps, sessionExists: async () => true });
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<LivenessVerdict>((resolve) => {
    timer = setTimeout(() => resolve(INDETERMINATE), deps.legacyTmuxTimeoutMs ?? LEGACY_TMUX_LIVENESS_TIMEOUT_MS);
  });
  try {
    return await Promise.race([check.catch(() => INDETERMINATE), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Herdr's own agent registry is the oracle. A server that answers "no such
 * agent" is a confirmed death; a socket that does not answer is
 * `runtime-indeterminate`, never a death — a Herdr outage must not become a
 * fleet-wide reap.
 */
async function isAliveOnHerdr(agentId: string, deps: LivenessAsyncDeps): Promise<LivenessVerdict> {
  let probe: (id: string) => Promise<HerdrLivenessProbe>;
  if (deps.probeHerdr) {
    probe = deps.probeHerdr;
  } else {
    try {
      const { probeHerdrAgentLiveness } = await import('../terminal-backends/herdr.js');
      probe = (id) => probeHerdrAgentLiveness(id);
    } catch {
      return { alive: false, reason: 'runtime-indeterminate' };
    }
  }

  const result = await probe(agentId).catch((): HerdrLivenessProbe => ({
    kind: 'indeterminate',
    reason: 'herdr probe threw',
  }));
  switch (result.kind) {
    case 'alive': return { alive: true, paneAlive: true };
    case 'exited': return { alive: false, reason: 'pane-dead' };
    case 'absent': return { alive: false, reason: 'no-session' };
    default: return { alive: false, reason: 'runtime-indeterminate' };
  }
}

/**
 * tmux liveness: the session exists AND a pane is not dead AND the harness
 * process is in a live pane's subtree. The subtree walk covers
 * supervisor-launched agents, whose pane runs
 * `bash launcher.sh → node pty-supervisor.js → <harness>` — a wrapper that
 * exists only on tmux (see `decideSupervisorForWorkAgent`). Exported so the
 * tmux backend adapter's inventory keeps probing tmux even on a host whose
 * selected backend is Herdr.
 */
export async function isAliveOnTmux(agentId: string, deps: LivenessAsyncDeps = {}): Promise<LivenessVerdict> {
  const sessionExistsProbe = deps.sessionExists ?? sessionExistsDefault;
  const listPaneRows = deps.listPaneRows ?? listPaneRowsDefault;
  const findRuntimePid = deps.findRuntimePid ?? findAgentRuntimePidInSubtree;
  const readHarness = deps.readHarness ?? readHarnessDefault;

  if (!(await sessionExistsProbe(agentId))) return { alive: false, reason: 'no-session' };
  const panes = await listPaneRows(agentId);
  const livePanes = panes.filter((pane) => !pane.dead);
  if (livePanes.length === 0) return { alive: false, reason: 'pane-dead' };
  const harness = readHarness(agentId);
  let probeIndeterminate = false;
  for (const pane of livePanes) {
    const pid = await findRuntimePid(pane.pid, harness);
    if (typeof pid === 'number') return { alive: true, paneAlive: true, runtimePid: pid };
    if (pid === 'indeterminate') probeIndeterminate = true;
  }
  // A failed probe is not a confirmed death — remediators consult
  // isConfirmedDead, which treats this as "not dead".
  if (probeIndeterminate) return { alive: false, reason: 'runtime-indeterminate' };
  return { alive: false, reason: 'runtime-missing' };
}

/**
 * Synchronous liveness verdict over the same three checks. Exists for the
 * lifecycle classifier (`getWorkAgentLifecycleStateSync`) and the parked
 * sweeper, which are sync paths. Each call is a handful of sync tmux/ps/pgrep
 * execs — never use it in a hot per-request loop.
 */
export function isAliveSync(agentId: string, deps: LivenessSyncDeps = {}): LivenessVerdict {
  const sessionExistsProbe = deps.sessionExistsSync ?? sessionExistsSync;
  const listPaneRows = deps.listPaneRowsSync ?? listPaneRowsSyncDefault;
  const findRuntimePid = deps.findRuntimePidSync ?? findAgentRuntimePidInSubtreeSync;
  const readHarness = deps.readHarness ?? readHarnessDefault;

  if (!sessionExistsProbe(agentId)) return { alive: false, reason: 'no-session' };
  const panes = listPaneRows(agentId);
  const livePanes = panes.filter((pane) => !pane.dead);
  if (livePanes.length === 0) return { alive: false, reason: 'pane-dead' };
  const harness = readHarness(agentId);
  let probeIndeterminate = false;
  for (const pane of livePanes) {
    const pid = findRuntimePid(pane.pid, harness);
    if (typeof pid === 'number') return { alive: true, paneAlive: true, runtimePid: pid };
    if (pid === 'indeterminate') probeIndeterminate = true;
  }
  // A failed probe is not a confirmed death — remediators consult
  // isConfirmedDead, which treats this as "not dead".
  if (probeIndeterminate) return { alive: false, reason: 'runtime-indeterminate' };
  return { alive: false, reason: 'runtime-missing' };
}


/**
 * The union of every activity signal, INCLUDING tmux `window_activity`.
 * Claude Code repaints its spinner every second mid-turn, so this stays fresh
 * even when no work is happening — use {@link getAgentWorkActivityMs} for
 * idle/wedge decisions and keep this for display-grade "last sign of life".
 */
export function getAgentEffectiveLastActivityMs(agentId: string): number | null {
  const candidates: number[] = [];

  const runtimeState = getAgentRuntimeStateSync(agentId);
  const runtimeMs = runtimeState?.lastActivity ? new Date(runtimeState.lastActivity).getTime() : NaN;
  if (Number.isFinite(runtimeMs)) candidates.push(runtimeMs);

  try {
    const tmuxActivity = listPaneValuesSync(agentId, '#{window_activity}')
      .map((value) => Number.parseInt(value.trim(), 10) * 1000)
      .filter(Number.isFinite);
    candidates.push(...tmuxActivity);
  } catch {
    // tmux activity is best-effort; fall through to transcript/runtime sources.
  }

  const heartbeatMs = getTranscriptHeartbeatMs(agentId);
  if (heartbeatMs !== null) candidates.push(heartbeatMs);

  return candidates.length > 0 ? Math.max(...candidates) : null;
}

/**
 * PAN-3677: work-product activity only — the runtime mirror (hook-driven) plus
 * the transcript heartbeat, deliberately EXCLUDING tmux `window_activity`.
 * Claude Code repaints its spinner / background-task panel every second while a
 * turn is in flight, so `window_activity` stays fresh even when the provider
 * call is hung and no work is happening. A mid-turn wedge detector keyed on
 * {@link getAgentEffectiveLastActivityMs} (which takes the MAX) would never see
 * the PAN-3677 planning wedge — the hung sessions looked busy on the pane for
 * minutes while producing no tool calls, no transcript writes, and no hook
 * events. This signal goes stale exactly when real work stops.
 */
function getAgentWorkActivityMs(agentId: string): number | null {
  const candidates: number[] = [];

  const runtimeState = getAgentRuntimeStateSync(agentId);
  const runtimeMs = runtimeState?.lastActivity ? new Date(runtimeState.lastActivity).getTime() : NaN;
  if (Number.isFinite(runtimeMs)) candidates.push(runtimeMs);

  const heartbeatMs = getTranscriptHeartbeatMs(agentId);
  if (heartbeatMs !== null) candidates.push(heartbeatMs);

  return candidates.length > 0 ? Math.max(...candidates) : null;
}

/**
 * Idle age based on work activity only (PAN-3846): the runtime mirror's
 * hook-driven timestamp plus the transcript heartbeat, never tmux pane repaints
 * and never the mirror's `idle` label. Returns null when no work-activity
 * signal exists at all. For log lines that report how long an agent has been
 * idle.
 */
export function idleAgeMs(agentId: string, now = Date.now()): number | null {
  const runtimeState = getAgentRuntimeStateSync(agentId);
  const workActivityMs = getAgentWorkActivityMs(agentId)
    ?? (runtimeState?.lastActivity ? new Date(runtimeState.lastActivity).getTime() : null);
  return workActivityMs === null ? null : now - workActivityMs;
}

/**
 * FR-5: "idle" is work activity older than `thresholdMs`. The runtime mirror's
 * `idle` state alone never makes an agent idle — the Stop hook flips the
 * mirror to 'idle' between every two turns, and a stale 'active' mirror means
 * the activity hooks stopped firing (PAN-1574). Both labels reduce to the same
 * question: how old is the last real work?
 */
export function isIdle(
  agentId: string,
  thresholdMs = 5 * 60_000,
  now = Date.now(),
): boolean {
  const runtimeState = getAgentRuntimeStateSync(agentId);
  const workActivityMs = getAgentWorkActivityMs(agentId);
  if (!runtimeState) {
    if (workActivityMs === null) {
      console.log(`[deacon] ${agentId}: no runtime.json — skipping (hook not yet fired)`);
      return false;
    }
    return now - workActivityMs > thresholdMs;
  }
  if (runtimeState.state === 'suspended' || runtimeState.state === 'stopped') return false;
  // A human-blocked agent is not idle work — never nudge it.
  if (runtimeState.state === 'waiting-on-human') return false;
  const lastWorkMs = workActivityMs ?? new Date(runtimeState.lastActivity).getTime();
  return now - lastWorkMs > thresholdMs;
}
