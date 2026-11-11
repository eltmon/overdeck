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
 *    sessions) whose row is `active`, or ended within the last minute (the
 *    supervisor's exit event can end a row just before the stream drops). The
 *    lifecycle poll ends nothing while the backend is unreadable, so the rows
 *    still say which conversations were live.
 * 2. **Restored.** When the stream is back on a fresh snapshot, keep only the
 *    recorded conversations whose harness the backend does not run now. A
 *    stream blip leaves every conversation live, so it offers nothing.
 * 3. **Offer.** Each read drops conversations that are live again, archived,
 *    or stopped on purpose since the loss (`conversation-stop-marks.ts`), and
 *    hides those paused (`pan pause`), held (a `--hold` handoff kickoff), or
 *    owned by another machine. The list only shrinks: a conversation that dies
 *    days later is never offered as a restart casualty.
 * 4. **Resume all.** One conversation at a time through
 *    `handleConversationResume` (resume cause `system`, so the resume contract
 *    says the process ended unexpectedly). Before each one it waits while the
 *    memory governor (`assessMemoryPressure`, MemAvailable plus PSI) is not
 *    admitting, and it re-checks the skip rules.
 *
 * State is in memory only. It runs in the primary dashboard (main.ts); a
 * dashboard restart forgets the offer. tmux hosts never fire the edges, because
 * the tmux adapter has no event stream.
 */
import type {
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
import { onBackendConnectionChange } from './backend-inventory.js';

/** A row that ended this long before the loss still counts as live at the loss. */
export const RESTART_EXIT_WINDOW_MS = 60_000;
/** How long Resume all waits before it asks the memory governor again. */
export const MEMORY_WAIT_MS = 15_000;

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
  memoryBand: () => Promise<MemoryPressureBand>;
  resume: (name: string) => Promise<{ status: number; body: unknown }>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultDeps: BackendRestartRecoveryDeps = {
  listConversations: () => listConversations(),
  getConversation: (name) => getConversationByName(name),
  liveSessions: () => listLiveConversationSessions(),
  isPaused: (tmuxSession) => getAgentState(tmuxSession)?.paused === true,
  isHeld: (name) => readHeldKickoff(name) !== null,
  stoppedSince: conversationStoppedSince,
  memoryBand: async () => (await assessMemoryPressure()).band,
  resume: async (name) => decodeDoorResponse(
    await handleConversationResume(name, {}, { resolveSessionFile, resumeCause: 'system' }),
  ),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
};

interface Capture {
  lostAtMs: number;
  names: string[];
  /** The backend is back; false while it is down. */
  restored: boolean;
  /** `names` holds only conversations the restart left stopped. */
  settled: boolean;
}

interface MutableRun {
  state: 'running' | 'done';
  startedAt: string;
  finishedAt: string | null;
  current: string | null;
  waitingForMemory: boolean;
  results: BackendRestartResumeResult[];
}

let deps: BackendRestartRecoveryDeps = defaultDeps;
let capture: Capture | null = null;
let run: MutableRun | null = null;

function isOperatorConversation(row: RecoveryConversationRow): boolean {
  return row.tmuxSession.startsWith('conv-');
}

/** Why a conversation drops out of the offer for good, or null. */
function dropReason(row: RecoveryConversationRow | null, live: ReadonlySet<string>, lostAtMs: number): string | null {
  if (!row) return 'not found';
  if (row.archivedAt) return 'archived';
  if (live.has(row.tmuxSession)) return 'already running';
  if (deps.stoppedSince(row.name, lostAtMs - RESTART_EXIT_WINDOW_MS)) return 'stopped on purpose';
  return null;
}

/** Why a conversation is left out of the offer for now, or null. */
function holdReason(row: RecoveryConversationRow): string | null {
  if (deps.isPaused(row.tmuxSession)) return 'paused';
  if (deps.isHeld(row.name)) return 'held';
  if (row.origin === 'vault' || row.releasedTo) return 'owned by another machine';
  return null;
}

/** Record the conversations live at the moment the backend went down. */
export function noteBackendLost(): void {
  const now = deps.now();
  const cutoff = now - RESTART_EXIT_WINDOW_MS;
  const names = deps.listConversations()
    .filter((row) => isOperatorConversation(row) && !row.archivedAt)
    .filter((row) => row.status === 'active' || (row.endedAt !== null && Date.parse(row.endedAt) >= cutoff))
    .map((row) => row.name);
  if (capture) {
    // A second loss before the operator acted: one offer for both.
    capture.names = [...new Set([...capture.names, ...names])];
    capture.restored = false;
    capture.settled = false;
    return;
  }
  if (names.length === 0) return;
  capture = { lostAtMs: now, names, restored: false, settled: false };
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
    return row !== null && !live.has(row.tmuxSession);
  });
  current.settled = true;
  if (current.names.length === 0) {
    capture = null;
    return;
  }
  console.log(`[backend-restart-recovery] ${current.names.length} conversation(s) stopped when the terminal backend restarted; offering Resume all`);
}

/** The conversations Resume all would resume now, pruning the ones that dropped out. */
async function offeredConversations(): Promise<BackendRestartConversation[]> {
  await settle();
  const current = capture;
  if (!current?.settled) return [];
  const live = await deps.liveSessions();
  if (!live || capture !== current) return [];
  const offered: BackendRestartConversation[] = [];
  current.names = current.names.filter((name) => {
    const row = deps.getConversation(name);
    if (dropReason(row, live, current.lostAtMs) !== null) return false;
    if (row && holdReason(row) === null) offered.push({ name: row.name, title: row.title });
    return true;
  });
  if (current.names.length === 0 && run?.state !== 'running') capture = null;
  return offered;
}

export async function getBackendRestartRecoverySnapshot(): Promise<BackendRestartRecoverySnapshot> {
  const conversations = await offeredConversations();
  return {
    lostAt: conversations.length > 0 && capture ? new Date(capture.lostAtMs).toISOString() : null,
    conversations,
    run: run ? { ...run, results: [...run.results] } : null,
  };
}

async function waitForMemory(active: MutableRun): Promise<void> {
  for (;;) {
    let band: MemoryPressureBand;
    try {
      band = await deps.memoryBand();
    } catch (error) {
      console.warn(`[backend-restart-recovery] memory check failed, resuming anyway: ${error instanceof Error ? error.message : String(error)}`);
      band = 'ok';
    }
    if (band === 'ok') break;
    active.waitingForMemory = true;
    await deps.sleep(MEMORY_WAIT_MS);
  }
  active.waitingForMemory = false;
}

async function resumeOne(name: string, lostAtMs: number): Promise<BackendRestartResumeResult> {
  const row = deps.getConversation(name);
  const live = await deps.liveSessions();
  if (!live) return { name, outcome: 'failed', reason: 'the terminal backend did not answer' };
  const drop = dropReason(row, live, lostAtMs);
  if (drop === 'already running') return { name, outcome: 'already-running' };
  if (drop) return { name, outcome: 'skipped', reason: drop };
  const hold = row ? holdReason(row) : null;
  if (hold) return { name, outcome: 'skipped', reason: hold };
  try {
    const response = await deps.resume(name);
    const body = response.body as { error?: unknown; reattached?: unknown } | null;
    if (response.status >= 400) {
      return { name, outcome: 'failed', reason: typeof body?.error === 'string' ? body.error : `resume answered ${response.status}` };
    }
    return { name, outcome: body?.reattached === true ? 'already-running' : 'resumed' };
  } catch (error) {
    return { name, outcome: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

async function runResumeAll(active: MutableRun, names: readonly string[], lostAtMs: number): Promise<void> {
  try {
    for (const name of names) {
      await waitForMemory(active);
      active.current = name;
      active.results.push(await resumeOne(name, lostAtMs));
      active.current = null;
    }
  } finally {
    active.current = null;
    active.waitingForMemory = false;
    active.state = 'done';
    active.finishedAt = new Date(deps.now()).toISOString();
    const resumed = active.results.filter((result) => result.outcome === 'resumed').length;
    console.log(`[backend-restart-recovery] Resume all finished: ${resumed} of ${names.length} resumed`);
  }
}

export type ResumeAllStart =
  | { started: true; conversations: number }
  | { started: false; reason: 'running' | 'nothing-to-resume' };

/** Start Resume all in the background. Refuses while a run is in progress. */
export async function startBackendRestartResumeAll(): Promise<ResumeAllStart> {
  if (run?.state === 'running') return { started: false, reason: 'running' };
  const offered = await offeredConversations();
  const current = capture;
  if (offered.length === 0 || !current) return { started: false, reason: 'nothing-to-resume' };
  const active: MutableRun = {
    state: 'running',
    startedAt: new Date(deps.now()).toISOString(),
    finishedAt: null,
    current: null,
    waitingForMemory: false,
    results: [],
  };
  run = active;
  void runResumeAll(active, offered.map((row) => row.name), current.lostAtMs).catch(() => undefined);
  return { started: true, conversations: offered.length };
}

/** Drop the offer. Refuses while Resume all runs. */
export function dismissBackendRestartRecovery(): boolean {
  if (run?.state === 'running') return false;
  capture = null;
  run = null;
  return true;
}

/** Subscribe to the backend's connection edges. Primary dashboard only. */
export function startBackendRestartRecovery(overrides: Partial<BackendRestartRecoveryDeps> = {}): void {
  deps = { ...defaultDeps, ...overrides };
  onBackendConnectionChange({ lost: noteBackendLost, restored: noteBackendRestored });
}

/** Test seam: forget all state and restore the default deps. */
export function _resetBackendRestartRecoveryForTests(): void {
  deps = defaultDeps;
  capture = null;
  run = null;
}
