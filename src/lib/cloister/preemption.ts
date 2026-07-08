/**
 * PAN-2507: preemptive pipeline scheduler.
 *
 * When a review/test/merge ("advancing") dispatch cannot reserve capacity, the
 * deacon normally defers to the next patrol — indefinitely if idle work agents
 * hold the box. This module is the single owner of the YIELD mechanic: it pauses
 * an idle work agent (resumable — session killed, state preserved) to free the
 * slot/memory, so the advancing dispatch can proceed, and resumes yielded agents
 * oldest-first once capacity returns.
 *
 * Priority is fixed (higher preempts lower, never the reverse):
 *   merge/ship > test > review > work-rework > work-new.
 * Preemption only flows DOWN this list — an advancing dispatch may yield a work
 * agent; new work never preempts anything; advancing roles never preempt each
 * other.
 *
 * Opt-in: gated on `[concurrency] preemption = true` in cloister.toml. Default
 * off ⇒ every entry point is a no-op and the dispatch sites keep their existing
 * defer-until-attrition behavior (PAN-2507 AC-1).
 *
 * All tmux interaction here goes through async primitives (NFR-1): the yield stop
 * uses the async `stopAgent` Effect, and attach-detection reads the async
 * `listSessions()`.
 */

import { Effect } from 'effect';

import {
  clearYieldForResumeSync,
  listAgentStates,
  listRunningAgentsSync,
  resumeAgent,
  setAgentYieldedSync,
  stopAgent,
  type AgentState,
} from '../agents.js';
import { getReviewStatusSync } from '../review-status.js';
import { listSessions } from '../tmux.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { logDeaconEventSync } from '../persistent-logger.js';
import { loadCloisterConfigSync } from './config.js';
import { isAgentIdleForNudge } from './agent-idle.js';
import { assessMemoryPressure } from './memory-governor.js';

/** RSS settle window after a resume before the next memory re-assessment (mirrors deacon-auto-resume). */
const RSS_SETTLE_MS = 2000;

export type AdvancingRole = 'review' | 'test' | 'ship';

export interface YieldOutcome {
  yielded: boolean;
  victimId?: string;
  reason?: string;
}

/**
 * A running work agent considered for yielding. Carries the precomputed
 * eligibility signals so `selectYieldVictim` is pure and unit-testable.
 */
export interface YieldCandidate {
  id: string;
  issueId: string;
  /** `isAgentIdleForNudge` — only idle agents may be yielded (never preempt active work). */
  idle: boolean;
  /** An operator is attached to the tmux session — never yield out from under a human. */
  attached: boolean;
  /** Already paused (operator pause or a prior yield) — not a fresh victim. */
  paused: boolean;
  /**
   * The agent's own issue is blocked on the pipeline (reviewStatus pending or
   * reviewing) — it is waiting anyway, so prefer it as a victim (FR-2a).
   */
  reviewBlocked: boolean;
  /** `lastActivity` epoch ms for longest-idle ordering (ascending). Null ⇒ treated as oldest. */
  lastActivityMs: number | null;
  /** `lastYieldResumeAt` epoch ms for the re-yield cooldown. Null ⇒ never yielded. */
  lastYieldResumeMs: number | null;
}

/**
 * FR-2 predicate + ordering, pure. Returns the best victim or null.
 *
 * Excludes any agent that is not idle, is operator-attached, is already paused,
 * or is inside its post-resume re-yield cooldown. Among the eligible, prefers
 * (a) an agent blocked on its own review, then (b) the longest-idle
 * (`lastActivity` ascending).
 */
export function selectYieldVictim(
  candidates: readonly YieldCandidate[],
  nowMs: number,
  cooldownSecs: number,
): YieldCandidate | null {
  const cooldownMs = cooldownSecs * 1000;
  const eligible = candidates.filter((c) => {
    if (!c.idle) return false;
    if (c.attached) return false;
    if (c.paused) return false;
    if (c.lastYieldResumeMs !== null && nowMs - c.lastYieldResumeMs < cooldownMs) return false;
    return true;
  });
  if (eligible.length === 0) return null;

  const ordered = [...eligible].sort((a, b) => {
    // (a) prefer pipeline-blocked agents
    if (a.reviewBlocked !== b.reviewBlocked) return a.reviewBlocked ? -1 : 1;
    // (b) then longest-idle first (oldest lastActivity)
    return (a.lastActivityMs ?? 0) - (b.lastActivityMs ?? 0);
  });
  return ordered[0];
}

function reviewBlockedFor(issueId: string): boolean {
  const status = getReviewStatusSync(issueId)?.reviewStatus;
  // PAN-2507 (FR-2a): the enum has no `in_progress`; the faithful "waiting on
  // its own review" states are `pending` (queued) and `reviewing` (running).
  return status === 'pending' || status === 'reviewing';
}

function parseMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

async function buildCandidates(): Promise<YieldCandidate[]> {
  const sessions = await Effect.runPromise(listSessions());
  const attached = new Set(sessions.filter((s) => s.attached).map((s) => s.name));

  return listRunningAgentsSync()
    .filter((s) => s.role === 'work' && s.status === 'running')
    .map((s) => ({
      id: s.id,
      issueId: s.issueId,
      idle: isAgentIdleForNudge(s.id),
      attached: attached.has(s.id),
      paused: s.paused === true,
      reviewBlocked: reviewBlockedFor(s.issueId),
      lastActivityMs: parseMs(s.lastActivity),
      lastYieldResumeMs: parseMs(s.lastYieldResumeAt),
    }));
}

function countYielded(): number {
  return listAgentStates().filter((s: AgentState) => s.yieldedByScheduler === true).length;
}

/**
 * FR-1 flow: try to yield an idle work agent to free capacity for an advancing
 * dispatch of `role` for `issueId`. Pauses the victim with scheduler attribution
 * and stops its session (async). The caller re-attempts its reservation after a
 * true outcome; on FR-6c (retry still fails) the caller is responsible for
 * resuming the victim immediately — see the wire-site pattern.
 *
 * No-op (returns `{ yielded: false }`) when preemption is disabled, the
 * `max_yielded` cap is reached, or no eligible victim exists.
 */
export async function yieldWorkAgentFor(role: AdvancingRole, issueId: string): Promise<YieldOutcome> {
  const concurrency = loadCloisterConfigSync().concurrency;
  if (concurrency?.preemption !== true) return { yielded: false, reason: 'preemption disabled' };

  const maxYielded = concurrency.max_yielded ?? 3;
  const cooldownSecs = concurrency.yield_cooldown_secs ?? 600;

  const alreadyYielded = countYielded();
  if (alreadyYielded >= maxYielded) {
    return { yielded: false, reason: `max_yielded reached (${alreadyYielded}/${maxYielded})` };
  }

  const nowMs = Date.now();
  const candidates = await buildCandidates();
  const victim = selectYieldVictim(candidates, nowMs, cooldownSecs);
  if (!victim) return { yielded: false, reason: 'no eligible idle work agent to yield' };

  const reason = `yield: making room for ${role} of ${issueId}`;
  if (!setAgentYieldedSync(victim.id, reason)) {
    return { yielded: false, reason: `victim ${victim.id} state vanished before yield` };
  }
  await Effect.runPromise(stopAgent(victim.id));

  const idleMinutes = victim.lastActivityMs !== null ? Math.round((nowMs - victim.lastActivityMs) / 60000) : null;
  const idleDesc = idleMinutes !== null ? ` (idle ${idleMinutes}m)` : '';
  const message = `Yielded ${victim.id}${idleDesc} to run ${role} for ${issueId}`;
  logDeaconEventSync(`[preemption] ${message}`);
  emitActivityEntrySync({ source: 'cloister', level: 'info', message, issueId });

  return { yielded: true, victimId: victim.id, reason: message };
}

/**
 * Immediately resume a victim after a failed reservation retry (FR-6c): the
 * yield freed capacity but the advancing dispatch still could not reserve it, so
 * put the work agent back rather than leaving it stranded.
 */
export async function resumeYieldedVictim(agentId: string): Promise<void> {
  clearYieldForResumeSync(agentId);
  const result = await resumeAgent(agentId);
  const suffix = result.success ? 'resumed' : `resume failed: ${result.error ?? 'unknown'}`;
  logDeaconEventSync(`[preemption] Yield retry still blocked — ${agentId} ${suffix}`);
}

/**
 * FR-4: resume yielded work agents oldest-first, up to `maxToResume`, while the
 * memory gate allows. Clears the pause + yield attribution and stamps the
 * re-yield cooldown before each resume. Returns the ids actually resumed.
 *
 * Deliberately NOT gated on `preemption` — a previously-yielded agent must be
 * resumable even if the operator has since turned preemption off, so it is never
 * stranded paused.
 */
export async function resumeYieldedAgents(maxToResume: number): Promise<string[]> {
  if (maxToResume <= 0) return [];

  const yielded = listAgentStates({ status: 'stopped', role: 'work' })
    .filter((s) => s.yieldedByScheduler === true)
    .sort((a, b) => (parseMs(a.yieldedAt) ?? 0) - (parseMs(b.yieldedAt) ?? 0));
  if (yielded.length === 0) return [];

  const resumed: string[] = [];
  for (const agent of yielded) {
    if (resumed.length >= maxToResume) break;

    const memVerdict = await assessMemoryPressure();
    if (memVerdict.band !== 'ok') {
      logDeaconEventSync(
        `[preemption] resumeYieldedAgents: memory gate (${memVerdict.band}); deferring remaining yielded agents`,
      );
      break;
    }

    // Let the previous resume's RSS register before the next memory check.
    if (resumed.length > 0) {
      await new Promise((r) => setTimeout(r, RSS_SETTLE_MS));
    }

    clearYieldForResumeSync(agent.id);
    const result = await resumeAgent(agent.id);
    if (result.success) {
      resumed.push(agent.id);
      const message = `Resumed yielded ${agent.id} for ${agent.issueId} — capacity returned`;
      logDeaconEventSync(`[preemption] ${message}`);
      emitActivityEntrySync({ source: 'cloister', level: 'info', message, issueId: agent.issueId });
    } else {
      // The pause is already cleared, so the normal auto-resume path will retry
      // this agent on a later patrol like any other stopped work agent.
      logDeaconEventSync(`[preemption] resumeYieldedAgents: resume failed for ${agent.id}: ${result.error ?? 'unknown'}`);
    }
  }
  return resumed;
}
