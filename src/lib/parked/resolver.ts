/**
 * Single authoritative parked-population resolver (PAN-3485, epic phase 1).
 *
 * A "parked orbit" is any state an issue can sit in where no autonomous actor
 * will advance it within 24h without operator or flywheel intervention. Over
 * months of incident response, each failure mode grew its own safety valve —
 * stuck flags, needs-you trips, deacon-ignore, resume gates, UAT gates, merge
 * retry caps, and circuit breakers — and every one of them converts autonomous
 * motion into operator work. Nine of those valves exist today, in six subsystems,
 * and no surface could answer "what is stalled, why, and what would release it."
 * This resolver is that answer: ONE read door that unions all nine orbits into
 * typed rows, so the CLI, the API, the dashboard, and the stall sweeper all agree
 * by construction.
 *
 * Modeled on `resolvePipelineMembership()` (src/lib/pipeline-membership.ts):
 * a pure classifier over gathered signals, with the gathering done here through
 * existing read doors only (review-status door, agents table, tmux liveness,
 * the per-issue record door for recovery trips). No surface may re-derive
 * parking independently.
 *
 * The nine orbits (see docs/PARKED-POPULATION.md):
 *
 *   1. stuck-flag        review_status.stuck = 1 (any stuck_reason)
 *   2. needs-you         an open recovery trip in the permanent record
 *   3. deacon-ignored    review_status.deaconIgnored = true
 *   4. operator-gate     paused (operator, not yield) / troubled / stoppedByUser
 *   5. uat-failed        uatStatus failed with merge still pending
 *   6. merge-failed      mergeStatus failed (retries saturated or abandoned)
 *   7. zombie-session    live agent whose issue is merged/closed
 *   8. idle-running      live agent, no pipeline owner, idle beyond threshold
 *   9. circuit-breaker   autoRequeueCount >= 25 (dead-end recovery exhausted)
 */

import { loadReviewStatuses, type ReviewStatus } from '../review-status.js';
import { listAgentStates, listRunningAgentsSync } from '../agents/queries.js';
import type { AgentState } from '../agents.js';
import { FAILED_MERGE_MAX_RETRIES } from '../cloister/deacon-merge.js';
import { shouldSkipReviewStatus } from '../cloister/stuck-remediation.js';
import { isIssueClosed } from '../cloister/issue-closed.js';
import { readIssueRecord } from '../pan-dir/record.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';
import { isRecordPipelineTerminal } from '../cloister/parked-residue.js';
import { existsSync } from 'fs';
import { join } from 'path';
import { getOverdeckHome } from '../paths.js';

export const PARKED_ORBITS = [
  'stuck-flag',
  'needs-you',
  'deacon-ignored',
  'operator-gate',
  'uat-failed',
  'merge-failed',
  'zombie-session',
  'idle-running',
  'circuit-breaker',
] as const;

export type ParkedOrbit = (typeof PARKED_ORBITS)[number];

/**
 * Severity order — recommendations surface these orbits in this order, with
 * operator-gated rows last so a full report ends by surfacing what only a human
 * can release. The God View tints an orb
 * by its most severe orbit.
 */
export const PARKED_ORBIT_SEVERITY: readonly ParkedOrbit[] = [
  'zombie-session',
  'merge-failed',
  'uat-failed',
  'stuck-flag',
  'circuit-breaker',
  'idle-running',
  'needs-you',
  'deacon-ignored',
  'operator-gate',
];

export interface ParkedRow {
  issueId: string;
  orbit: ParkedOrbit;
  /** ISO timestamp the issue entered this orbit (best available evidence). */
  parkedAt: string;
  /** Operator-facing sentence: why the issue is parked. */
  parkReason: string;
  /** Operator-facing sentence: what would release it. */
  unparkCondition: string;
  /** Orbit-specific evidence (stuck reason, gate kind, idle minutes, …). */
  details?: Record<string, unknown>;
}

/** A human sentence per stuck_reason — the stuck flag carries the machine code, the resolver owns the copy.
 * GUARD-EXIT INVARIANT (PAN-3488): every stuck_reason written anywhere in src/ MUST have an entry
 * here — scripts/guard-park-exits.sh fails the lint on an undocumented flavor. */
const STUCK_REASON_COPY: Record<string, { park: string; unpark: string }> = {
  feedback_delivery_needs_you: {
    park: 'review/test feedback could not be delivered — the work agent is not running and nothing resumed it',
    unpark: 'resume the work agent with its pending feedback through the established work-resume door',
  },
  review_infrastructure_failure: {
    park: 'the review pipeline failed repeatedly for infrastructure reasons, not verdict reasons',
    unpark: 're-dispatch a fresh review through the review door once the infra cause is resolved',
  },
  review_parent_stalled_needs_you: {
    park: 'the review parent exceeded its deadline with no terminal verdict in the row or verdict artifact',
    unpark: 'inspect the parent pane and review artifacts, then pan unstick <id> and pan review restart <id> if a fresh review is required',
  },
  verification_stuck: {
    park: 'verification exhausted its cycles without passing',
    unpark: 're-drive the verification feedback to a resumed work agent',
  },
  'dead-end-rebuild': {
    park: 'dead-end recovery exhausted 25 requeues',
    unpark: 'operator decision — decompose or pan unstick after the root cause is fixed',
  },
  main_diverged: {
    park: 'the PR branch diverged from main and cannot merge cleanly',
    unpark: 'sync-main and resolve conflicts, then re-drive through the normal pipeline',
  },
  model_divergence: {
    park: 'the agent hit a model/API divergence error and was parked for investigation',
    unpark: 'investigate the model error (pane + transcript), then pan unstick and resume',
  },
  usage_limit: {
    park: 'the agent hit a provider usage limit and stopped mid-flight',
    unpark: 'wait for the provider window to reset, then pan unstick and resume',
  },
  context_overflow: {
    park: 'the agent overflowed its context window and cannot continue in this session',
    unpark: 'pan unstick after compaction/fork — resume with a fresh session',
  },
  review_convoy_unrecoverable: {
    park: 'the review convoy died and could not be recovered in place',
    unpark: 're-dispatch a fresh review convoy through the review door after the root cause is resolved',
  },
  test_signal_strand: {
    park: 'a test verdict was written but never delivered to the pipeline',
    unpark: 're-drive the stranded verdict to a resumed work agent',
  },
  'review-not-converging': {
    park: 'review cycles stopped converging (stall or reversal across ≥3 cycles) — rework is suppressed',
    unpark: 'decompose into sibling issues, or pan unstick to clear the gate and attempt rework',
  },
  state_derived_verification_hold: {
    park: 'verification is held by a derived-state rule (the recorded state forbids advancing)',
    unpark: 'fix the underlying state mismatch, then pan unstick to release the hold',
  },
};

/** Idle threshold for the idle-running orbit: below this a live idle agent is warm, not parked. */
export const IDLE_RUNNING_THRESHOLD_MS = 6 * 60 * 60_000;

/**
 * Roles the idle-running orbit must NEVER touch: orchestrators and
 * conversations. Their real activity lives in the conversation/runtime plane,
 * not the agents-table lastActivity this orbit reads — the sweeper's first
 * night proved the trap when its idle nudge→stop killed the FLYWHEEL (its
 * agents-table stamp was a day stale while it ticked normally), halting all
 * new dispatch for 90 minutes. A "stopped orchestrator" is not a freed slot;
 * it is the pipeline going silent.
 */
export const IDLE_EXEMPT_ROLES: ReadonlySet<string> = new Set(['flywheel', 'sequencer', 'conversation', 'knowledge']);

/** Per-issue gathered signals — the classifier's entire input. Gathered through read doors, never stores. */
export interface ParkedSignals {
  issueId: string;
  reviewStatus: ReviewStatus | null;
  /** All agents (any status) carrying this issue id. */
  agents: AgentState[];
  /** Live (running + tmux-active) agents for this issue. */
  liveAgents: (AgentState & { tmuxActive: boolean })[];
  /** Open recovery trips from the permanent record (needs-you orbit). */
  openRecoveryTrips: { recoveryPath: string; needsYouEmittedAt?: string }[];
  /** Tracker-closed (only resolved for live-agent candidates; null = unknown/not checked). */
  issueClosed: boolean | null;
  now: number;
}

function isoOr(ts: string | number | null | undefined, fallback: number): string {
  if (typeof ts === 'number' && Number.isFinite(ts)) return new Date(ts).toISOString();
  if (typeof ts === 'string' && ts) {
    const parsed = Date.parse(ts);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date(fallback).toISOString();
}

/**
 * `pan done` marks the work agent stoppedByUser as an auto-resume suppressor
 * (done.ts:439/:869 — finished, don't idle-revive; the PAN-2668 completed-
 * handoff exception is the sanctioned rework path). That is a NORMAL lifecycle
 * completion, not an operator park — reporting it as an operator gate makes
 * the sweeper escalate false gates every TTL (observed on PAN-3512 at
 * 00:02:26Z, self-cleared 80s later by the rework resume). A completed
 * handoff marker means finished, not parked.
 */
export function hasCompletedHandoffMarker(agentId: string): boolean {
  const dir = join(getOverdeckHome(), 'agents', agentId);
  return existsSync(join(dir, 'completed')) || existsSync(join(dir, 'completed.processed'));
}

/**
 * Agent rows occasionally carry a bare numeric issue id ("2156") where every
 * other surface keys "PAN-2156" — without normalization the issue loses its
 * review-status row and trip enrichment. Uppercase always; for bare numerics
 * that fail project resolution, retry with the PAN- prefix.
 */
export function normalizeParkedIssueId(raw: string): string {
  const upper = raw.trim().toUpperCase();
  if (!/^\d+$/.test(upper)) return upper;
  if (resolveProjectFromIssueSync(upper)) return upper;
  return `PAN-${upper}`;
}

function stuckCopy(reason: string | undefined): { park: string; unpark: string } {
  if (reason && STUCK_REASON_COPY[reason]) return STUCK_REASON_COPY[reason];
  return {
    park: `stuck flag set${reason ? ` (${reason})` : ''} — nothing autonomous will advance this issue`,
    unpark: 'pan unstick after the underlying cause is fixed',
  };
}

/**
 * Classify one issue's parked orbits from gathered signals. Pure — unit-tested
 * with fixtures. Emits at most one row per orbit; an issue may legitimately
 * occupy several orbits at once (e.g. a stuck flag AND a dead operator-stopped
 * agent). idle-running is only emitted when no other orbit already explains
 * the stall — it is the orbit of last resort ("live but leaderless").
 */
export function classifyParked(s: ParkedSignals): ParkedRow[] {
  const rows: ParkedRow[] = [];
  const r = s.reviewStatus;
  const issueId = s.issueId;
  const push = (orbit: ParkedOrbit, parkedAt: string, parkReason: string, unparkCondition: string, details?: Record<string, unknown>) => {
    rows.push({ issueId, orbit, parkedAt, parkReason, unparkCondition, ...(details ? { details } : {}) });
  };

  // Terminal issues are never parked — they are residue. A closed issue can
  // only produce zombie-session rows (a live agent to reap); every other orbit
  // is moot once the issue is done. issueClosed === null means "unknown" — the
  // gather resolves it for row-producing issues and re-classifies (pass 2).
  const closed = s.issueClosed === true;

  // 1. stuck-flag
  if (!closed && r?.stuck) {
    const copy = stuckCopy(r.stuckReason);
    push('stuck-flag', isoOr(r.stuckAt ?? r.updatedAt, s.now), copy.park, copy.unpark, { stuckReason: r.stuckReason ?? null });
  }

  // 2. needs-you (open recovery trips from the permanent record)
  if (!closed) for (const trip of s.openRecoveryTrips) {
    push(
      'needs-you',
      isoOr(trip.needsYouEmittedAt, s.now),
      `a durable needs-you escalation fired (${trip.recoveryPath}) and went silent — the operator never answered`,
      'answer the escalation (pan answer / dashboard needs-you), or let the sweeper re-surface it on its TTL',
      { recoveryPath: trip.recoveryPath },
    );
  }

  // 3. deacon-ignored
  if (!closed && r?.deaconIgnored) {
    push(
      'deacon-ignored',
      isoOr(r.deaconIgnoredAt ?? r.updatedAt, s.now),
      `deacon is ignoring this issue${r.deaconIgnoredReason ? ` — ${r.deaconIgnoredReason}` : ''}`,
      'clear the ignore flag once the reason it was set is resolved',
      { reason: r.deaconIgnoredReason ?? null },
    );
  }

  // 4. operator-gate — operator-set resume gates on this issue's agents,
  //    grouped one row per gate kind (an issue with three stopped agents has
  //    ONE operator-stop park, not three). A scheduler YIELD reuses the paused
  //    flag but is self-clearing (the preemptive scheduler resumes yielded
  //    agents oldest-first) — NOT a park.
  if (!closed) {
    const gateRows = new Map<'paused' | 'troubled' | 'stopped-by-user', { parkedAt: string; agentIds: string[]; reason: string; unpark: string }>();
    for (const agent of s.agents) {
      if (agent.paused === true && agent.yieldedByScheduler !== true) {
        const row = gateRows.get('paused') ?? { parkedAt: isoOr(agent.pausedAt, s.now), agentIds: [], reason: '', unpark: '' };
        row.agentIds.push(agent.id);
        const at = isoOr(agent.pausedAt, s.now);
        if (at < row.parkedAt) row.parkedAt = at;
        if (agent.pausedReason && !row.reason) row.reason = agent.pausedReason;
        gateRows.set('paused', row);
      } else if (agent.troubled === true) {
        const row = gateRows.get('troubled') ?? { parkedAt: isoOr(agent.troubledAt, s.now), agentIds: [], reason: '', unpark: '' };
        row.agentIds.push(agent.id);
        const at = isoOr(agent.troubledAt, s.now);
        if (at < row.parkedAt) row.parkedAt = at;
        gateRows.set('troubled', row);
      } else if (agent.stoppedByUser === true && agent.status !== 'running' && !hasCompletedHandoffMarker(agent.id)) {
        const row = gateRows.get('stopped-by-user') ?? { parkedAt: isoOr(agent.stoppedAt, s.now), agentIds: [], reason: '', unpark: '' };
        row.agentIds.push(agent.id);
        const at = isoOr(agent.stoppedAt, s.now);
        if (at < row.parkedAt) row.parkedAt = at;
        gateRows.set('stopped-by-user', row);
      }
    }
    for (const [gate, row] of gateRows) {
      const names = row.agentIds.join(', ');
      if (gate === 'paused') {
        push('operator-gate', row.parkedAt, `${names} manually paused${row.reason ? ` — ${row.reason}` : ''}`, 'pan unpause <id> (operator-only; the sweeper re-surfaces on TTL, never overrides)', { gate, agentIds: row.agentIds });
      } else if (gate === 'troubled') {
        push('operator-gate', row.parkedAt, `${names} marked troubled after repeated resume/crash failures`, 'pan untroubled <id> after the crash cause is investigated', { gate, agentIds: row.agentIds });
      } else {
        push('operator-gate', row.parkedAt, `${names} explicitly stopped by the operator with no completed handoff to re-drive`, 'pan start <id> (operator-only; explicit start clears the stop gate)', { gate, agentIds: row.agentIds });
      }
    }
  }

  // 5. uat-failed — the feedback relay already owns rework while work is live.
  const hasLiveWorkAgent = s.liveAgents.some((agent) => agent.role === 'work');
  if (!closed && r?.uatStatus === 'failed' && r.mergeStatus !== 'merged' && !r.readyForMerge && !hasLiveWorkAgent) {
    push(
      'uat-failed',
      isoOr(r.updatedAt, s.now),
      'UAT failed and no work agent is live to rework it — the merge gate will not take the issue and the UAT-failure relay found no delivery target',
      'pan start <id> to put a work agent on the UAT feedback; the relay redelivers on the next failed verdict',
      { uatNotes: r.uatNotes ?? null },
    );
  }

  // 6. merge-failed — a failed merge that nothing is retrying
  if (!closed && r?.mergeStatus === 'failed') {
    const retries = r.mergeRetryCount ?? 0;
    push(
      'merge-failed',
      isoOr(r.updatedAt, s.now),
      retries >= FAILED_MERGE_MAX_RETRIES
        ? `merge failed and its ${FAILED_MERGE_MAX_RETRIES} automatic retries are exhausted`
        : 'merge failed and no retry is in flight',
      'one fresh merge attempt once main CI is green and the branch is conflict-free (sweeper tries once per scan window)',
      { mergeRetryCount: retries, mergeNotes: r.mergeNotes ?? null },
    );
  }

  // 7. zombie-session — live agent whose issue is already merged/closed
  for (const agent of s.liveAgents) {
    const merged = r?.mergeStatus === 'merged' || s.issueClosed === true;
    if (!merged) continue;
    push(
      'zombie-session',
      isoOr(agent.lastActivity ?? agent.startedAt, s.now),
      `${agent.id} is still running but the issue is ${r?.mergeStatus === 'merged' ? 'merged' : 'closed'} — it holds a session and a concurrency slot for nothing`,
      'reap the session through the established merged-zombie teardown door',
      { agentId: agent.id, mergeStatus: r?.mergeStatus ?? null },
    );
  }

  // 9. circuit-breaker — dead-end recovery exhausted
  const requeues = r?.autoRequeueCount ?? 0;
  if (!closed && requeues >= 25) {
    push(
      'circuit-breaker',
      isoOr(r?.updatedAt, s.now),
      `dead-end recovery used all ${requeues}/25 requeues — the circuit breaker is permanently open`,
      'operator decision — decompose the change or pan unstick after the root cause is fixed',
      { autoRequeueCount: requeues },
    );
  }

  // 8. idle-running — live agent, no pipeline owner, idle beyond threshold, and
  //    no other orbit already explains the stall (orbit of last resort).
  if (!closed && rows.length === 0) {
    for (const agent of s.liveAgents) {
      // Orchestrators and conversations are exempt (IDLE_EXEMPT_ROLES): their
      // activity does not live in the stamp this orbit reads, and stopping one
      // silences the pipeline instead of freeing a slot.
      if (IDLE_EXEMPT_ROLES.has(String(agent.role ?? ''))) continue;
      const lastMs = Date.parse(agent.lastActivity ?? agent.startedAt ?? '');
      if (!Number.isFinite(lastMs)) continue;
      const idleMs = s.now - lastMs;
      if (idleMs < IDLE_RUNNING_THRESHOLD_MS) continue;
      // Warm-idle on a pipeline-owned issue is the intended state (PAN-2579):
      // review/test/merge owns the next move, the agent is SUPPOSED to wait.
      if (shouldSkipReviewStatus(r)) continue;
      push(
        'idle-running',
        new Date(lastMs).toISOString(),
        `${agent.id} is alive but has done nothing for ${Math.floor(idleMs / 60_000)} minutes and no pipeline stage owns the next move`,
        'poke for progress; if none, stop or resume with a nudge through the established agent-control door',
        { agentId: agent.id, idleMinutes: Math.floor(idleMs / 60_000) },
      );
    }
  }

  return rows;
}

/** Options for the gather pass — injectable for tests. */
export interface ResolveParkedOptions {
  now?: number;
  /** Per-issue open recovery trips (defaults to the record door). */
  readOpenTrips?: (issueId: string) => Promise<{ recoveryPath: string; needsYouEmittedAt?: string }[]>;
  /** Tracker-closed check (defaults to isIssueClosed). Only called for live-agent candidates. */
  isClosed?: (issueId: string) => Promise<boolean>;
  /**
   * Cheap local terminality evidence from the per-issue record (defaults to
   * defaultReadRecordTerminal). Checked BEFORE any tracker call — a record
   * this resolver already reads for trips, so a tracker blip can never
   * resurrect a record-terminal issue into the parked population (PAN-3727).
   */
  readRecordTerminal?: (issueId: string) => Promise<boolean>;
}

/**
 * Record-level terminality via the shared isRecordPipelineTerminal predicate
 * (also used by the terminal-issue residue patrol, PAN-3727) — closedOut, or
 * mergeStatus='merged' with no reopenedAt. Any throw or missing record is
 * "not terminal" so this check can only suppress, never invent, a park.
 */
export async function defaultReadRecordTerminal(issueId: string): Promise<boolean> {
  try {
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return false;
    const project = getProjectSync(resolved.projectKey);
    if (!project) return false;
    const record = await readIssueRecord(project, issueId);
    if (!record) return false;
    return isRecordPipelineTerminal(record);
  } catch {
    return false;
  }
}

async function defaultReadOpenTrips(issueId: string): Promise<{ recoveryPath: string; needsYouEmittedAt?: string }[]> {
  try {
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return [];
    const project = getProjectSync(resolved.projectKey);
    if (!project) return [];
    const record = await readIssueRecord(project, issueId);
    return (record?.recoveryTrips ?? [])
      .filter((trip) => trip.open === true)
      .map((trip) => ({ recoveryPath: trip.recoveryPath, ...(trip.needsYouEmittedAt ? { needsYouEmittedAt: trip.needsYouEmittedAt } : {}) }));
  } catch {
    // A record that cannot be read must never fail the whole resolve — the
    // issue simply loses its needs-you enrichment for this pass.
    return [];
  }
}

/**
 * Gather signals through the read doors and classify every candidate issue.
 * Candidates = every issue with a review_status row OR a registered agent —
 * the bounded in-flight universe (~dozens), never the 800-row backlog (an
 * untouched backlog issue is not parked; it was never started).
 *
 * Returns rows sorted oldest-first (the sweep order).
 */
export async function resolveParkedPopulation(options: ResolveParkedOptions = {}): Promise<ParkedRow[]> {
  const now = options.now ?? Date.now();
  const readTrips = options.readOpenTrips ?? defaultReadOpenTrips;
  const isClosed = options.isClosed ?? isIssueClosed;
  const readRecordTerminal = options.readRecordTerminal ?? defaultReadRecordTerminal;

  const statuses = loadReviewStatuses();
  const allAgents = listAgentStates();
  const liveAgents = listRunningAgentsSync().filter((a) => a.tmuxActive && (a.status === 'running' || a.status === 'starting'));

  const agentsByIssue = new Map<string, AgentState[]>();
  for (const agent of allAgents) {
    const issueId = normalizeParkedIssueId(agent.issueId ?? '');
    if (!issueId) continue;
    const list = agentsByIssue.get(issueId) ?? [];
    list.push(agent);
    agentsByIssue.set(issueId, list);
  }
  const liveByIssue = new Map<string, (AgentState & { tmuxActive: boolean })[]>();
  for (const agent of liveAgents) {
    const issueId = normalizeParkedIssueId(agent.issueId ?? '');
    if (!issueId) continue;
    const list = liveByIssue.get(issueId) ?? [];
    list.push(agent);
    liveByIssue.set(issueId, list);
  }

  const candidateIds = new Set<string>([...Object.keys(statuses).map((id) => id.toUpperCase()), ...agentsByIssue.keys(), ...liveByIssue.keys()]);

  // Pass 1: classify with closedness unknown (null) except where cheap local
  // evidence already decides (live-agent zombie checks resolve it below).
  // Pass 2: for every issue that PRODUCED a row, resolve tracker-closed
  // (TTL-cached, shadow-state-first) and re-classify — a closed issue keeps
  // only its zombie-session rows; every other orbit is moot residue.
  const closedByIssue = new Map<string, boolean>();
  const classifyOne = async (issueId: string): Promise<ParkedRow[]> => {
    const statusKey = Object.keys(statuses).find((key) => key.toUpperCase() === issueId) ?? issueId;
    const reviewStatus = statuses[statusKey] ?? null;
    const live = liveByIssue.get(issueId) ?? [];
    let issueClosed = closedByIssue.get(issueId) ?? null;
    if (issueClosed === null && await readRecordTerminal(issueId)) {
      // Cheap local terminality evidence decides before any tracker call — a
      // tracker blip (fail-open toward "open", negative-cached for minutes)
      // must never resurrect a record-terminal issue into the population.
      issueClosed = true;
      closedByIssue.set(issueId, true);
    } else if (issueClosed === null && live.length > 0 && reviewStatus?.mergeStatus !== 'merged') {
      // Zombie detection needs tracker-closed only when the cheap local signals
      // can't decide (strikes bypass the review pipeline, so mergeStatus never
      // records their merge). Bound the check to live-agent candidates.
      try { issueClosed = await isClosed(issueId); closedByIssue.set(issueId, issueClosed); } catch { issueClosed = null; }
    }
    const trips = issueClosed === true ? [] : await readTrips(issueId);
    return classifyParked({
      issueId,
      reviewStatus,
      agents: agentsByIssue.get(issueId) ?? [],
      liveAgents: live,
      openRecoveryTrips: trips,
      issueClosed,
      now,
    });
  };

  const firstPass = new Map<string, ParkedRow[]>();
  for (const issueId of candidateIds) {
    const rows = await classifyOne(issueId);
    if (rows.length > 0) firstPass.set(issueId, rows);
  }
  const rows: ParkedRow[] = [];
  for (const [issueId, produced] of firstPass) {
    if (!closedByIssue.has(issueId)) {
      try { closedByIssue.set(issueId, await isClosed(issueId)); } catch { /* unknown — keep the open-issue reading */ }
    }
    if (closedByIssue.get(issueId) === true) {
      // Closed: residue — keep only zombie-session rows (reap candidates).
      rows.push(...produced.filter((row) => row.orbit === 'zombie-session'));
    } else {
      rows.push(...produced);
    }
  }

  return rows.sort((a, b) => a.parkedAt.localeCompare(b.parkedAt) || a.issueId.localeCompare(b.issueId));
}

/** Rollup for dashboards: count by orbit plus the primary (most severe) orbit per issue. */
export function summarizeParked(rows: readonly ParkedRow[]): { total: number; byOrbit: Record<string, number>; primaryByIssue: Record<string, ParkedOrbit> } {
  const byOrbit: Record<string, number> = {};
  const primaryByIssue: Record<string, ParkedOrbit> = {};
  const issues = new Set<string>();
  for (const row of rows) {
    byOrbit[row.orbit] = (byOrbit[row.orbit] ?? 0) + 1;
    issues.add(row.issueId);
    const current = primaryByIssue[row.issueId];
    if (!current || PARKED_ORBIT_SEVERITY.indexOf(row.orbit) < PARKED_ORBIT_SEVERITY.indexOf(current)) {
      primaryByIssue[row.issueId] = row.orbit;
    }
  }
  return { total: issues.size, byOrbit, primaryByIssue };
}
