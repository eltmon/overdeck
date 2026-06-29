import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { cpus, loadavg } from 'os';
import { Effect } from 'effect';
import { isStartingWithinGrace } from './agent-grace.js';
import { isAgentIdleForNudge } from './agent-idle.js';
import { getConcurrencyLimits, countRunningAgents, workResumeSlotsAvailable } from './concurrency.js';
import { getNoResumeMode } from './no-resume-mode.js';
import { isIssueClosed } from './issue-closed.js';
import { listAllAgentsSync as listAllAgents } from '../overdeck/agents.js';
import { emitActivityEntrySync, emitActivityTtsSync } from '../activity-logger.js';
import { logDeaconEventSync, logAgentLifecycleSync } from '../persistent-logger.js';
import { getReviewStatusSync } from '../review-status.js';
import { captureTranscriptUserRecordSnapshot } from '../transcript-landing.js';
import {
  buildDefaultResumeContinueMessage,
  getAgentDir,
  getAgentRuntimeStateSync,
  getAgentState,
  getAgentStateSync,
  listAgentStates,
  markAgentRunningState,
  recordAgentFailure,
  resetAgentFailureCount,
  resumeAgent,
  saveAgentState,
  saveAgentStateSync,
  type AgentState,
} from '../agents.js';
import {
  killSession,
  listPaneValues,
  listSessionNames,
  sessionExists,
  sessionExistsSync,
} from '../tmux.js';

const execAsync = promisify(exec);

export interface AutoResumeNotifierDeps {
  notifyAgentStopped: (agentId: string) => void;
  notifyAgentStatusChanged: (state: AgentState, previousStatus?: AgentState['status'], hasLiveTmuxSession?: boolean) => void;
}

const orphanFailureRecordedForAutoResume = new Set<string>();

function isVerifyPausedAgentState(state: Pick<AgentState, 'issueId' | 'paused'>): boolean {
  if (state.paused !== true || !state.issueId) return false;
  return getReviewStatusSync(state.issueId)?.mergeStatus === 'merged';
}

function reviewArtifactExistsForRun(path: string | undefined, startedAt: string | undefined): boolean {
  if (!path || !existsSync(path)) return false;
  const startedMs = Date.parse(startedAt ?? '');
  if (!Number.isFinite(startedMs)) return true;
  try {
    return statSync(path).mtimeMs >= startedMs;
  } catch {
    return false;
  }
}

function hasCompletedReviewArtifact(state: AgentState): boolean {
  if (state.role !== 'review') return false;
  if (state.reviewSubRole) {
    return reviewArtifactExistsForRun(state.reviewOutputPath, state.startedAt);
  }
  if (!state.workspace || !state.reviewRunId) return false;
  return reviewArtifactExistsForRun(join(state.workspace, '.pan', 'review', state.reviewRunId, 'synthesis.md'), state.startedAt);
}

let recoverOrphanedAgentsInFlight: Promise<string[]> | null = null;
const RAPID_POST_RESUME_DEATH_MS = 120_000;

export function isRapidPostResumeDeath(state: AgentState): boolean {
  const lastResumeMs = Date.parse(state.lastResumeAt ?? '');
  return Number.isFinite(lastResumeMs) && Date.now() - lastResumeMs <= RAPID_POST_RESUME_DEATH_MS;
}

/**
 * PAN-1718: a work agent that reached a tmux session but lost it before ever
 * delivering its kickoff never started doing real work — this is a launch
 * crash, not a healthy run that later died. Work agents set
 * kickoffDelivered=false at spawn and =true once the kickoff lands.
 *
 * Why this exists alongside isRapidPostResumeDeath: that guard keys off
 * lastResumeAt, so it only catches rapid death after a *resume*. A
 * fundamentally-broken work agent (crashing harness, dead model) is
 * re-dispatched by the orphan-proposed reconciler as a *fresh start* each
 * time, which has no lastResumeAt — and its startedAt→orphan span can exceed
 * the rapid window purely because the spawn itself is slow (e.g. ~2 min to
 * reach `running`). Without this, the orphan path resets the failure counter
 * every cycle, so consecutiveFailures oscillates 1→0→1 and never reaches
 * maxConsecutiveFailures — the troubled gate never trips and the agent
 * crash-loops forever. Treating a pre-kickoff orphan as an accumulating
 * failure lets it trip `troubled` after maxConsecutiveFailures, which the
 * reconciler then honors (it skips troubled agents) and the loop stops.
 */
export function isPreKickoffLaunchDeath(state: AgentState): boolean {
  return state.role === 'work' && state.kickoffDelivered === false;
}

/**
 * PAN-1908: event-driven orphan recovery. A single agent has been declared
 * heartbeat-dead (tmux session gone). Mark it stopped, record a failure for
 * auto-resume tracking, and notify subscribers. Does NOT enumerate directories —
 * it operates on the agent ID passed by the event/reconcile caller.
 */
export async function handleAgentHeartbeatDeadEvent(
  agentId: string,
  context: string | undefined,
  deps: AutoResumeNotifierDeps,
): Promise<string[]> {
  const noResumeMode = getNoResumeMode();
  if (noResumeMode.active) {
    logDeaconEventSync(`handleAgentHeartbeatDeadEvent: ${agentId} skipped — OVERDECK_NO_RESUME=1`);
    return [];
  }

  const state = getAgentStateSync(agentId);
  if (!state) {
    logDeaconEventSync(`handleAgentHeartbeatDeadEvent: ${agentId} skipped — no state`);
    return [];
  }
  if (state.status !== 'running' && state.status !== 'starting') {
    logDeaconEventSync(`handleAgentHeartbeatDeadEvent: ${agentId} skipped — status=${state.status} (not running/starting)`);
    return [];
  }
  if (isVerifyPausedAgentState(state)) {
    logDeaconEventSync(`handleAgentHeartbeatDeadEvent: ${agentId} skipped — verify-paused (mergeStatus=merged, tmux session intentionally absent)`);
    return [];
  }

  // PAN-1557: convoy reviewers are interactive — they own a tmux session
  // (remain-on-exit on) like other specialists, so liveness is the session's
  // pane, not a launcher pid. While the pane is alive the reviewer is working
  // or idling attachably; a dead pane (Claude exited) or a missing session
  // past the startup grace means it's done — fall through to mark stopped.
  if (state.reviewSubRole) {
    if (sessionExistsSync(agentId)) {
      try {
        const dead = ((await Effect.runPromise(listPaneValues(agentId, '#{pane_dead}')))[0]?.trim() ?? '') === '1';
        if (!dead) return []; // pane alive — still working / idling attachably
        try { await Effect.runPromise(killSession(agentId)); } catch { /* ignore */ }
        logDeaconEventSync(`handleAgentHeartbeatDeadEvent: killed dead reviewer pane ${agentId}`);
      } catch {
        return []; // can't check — assume alive
      }
    } else {
      // No session yet — startup grace keyed off startedAt before orphaning.
      const startedMs = Date.parse(state.startedAt ?? '');
      const REVIEWER_STARTUP_GRACE_MS = 90_000;
      if (Number.isFinite(startedMs) && Date.now() - startedMs < REVIEWER_STARTUP_GRACE_MS) {
        return [];
      }
    }
    // Session gone (or dead pane past grace) — fall through to mark stopped.
  } else if (sessionExistsSync(agentId)) {
    // Planning sessions use remain-on-exit, so the tmux session persists after
    // Claude exits. Check if the pane's process is actually dead.
    if (agentId.startsWith('planning-')) {
      try {
        const result = (await Effect.runPromise(listPaneValues(agentId, '#{pane_dead}')))[0]?.trim() ?? '';
        if (result !== '1') return []; // pane is alive — truly still running
        // Pane is dead — kill the zombie tmux session and fall through to recovery
        try { await Effect.runPromise(killSession(agentId)); } catch { /* ignore */ }
        logDeaconEventSync(`handleAgentHeartbeatDeadEvent: killed dead planning pane ${agentId}`);
      } catch {
        return []; // can't check — assume alive
      }
    } else {
      return []; // truly still running
    }
  } else if (state.status === 'starting') {
    // PAN-1256: work agents in `starting` status need a startup grace
    // window before being declared orphaned.
    if (isStartingWithinGrace(state)) {
      return [];
    }
    // Past the grace window with no tmux session — true orphan, fall through.
  }

  // Orphaned — crashed agent with no tmux session
  const oldStatus = state.status;
  state.status = 'stopped';
  state.stoppedAt = new Date().toISOString();
  await Effect.runPromise(saveAgentState(state));
  // PAN-1530: only record failure markers for agents the auto-resume gate
  // will actually retry. Planning agents are one-shot by design.
  const isResumableRole = !agentId.startsWith('planning-');
  const completedReviewArtifact = hasCompletedReviewArtifact(state);
  if (state.stoppedByUser !== true && isResumableRole && !completedReviewArtifact) {
    const rapidPostResumeDeath = isRapidPostResumeDeath(state);
    const preKickoffLaunchDeath = isPreKickoffLaunchDeath(state);
    // PAN-1718: preserve (accumulate) the failure counter for deaths that prove
    // the agent never came up healthy — a rapid post-resume death, or a death
    // before the kickoff was ever delivered. Resetting on these lets a
    // fundamentally-broken agent that the reconciler re-dispatches as a fresh
    // start zero its counter every cycle and crash-loop forever without ever
    // tripping the troubled gate.
    const accumulatingDeath = rapidPostResumeDeath || preKickoffLaunchDeath;
    if (!accumulatingDeath) {
      resetAgentFailureCount(agentId);
    }
    const failureReason = rapidPostResumeDeath
      ? `rapid post-resume death: tmux session missing within ${RAPID_POST_RESUME_DEATH_MS / 1000}s (${context ?? 'event'})`
      : preKickoffLaunchDeath
        ? `launch crash: tmux session lost before kickoff delivery (${context ?? 'event'})`
        : `orphaned: tmux session missing (${context ?? 'event'})`;
    const failedState = await Effect.runPromise(recordAgentFailure(agentId, failureReason));
    if (failedState) {
      deps.notifyAgentStatusChanged(failedState, oldStatus, false);
      orphanFailureRecordedForAutoResume.add(agentId);
    }
  } else if (completedReviewArtifact) {
    logDeaconEventSync(`handleAgentHeartbeatDeadEvent: ${agentId} stopped after completed review artifact; not recording orphan failure`);
  }
  const msg = `Recovered orphaned agent ${agentId} (${oldStatus}→stopped)`;
  console.log(`[deacon] ${msg}`);
  logDeaconEventSync(`handleAgentHeartbeatDeadEvent: ${msg} — tmux session missing, state.json reset`);
  logAgentLifecycleSync(agentId, `status changed: ${oldStatus} → stopped (orphaned: tmux session missing)`);
  // Notify server layer so the read model and frontend update
  deps.notifyAgentStopped(agentId);
  return [msg];
}

/**
 * On startup, detect agents whose state.json claims 'running' or 'starting' but have
 * no live tmux session — this happens after a system crash where tmux was killed but
 * state.json was never updated. Reset them to 'stopped' so resume/re-plan works correctly.
 */
export async function recoverOrphanedAgents(context: string | undefined, deps: AutoResumeNotifierDeps): Promise<string[]> {
  if (recoverOrphanedAgentsInFlight) {
    logDeaconEventSync(`recoverOrphanedAgents coalesced${context ? ` (${context})` : ''}: scan already in flight`);
    return recoverOrphanedAgentsInFlight;
  }

  const scan = recoverOrphanedAgentsOnce(context, deps);
  recoverOrphanedAgentsInFlight = scan;
  try {
    return await scan;
  } finally {
    if (recoverOrphanedAgentsInFlight === scan) {
      recoverOrphanedAgentsInFlight = null;
    }
  }
}

async function recoverOrphanedAgentsOnce(context: string | undefined, deps: AutoResumeNotifierDeps): Promise<string[]> {
  const noResumeMode = getNoResumeMode();
  if (noResumeMode.active) {
    logDeaconEventSync(`OVERDECK_NO_RESUME=1 — skipping recoverOrphanedAgents${context ? ` (${context})` : ''}`);
    return [];
  }

  // PAN-1908: authoritative registry is the agents table; no directory scan.
  const candidates = listAllAgents()
    .filter((agent) => agent.status === 'running' || agent.status === 'starting')
    .map((agent) => agent.id);

  logDeaconEventSync(`recoverOrphanedAgents started${context ? ` (${context})` : ''}: ${candidates.length} candidate(s) from agents table`);
  const actions: string[] = [];
  for (const agentId of candidates) {
    try {
      const result = await handleAgentHeartbeatDeadEvent(agentId, context ?? 'patrol', deps);
      actions.push(...result);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      logDeaconEventSync(`recoverOrphanedAgents: error processing ${agentId}: ${reason}`);
    }
  }
  if (actions.length > 0 && context) {
    console.log(`[deacon] ${context}: ${actions.length} orphaned agent(s) reset to stopped`);
    logDeaconEventSync(`recoverOrphanedAgents completed (${context}): ${actions.length} orphaned agent(s) reset to stopped`);
  } else {
    logDeaconEventSync(`recoverOrphanedAgents completed: no orphaned agents found`);
  }
  return actions;
}

/**
 * Kill `planning-*` tmux sessions whose corresponding work agent (`agent-*`) is
 * already alive — that's definitive evidence planning is over. Handles the PAN-682
 * pattern where a planning session survives after `complete-planning` fails to
 * kill it (skipKill=true path, or complete-planning never invoked because the
 * work agent was started via a different code path).
 */
export async function cleanupOrphanedPlanningSessions(deps: AutoResumeNotifierDeps): Promise<string[]> {
  const actions: string[] = [];
  let planningSessions: string[];
  try {
    planningSessions = (await Effect.runPromise(listSessionNames()))
      .filter(s => s.startsWith('planning-'));
  } catch {
    return actions;
  }

  logDeaconEventSync(`cleanupOrphanedPlanningSessions started: found ${planningSessions.length} planning session(s)`);

  for (const planningSession of planningSessions) {
    // planning-pan-596 → agent-pan-596
    const workAgentSession = planningSession.replace(/^planning-/, 'agent-');
    if (!sessionExistsSync(workAgentSession)) {
      logDeaconEventSync(`cleanupOrphanedPlanningSessions: ${planningSession} kept — work agent ${workAgentSession} not running`);
      continue;
    }

    try {
      await Effect.runPromise(killSession(planningSession)).catch(() => {});
    } catch { /* non-fatal */ }

    // Mark planning agent state as stopped so the UI doesn't show a "running" pill.
    try {
      const agentState = getAgentStateSync(planningSession);
      if (agentState && (agentState.status === 'running' || agentState.status === 'starting')) {
        const oldStatus = agentState.status;
        saveAgentStateSync({ ...agentState, status: 'stopped', stoppedAt: new Date().toISOString() });
        deps.notifyAgentStopped(planningSession);
        logAgentLifecycleSync(planningSession, `status changed: ${oldStatus} → stopped (orphaned planning session killed)`);
      }
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      logDeaconEventSync(`cleanupOrphanedPlanningSessions: error updating state for ${planningSession}: ${reason}`);
    }

    const msg = `Killed orphaned ${planningSession} (work agent ${workAgentSession} is running)`;
    actions.push(msg);
    console.log(`[deacon] ${msg}`);
    logDeaconEventSync(`cleanupOrphanedPlanningSessions: ${msg}`);
  }
  if (actions.length > 0) {
    logDeaconEventSync(`cleanupOrphanedPlanningSessions completed: killed ${actions.length} orphaned session(s)`);
  } else {
    logDeaconEventSync(`cleanupOrphanedPlanningSessions completed: no orphaned sessions found`);
  }

  return actions;
}

/**
 * Nudge work agents that are alive-but-idle with open beads remaining.
 *
 * Detects the gap that autoResumeStoppedWorkAgents misses: agents whose tmux
 * session is alive and `state.status === 'running'`, but whose Stop hook has
 * fired (state='idle' in the runtime mirror) and have NOT advanced. The
 * existing recovery paths only fire on `status='stopped'` (process killed)
 * or on a downstream review failure — neither matches this case.
 *
 * Triggered when ALL of the following hold:
 *   - state.status === 'running'                  (process still alive)
 *   - phase === 'implementation' or 'review-response'
 *   - tmux session exists                          (not orphaned)
 *   - isAgentIdleForNudge() returns true           (Stop hook authoritative)
 *   - bd ready -l <issueLabel> has ≥1 ready bead   (work remaining)
 *   - last nudge older than NUDGE_COOLDOWN_MS      (don't spam)
 *
 * Action: send `pan tell` with a concrete imperative pointing at the next
 * ready bead. Updates `<agentDir>/.last-bead-nudge` for cooldown.
 *
 * Returns a list of action descriptions for runPatrol to log.
 */
const BEAD_NUDGE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const STALLED_RESUME_NUDGE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function hasLandedUserRecordSinceResume(state: AgentState, snapshot: Awaited<ReturnType<typeof captureTranscriptUserRecordSnapshot>>): boolean {
  const resumeAt = state.lastResumeAt ? Date.parse(state.lastResumeAt) : NaN;
  if (!Number.isFinite(resumeAt)) return true;
  const lastUserAt = snapshot.lastUserRecord?.timestamp ? Date.parse(snapshot.lastUserRecord.timestamp) : NaN;
  if (!Number.isFinite(lastUserAt)) return snapshot.userRecordCount > 0;
  return lastUserAt >= resumeAt;
}

function stalledResumeCooldownActive(agentId: string): boolean {
  const cooldownFile = join(getAgentDir(agentId), '.last-stalled-resume-nudge');
  if (!existsSync(cooldownFile)) return false;
  try {
    const last = parseInt(readFileSync(cooldownFile, 'utf-8').trim(), 10);
    return !Number.isNaN(last) && Date.now() - last < STALLED_RESUME_NUDGE_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function recordStalledResumeCooldown(agentId: string): void {
  writeFileSync(join(getAgentDir(agentId), '.last-stalled-resume-nudge'), String(Date.now()), 'utf-8');
}

function buildStalledResumePrompt(state: AgentState): string | null {
  if (state.kickoffDelivered === false) {
    const promptPath = join(getAgentDir(state.id), 'initial-prompt.md');
    try {
      return readFileSync(promptPath, 'utf-8');
    } catch (err) {
      logDeaconEventSync(`nudgeStalledResumeWorkAgents: ${state.id} skipped — kickoffDelivered=false but ${promptPath} is unreadable: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
  return buildDefaultResumeContinueMessage(state.issueId);
}

export async function nudgeStalledResumeWorkAgents(): Promise<string[]> {
  const actions: string[] = [];

  const states = listAgentStates({ status: 'running', role: 'work' });

  for (const state of states) {
    const agentId = state.id;
    if (state.paused || state.troubled) continue;
    if (!state.lastResumeAt) continue;
    if (await isIssueClosed(state.issueId)) continue;
    if (!await Effect.runPromise(sessionExists(agentId))) continue;
    if (!isAgentIdleForNudge(agentId)) continue;
    if (stalledResumeCooldownActive(agentId)) continue;

    const sessionId = state.sessionId;
    if (!sessionId) continue;
    const snapshot = await captureTranscriptUserRecordSnapshot(state.workspace, sessionId);
    if (hasLandedUserRecordSinceResume(state, snapshot)) continue;

    const message = buildStalledResumePrompt(state);
    if (!message) continue;

    try {
      const { messageAgent } = await import('../agents.js');
      await messageAgent(agentId, message);
      recordStalledResumeCooldown(agentId);
      const action = `Re-sent stalled resume prompt to ${agentId} (${state.issueId})`;
      actions.push(action);
      logDeaconEventSync(`nudgeStalledResumeWorkAgents: ${action}`);
    } catch (err: unknown) {
      logDeaconEventSync(`nudgeStalledResumeWorkAgents: ${agentId} messageAgent failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return actions;
}

export async function nudgeIdleWorkAgentsWithOpenBeads(): Promise<string[]> {
  const actions: string[] = [];

  const states = listAgentStates({ status: 'running', role: 'work' });

  for (const state of states) {
    const agentId = state.id;
    if (await isIssueClosed(state.issueId)) {
      logDeaconEventSync(`nudgeIdleWorkAgentsWithOpenBeads: ${agentId} skipped — issue ${state.issueId} is closed`);
      continue;
    }

    // Tmux must be alive; orphans are handled by recoverOrphanedAgents.
    if (!await Effect.runPromise(sessionExists(agentId))) continue;

    // Authoritative idle signal — Stop hook fired and runtime mirror is idle.
    // Skips agents currently mid-thought (state='active') and ones we already
    // know are stopped/suspended.
    if (!isAgentIdleForNudge(agentId)) continue;

    // Cooldown — don't nudge the same agent more than once per BEAD_NUDGE_COOLDOWN_MS.
    const cooldownFile = join(getAgentDir(agentId), '.last-bead-nudge');
    if (existsSync(cooldownFile)) {
      try {
        const last = parseInt(readFileSync(cooldownFile, 'utf-8').trim(), 10);
        if (!Number.isNaN(last) && Date.now() - last < BEAD_NUDGE_COOLDOWN_MS) continue;
      } catch { /* fall through and nudge */ }
    }

    // Open beads for THIS issue?
    const issueLabel = state.issueId.toLowerCase();
    let openBeads: string[] = [];
    try {
      const { stdout } = await execAsync(`bd ready -l ${issueLabel}`, {
        cwd: state.workspace,
        encoding: 'utf-8',
        timeout: 10_000,
      });
      // bd ready output: lines starting with "○ workspace-XXXX ● ... pan-NNN: title"
      openBeads = stdout
        .split('\n')
        .filter(l => /^[○◐]\s+workspace-/i.test(l.trim()))
        .map(l => l.trim());
    } catch (err: unknown) {
      logDeaconEventSync(`nudgeIdleWorkAgentsWithOpenBeads: ${agentId} bd ready failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (openBeads.length === 0) continue;

    // Build the nudge: tell the agent what's next, do not just ping.
    const firstBead = openBeads[0]?.replace(/^[○◐]\s+/, '').slice(0, 200) ?? '';
    // PAN-2102: startup kickoff delivery can silently fail on large briefs (the
    // ~50KB initial prompt trips the PTY supervisor's echo-confirm), leaving the
    // agent running with NO original context — only this nudge. Point it at the
    // brief on disk so it can self-recover the full plan/role/decisions/hazards
    // instead of guessing from the bead title alone.
    const briefPath = join(getAgentDir(agentId), 'initial-prompt.md');
    const message = [
      `Deacon idle-nudge: your tmux is alive but Claude is idle and you have ${openBeads.length} open bead(s) remaining for ${state.issueId}.`,
      ``,
      `Next ready bead: ${firstBead}`,
      ``,
      `If you don't already have your full brief for ${state.issueId} in context (work-agent role instructions, the vBRIEF plan, recorded decisions & hazards), re-read it now — it is on disk at ${briefPath}, plus .pan/continue.json and .pan/spec.vbrief.json in your workspace. Startup kickoff delivery can silently fail on large briefs, so do not assume you received it.`,
      ``,
      `Continue the per-bead workflow without asking — claim it (\`bd update <bead-id> --claim\`), implement, commit, close. ` +
      `Inspection is conditional on metadata.requiresInspection (default false; check the plan item before deciding to call \`pan inspect\`). ` +
      `Do NOT end your turn with a multi-paragraph summary; just advance to the next bead.`,
    ].join('\n');

    try {
      const { messageAgent } = await import('../agents.js');
      await messageAgent(agentId, message);
      writeFileSync(cooldownFile, String(Date.now()), 'utf-8');
      const action = `Nudged idle ${agentId} (${state.issueId}) — ${openBeads.length} open bead(s)`;
      actions.push(action);
      logDeaconEventSync(`nudgeIdleWorkAgentsWithOpenBeads: ${action}`);
    } catch (err: unknown) {
      logDeaconEventSync(`nudgeIdleWorkAgentsWithOpenBeads: ${agentId} messageAgent failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return actions;
}

/**
 * Auto-resume work agents that were stopped by a system crash/reboot
 * but still have incomplete work. Scans all agent state directories for
 * stopped work-role agents and resumes them.
 *
 * Resumption rules:
 * - Agents with pending review feedback (blocked/failed/verification-failed)
 *   are ALWAYS resumed — the specialist pipeline needs them to fix issues.
 * - Agents without pending feedback are skipped if stoppedByUser=true (the
 *   user deliberately killed them via pan kill / pan done).
 * - Orphaned agents (tmux session missing, no stoppedByUser flag) are resumed.
 *
 * Called by runPatrol() on every patrol cycle AND during deacon startup.
 *
 * PAN-1665: bounded by the concurrency governor. An unfreeze used to mass-resume
 * every stopped work agent back-to-back, marching the box toward dozens of heavy
 * `claude` processes (load spiked 5→52). We now resume only up to the number of
 * free work slots (`max_work_agents − runningWork`); at or over the cap we resume
 * nothing and let attrition drain. This is a gate on *starting* work — it never
 * kills a running agent. The load gate and stagger below are secondary safety
 * valves. Remaining candidates are re-evaluated next patrol, so nothing is
 * dropped — only spread out and bounded.
 */
// Skip the rest of this cycle once 1-minute load exceeds cores * this factor.
const RESUME_LOAD_FACTOR = 1.5;
// Pause between consecutive resume spawns so the herd is spread across the cycle.
const RESUME_STAGGER_MS = 150;

function shouldRetryUndeliveredKickoff(state: AgentState): boolean {
  return state.role === 'work' && state.kickoffDelivered === false;
}

interface HandleAgentStoppedOptions {
  /** When true, the caller is managing global concurrency/load gates. */
  skipGlobalGates?: boolean;
  /** Descriptive source for log messages. */
  context?: string;
}

/**
 * PAN-1908: event-driven resume decision for a stopped agent. Called by the
 * reactive scheduler on `agent.stopped` and by the thin safety-net reconcile.
 * Does not enumerate directories — it evaluates the single agent ID it was given.
 */
export async function handleAgentStoppedEvent(
  agentId: string,
  opts: HandleAgentStoppedOptions = {},
  deps: AutoResumeNotifierDeps,
): Promise<string | null> {
  const { skipGlobalGates = false, context = 'event' } = opts;
  const noResumeMode = getNoResumeMode();
  if (noResumeMode.active) {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — OVERDECK_NO_RESUME=1`);
    return null;
  }

  const state = getAgentStateSync(agentId);
  if (!state) {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — no state`);
    return null;
  }
  if (state.status !== 'stopped') {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — status=${state.status} (not stopped)`);
    return null;
  }
  if (state.role !== 'work') {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — role=${state.role} (not work)`);
    return null;
  }

  // Skip if workspace is missing
  if (!state.workspace || !existsSync(state.workspace)) {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — workspace missing (${state.workspace || 'undefined'})`);
    return null;
  }

  if (state.paused === true) {
    const pauseKind = isVerifyPausedAgentState(state) ? 'verify-paused' : 'manually-paused';
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — ${pauseKind} (${state.pausedReason ?? 'no reason'})`);
    return null;
  }

  if (state.troubled === true) {
    const failureCount = state.consecutiveFailures ?? 0;
    const since = state.firstFailureInRunAt ?? state.troubledAt ?? 'unknown';
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — troubled (${failureCount} consecutive failures since ${since})`);
    return null;
  }

  const hasLiveTmuxSession = await Effect.runPromise(sessionExists(agentId));
  if (hasLiveTmuxSession) {
    const previousStatus = state.status;
    markAgentRunningState(state);
    await Effect.runPromise(saveAgentState(state));
    deps.notifyAgentStatusChanged(state, previousStatus, true);
    const msg = `Reconciled ${agentId} (${previousStatus}→running; tmux session alive)`;
    logDeaconEventSync(`handleAgentStoppedEvent: ${msg}`);
    return null;
  }

  if (state.lastFailureNextRetryAt !== undefined) {
    const nextRetryMs = Date.parse(state.lastFailureNextRetryAt);
    if (Number.isFinite(nextRetryMs) && nextRetryMs > Date.now()) {
      logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — backoff active (next retry at ${state.lastFailureNextRetryAt})`);
      return null;
    }
  }

  // Skip if the agent has a completed marker (or processed completion) — unless
  // review or test found issues that need fixing (blocked / failed).
  const completedFile = join(getAgentDir(agentId), 'completed');
  const processedFile = join(getAgentDir(agentId), 'completed.processed');
  const handedOffViaDone = existsSync(completedFile) || existsSync(processedFile);
  let review = getReviewStatusSync(state.issueId);
  if (handedOffViaDone) {
    const needsFix =
      review?.reviewStatus === 'blocked' ||
      review?.reviewStatus === 'failed' ||
      review?.testStatus === 'failed';
    const trulyPassed =
      review?.reviewStatus === 'passed' && review?.testStatus === 'passed';
    if (needsFix) {
      logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} resuming despite completed marker — review/test needs fixing (review=${review?.reviewStatus}, test=${review?.testStatus})`);
    } else if (trulyPassed) {
      logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — completed marker exists and review/test passed`);
      return null;
    } else {
      logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — pipeline mid-flight (review=${review?.reviewStatus ?? 'none'}, test=${review?.testStatus ?? 'none'})`);
      return null;
    }
  }

  // Refresh review status if we haven't loaded it yet.
  review ??= getReviewStatusSync(state.issueId);

  // Skip if already merge-ready (review+test passed) or already merged
  if (review?.readyForMerge && review.reviewStatus === 'passed' && review.testStatus === 'passed') {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — already merge-ready`);
    return null;
  }
  if (review?.mergeStatus === 'merged') {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — already merged`);
    return null;
  }

  if ((state as { merged?: boolean }).merged === true) {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — agent state has merged=true (mergedAt=${(state as { mergedAt?: string }).mergedAt ?? 'unknown'})`);
    return null;
  }

  if (await isIssueClosed(state.issueId)) {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — issue ${state.issueId} is closed`);
    return null;
  }

  const hasPendingReviewFeedback =
    review?.reviewStatus === 'blocked' ||
    review?.reviewStatus === 'failed' ||
    review?.testStatus === 'failed' ||
    review?.verificationStatus === 'failed';

  const deliberatelyStopped = state.stoppedByUser === true;
  if (deliberatelyStopped && !(handedOffViaDone && hasPendingReviewFeedback)) {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — deliberately stopped by user (stoppedByUser=true)`);
    return null;
  }

  if (hasPendingReviewFeedback) {
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} resuming — review feedback pending (review=${review?.reviewStatus}, test=${review?.testStatus}, verification=${review?.verificationStatus})`);
  } else {
    const runtimeState = getAgentRuntimeStateSync(agentId);
    if (runtimeState?.state === 'idle' && !shouldRetryUndeliveredKickoff(state)) {
      logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} skipped — idle (runtime.state=idle, no review feedback)`);
      return null;
    }
  }

  // Global gates (skipped when the batch reconcile is driving the loop).
  if (!skipGlobalGates) {
    const concurrencyLimits = getConcurrencyLimits();
    const runningBefore = countRunningAgents();
    const workSlots = workResumeSlotsAvailable(runningBefore, concurrencyLimits);
    if (workSlots <= 0) {
      logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} deferred — work concurrency cap reached (running=${runningBefore.work}, max=${concurrencyLimits.maxWorkAgents}, slots=${workSlots})`);
      return null;
    }
    const cores = cpus().length || 1;
    const loadCeiling = cores * RESUME_LOAD_FACTOR;
    const load1 = loadavg()[0];
    if (load1 > loadCeiling) {
      logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} deferred — load gate tripped (load1=${load1.toFixed(2)} > ${loadCeiling.toFixed(2)})`);
      return null;
    }
  }

  const runtimeStateForLog = getAgentRuntimeStateSync(agentId);
  logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} candidate — calling resumeAgent (issueId=${state.issueId}, runtime.state=${runtimeStateForLog?.state || 'null'})`);
  try {
    const result = await resumeAgent(agentId);
    if (result.success) {
      const resumedState = await Effect.runPromise(getAgentState(agentId));
      if (resumedState) {
        deps.notifyAgentStatusChanged(resumedState, state.status, true);
      }
      const msg = `Auto-resumed ${agentId} (was orphaned by system event)`;
      console.log(`[deacon] ${msg}`);
      logDeaconEventSync(`handleAgentStoppedEvent: ${msg}`);
      logAgentLifecycleSync(agentId, `resumed by deacon auto-recovery (session restored after system event)`);
      const issueId = state.issueId;
      emitActivityEntrySync({
        source: 'cloister',
        level: 'info',
        message: issueId
          ? `Deacon auto-resumed ${issueId} work agent`
          : `Deacon auto-resumed agent ${agentId}`,
        issueId,
      });
      emitActivityTtsSync({
        utterance: issueId
          ? `Deacon auto resumed ${issueId} work agent`
          : `Deacon auto resumed agent ${agentId}`,
        priority: 1,
        issueId,
        source: 'cloister',
        eventType: 'agent.autoResumed',
      });
      return agentId;
    }
    const msg = `Failed to auto-resume ${agentId}: ${result.error}`;
    if (!orphanFailureRecordedForAutoResume.has(agentId)) {
      const failedState = await Effect.runPromise(recordAgentFailure(agentId, msg));
      if (failedState) {
        deps.notifyAgentStatusChanged(failedState, state.status, false);
      }
    }
    console.warn(`[deacon] ${msg}`);
    logDeaconEventSync(`handleAgentStoppedEvent: ${msg}`);
    logAgentLifecycleSync(agentId, `auto-resume FAILED: ${result.error}`);
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!orphanFailureRecordedForAutoResume.has(agentId)) {
      const failedState = await Effect.runPromise(recordAgentFailure(agentId, `Auto-resume error for ${agentId}: ${msg}`));
      if (failedState) {
        deps.notifyAgentStatusChanged(failedState, state.status, false);
      }
    }
    console.warn(`[deacon] Auto-resume error for ${agentId}: ${msg}`);
    logDeaconEventSync(`handleAgentStoppedEvent: ${agentId} auto-resume threw: ${msg}`);
    logAgentLifecycleSync(agentId, `auto-resume threw exception: ${msg}`);
    return null;
  }
}

export async function autoResumeStoppedWorkAgents(deps: AutoResumeNotifierDeps): Promise<string[]> {
  const resumed: string[] = [];
  // PAN-1665: count spawn attempts (not just successes) — a failed resume still
  // forks a `claude` process, so the budget must bound attempts to curb the herd.
  let resumeAttempts = 0;
  // Free work slots this patrol = max_work_agents − running work agents. Zero when
  // already at/over the cap, in which case we resume nothing (never kill). Computed
  // once: newly-resumed sessions take time to register as tmux-alive, so we count
  // attempts against this fixed budget rather than re-polling mid-loop.
  const concurrencyLimits = getConcurrencyLimits();
  const runningBefore = countRunningAgents();
  const workSlots = workResumeSlotsAvailable(runningBefore, concurrencyLimits);
  const cores = cpus().length || 1;
  const loadCeiling = cores * RESUME_LOAD_FACTOR;
  const noResumeMode = getNoResumeMode();
  if (noResumeMode.active) {
    logDeaconEventSync('OVERDECK_NO_RESUME=1 — skipping autoResumeStoppedWorkAgents');
    orphanFailureRecordedForAutoResume.clear();
    return resumed;
  }

  // PAN-1908: authoritative registry is the agents table; no directory scan.
  const candidates = listAllAgents()
    .filter((agent) => agent.status === 'stopped' && agent.role === 'work')
    .map((agent) => agent.id);

  logDeaconEventSync(`autoResumeStoppedWorkAgents started: ${candidates.length} candidate(s) from agents table`);

  for (const agentId of candidates) {
    // PAN-1665 concurrency gate: resume only up to the free work slots, and bail
    // when load is high. At/over the cap workSlots is 0 → we resume nothing and let
    // attrition drain (never kill). Deferred candidates are re-evaluated next patrol.
    if (resumeAttempts >= workSlots) {
      logDeaconEventSync(`autoResumeStoppedWorkAgents: work concurrency cap reached (running=${runningBefore.work}, max=${concurrencyLimits.maxWorkAgents}, slots=${workSlots}); deferring remaining candidates to next patrol`);
      break;
    }
    const load1 = loadavg()[0];
    if (load1 > loadCeiling) {
      logDeaconEventSync(`autoResumeStoppedWorkAgents: load gate tripped (load1=${load1.toFixed(2)} > ${loadCeiling.toFixed(2)} = ${cores} cores * ${RESUME_LOAD_FACTOR}); deferring remaining candidates to next patrol`);
      break;
    }
    // Stagger spawns so the scheduler can absorb each `claude` before the next.
    if (resumeAttempts > 0) {
      await new Promise(r => setTimeout(r, RESUME_STAGGER_MS));
    }

    const result = await handleAgentStoppedEvent(agentId, { skipGlobalGates: true, context: 'patrol' }, deps);
    if (result) {
      resumed.push(result);
      resumeAttempts++;
    }
  }
  if (resumed.length > 0) {
    console.log(`[deacon] Auto-resumed ${resumed.length} work agent(s): ${resumed.join(', ')}`);
    logDeaconEventSync(`autoResumeStoppedWorkAgents completed: resumed ${resumed.length} agent(s): ${resumed.join(', ')}`);
  } else {
    logDeaconEventSync(`autoResumeStoppedWorkAgents completed: no agents resumed`);
  }
  orphanFailureRecordedForAutoResume.clear();
  return resumed;
}

/**
 * PAN-1908: thin safety-net reconcile for dropped lifecycle events. Queries the
 * authoritative agents table (no directory scan) and re-runs the event handlers
 * for any row that is inconsistent with live tmux state or should have resumed.
 * The primary path is reactive (agent.stopped / agent.heartbeat_dead events);
 * this is only a fallback.
 */
export async function reconcileAgentLiveness(deps: AutoResumeNotifierDeps): Promise<string[]> {
  const noResumeMode = getNoResumeMode();
  if (noResumeMode.active) {
    logDeaconEventSync('OVERDECK_NO_RESUME=1 — skipping reconcileAgentLiveness');
    return [];
  }

  const actions: string[] = [];
  const agents = listAllAgents();

  // Orphans: agents the registry says are running/starting but have no live tmux.
  const orphanCandidates = agents
    .filter((agent) => agent.status === 'running' || agent.status === 'starting')
    .map((agent) => agent.id)
    .filter((id) => !sessionExistsSync(id));

  for (const agentId of orphanCandidates) {
    const result = await handleAgentHeartbeatDeadEvent(agentId, 'reconcile', deps);
    actions.push(...result);
  }

  // Stopped work agents that may have missed an agent.stopped event.
  const stoppedWorkCandidates = agents
    .filter((agent) => agent.status === 'stopped' && agent.role === 'work')
    .map((agent) => agent.id);

  for (const agentId of stoppedWorkCandidates) {
    const resumed = await handleAgentStoppedEvent(agentId, { context: 'reconcile' }, deps);
    if (resumed) actions.push(`Auto-resumed ${agentId} via reconcile`);
  }

  if (actions.length > 0) {
    logDeaconEventSync(`reconcileAgentLiveness completed: ${actions.length} action(s)`);
  } else {
    logDeaconEventSync('reconcileAgentLiveness completed: no actions needed');
  }
  return actions;
}
