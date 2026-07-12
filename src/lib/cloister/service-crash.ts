/** Cloister crash recovery and poke escalation seam. */
import { createHash } from 'crypto';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DomainEvent } from '@overdeck/contracts';
import { isContextOverflowTail, CONTEXT_OVERFLOW_TAIL_LINES } from '../context-overflow.js';
import { getAgentRuntimeStateSync, getAgentStateSync } from '../agents.js';
import { setCloisterSpawnsPausedSync } from '../overdeck/control-settings.js';
import { getRuntimeForAgent } from '../runtimes/index.js';
import { exactPaneTarget } from '../tmux.js';
import { isRoleTerminal, type AdvancingRole } from './reap-terminal-sessions.js';
import type { AgentHealth } from './health.js';
import type { CloisterConfig } from './config.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Agent crash tracker for auto-restart
 */
interface AgentCrashTracker {
  agentId: string;
  crashCount: number;
  lastCrash: Date;
  nextRetryAt?: Date;
  gaveUp: boolean;
}

/**
 * One-shot convoy roles (PAN-1742). The review lenses + synthesis and the test
 * role are spawned fresh via `spawnRun` each cycle; they run once, write their
 * artifact, and exit. They never save a sessionId, so they cannot be resumed.
 */
const ONE_SHOT_ROLES: ReadonlySet<string> = new Set(['review', 'test']);

export type CrashEvent =
  | { type: 'poked_agent'; agentId: string }
  | { type: 'killed_agent'; agentId: string }
  | { type: 'agent_crashed'; agentId: string; crashCount: number }
  | { type: 'agent_stuck'; agentId: string; health: AgentHealth }
  | { type: 'agent_restarting'; agentId: string; crashCount: number; backoffSeconds: number }
  | { type: 'agent_gave_up'; agentId: string; maxRetries: number }
  | { type: 'mass_death_detected'; deathCount: number; windowSeconds: number }
  | { type: 'spawn_paused'; reason: string };

export interface CrashHost {
  config: CloisterConfig;
  crashTrackers: Map<string, AgentCrashTracker>;
  deathTimestamps: Date[];
  spawnsPaused: boolean;
  pokeProgress: Map<string, { fingerprint: string; ineffective: number }>;
  eventStore: { append(event: Omit<DomainEvent, 'sequence'>): number } | null;
  progressFingerprint(agentId: string): Promise<string>;
  pokeAgentWithEscalation(agentId: string): Promise<void>;
  checkForMassDeaths(): void;
  pauseSpawns(reason: string): void;
  emit(event: CrashEvent): void;
}

/**
 * Decide whether a vanished tmux session should be treated as a crash worth
 * auto-restarting (PAN-1742). Returns a human-readable reason to SKIP the
 * crash/restart machinery, or `null` when the agent is a genuine restart
 * candidate.
 *
 * Two cases are not crashes:
 *  - one-shot convoy roles, whose session-end is a normal completion; and
 *  - any agent without a saved session, which `restartAgent` cannot resume
 *    (it throws "No session ID found"), so counting a crash and scheduling a
 *    restart is pure noise.
 *
 * Pure and exported so the rule is unit-tested independent of the service's
 * private health-check plumbing.
 */
export function nonRestartableReason(role: string, sessionId: string | undefined): string | null {
  if (ONE_SHOT_ROLES.has(role)) {
    return `(${role}) finished its one-shot run — completion, not a crash`;
  }
  if (!sessionId) {
    return 'ended with no resumable session — not auto-restartable';
  }
  return null;
}

/**
 * Poke an agent (send "are you stuck?" message).
 *
 * NOTE: runtime.sendMessage() is async — both ClaudeCodeRuntime and PiRuntime
 * are declared `async sendMessage(): Promise<void>`. A `throw` inside an
 * async function before any await still returns a rejected Promise, so the
 * surrounding try/catch CANNOT catch it. Without explicit `.catch()`, the
 * rejection becomes an UnhandledPromiseRejection and crashes the dashboard
 * server. We hit this in production when the deacon health-check polled a
 * dead agent (PAN-1189 wedge sweep #12-13).
 */
export function pokeAgent(host: CrashHost, agentId: string): void {
  // Fire-and-forget wrapper; the async body measures progress first.
  void host.pokeAgentWithEscalation(agentId).catch((error) => {
    console.error(`Failed to poke ${agentId}:`, error);
  });
}

/** PAN-2452: fingerprint of observable progress — workspace HEAD + pane tail.
 * Unchanged fingerprint across pokes = the poke did nothing. */
export async function progressFingerprint(_host: CrashHost, agentId: string): Promise<string> {
  const state = getAgentStateSync(agentId);
  let head = '';
  if (state?.workspace) {
    try {
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd: state.workspace, encoding: 'utf-8' });
      head = stdout.trim();
    } catch { /* workspace may be gone; pane still fingerprints */ }
  }
  let pane = '';
  try {
    const { stdout } = await execFileAsync(
      'tmux',
      ['-L', 'overdeck', 'capture-pane', '-t', exactPaneTarget(agentId), '-p', '-S', `-${CONTEXT_OVERFLOW_TAIL_LINES}`],
      { encoding: 'utf-8' },
    );
    pane = stdout;
  } catch { /* session may be gone */ }
  const paneHash = createHash('sha1').update(pane).digest('hex').slice(0, 12);
  return `${head}:${paneHash}`;
}

export async function pokeAgentWithEscalation(host: CrashHost, agentId: string): Promise<void> {
  const runtime = getRuntimeForAgent(agentId);
  if (!runtime) {
    throw new Error(`No runtime found for agent ${agentId}`);
  }

  const fingerprint = await host.progressFingerprint(agentId);
  const prior = host.pokeProgress.get(agentId);
  const ineffective = prior && prior.fingerprint === fingerprint ? prior.ineffective + 1 : 0;
  host.pokeProgress.set(agentId, { fingerprint, ineffective });

  // Tier 3 (5th no-progress poke): stop poking — surface to the operator.
  if (ineffective >= 4) {
    const { setAgentPausedSync } = await import('../agents/agent-state.js');
    try {
      setAgentPausedSync(agentId, `needs-you: idle-alive — no observable progress across ${ineffective + 1} pokes (idle-alive escalation)`);
      host.emit({ type: 'agent_stuck', agentId, health: undefined as never });
      console.log(`🛑 ${agentId} paused: idle-alive across ${ineffective + 1} pokes`);
    } catch (pauseErr) {
      console.error(`Failed to pause idle-alive ${agentId}:`, pauseErr);
    }
    return;
  }

  // Tier 2 (3rd no-progress poke): escalate — /compact on overflow, else a
  // substantive reconstruct instruction instead of another "are you stuck?".
  let pokeMessage =
    'Hey, I noticed you haven\'t made progress in a while. Are you stuck? ' +
    'If you need help or clarification, please ask. Otherwise, please continue with your work.';
  if (ineffective >= 2) {
    let tail = '';
    try {
      const { stdout } = await execFileAsync(
        'tmux',
        ['-L', 'overdeck', 'capture-pane', '-t', exactPaneTarget(agentId), '-p', '-S', `-${CONTEXT_OVERFLOW_TAIL_LINES}`],
        { encoding: 'utf-8' },
      );
      tail = stdout;
    } catch { /* fall through to reconstruct nudge */ }
    if (isContextOverflowTail(tail)) {
      pokeMessage = '/compact';
      console.log(`🔔 ${agentId}: overflow tail detected — delivering /compact instead of a poke`);
    } else {
      pokeMessage =
        'You appear active but have made no observable progress (no new commits, unchanged output) across multiple checks. '
        + 'Do exactly one of: (1) work is done — commit, push, and run pan done; '
        + '(2) blocked — state the blocker in one sentence and commit what you have as WIP; '
        + '(3) lost context — re-read your bead (bd show), your latest .pan/feedback/ file, and git status, then resume. Act now.';
    }
  }

  await Promise.resolve(runtime.sendMessage(agentId, pokeMessage)).catch((sendErr) => {
    console.error(`Failed to send poke to ${agentId}:`, sendErr);
  });
  host.emit({ type: 'poked_agent', agentId });
  console.log(`🔔 Poked ${agentId}${ineffective > 0 ? ` (ineffective streak: ${ineffective})` : ''}`);
}

/**
 * Kill an agent
 *
 * runtime.killAgent() is also async in some runtime implementations — apply
 * the same fire-and-forget guard as pokeAgent so async rejection cannot
 * crash the dashboard from a deacon health-check timer callback.
 */
export function killAgent(host: CrashHost, agentId: string): void {
  try {
    const runtime = getRuntimeForAgent(agentId);
    if (!runtime) {
      throw new Error(`No runtime found for agent ${agentId}`);
    }

    Promise.resolve(runtime.killAgent(agentId)).catch((killErr) => {
      console.error(`Failed to kill ${agentId}:`, killErr);
    });
    host.emit({ type: 'killed_agent', agentId });

    console.log(`🔔 Killed ${agentId}`);
  } catch (error) {
    console.error(`Failed to kill ${agentId}:`, error);
  }
}

/**
 * Handle agent crash with auto-restart logic
 */
export async function handleAgentCrash(host: CrashHost, agentId: string): Promise<void> {
  const config = host.config.auto_restart;
  if (!config?.enabled) return;

  // Check if agent was intentionally stopped or suspended (not a crash).
  // Both state.json and runtime.json must be checked — stopAgent writes both,
  // but a race between the CLI kill and this health check poll could see one
  // but not the other if only one file is consulted.
  const agentState = getAgentStateSync(agentId);
  if (!agentState || agentState.status === 'stopped') {
    console.log(`🔔 Agent ${agentId} was intentionally stopped, skipping restart`);
    return;
  }
  const runtimeState = getAgentRuntimeStateSync(agentId);
  if (runtimeState?.state === 'suspended') {
    console.log(`🔔 Agent ${agentId} is suspended, skipping restart`);
    return;
  }
  if (runtimeState?.state === 'stopped') {
    console.log(`🔔 Agent ${agentId} runtime is stopped, skipping restart`);
    return;
  }

  // PAN-1742: a vanished session is not always a crash. One-shot convoy roles
  // complete-and-exit, and any agent with no saved session is structurally
  // un-restartable. Either way, counting it as a crash pollutes the
  // crash/troubled counters and schedules a doomed restart.
  const skipReason = nonRestartableReason(agentState.role, agentState.sessionId);
  if (skipReason) {
    // PAN-2007: a one-shot review/test session that vanished BEFORE recording a
    // terminal verdict died prematurely — e.g. before it could run
    // `pan specialists done`. Masking that as a normal "one-shot completion" and
    // skipping restart strands the issue at reviewStatus=reviewing forever (the
    // exact PAN-1832 symptom). Recover it instead: resume so it can finish and
    // signal. Only a terminal verdict (or a missing session) is a genuine
    // non-restartable completion.
    let recoverUnfinishedOneShot = false;
    if (ONE_SHOT_ROLES.has(agentState.role) && agentState.sessionId && agentState.issueId) {
      try {
        const { getReviewStatusSync } = await import('../review-status.js');
        const status = getReviewStatusSync(agentState.issueId);
        const verdictTerminal = status
          ? isRoleTerminal(agentState.role as AdvancingRole, {
              reviewStatus: status.reviewStatus,
              testStatus: status.testStatus,
              readyForMerge: status.readyForMerge,
              mergeStatus: status.mergeStatus,
            })
          : false;
        recoverUnfinishedOneShot = !verdictTerminal;
      } catch {
        recoverUnfinishedOneShot = false;
      }
    }
    if (!recoverUnfinishedOneShot) {
      console.log(`🔔 Agent ${agentId} ${skipReason}; skipping restart`);
      return;
    }
    console.log(`🔔 Agent ${agentId} (${agentState.role}) vanished before a terminal verdict — recovering instead of treating as a one-shot completion (PAN-2007)`);
    // fall through to the restart/resume path below
  }

  // Record death timestamp for mass death detection
  const now = new Date();
  host.deathTimestamps.push(now);
  host.checkForMassDeaths();

  // Get or create crash tracker
  let tracker = host.crashTrackers.get(agentId);
  if (!tracker) {
    tracker = {
      agentId,
      crashCount: 0,
      lastCrash: now,
      gaveUp: false,
    };
    host.crashTrackers.set(agentId, tracker);
  }

  // Skip if we've already given up on this agent
  if (tracker.gaveUp) return;

  // Increment crash count
  tracker.crashCount++;
  tracker.lastCrash = now;

  host.emit({ type: 'agent_crashed', agentId, crashCount: tracker.crashCount });
  console.log(`🔔 Agent ${agentId} crashed (crash #${tracker.crashCount})`);

  // PAN-1908: emit agent.heartbeat_dead so the event-driven deacon recovery
  // can mark the agent stopped and resume it with the proper gates, rather
  // than Cloister scheduling its own auto-restart in parallel.
  if (host.eventStore) {
    try {
      host.eventStore.append({
        type: 'agent.heartbeat_dead',
        timestamp: new Date().toISOString(),
        payload: { agentId, issueId: agentState.issueId, sessionId: agentState.sessionId },
      });
    } catch (err) {
      console.error(`[cloister] Failed to emit heartbeat_dead for ${agentId}:`, err);
    }
  }

  // Check if we've exceeded max retries
  if (tracker.crashCount > config.max_retries) {
    tracker.gaveUp = true;
    host.emit({ type: 'agent_gave_up', agentId, maxRetries: config.max_retries });
    console.error(`🔔 Gave up on restarting ${agentId} after ${config.max_retries} attempts`);
    return;
  }

  // Calculate backoff delay for logging/mass-death tracking only — the actual
  // resume is handled by the deacon's agent.heartbeat_dead handler.
  const backoffIndex = Math.min(tracker.crashCount - 1, config.backoff_seconds.length - 1);
  const backoffSeconds = config.backoff_seconds[backoffIndex];
  const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000);
  tracker.nextRetryAt = nextRetryAt;

  host.emit({
    type: 'agent_restarting',
    agentId,
    crashCount: tracker.crashCount,
    backoffSeconds,
  });

  console.log(
    `🔔 Deacon will recover ${agentId} via heartbeat_dead (attempt ${tracker.crashCount}/${config.max_retries}, backoff ${backoffSeconds}s)`
  );
}

/**
 * Restart an agent using its saved session
 */
export async function restartAgent(_host: CrashHost, agentId: string): Promise<void> {
  const runtime = getRuntimeForAgent(agentId);
  if (!runtime) {
    throw new Error(`No runtime found for agent ${agentId}`);
  }

  // Get agent state to find session ID and workspace
  const agentState = getAgentStateSync(agentId);
  if (!agentState?.sessionId) {
    throw new Error(`No session ID found for agent ${agentId}`);
  }

  if (!agentState.workspace) {
    throw new Error(`No workspace found for agent ${agentId}`);
  }

  // Restart with --resume using spawnAgent with sessionId
  console.log(`🔔 Restarting ${agentId} with session ${agentState.sessionId.substring(0, 8)}...`);
  runtime.spawnAgent({
    agentId,
    workspace: agentState.workspace,
    sessionId: agentState.sessionId,
    runtime: runtime.name,
  });
  console.log(`🔔 Successfully restarted ${agentId}`);
}

/**
 * Check for mass death events
 *
 * Detects when 3+ agents die within 30 seconds and pauses spawns.
 */
export function checkForMassDeaths(host: CrashHost): void {
  const MASS_DEATH_THRESHOLD = 3;
  const WINDOW_SECONDS = 30;

  const now = Date.now();
  const windowStart = now - WINDOW_SECONDS * 1000;

  // Clean up old timestamps outside the window
  host.deathTimestamps = host.deathTimestamps.filter(
    (timestamp) => timestamp.getTime() >= windowStart
  );

  // Check if we have mass deaths
  if (host.deathTimestamps.length >= MASS_DEATH_THRESHOLD) {
    // Trigger mass death alert
    host.emit({
      type: 'mass_death_detected',
      deathCount: host.deathTimestamps.length,
      windowSeconds: WINDOW_SECONDS,
    });

    // Pause spawns
    if (!host.spawnsPaused) {
      host.pauseSpawns('Mass death detected - system stability concern');
      console.error(
        `🔔 MASS DEATH DETECTED: ${host.deathTimestamps.length} agents died in ${WINDOW_SECONDS}s - spawns paused`
      );
    }
  }
}

/**
 * Pause new agent spawns
 */
export function pauseSpawns(host: CrashHost, reason: string): void {
  host.spawnsPaused = true;
  setCloisterSpawnsPausedSync(true);
  host.emit({ type: 'spawn_paused', reason });
  console.log(`🔔 Agent spawns paused: ${reason}`);
}
