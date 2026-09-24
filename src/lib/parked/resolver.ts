/**
 * Single authoritative parked-population resolver (PAN-3485; cut to the
 * derived model by PAN-3917).
 *
 * A "parked orbit" is any state an issue can sit in where no autonomous actor
 * will advance it within 24h without operator or flywheel intervention, and no
 * surface could answer "what is stalled, why, and what would release it."
 * This resolver is that answer: ONE read door that unions the orbits into typed
 * rows, so the CLI, the API, the dashboard, and the stall sweeper all agree by
 * construction.
 *
 * Modeled on `resolvePipelineMembership()` (src/lib/pipeline-membership.ts):
 * a pure classifier over gathered signals. Every signal it reads has an owner
 * outside Overdeck — the agents table and the liveness oracle for sessions, the
 * tracker for closedness. Nothing is read from a stored pipeline copy.
 *
 * The three orbits (see docs/PARKED-POPULATION.md):
 *
 *   1. operator-gate    paused (operator, not yield) / troubled / stoppedByUser
 *   2. zombie-session   live agent whose issue is closed
 *   3. idle-running     live agent, no pipeline owner, idle beyond threshold
 *
 * The record-backed orbits (stuck-flag, needs-you, deacon-ignored, uat-failed,
 * merge-failed, circuit-breaker, invariant-mismatch) came from the state layer
 * and went with it; their replacements are derived from the PR and its checks.
 */

import { listAgentStates, listRunningAgentsSync } from '../agents/queries.js';
import { isAliveSync, isConfirmedDead } from '../agents/liveness.js';
import type { AgentState } from '../agents.js';
import { isIssueClosed } from '../cloister/issue-closed.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { existsSync } from 'fs';
import { join } from 'path';
import { getOverdeckHome } from '../paths.js';

export const PARKED_ORBITS = [
  'operator-gate',
  'zombie-session',
  'idle-running',
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
  'idle-running',
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
  /** Orbit-specific evidence (gate kind, agent id, idle minutes, …). */
  details?: Record<string, unknown>;
}

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
const IDLE_EXEMPT_ROLES: ReadonlySet<string> = new Set(['flywheel', 'sequencer', 'conversation', 'knowledge']);

/** Per-issue gathered signals — the classifier's entire input. Gathered through read doors, never stores. */
export interface ParkedSignals {
  issueId: string;
  /** All agents (any status) carrying this issue id. */
  agents: AgentState[];
  /** Live (running + liveness-confirmed) agents for this issue. */
  liveAgents: (AgentState & { tmuxActive: boolean })[];
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
function hasCompletedHandoffMarker(agentId: string): boolean {
  const dir = join(getOverdeckHome(), 'agents', agentId);
  return existsSync(join(dir, 'completed')) || existsSync(join(dir, 'completed.processed'));
}

/**
 * Agent rows occasionally carry a bare numeric issue id ("2156") where every
 * other surface keys "PAN-2156" — without normalization the issue loses its
 * review-status row and trip enrichment. Uppercase always; for bare numerics
 * that fail project resolution, retry with the PAN- prefix.
 */
function normalizeParkedIssueId(raw: string): string {
  const upper = raw.trim().toUpperCase();
  if (!/^\d+$/.test(upper)) return upper;
  if (resolveProjectFromIssueSync(upper)) return upper;
  return `PAN-${upper}`;
}

/**
 * Classify one issue's parked orbits from gathered signals. Pure — unit-tested
 * with fixtures. Emits at most one row per orbit; an issue may legitimately
 * occupy several orbits at once (e.g. an operator-stopped agent AND a live
 * idle one). idle-running is only emitted when no other orbit already explains
 * the stall — it is the orbit of last resort ("live but leaderless").
 */
export function classifyParked(s: ParkedSignals): ParkedRow[] {
  const rows: ParkedRow[] = [];
  const issueId = s.issueId;
  const push = (orbit: ParkedOrbit, parkedAt: string, parkReason: string, unparkCondition: string, details?: Record<string, unknown>) => {
    rows.push({ issueId, orbit, parkedAt, parkReason, unparkCondition, ...(details ? { details } : {}) });
  };

  // Terminal issues are never parked — they are residue. A closed issue can
  // only produce zombie-session rows (a live agent to reap); every other orbit
  // is moot once the issue is done. issueClosed === null means "unknown" — the
  // gather resolves it for row-producing issues and re-classifies (pass 2).
  const closed = s.issueClosed === true;

  // 1. operator-gate — operator-set resume gates on this issue's agents,
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

  // 2. zombie-session — live agent whose issue is already closed
  for (const agent of s.liveAgents) {
    if (s.issueClosed !== true) continue;
    push(
      'zombie-session',
      isoOr(agent.lastActivity ?? agent.startedAt, s.now),
      `${agent.id} is still running but the issue is closed — it holds a session and a concurrency slot for nothing`,
      'reap the session through the established merged-zombie teardown door',
      { agentId: agent.id },
    );
  }

  // 3. idle-running — live agent, no pipeline owner, idle beyond threshold, and
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
  /** Tracker-closed check (defaults to isIssueClosed). Only called for live-agent candidates. */
  isClosed?: (issueId: string) => Promise<boolean>;
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
  const isClosed = options.isClosed ?? isIssueClosed;

  const allAgents = listAgentStates();
  // PAN-3849 (W32): "live" is the liveness oracle's verdict (session + live
  // pane + harness process in the pane subtree), not the batch tmux listing —
  // a remain-on-exit zombie pane no longer counts as a live agent. The oracle
  // replaces the tmuxActive check, NOT the status gate: a stopped/error agent
  // with a live session is resumable residue, not a running agent, and must
  // not mint zombie-session/idle-running rows. A failed probe
  // (runtime-indeterminate) counts as live — never park an issue out from
  // under an agent the probe could not observe.
  const liveAgents = listRunningAgentsSync().filter((a) => (a.status === 'running' || a.status === 'starting') && !isConfirmedDead(isAliveSync(a.id)));

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

  const candidateIds = new Set<string>([...agentsByIssue.keys(), ...liveByIssue.keys()]);

  // Pass 1: classify with closedness unknown (null) except where a live agent
  // makes the tracker call worth making (zombie detection).
  // Pass 2: for every issue that PRODUCED a row, resolve tracker-closed
  // (TTL-cached) and re-classify — a closed issue keeps only its
  // zombie-session rows; every other orbit is moot residue.
  const closedByIssue = new Map<string, boolean>();
  const classifyOne = async (issueId: string): Promise<ParkedRow[]> => {
    const live = liveByIssue.get(issueId) ?? [];
    let issueClosed = closedByIssue.get(issueId) ?? null;
    if (issueClosed === null && live.length > 0) {
      try { issueClosed = await isClosed(issueId); closedByIssue.set(issueId, issueClosed); } catch { issueClosed = null; }
    }
    return classifyParked({
      issueId,
      agents: agentsByIssue.get(issueId) ?? [],
      liveAgents: live,
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
