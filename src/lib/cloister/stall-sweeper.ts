/**
 * The Stall Sweeper (PAN-3485 phase 2) — the pipeline's un-parker.
 *
 * Every failure path in the pipeline parks the issue somewhere autonomous
 * motion stops (the ten orbits in src/lib/parked/resolver.ts). Until now each
 * orbit fired its escalation once and went silent forever; the operator was
 * the only un-parker, and the flywheel parks structural blockers by design.
 * This patrol walks the parked population every deacon cycle and executes the
 * orbit's autonomous action — resume-with-feedback, merge re-evaluation, UAT
 * re-drive, zombie reap, idle nudge-then-stop — with bounded retries and
 * cooldowns. Operator-set gates are never overridden; they (and truly
 * exhausted rows) are re-surfaced to the operator on a TTL instead of going
 * silent. Every action and escalation emits a sweep.* domain event and an
 * activity-feed sentence, so a sweep is always visible (PAN-3489 wires those
 * events into the God View).
 *
 * Guardrails:
 *  - one action per row per cooldown window; SWEEP_MAX_ACTIONS_PER_ROW per
 *    park episode, then escalate-only;
 *  - a global mutating-action budget per scan so a graveyard census can't
 *    spawn a fleet at once;
 *  - resumes go through decideAutonomousRedrive (resume gates + cached memory
 *    verdict) — the sweeper asks, it never forces;
 *  - every mutation flows through existing doors (review-status write door,
 *    agents endpoint spawn, feedback writer, stopAgent) — no new store access.
 */
import { Effect } from 'effect';

import { emitActivityEntrySync } from '../activity-logger.js';
import { getAgentStateSync } from '../agents.js';
import { messageAgent } from '../agents/messaging.js';
import { stopAgent } from '../agents.js';
import {
  PARKED_ORBIT_SEVERITY,
  resolveParkedPopulation,
  type ParkedOrbit,
  type ParkedRow,
} from '../parked/resolver.js';
import { clearWorkspaceStuck, dispatchReviewHostSide, setReviewStatusSync } from '../review-status.js';
import { decideAutonomousRedrive } from './redrive-gate.js';
import { writeFeedbackFile } from './feedback-writer.js';
import { spawnWorkAgentThroughAgentsEndpoint } from './work-agent-start.js';
import { getCloisterEventStore } from './service.js';
import {
  clearSweeperRowState,
  readSweeperRowState,
  readSweeperSignature,
  writeSweeperRowState,
  writeSweeperSignature,
  type StallSweeperRowState,
} from './stall-sweeper-state.js';

// ─── Policy constants ─────────────────────────────────────────────────────────

/** Max autonomous actions per park episode; beyond this the row is escalate-only. */
export const SWEEP_MAX_ACTIONS_PER_ROW = 8;
/** Max mutating actions per patrol scan — a full graveyard drains over cycles, never in one burst. */
export const SWEEP_MAX_ACTIONS_PER_SCAN = 4;
/** Operator-gated / exhausted rows re-surface to the operator this often (and stay autonomous-hands-off otherwise). */
export const SWEEP_RESURFACE_TTL_MS = 24 * 60 * 60_000;

const ORBIT_COOLDOWN_MS: Record<string, number> = {
  'zombie-session': 15 * 60_000,
  'merge-failed': 2 * 60 * 60_000,
  'uat-failed': 2 * 60 * 60_000,
  conflicts: 2 * 60 * 60_000,
  'stuck-flag': 2 * 60 * 60_000,
  'idle-running': 30 * 60_000,
};
/** After an idle nudge, wait this long for movement before stopping the agent. */
const IDLE_NUDGE_GRACE_MS = 90 * 60_000;

// ─── Deps (injectable for tests) ──────────────────────────────────────────────

export interface StallSweeperDeps {
  now?: number;
  resolveRows?: () => Promise<ParkedRow[]>;
  spawnWorkAgent?: (issueId: string) => Promise<{ spawned: boolean; skippedReason?: string; error?: string }>;
  stopAgent?: (agentId: string) => Promise<void>;
  messageAgent?: (agentId: string, message: string) => Promise<unknown>;
  writeFeedback?: (issueId: string, stage: string, summary: string, markdownBody: string) => Promise<void>;
  dispatchReview?: (issueId: string) => Promise<void>;
  clearStuck?: (issueId: string) => void;
  resetMergeForEvaluation?: (issueId: string) => void;
  emitActivity?: (entry: { level: string; issueId?: string; message: string }) => void;
  emitEvent?: (type: string, payload: Record<string, unknown>) => void;
}

interface ScanOutcome {
  actions: string[];
  escalations: string[];
}

// ─── Event + activity emission ────────────────────────────────────────────────

function defaultEmitEvent(type: string, payload: Record<string, unknown>): void {
  try {
    getCloisterEventStore()?.append({
      type,
      timestamp: new Date().toISOString(),
      payload,
    } as Parameters<NonNullable<ReturnType<typeof getCloisterEventStore>>['append']>[0]);
  } catch (error) {
    console.warn(`[sweeper] failed to append ${type}:`, error instanceof Error ? error.message : String(error));
  }
}

function defaultEmitActivity(entry: { level: string; issueId?: string; message: string }): void {
  emitActivityEntrySync({
    source: 'sweeper',
    level: entry.level,
    ...(entry.issueId ? { issueId: entry.issueId } : {}),
    message: entry.message,
  });
}

// ─── Per-row helpers ──────────────────────────────────────────────────────────

function coolingDown(state: StallSweeperRowState | null, orbit: ParkedOrbit, now: number): boolean {
  if (!state?.lastActionAt) return false;
  const cooldown = ORBIT_COOLDOWN_MS[orbit] ?? 60 * 60_000;
  return now - Date.parse(state.lastActionAt) < cooldown;
}

function dueForResurface(state: StallSweeperRowState | null, now: number): boolean {
  if (!state?.lastEscalatedAt) return true;
  return now - Date.parse(state.lastEscalatedAt) >= SWEEP_RESURFACE_TTL_MS;
}

function recordAction(issueId: string, orbit: ParkedOrbit, state: StallSweeperRowState | null, now: number): void {
  writeSweeperRowState(issueId, orbit, {
    actionCount: (state?.actionCount ?? 0) + 1,
    lastActionAt: new Date(now).toISOString(),
    episodeStartedAt: state?.episodeStartedAt ?? new Date(now).toISOString(),
    ...(state?.lastEscalatedAt ? { lastEscalatedAt: state.lastEscalatedAt } : {}),
    ...(state?.lastNudgedAt ? { lastNudgedAt: state.lastNudgedAt } : {}),
    ...(state?.nudgedActivityAt ? { nudgedActivityAt: state.nudgedActivityAt } : {}),
  });
}

function recordEscalation(issueId: string, orbit: ParkedOrbit, state: StallSweeperRowState | null, now: number): void {
  writeSweeperRowState(issueId, orbit, {
    actionCount: state?.actionCount ?? 0,
    ...(state?.lastActionAt ? { lastActionAt: state.lastActionAt } : {}),
    episodeStartedAt: state?.episodeStartedAt ?? new Date(now).toISOString(),
    lastEscalatedAt: new Date(now).toISOString(),
  });
}

// ─── The patrol ───────────────────────────────────────────────────────────────

export async function runStallSweeperPatrol(deps: StallSweeperDeps = {}): Promise<string[]> {
  const now = deps.now ?? Date.now();
  const resolveRows = deps.resolveRows ?? resolveParkedPopulation;
  const spawn = deps.spawnWorkAgent ?? ((issueId: string) => spawnWorkAgentThroughAgentsEndpoint(issueId, undefined, false, 'stall-sweeper'));
  const stop = deps.stopAgent ?? (async (agentId: string) => { await Effect.runPromise(stopAgent(agentId)); });
  const message = deps.messageAgent ?? ((agentId: string, text: string) => messageAgent(agentId, text, 'stall-sweeper'));
  const writeFeedback = deps.writeFeedback ?? (async (issueId: string, stage: string, summary: string, markdownBody: string) => {
    await Effect.runPromise(writeFeedbackFile({ issueId, specialist: stage, outcome: 'failed', summary, markdownBody }).pipe(
      Effect.catch((error) => { console.warn(`[sweeper] feedback write failed for ${issueId}:`, error.message); return Effect.succeed({ success: false }); }),
    ));
  });
  const dispatchReview = deps.dispatchReview ?? ((issueId: string) => dispatchReviewHostSide(issueId));
  const clearStuck = deps.clearStuck ?? clearWorkspaceStuck;
  const resetMerge = deps.resetMergeForEvaluation ?? ((issueId: string) => {
    setReviewStatusSync(issueId, { mergeStatus: 'pending', mergeRetryCount: 0, mergeNotes: 'stall sweeper: reset for merge re-evaluation' });
  });
  const emitActivity = deps.emitActivity ?? defaultEmitActivity;
  const emitEvent = deps.emitEvent ?? defaultEmitEvent;

  const rows = await resolveRows();
  const outcome: ScanOutcome = { actions: [], escalations: [] };

  // Population signature → sweep.scan fires only on CHANGE (a scan that finds
  // the same population is not news; a scan that finds a different one is).
  const signature = rows.map((row) => `${row.issueId}:${row.orbit}`).sort().join('|');
  if (signature !== readSweeperSignature()) {
    emitEvent('sweep.scan', {
      issueCount: new Set(rows.map((row) => row.issueId)).size,
      rowCount: rows.length,
      rows: rows.map((row) => ({ issueId: row.issueId, orbit: row.orbit, parkedAt: row.parkedAt })),
    });
    writeSweeperSignature(signature);
  }

  // Resolved rows get their episode state forgotten so a future park starts fresh.
  // (Rows absent from this scan are resolved by definition of the resolver.)

  const severity = (row: ParkedRow) => PARKED_ORBIT_SEVERITY.indexOf(row.orbit);
  const work = [...rows].sort((a, b) => severity(a) - severity(b) || a.parkedAt.localeCompare(b.parkedAt));
  let actionBudget = SWEEP_MAX_ACTIONS_PER_SCAN;

  for (const row of work) {
    const { issueId, orbit } = row;
    const state = readSweeperRowState(issueId, orbit);

    // Operator-owned rows: never act, re-surface on TTL.
    if (orbit === 'operator-gate' || orbit === 'deacon-ignored' || orbit === 'needs-you' || orbit === 'circuit-breaker') {
      if (dueForResurface(state, now)) {
        recordEscalation(issueId, orbit, state, now);
        emitEvent('sweep.escalated', { issueId, orbit, reason: row.parkReason });
        emitActivity({ level: 'warn', issueId, message: `🧹 sweeper re-surface: ${issueId} is still parked (${orbit}) — ${row.parkReason}. Release: ${row.unparkCondition}` });
        outcome.escalations.push(`${issueId} (${orbit}) re-surfaced to operator`);
      }
      continue;
    }

    if (coolingDown(state, orbit, now)) continue;
    if ((state?.actionCount ?? 0) >= SWEEP_MAX_ACTIONS_PER_ROW) {
      if (dueForResurface(state, now)) {
        recordEscalation(issueId, orbit, state, now);
        emitEvent('sweep.escalated', { issueId, orbit, reason: `exhausted ${SWEEP_MAX_ACTIONS_PER_ROW} sweep actions` });
        emitActivity({ level: 'warn', issueId, message: `🧹 sweeper: ${issueId} (${orbit}) exhausted ${SWEEP_MAX_ACTIONS_PER_ROW} autonomous actions — needs a human. ${row.parkReason}` });
        outcome.escalations.push(`${issueId} (${orbit}) exhausted → operator`);
      }
      continue;
    }
    if (actionBudget <= 0) continue;

    const acted = await sweepRow(row, state, now, {
      spawn, stop, message, writeFeedback, dispatchReview, clearStuck, resetMerge, emitActivity, emitEvent,
    }, outcome);
    if (acted) {
      recordAction(issueId, orbit, state, now);
      actionBudget--;
    }
  }

  return [...outcome.actions, ...outcome.escalations];
}

// ─── Per-orbit actions ────────────────────────────────────────────────────────

interface SweepActions {
  spawn: (issueId: string) => Promise<{ spawned: boolean; skippedReason?: string; error?: string }>;
  stop: (agentId: string) => Promise<void>;
  message: (agentId: string, text: string) => Promise<unknown>;
  writeFeedback: (issueId: string, stage: string, summary: string, markdownBody: string) => Promise<void>;
  dispatchReview: (issueId: string) => Promise<void>;
  clearStuck: (issueId: string) => void;
  resetMerge: (issueId: string) => void;
  emitActivity: (entry: { level: string; issueId?: string; message: string }) => void;
  emitEvent: (type: string, payload: Record<string, unknown>) => void;
}

async function resumeWorkAgentWithFeedback(
  row: ParkedRow,
  stage: string,
  summary: string,
  markdownBody: string,
  actions: Pick<SweepActions, 'spawn' | 'writeFeedback'>,
): Promise<{ ok: boolean; note: string }> {
  const agentId = `agent-${row.issueId.toLowerCase()}`;
  const agentState = getAgentStateSync(agentId);
  const gate = decideAutonomousRedrive(agentState ?? {}, { owesRework: true });
  if (gate.decision !== 'proceed') {
    return { ok: false, note: `re-drive deferred — ${gate.reason}` };
  }
  await actions.writeFeedback(row.issueId, stage, summary, markdownBody);
  const result = await actions.spawn(row.issueId);
  if (!result.spawned) {
    return { ok: false, note: `spawn skipped (${result.skippedReason ?? result.error ?? 'unknown'})` };
  }
  return { ok: true, note: `resumed ${agentId} with ${stage} feedback` };
}

async function sweepRow(
  row: ParkedRow,
  state: StallSweeperRowState | null,
  now: number,
  actions: SweepActions,
  outcome: ScanOutcome,
): Promise<boolean> {
  const { issueId, orbit } = row;
  const act = (text: string) => {
    outcome.actions.push(text);
    actions.emitActivity({ level: 'info', issueId, message: `🧹 ${text}` });
  };

  switch (orbit) {
    case 'zombie-session': {
      const agentId = String(row.details?.agentId ?? `agent-${issueId.toLowerCase()}`);
      await actions.stop(agentId);
      actions.emitEvent('sweep.unparked', { issueId, orbit, action: 'reaped-zombie', agentId });
      act(`sweeper reaped zombie ${agentId} — ${issueId} is merged/closed (${row.parkReason})`);
      return true;
    }

    case 'merge-failed': {
      actions.resetMerge(issueId);
      actions.emitEvent('sweep.action', { issueId, orbit, action: 'merge-reevaluate' });
      act(`sweeper reset ${issueId} merge for re-evaluation — ${row.parkReason}`);
      return true;
    }

    case 'uat-failed': {
      const notes = typeof row.details?.uatNotes === 'string' ? row.details.uatNotes : 'UAT failed — see the UAT panel for details';
      const result = await resumeWorkAgentWithFeedback(row, 'uat', `UAT failed for ${issueId}`, `## UAT Failure — Rework Required\n\n${notes}\n\nFix the failing acceptance criteria, commit, push, and run \`pan done ${issueId}\`.`, actions);
      if (!result.ok) {
        outcome.actions.push(`sweeper: ${issueId} UAT re-drive ${result.note}`);
        return false;
      }
      actions.emitEvent('sweep.action', { issueId, orbit, action: 'uat-redrive' });
      act(`sweeper re-drove ${issueId} UAT failure to a fresh work agent — ${result.note}`);
      return true;
    }

    case 'conflicts': {
      const result = await resumeWorkAgentWithFeedback(row, 'conflicts', `Branch conflicts for ${issueId}`, `## Branch Conflict — Resolution Required\n\nA merge to main invalidated this branch. Run \`pan sync-main ${issueId}\` (or rebase), resolve the conflicts, commit, push, and run \`pan done ${issueId}\`.`, actions);
      if (!result.ok) {
        outcome.actions.push(`sweeper: ${issueId} conflict re-drive ${result.note}`);
        return false;
      }
      actions.emitEvent('sweep.action', { issueId, orbit, action: 'conflict-redrive' });
      act(`sweeper resumed ${issueId} work agent for conflict resolution — ${result.note}`);
      return true;
    }

    case 'stuck-flag': {
      const reason = typeof row.details?.stuckReason === 'string' ? row.details.stuckReason : '';
      if (reason === 'review_infrastructure_failure') {
        actions.clearStuck(issueId);
        await actions.dispatchReview(issueId);
        actions.emitEvent('sweep.unparked', { issueId, orbit, action: 'review-redispatch' });
        act(`sweeper cleared ${issueId} infra-failure stuck flag and re-dispatched review`);
        return true;
      }
      if (reason === 'feedback_delivery_needs_you' || reason === 'verification_stuck') {
        const summary = reason === 'verification_stuck' ? `Verification exhausted for ${issueId}` : `Review/test feedback delivery for ${issueId}`;
        const result = await resumeWorkAgentWithFeedback(row, 'rework', summary, `## Pipeline Rework Required\n\n${row.parkReason}.\n\nAddress the pending feedback in \`.pan/feedback\`, commit, push, and run \`pan done ${issueId}\`.`, actions);
        if (!result.ok) {
          outcome.actions.push(`sweeper: ${issueId} stuck re-drive ${result.note}`);
          return false;
        }
        actions.clearStuck(issueId);
        actions.emitEvent('sweep.unparked', { issueId, orbit, action: 'stuck-redrive' });
        act(`sweeper cleared ${issueId} stuck flag and resumed rework — ${result.note}`);
        return true;
      }
      // Unknown / dead-end stuck flavors are operator-owned.
      if (dueForResurface(state, now)) {
        recordEscalation(issueId, orbit, state, now);
        actions.emitEvent('sweep.escalated', { issueId, orbit, reason: row.parkReason });
        actions.emitActivity({ level: 'warn', issueId, message: `🧹 sweeper re-surface: ${issueId} remains stuck (${reason || 'unknown'}) — ${row.parkReason}` });
        outcome.escalations.push(`${issueId} (stuck:${reason || 'unknown'}) re-surfaced`);
      }
      return false;
    }

    case 'idle-running': {
      const agentId = String(row.details?.agentId ?? `agent-${issueId.toLowerCase()}`);
      const lastActivity = typeof row.details?.idleMinutes === 'number' ? row.details.idleMinutes : 0;
      const agentState = getAgentStateSync(agentId);
      const currentActivity = agentState?.lastActivity ?? null;
      // Step 2: previously nudged, grace elapsed, and the agent never moved → stop it.
      if (state?.nudgedActivityAt && currentActivity && state.nudgedActivityAt === currentActivity
        && now - Date.parse(state.lastNudgedAt ?? 0) >= IDLE_NUDGE_GRACE_MS) {
        await actions.stop(agentId);
        actions.emitEvent('sweep.unparked', { issueId, orbit, action: 'stopped-idle', agentId });
        act(`sweeper stopped ${agentId} — no progress ${Math.round(lastActivity / 60)}h after a nudge; the slot is freed for live work`);
        return true;
      }
      // Step 1: nudge once, remember the activity stamp it must beat.
      if (state?.lastNudgedAt && now - Date.parse(state.lastNudgedAt) < IDLE_NUDGE_GRACE_MS) return false;
      await actions.message(agentId, `You have been idle for ${Math.floor(lastActivity / 60)}h with no pipeline stage owning your next move. If you have unfinished xBRIEF items, continue them now. If your work is complete, run \`pan done ${issueId}\`. If you are blocked, say so plainly in one sentence.`);
      writeSweeperRowState(issueId, orbit, {
        actionCount: (state?.actionCount ?? 0) + 1,
        lastActionAt: new Date(now).toISOString(),
        episodeStartedAt: state?.episodeStartedAt ?? new Date(now).toISOString(),
        lastNudgedAt: new Date(now).toISOString(),
        ...(currentActivity ? { nudgedActivityAt: currentActivity } : {}),
      });
      actions.emitEvent('sweep.action', { issueId, orbit, action: 'nudged-idle', agentId });
      act(`sweeper nudged idle ${agentId} for ${issueId} — stop follows if nothing moves within ${IDLE_NUDGE_GRACE_MS / 60_000} minutes`);
      return false; // the nudge records its own row state above
    }

    default:
      return false;
  }
}

/** Forget episode state for rows that left the population (called by tests + future reconcilers). */
export function forgetResolvedSweeperRows(currentRows: readonly ParkedRow[]): void {
  const live = new Set(currentRows.map((row) => `${row.issueId}:${row.orbit}`));
  for (const row of currentRows) {
    if (!live.has(`${row.issueId}:${row.orbit}`)) clearSweeperRowState(row.issueId, row.orbit);
  }
}
