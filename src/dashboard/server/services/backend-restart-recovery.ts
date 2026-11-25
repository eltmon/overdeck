/**
 * Terminal-backend restart recovery (PAN-5091).
 *
 * Overdeck sets Herdr's `resume_agents_on_restore = false` because Overdeck
 * owns resume, so a Herdr restart (a crash, an OOM stop, a service restart)
 * leaves every conversation stopped. This service turns that into one
 * Needs-you offer; it never resumes anything by itself, because relaunching
 * dozens of harnesses into a host that just ran out of memory can cause the
 * same OOM again.
 *
 * 1. **Lost.** When the backend's event stream ends (`backend-inventory.ts`
 *    `onBackendConnectionChange`), record the operator conversations (`conv-`
 *    sessions, owned by this machine) whose row is `active`, or ended within
 *    the last minute. The window covers a harness that died moments before the
 *    server went down, whose row the conversation lifecycle poll ended in
 *    between (on a unit still on `OOMPolicy=stop`, the kernel OOM-kills one pane
 *    process and then systemd stops the whole unit). The poll ends nothing
 *    while the backend is unreadable, so the rows still say which conversations
 *    were live.
 * 2. **Restored.** When the stream is back on a fresh snapshot, keep only the
 *    recorded conversations whose harness the backend does not run now. A
 *    stream blip leaves every conversation live, so it offers nothing.
 * 3. **Offer.** Each read drops conversations that are live again, archived,
 *    paused (`pan pause`), held (a `--hold` handoff kickoff), or stopped on
 *    purpose. Stopped on purpose is either a stop door in any process
 *    (`conversation-stop-marks.ts`, on the row) since a minute before the loss, or a row
 *    ended again after the offer first saw it ended (a stop from any process
 *    rewrites `ended_at`; settle records the first value). The list only
 *    shrinks: a conversation that dies days later is never offered as a
 *    restart casualty. A new loss starts a new incident: a fresh loss time and
 *    baselines, carrying over only the names still offered.
 * 4. **Resume all.** One conversation at a time through
 *    `handleConversationResume` (resume cause `system`, so the resume contract
 *    says the process ended unexpectedly and the harness takes a turn). Before
 *    each one it waits while the resource governor (`assessMemoryPressure`:
 *    MemAvailable, PSI and CPU saturation) is not admitting, or cannot answer,
 *    and it re-checks the skip rules. `conv-flywheel` resumes through
 *    `resumeFlywheel`, as `pan flywheel resume` does. Dismiss cancels a run
 *    before its next resume.
 *
 * 5. **Shutdown (PAN-5342).** `seedShutdownOffer` turns the sessions a safe
 *    shutdown's drain stopped into the same offer, settled at once, with cause
 *    `shutdown`: the mid-turn conversations, the Flywheel conversation idle or
 *    not (PAN-5671), plus every work agent. The drain's
 *    own stops recorded stop marks, so the stopped-on-purpose mark rule is off
 *    for that cause; the `ended_at` baseline still drops a conversation the
 *    operator stops after the offer. Resume all then resumes conversations with
 *    resume cause `operator`, and afterwards each agent through `resumeAgent`,
 *    with the same pressure wait before each one.
 *
 * State is in memory only, read by polling the GET route; nothing is emitted.
 * It runs in the primary dashboard (main.ts); a dashboard restart forgets the
 * offer. tmux hosts never fire the edges, because the tmux adapter has no
 * event stream. Work agents are offered only after a shutdown.
 */
import type {
  BackendRestartAgent,
  BackendRestartConversation,
  BackendRestartRecoverySnapshot,
  BackendRestartResumeResult,
} from '@overdeck/contracts';

import { getAgentState } from '../../../lib/agents/agent-state-read.js';
import { assessMemoryPressure, type MemoryPressureBand } from '../../../lib/cloister/memory-governor.js';
import { readHeldKickoff } from '../../../lib/overdeck/conversation-kickoff-store.js';
import { listLiveConversationSessions } from '../../../lib/overdeck/conversation-liveness.js';
import { resolveSessionFile } from '../../../lib/overdeck/conversation-reads.js';
import { handleConversationResume } from '../../../lib/overdeck/conversation-runtime.js';
import { conversationStoppedSince } from '../../../lib/overdeck/conversation-stop-marks.js';
import { getConversationByName, listConversations } from '../../../lib/overdeck/conversations.js';
import { decodeDoorResponse } from '../../../lib/overdeck/scheduled-message-delivery.js';
import { FLYWHEEL_CONVERSATION_SESSION } from '../../../lib/flywheel/constants.js';
import type { ResumeCause } from '../../../lib/resume-contract.js';
import { isOfferedAfterShutdown, type ShutdownStoppedSession } from '../../../lib/shutdown/drain-record.js';
import { listLiveAgentIds } from '../../../lib/terminal-backends/inventory.js';
import { onBackendConnectionChange } from './backend-inventory.js';

/** A row that ended this long before the loss still counts as live at the loss. */
export const RESTART_EXIT_WINDOW_MS = 60_000;
/** How long Resume all waits before it asks the resource governor again. */
export const PRESSURE_WAIT_MS = 15_000;

/** The conversation fields this service reads. */
export interface RecoveryConversationRow {
  readonly name: string;
  readonly tmuxSession: string;
  readonly title: string | null;
  readonly status: 'active' | 'ended';
  readonly endedAt: string | null;
  readonly archivedAt: string | null;
  readonly origin?: 'local' | 'vault';
  readonly releasedTo?: string | null;
}

export interface BackendRestartRecoveryDeps {
  listConversations: () => readonly RecoveryConversationRow[];
  getConversation: (name: string) => RecoveryConversationRow | null;
  /** Session names whose harness runs now; null when the backend did not answer. */
  liveSessions: () => Promise<ReadonlySet<string> | null>;
  isPaused: (tmuxSession: string) => boolean;
  isHeld: (name: string) => boolean;
  stoppedSince: (name: string, sinceMs: number) => boolean;
  pressureBand: () => Promise<MemoryPressureBand>;
  resume: (name: string, resumeCause: ResumeCause) => Promise<{ status: number; body: unknown }>;
  /** Agent ids whose pane runs now; null when the inventory could not be read. One read per pass. */
  liveAgentIds: () => Promise<ReadonlySet<string> | null>;
  hasAgentState: (agentId: string) => boolean;
  resumeAgent: (
    agentId: string,
    message: string | undefined,
    opts: { resumeCause: ResumeCause },
  ) => Promise<{ success: boolean; error?: string }>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/**
 * The flywheel resumes the way `pan flywheel resume` does: no resume contract,
 * then `/pan-flywheel` re-sent, so the loop re-orients from its skill.
 */
async function resumeFlywheelConversation(): Promise<{ status: number; body: unknown }> {
  const [{ resumeFlywheel }, { FlywheelAlreadyRunning }] = await Promise.all([
    import('../../../lib/flywheel/actions.js'),
    import('../../../lib/flywheel/errors.js'),
  ]);
  try {
    await resumeFlywheel();
    return { status: 200, body: { reattached: false } };
  } catch (error) {
    if (error instanceof FlywheelAlreadyRunning) return { status: 200, body: { reattached: true } };
    return { status: 500, body: { error: error instanceof Error ? error.message : String(error) } };
  }
}

const defaultDeps: BackendRestartRecoveryDeps = {
  listConversations: () => listConversations(),
  getConversation: (name) => getConversationByName(name),
  liveSessions: () => listLiveConversationSessions(),
  isPaused: (tmuxSession) => getAgentState(tmuxSession)?.paused === true,
  isHeld: (name) => readHeldKickoff(name) !== null,
  stoppedSince: conversationStoppedSince,
  pressureBand: async () => (await assessMemoryPressure()).band,
  resume: async (name, resumeCause) => (name === FLYWHEEL_CONVERSATION_SESSION
    ? resumeFlywheelConversation()
    : decodeDoorResponse(await handleConversationResume(name, {}, { resolveSessionFile, resumeCause }))),
  liveAgentIds: () => listLiveAgentIds(),
  hasAgentState: (agentId) => getAgentState(agentId) !== null,
  resumeAgent: async (agentId, message, opts) => (await import('../../../lib/agents/resume.js')).resumeAgent(agentId, message, opts),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
};

interface Capture {
  /** What stopped the sessions: `shutdown` turns the stop-mark rule off. */
  cause: BackendRestartRecoverySnapshot['cause'];
  lostAtMs: number;
  names: string[];
  /** Work agents a shutdown stopped, resumed after the conversations. */
  agents: BackendRestartAgent[];
  /** The backend is back; false while it is down. */
  restored: boolean;
  /** `names` holds only conversations the restart left stopped. */
  settled: boolean;
  /** The `ended_at` each row had when the offer first saw it ended. */
  endedAtSeen: Map<string, string>;
  /** Names whose resume failed: their next `ended_at` change is the failure's own, not a stop. */
  rebaseline: Set<string>;
}

interface MutableRun {
  state: 'running' | 'done';
  startedAt: string;
  finishedAt: string | null;
  current: string | null;
  waitingForPressure: boolean;
  cancelled: boolean;
  results: BackendRestartResumeResult[];
}

let deps: BackendRestartRecoveryDeps = defaultDeps;
let capture: Capture | null = null;
let run: MutableRun | null = null;

/** An operator conversation this machine owns and can resume. */
function isResumableHere(row: RecoveryConversationRow): boolean {
  return row.tmuxSession.startsWith('conv-') && !row.archivedAt && row.origin !== 'vault' && !row.releasedTo;
}

/** Why a conversation drops out of the offer for good, or null. Records first-seen `ended_at`. */
function dropReason(row: RecoveryConversationRow | null, live: ReadonlySet<string>, current: Capture): string | null {
  if (!row) return 'not found';
  if (row.archivedAt) return 'archived';
  if (row.origin === 'vault' || row.releasedTo) return 'owned by another machine';
  if (live.has(row.tmuxSession)) return 'already running';
  // The drain's own stops recorded stop marks: after a shutdown they say nothing.
  if (current.cause !== 'shutdown' && deps.stoppedSince(row.name, current.lostAtMs - RESTART_EXIT_WINDOW_MS)) return 'stopped on purpose';
  if (row.status === 'ended' && row.endedAt) {
    const seen = current.endedAtSeen.get(row.name);
    if (seen === undefined) current.endedAtSeen.set(row.name, row.endedAt);
    else if (seen !== row.endedAt) {
      if (!current.rebaseline.delete(row.name)) return 'stopped on purpose';
      current.endedAtSeen.set(row.name, row.endedAt);
    }
  }
  if (deps.isPaused(row.tmuxSession)) return 'paused';
  if (deps.isHeld(row.name)) return 'held';
  return null;
}

/** Record the conversations live at the moment the backend went down. */
export function noteBackendLost(): void {
  const now = deps.now();
  const cutoff = now - RESTART_EXIT_WINDOW_MS;
  const names = deps.listConversations()
    .filter(isResumableHere)
    .filter((row) => row.status === 'active' || (row.endedAt !== null && Date.parse(row.endedAt) >= cutoff))
    .map((row) => row.name);
  // A new loss is a new incident: a fresh loss time and fresh baselines, so a
  // conversation resumed after the last restart is never read as stopped on
  // purpose. Names the last offer still holds carry over.
  const carried = capture?.names ?? [];
  const agents = capture?.agents ?? [];
  const cause = capture?.cause ?? 'backend-restart';
  if (run?.state === 'running') run.cancelled = true;
  run = null;
  const merged = [...new Set([...carried, ...names])];
  capture = merged.length > 0 || agents.length > 0
    ? { cause, lostAtMs: now, names: merged, agents, restored: false, settled: false, endedAtSeen: new Map(), rebaseline: new Set() }
    : null;
}

/**
 * Offer what a safe shutdown stopped (PAN-5342, D-9/D-10): every agent, the
 * conversations that were mid-turn (`wasWorking`), and the Flywheel
 * conversation idle or not (PAN-5671). `isOfferedAfterShutdown` is the rule.
 * The offer is settled at once; names an existing offer still holds carry over.
 */
export function seedShutdownOffer(sessions: readonly ShutdownStoppedSession[]): void {
  const names = sessions
    .filter((session) => session.kind === 'conversation' && isOfferedAfterShutdown(session))
    .map((session) => session.name ?? session.id.replace(/^conv-/, ''));
  const agents = new Map((capture?.agents ?? []).map((agent) => [agent.id, agent]));
  for (const session of sessions) {
    if (session.kind !== 'agent') continue;
    agents.set(session.id, { id: session.id, issueId: session.issueId ?? null, label: session.label });
  }
  const merged = [...new Set([...(capture?.names ?? []), ...names])];
  if (run?.state === 'running') run.cancelled = true;
  run = null;
  if (merged.length === 0 && agents.size === 0) {
    capture = null;
    return;
  }
  const endedAtSeen = new Map<string, string>();
  for (const name of merged) {
    const row = deps.getConversation(name);
    if (row?.status === 'ended' && row.endedAt) endedAtSeen.set(name, row.endedAt);
  }
  capture = {
    cause: 'shutdown',
    lostAtMs: deps.now(),
    names: merged,
    agents: [...agents.values()],
    restored: true,
    settled: true,
    endedAtSeen,
    rebaseline: new Set(),
  };
  console.log(`[backend-restart-recovery] shutdown stopped ${merged.length} conversation(s) and ${agents.size} agent(s); offering Resume all`);
}

/** The backend is back: settle which recorded conversations it left stopped. */
export function noteBackendRestored(): void {
  if (!capture) return;
  capture.restored = true;
  void settle().catch((error: unknown) => {
    console.warn(`[backend-restart-recovery] settle failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function settle(): Promise<void> {
  const current = capture;
  if (!current || !current.restored || current.settled) return;
  const live = await deps.liveSessions();
  // The backend did not answer: try again on the next read.
  if (!live || capture !== current || !current.restored) return;
  current.names = current.names.filter((name) => {
    const row = deps.getConversation(name);
    if (row === null || live.has(row.tmuxSession)) return false;
    if (row.status === 'ended' && row.endedAt) current.endedAtSeen.set(name, row.endedAt);
    return true;
  });
  current.settled = true;
  if (current.names.length === 0 && current.agents.length === 0) {
    capture = null;
    return;
  }
  console.log(`[backend-restart-recovery] ${current.names.length} conversation(s) stopped when the terminal backend restarted; offering Resume all`);
}

/** Why an agent drops out of the offer, or null; `unknown` when the inventory did not answer. */
function agentDropReason(agentId: string, live: ReadonlySet<string> | null): 'already running' | 'not found' | 'unknown' | null {
  if (!deps.hasAgentState(agentId)) return 'not found';
  if (live === null) return 'unknown';
  return live.has(agentId) ? 'already running' : null;
}

interface Offer {
  conversations: BackendRestartConversation[];
  agents: BackendRestartAgent[];
}

/** What Resume all would resume now, pruning the conversations and agents that dropped out. */
async function offered(): Promise<Offer> {
  await settle();
  const current = capture;
  if (!current?.settled) return { conversations: [], agents: [] };
  const live = await deps.liveSessions();
  if (!live || capture !== current) return { conversations: [], agents: [] };
  const conversations: BackendRestartConversation[] = [];
  current.names = current.names.filter((name) => {
    const row = deps.getConversation(name);
    if (!row || dropReason(row, live, current) !== null) return false;
    conversations.push({ name: row.name, title: row.title });
    return true;
  });
  const liveAgents = current.agents.length > 0 ? await deps.liveAgentIds() : null;
  if (capture !== current) return { conversations: [], agents: [] };
  // An unreadable inventory keeps every agent: only a live pane or a missing state drops one.
  const kept = current.agents.filter((agent) => {
    const drop = agentDropReason(agent.id, liveAgents);
    return drop === null || drop === 'unknown';
  });
  current.agents = kept;
  if (current.names.length === 0 && current.agents.length === 0 && run?.state !== 'running') capture = null;
  return { conversations, agents: [...kept] };
}

export async function getBackendRestartRecoverySnapshot(): Promise<BackendRestartRecoverySnapshot> {
  const { conversations, agents } = await offered();
  return {
    lostAt: (conversations.length > 0 || agents.length > 0) && capture ? new Date(capture.lostAtMs).toISOString() : null,
    cause: capture?.cause ?? 'backend-restart',
    conversations,
    agents,
    run: run
      ? {
        state: run.state,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        current: run.current,
        waitingForPressure: run.waitingForPressure,
        results: [...run.results],
      }
      : null,
  };
}

async function waitForPressure(active: MutableRun): Promise<void> {
  while (!active.cancelled) {
    let band: MemoryPressureBand | 'unknown';
    try {
      band = await deps.pressureBand();
    } catch (error) {
      // No verdict is not a yes: wait and ask again.
      console.warn(`[backend-restart-recovery] governor check failed, waiting: ${error instanceof Error ? error.message : String(error)}`);
      band = 'unknown';
    }
    if (band === 'ok') break;
    active.waitingForPressure = true;
    await deps.sleep(PRESSURE_WAIT_MS);
  }
  active.waitingForPressure = false;
}

async function resumeOne(name: string, current: Capture): Promise<BackendRestartResumeResult> {
  const row = deps.getConversation(name);
  const live = await deps.liveSessions();
  if (!live) return { name, outcome: 'failed', reason: 'the terminal backend did not answer' };
  const drop = dropReason(row, live, current);
  if (drop === 'already running') return { name, outcome: 'already-running' };
  if (drop) return { name, outcome: 'skipped', reason: drop };
  let failed = false;
  try {
    const response = await deps.resume(name, current.cause === 'shutdown' ? 'operator' : 'system');
    const body = response.body as { error?: unknown; reattached?: unknown } | null;
    if (response.status >= 400) {
      failed = true;
      return { name, outcome: 'failed', reason: typeof body?.error === 'string' ? body.error : `resume answered ${response.status}` };
    }
    return { name, outcome: body?.reattached === true ? 'already-running' : 'resumed' };
  } catch (error) {
    failed = true;
    return { name, outcome: 'failed', reason: error instanceof Error ? error.message : String(error) };
  } finally {
    // A failed resume may end the row again, now or after the lifecycle poll
    // saw its pane come up and die; that is not a stop on purpose.
    if (failed) {
      const after = deps.getConversation(name);
      if (after?.status === 'ended' && after.endedAt) current.endedAtSeen.set(name, after.endedAt);
      current.rebaseline.add(name);
    }
  }
}

async function resumeOneAgent(agentId: string): Promise<BackendRestartResumeResult> {
  const drop = agentDropReason(agentId, await deps.liveAgentIds());
  if (drop === 'already running') return { name: agentId, outcome: 'already-running' };
  if (drop === 'not found') return { name: agentId, outcome: 'skipped', reason: 'not found' };
  if (drop === 'unknown') return { name: agentId, outcome: 'failed', reason: 'the terminal backend did not answer' };
  try {
    const result = await deps.resumeAgent(agentId, undefined, { resumeCause: 'operator' });
    return result.success
      ? { name: agentId, outcome: 'resumed' }
      : { name: agentId, outcome: 'failed', reason: result.error ?? 'resume failed' };
  } catch (error) {
    return { name: agentId, outcome: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

async function runResumeAll(
  active: MutableRun,
  names: readonly string[],
  agentIds: readonly string[],
  current: Capture,
): Promise<void> {
  const steps: Array<{ id: string; resume: () => Promise<BackendRestartResumeResult> }> = [
    ...names.map((name) => ({ id: name, resume: () => resumeOne(name, current) })),
    ...agentIds.map((id) => ({ id, resume: () => resumeOneAgent(id) })),
  ];
  try {
    for (const step of steps) {
      await waitForPressure(active);
      if (active.cancelled) break;
      active.current = step.id;
      active.results.push(await step.resume());
      active.current = null;
    }
  } finally {
    active.current = null;
    active.waitingForPressure = false;
    active.state = 'done';
    active.finishedAt = new Date(deps.now()).toISOString();
    const resumed = active.results.filter((result) => result.outcome === 'resumed').length;
    console.log(`[backend-restart-recovery] Resume all ${active.cancelled ? 'cancelled' : 'finished'}: ${resumed} of ${steps.length} resumed`);
  }
}

export type ResumeAllStart =
  | { started: true; conversations: number; agents?: number }
  | { started: false; reason: 'running' | 'nothing-to-resume' };

/** Start Resume all in the background. Refuses while a run is in progress. */
export async function startBackendRestartResumeAll(): Promise<ResumeAllStart> {
  if (run?.state === 'running') return { started: false, reason: 'running' };
  // Reserve the run before the first await, so a second POST sees it running.
  const previous = run;
  const active: MutableRun = {
    state: 'running',
    startedAt: new Date(deps.now()).toISOString(),
    finishedAt: null,
    current: null,
    waitingForPressure: false,
    cancelled: false,
    results: [],
  };
  run = active;
  const offer = await offered();
  const current = capture;
  if (run !== active || active.cancelled) return { started: false, reason: 'nothing-to-resume' };
  if ((offer.conversations.length === 0 && offer.agents.length === 0) || !current) {
    run = previous;
    return { started: false, reason: 'nothing-to-resume' };
  }
  void runResumeAll(
    active,
    offer.conversations.map((row) => row.name),
    offer.agents.map((agent) => agent.id),
    current,
  ).catch(() => undefined);
  return offer.agents.length > 0
    ? { started: true, conversations: offer.conversations.length, agents: offer.agents.length }
    : { started: true, conversations: offer.conversations.length };
}

/** Drop the offer. A running Resume all stops before its next resume; the one in flight finishes. */
export function dismissBackendRestartRecovery(): void {
  if (run?.state === 'running') run.cancelled = true;
  capture = null;
  run = null;
}

/** Subscribe to the backend's connection edges. Primary dashboard only. */
export function startBackendRestartRecovery(overrides: Partial<BackendRestartRecoveryDeps> = {}): void {
  deps = { ...defaultDeps, ...overrides };
  onBackendConnectionChange({ lost: noteBackendLost, restored: noteBackendRestored });
}

/** Test seam: forget all state and restore the default deps. */
export function _resetBackendRestartRecoveryForTests(): void {
  if (run?.state === 'running') run.cancelled = true;
  deps = defaultDeps;
  capture = null;
  run = null;
}
