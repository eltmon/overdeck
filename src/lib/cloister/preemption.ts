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


import { getPrFacts, type PrFacts } from './pr-facts.js';

import {
  clearYieldForResume,
  listAgentStates,
  resumeAgent,
  type AgentState,
} from '../agents.js';
import { emitActivityEntry } from '../activity-logger.js';
import { logDeaconEvent } from '../persistent-logger.js';
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
 * A running work agent considered for yielding, with its precomputed
 * eligibility signals.
 */
export interface YieldCandidate {
  id: string;
  issueId: string;
  /** `isIdle` — only idle agents may be yielded (never preempt active work). */
  idle: boolean;
  /** An operator is attached to the tmux session — never yield out from under a human. */
  attached: boolean;
  /** Already paused (operator pause or a prior yield) — not a fresh victim. */
  paused: boolean;
  /**
   * The agent's own issue is blocked on the pipeline (review pending or
   * reviewing) — it is waiting anyway, so prefer it as a victim (FR-2a).
   */
  reviewBlocked: boolean;
  /** `lastActivity` epoch ms for longest-idle ordering (ascending). Null ⇒ treated as oldest. */
  lastActivityMs: number | null;
  /** `lastYieldResumeAt` epoch ms for the re-yield cooldown. Null ⇒ never yielded. */
  lastYieldResumeMs: number | null;
}

function parseMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
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
      logDeaconEvent(
        `[preemption] resumeYieldedAgents: memory gate (${memVerdict.band}), availMB=${Math.round(memVerdict.availableBytes / 1048576)}`
        + `${memVerdict.loadPerCore == null ? '' : `, load/core=${memVerdict.loadPerCore.toFixed(2)}`}; deferring remaining yielded agents`,
      );
      break;
    }

    // Let the previous resume's RSS register before the next memory check.
    if (resumed.length > 0) {
      await new Promise((r) => setTimeout(r, RSS_SETTLE_MS));
    }

    clearYieldForResume(agent.id);
    const result = await resumeAgent(agent.id);
    if (result.success) {
      resumed.push(agent.id);
      const message = `Resumed yielded ${agent.id} for ${agent.issueId} — capacity returned`;
      logDeaconEvent(`[preemption] ${message}`);
      emitActivityEntry({ source: 'cloister', level: 'info', message, issueId: agent.issueId });
    } else {
      // The pause is already cleared, so the normal auto-resume path will retry
      // this agent on a later patrol like any other stopped work agent.
      logDeaconEvent(`[preemption] resumeYieldedAgents: resume failed for ${agent.id}: ${result.error ?? 'unknown'}`);
    }
  }
  return resumed;
}

/**
 * Is this idle agent waiting on the pipeline rather than stalled? (PAN-2581,
 * re-pointed by PAN-3917.)
 *
 * The health check's poke loop must never ask "are you stuck?" of an agent
 * that is legitimately waiting: a work agent that has opened its PR and is
 * waiting on review, or a review/test agent between phases. A poke there spends
 * tokens re-explaining the wait, and the idle-alive pause that follows it
 * manufactures the paused-delivery-target deadlock PAN-2461 exists to undo.
 *
 * This used to read the issue's review row — `reviewing`, `passed`, or
 * `pending` with a `reviewRequestedAt` stamp, plus the owed-rework states. The
 * pull request says the same thing without a row: a work/review/test agent
 * whose issue has a PR at all is inside the pipeline, and the pipeline, not a
 * poke, is what moves it. Roles outside work/review/test keep their ordinary
 * idleness semantics.
 */
export async function shouldSkipIdlePokeForAgent(
  agent: Pick<AgentState, 'id' | 'issueId' | 'role'> | null,
  readFacts: (issueId: string) => Promise<PrFacts> = getPrFacts,
): Promise<boolean> {
  if (!agent) return false;
  if (agent.role !== 'work' && agent.role !== 'review' && agent.role !== 'test') return false;
  const issueId = (agent.issueId
    || agent.id.replace(/^agent-/, '').replace(/-(review|test|ship)(-.*)?$/, '').replace(/-slot-\d+$/, '')
  ).toUpperCase();
  const facts = await readFacts(issueId).catch(() => null);
  return facts?.exists === true && !facts.merged;
}
