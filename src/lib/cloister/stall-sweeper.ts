/**
 * The Stall Sweeper (PAN-3485 phase 2) — the pipeline's stall DETECTOR.
 *
 * ─── OBSERVABILITY ONLY — OPERATOR DIRECTIVE (2026-08-05) ───────────────────
 * This module detects parked/stalled work and reports it with a recommended
 * action. It must NEVER act. Do not re-add spawn/stop/kill/message/dispatch/
 * clear/reset capability here — not behind a flag, not as "just this one safe
 * case", not as an opt-in. The kill-and-re-drive incarnation killed a
 * completed PAN-3511 review parent on a lost verdict and re-dispatched on
 * phantom stuck flags (2026-08-05): every failure was the sweeper ACTING on
 * state that had drifted. Detection is trustworthy because it reads; action
 * was not, because it wrote. The operator (or a deliberately invoked door)
 * executes recommendations.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Every failure path in the pipeline parks the issue somewhere autonomous
 * motion stops (the orbits in src/lib/parked/resolver.ts). This patrol walks
 * the parked population every deacon cycle and emits, per row: an
 * activity-feed sentence and a sweep.recommendation domain event naming the
 * evidence and the recommended remedy. Operator-set gates are never touched;
 * gated and truly exhausted rows are re-surfaced to the operator on a TTL
 * instead of going silent. Every recommendation and escalation emits a
 * sweep.* domain event and an activity-feed sentence, so a sweep is always
 * visible (PAN-3489 wires those events into the God View).
 *
 * Guardrails:
 *  - one recommendation per row per cooldown window; SWEEP_MAX_RECOMMENDATIONS_PER_ROW
 *    per park episode, then escalate-only;
 *  - a global recommendation budget per scan so a graveyard census can't
 *    flood the feed at once;
 *  - this module holds no door to any mutation — there is nothing to force.
 */
import { emitActivityEntrySync, type ActivityLevel } from '../activity-logger.js';
import { getAgentStateSync } from '../agents/agent-state.js';
import {
  PARKED_ORBIT_SEVERITY,
  resolveParkedPopulation,
  type ParkedOrbit,
  type ParkedRow,
} from '../parked/resolver.js';
import { sessionExistsSync } from '../tmux.js';
import { getCloisterEventStore } from './event-store-provider.js';
import { readMemoizedArtifactVerdict, type SynthesisArtifactVerdict } from './synthesis-verdict.js';
import {
  clearSweeperRowState,
  readSweeperRowState,
  readSweeperSignature,
  writeSweeperRowState,
  writeSweeperSignature,
  type StallSweeperRowState,
} from './stall-sweeper-state.js';

// ─── Policy constants ─────────────────────────────────────────────────────────

/** Max recommendations per park episode; beyond this the row is escalate-only. */
export const SWEEP_MAX_RECOMMENDATIONS_PER_ROW = 8;
/** Max recommendations per patrol scan — a full graveyard surfaces over cycles, never in one burst. */
export const SWEEP_MAX_RECOMMENDATIONS_PER_SCAN = 4;
/** Operator-gated / exhausted rows re-surface to the operator this often (and stay hands-off otherwise). */
export const SWEEP_RESURFACE_TTL_MS = 24 * 60 * 60_000;

const ORBIT_COOLDOWN_MS: Record<string, number> = {
  'zombie-session': 15 * 60_000,
  'merge-failed': 2 * 60 * 60_000,
  'uat-failed': 2 * 60 * 60_000,
  conflicts: 2 * 60 * 60_000,
  'stuck-flag': 2 * 60 * 60_000,
  'idle-running': 30 * 60_000,
};
/** An idle-running recommendation repeats at most this often while nothing moves. */
const IDLE_RECOMMEND_GRACE_MS = 90 * 60_000;

/** Every feed entry carries this so a recommendation can never be mistaken for an action. */
const NO_ACTION_TRAILER = 'Observability-only: no action taken.';

// ─── Deps (injectable for tests) ──────────────────────────────────────────────

export interface StallSweeperDeps {
  now?: number;
  resolveRows?: () => Promise<ParkedRow[]>;
  readArtifact?: (issueId: string) => SynthesisArtifactVerdict | null;
  isAgentLive?: (agentId: string) => boolean;
  emitActivity?: (entry: { level: ActivityLevel; issueId?: string; message: string }) => void;
  emitEvent?: (type: string, payload: Record<string, unknown>) => void;
}

interface ScanOutcome {
  recommendations: string[];
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

function defaultEmitActivity(entry: { level: ActivityLevel; issueId?: string; message: string }): void {
  // Source is cloister — the sweeper is cloister machinery; the 🧹 message
  // prefix carries the sweeper identity in the feed.
  emitActivityEntrySync({
    source: 'cloister',
    level: entry.level,
    ...(entry.issueId ? { issueId: entry.issueId } : {}),
    message: entry.message,
  });
}

// ─── Per-row helpers ──────────────────────────────────────────────────────────

function coolingDown(state: StallSweeperRowState | null, orbit: ParkedOrbit, now: number): boolean {
  if (!state?.lastRecommendedAt) return false;
  const cooldown = ORBIT_COOLDOWN_MS[orbit] ?? 60 * 60_000;
  return now - Date.parse(state.lastRecommendedAt) < cooldown;
}

function dueForResurface(state: StallSweeperRowState | null, now: number): boolean {
  if (!state?.lastEscalatedAt) return true;
  return now - Date.parse(state.lastEscalatedAt) >= SWEEP_RESURFACE_TTL_MS;
}

function recordRecommendation(issueId: string, orbit: ParkedOrbit, state: StallSweeperRowState | null, now: number): void {
  writeSweeperRowState(issueId, orbit, {
    recommendationCount: (state?.recommendationCount ?? 0) + 1,
    lastRecommendedAt: new Date(now).toISOString(),
    episodeStartedAt: state?.episodeStartedAt ?? new Date(now).toISOString(),
    ...(state?.lastEscalatedAt ? { lastEscalatedAt: state.lastEscalatedAt } : {}),
  });
}

function recordEscalation(issueId: string, orbit: ParkedOrbit, state: StallSweeperRowState | null, now: number): void {
  writeSweeperRowState(issueId, orbit, {
    recommendationCount: state?.recommendationCount ?? 0,
    ...(state?.lastRecommendedAt ? { lastRecommendedAt: state.lastRecommendedAt } : {}),
    episodeStartedAt: state?.episodeStartedAt ?? new Date(now).toISOString(),
    lastEscalatedAt: new Date(now).toISOString(),
  });
}

// ─── The patrol ───────────────────────────────────────────────────────────────

export async function runStallSweeperPatrol(deps: StallSweeperDeps = {}): Promise<string[]> {
  const now = deps.now ?? Date.now();
  const resolveRows = deps.resolveRows ?? resolveParkedPopulation;
  const readArtifact = deps.readArtifact ?? ((issueId: string) => {
    const review = getAgentStateSync(`agent-${issueId.toLowerCase()}-review`);
    return readMemoizedArtifactVerdict(issueId, {
      runId: review?.reviewRunId,
      workspacePath: review?.workspace,
    });
  });
  const isAgentLive = deps.isAgentLive ?? sessionExistsSync;
  const emitActivity = deps.emitActivity ?? defaultEmitActivity;
  const emitEvent = deps.emitEvent ?? defaultEmitEvent;

  const rows = await resolveRows();
  const outcome: ScanOutcome = { recommendations: [], escalations: [] };

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
  let recommendationBudget = SWEEP_MAX_RECOMMENDATIONS_PER_SCAN;

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
    if ((state?.recommendationCount ?? 0) >= SWEEP_MAX_RECOMMENDATIONS_PER_ROW) {
      if (dueForResurface(state, now)) {
        recordEscalation(issueId, orbit, state, now);
        emitEvent('sweep.escalated', { issueId, orbit, reason: `exhausted ${SWEEP_MAX_RECOMMENDATIONS_PER_ROW} sweep recommendations` });
        emitActivity({ level: 'warn', issueId, message: `🧹 sweeper: ${issueId} (${orbit}) exhausted ${SWEEP_MAX_RECOMMENDATIONS_PER_ROW} recommendations — needs a human. ${row.parkReason}` });
        outcome.escalations.push(`${issueId} (${orbit}) exhausted → operator`);
      }
      continue;
    }
    if (recommendationBudget <= 0) continue;

    const reported = reportRow(row, state, now, { readArtifact, isAgentLive, emitActivity, emitEvent }, outcome);
    if (reported) {
      recordRecommendation(issueId, orbit, state, now);
      recommendationBudget--;
    }
  }

  return [...outcome.recommendations, ...outcome.escalations];
}

// ─── Per-orbit recommendations ────────────────────────────────────────────────

interface ReportDeps {
  readArtifact: (issueId: string) => SynthesisArtifactVerdict | null;
  isAgentLive: (agentId: string) => boolean;
  emitActivity: (entry: { level: ActivityLevel; issueId?: string; message: string }) => void;
  emitEvent: (type: string, payload: Record<string, unknown>) => void;
}

/**
 * Build the per-orbit recommendation. This is the ONLY thing the sweeper does
 * with a row: describe the evidence, name the remedy, emit both. There is no
 * action door — see the file-header law.
 *
 * Recommendations always name the CANONICAL existing door (the same machinery
 * the deacon/operator uses — pan resume/start/tell/unstick/review restart/
 * sync-main/done/close), never a sweeper-invented path. A stall that keeps
 * recurring across an episode is a substrate bug by definition: the
 * recommendation says so, so the flywheel's substrate intake files why it
 * keeps parking instead of the symptom being swept forever.
 */
function reportRow(
  row: ParkedRow,
  state: StallSweeperRowState | null,
  now: number,
  reporting: ReportDeps,
  outcome: ScanOutcome,
): boolean {
  const { issueId, orbit } = row;
  const recurrence = state?.recommendationCount ?? 0;
  const substrateNote = recurrence >= 1
    ? ` This stall has recurred (${recurrence + 1} sweeps this episode) — that is a substrate bug: file why ${issueId} keeps parking here (flywheel substrate intake), don't just remedy the symptom.`
    : '';
  const recommend = (recommendation: string, evidence: Record<string, unknown> = {}) => {
    reporting.emitEvent('sweep.recommendation', { issueId, orbit, recommendation, recurring: recurrence >= 1, ...evidence });
    reporting.emitActivity({ level: 'warn', issueId, message: `🧹 sweeper recommends: ${recommendation} — ${row.parkReason}.${substrateNote} ${NO_ACTION_TRAILER}` });
    outcome.recommendations.push(`${issueId} (${orbit}) recommended: ${recommendation}`);
  };

  switch (orbit) {
    case 'zombie-session': {
      const agentId = String(row.details?.agentId ?? `agent-${issueId.toLowerCase()}`);
      const live = reporting.isAgentLive(agentId);
      recommend(`reap zombie session ${agentId} via the existing door (pan close ${issueId} owns merged/closed teardown; the reaper is the backstop)`, { agentId, sessionCurrentlyLive: live });
      return true;
    }

    case 'merge-failed': {
      recommend(`reset ${issueId}'s merge for re-evaluation via pan review resync ${issueId}`);
      return true;
    }

    case 'uat-failed': {
      const notes = typeof row.details?.uatNotes === 'string' ? row.details.uatNotes : 'UAT failed — see the UAT panel for details';
      recommend(`re-drive ${issueId} for UAT rework via pan resume agent-${issueId.toLowerCase()} with the UAT feedback (pan start ${issueId} if the agent is stopped)`, { uatNotes: notes.slice(0, 400) });
      return true;
    }

    case 'stuck-flag': {
      const reason = typeof row.details?.stuckReason === 'string' ? row.details.stuckReason : '';

      // PAN-3511: evidence from the active review run prevents a recommendation
      // from re-driving work over a review that has already finished. The
      // sweeper remains observability-only and cannot promote that evidence into
      // a terminal review status.
      const artifact = reporting.readArtifact(issueId);
      if (artifact?.verdict === 'passed') {
        recommend(
          `preserve ${issueId}'s passed review evidence from run ${artifact.runId} and await pan admin specialists done review; do not re-dispatch or resume rework`,
          { artifactVerdict: artifact.verdict, artifactRunId: artifact.runId, artifactHead: artifact.headSha },
        );
        return true;
      }
      if (reason === 'review_infrastructure_failure') {
        recommend(`clear ${issueId}'s infra-failure stuck flag and re-dispatch the review via pan unstick ${issueId} && pan review restart ${issueId}`);
        return true;
      }
      if (reason === 'feedback_delivery_needs_you' || reason === 'verification_stuck') {
        recommend(
          artifact?.notes
            ? `resume ${issueId} rework via pan resume agent-${issueId.toLowerCase()} using the blocker from review run ${artifact.runId}`
            : `resume ${issueId} rework from the pending feedback via pan resume agent-${issueId.toLowerCase()} (feedback is in .pan/feedback)`,
          artifact?.notes ? { artifactVerdict: artifact.verdict, artifactRunId: artifact.runId, reviewNotes: artifact.notes.slice(0, 400) } : {},
        );
        return true;
      }
      // Unknown / dead-end stuck flavors are operator-owned — re-surface on TTL.
      if (dueForResurface(state, now)) {
        recordEscalation(issueId, orbit, state, now);
        reporting.emitEvent('sweep.escalated', { issueId, orbit, reason: row.parkReason });
        reporting.emitActivity({ level: 'warn', issueId, message: `🧹 sweeper re-surface: ${issueId} remains stuck (${reason || 'unknown'}) — ${row.parkReason}` });
        outcome.escalations.push(`${issueId} (stuck:${reason || 'unknown'}) re-surfaced`);
      }
      return false;
    }

    case 'idle-running': {
      const agentId = String(row.details?.agentId ?? `agent-${issueId.toLowerCase()}`);
      const lastActivity = typeof row.details?.idleMinutes === 'number' ? row.details.idleMinutes : 0;
      if (state?.lastRecommendedAt && now - Date.parse(state.lastRecommendedAt) < IDLE_RECOMMEND_GRACE_MS) return false;
      const previouslyRecommended = !!state?.lastRecommendedAt;
      recommend(
        previouslyRecommended
          ? `stop or resume ${agentId} via pan kill ${agentId} / pan resume ${agentId} — still idle ${Math.round(lastActivity / 60)}h after a prior recommendation`
          : `nudge ${agentId} via pan tell ${agentId} — idle ${Math.round(lastActivity / 60)}h with no pipeline stage owning its next move`,
        { agentId, idleMinutes: lastActivity, live: reporting.isAgentLive(agentId) },
      );
      return true;
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
