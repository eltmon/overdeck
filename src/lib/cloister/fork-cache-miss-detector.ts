/**
 * PAN-1862: Fork cache-miss detector for the discovery-fork convoy.
 *
 * After the parent synthesis agent forks its session into reviewer sub-role
 * sessions, each forked reviewer should begin with a cache-warm first request
 * (cacheRead > 0 from the inherited prompt-cache). A miss means the forking
 * happened outside the 5-minute prompt-cache TTL, or the fork itself failed
 * to inherit the cache context.
 *
 * Only applicable to claude-code forked reviewers. Pi/Codex reviewers are
 * spawned independently (no fork) so cache-miss detection doesn't apply
 * (decision D9).
 */

import { queryCostEvents } from '../database/cost-events-db.js';

/** Prompt-cache TTL in milliseconds (5 minutes). */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Gap threshold for the proactive timing heuristic.
 * At 270 s (4.5 min), the cache is approaching its 5-min TTL — flag early
 * so the operator has a window to act before the TTL expires.
 */
const PROACTIVE_MISS_THRESHOLD_MS = 270 * 1000;

export type CacheMissReason =
  /** First request had cacheRead == 0 where a warm hit was expected */
  | 'first_request_cache_miss'
  /** discovery→launch gap is approaching the 5-min prompt-cache TTL */
  | 'timing_likely_miss';

export interface ForkCacheMissOutcome {
  /** Whether a cache miss was detected or is likely. */
  detected: boolean;
  /** Reasons for the miss (may contain multiple signals). */
  reasons: CacheMissReason[];
  /** Human-readable description for logs and notifications. */
  detail: string;
}

/**
 * Check whether the harness is a claude-code fork (the only harness for which
 * fork-cache detection is meaningful — decision D9).
 */
function isClaudeCodeHarness(harness: string): boolean {
  return harness === 'claude-code';
}

/**
 * Read the first cost event for a given agentId from the DB and determine
 * whether its cacheRead == 0 (expected warm hit → actual miss).
 *
 * Returns `null` when no cost events are recorded yet for the agent
 * (the forked session hasn't made its first request).
 */
export function checkFirstRequestCacheMiss(agentId: string): boolean | null {
  const events = queryCostEvents({ agentId, limit: 1 });
  if (events.length === 0) return null;
  return events[0].cacheRead === 0;
}

/**
 * Check whether the gap between discoveryReadyAt and convoyLaunchedAt is
 * approaching the 5-minute prompt-cache TTL.
 *
 * @param discoveryReadyAt  ISO timestamp when the synthesis agent signalled discovery-ready
 * @param convoyLaunchedAt  ISO timestamp when the convoy fork was dispatched
 */
export function checkTimingLikelyMiss(discoveryReadyAt: string, convoyLaunchedAt: string): boolean {
  const gapMs = new Date(convoyLaunchedAt).getTime() - new Date(discoveryReadyAt).getTime();
  return gapMs >= PROACTIVE_MISS_THRESHOLD_MS;
}

/**
 * Combined detector: check first-request cache miss and/or timing heuristic.
 *
 * @param agentId            Reviewer agent ID (e.g. 'agent-pan-1862-review-security')
 * @param harness            Harness the agent is running on ('claude-code' | 'pi' | 'codex')
 * @param discoveryReadyAt   ISO timestamp from parent agent state (optional)
 * @param convoyLaunchedAt   ISO timestamp from parent agent state (optional)
 */
export function detectForkCacheMiss(
  agentId: string,
  harness: string,
  discoveryReadyAt?: string,
  convoyLaunchedAt?: string,
): ForkCacheMissOutcome {
  // Non-claude-code harnesses never fork — no detection applicable.
  if (!isClaudeCodeHarness(harness)) {
    return { detected: false, reasons: [], detail: `${agentId}: non-forked harness (${harness}), cache-miss detection not applicable` };
  }

  const reasons: CacheMissReason[] = [];

  // Signal 1: first-request cacheRead check.
  const firstRequestMiss = checkFirstRequestCacheMiss(agentId);
  if (firstRequestMiss === true) {
    reasons.push('first_request_cache_miss');
  }

  // Signal 2: proactive timing heuristic.
  if (discoveryReadyAt && convoyLaunchedAt) {
    if (checkTimingLikelyMiss(discoveryReadyAt, convoyLaunchedAt)) {
      reasons.push('timing_likely_miss');
    }
  }

  const detected = reasons.length > 0;
  const detail = detected
    ? `${agentId}: cache miss detected — ${reasons.join(', ')}. Prompt-cache TTL is 5 min; gap ≥270 s or cacheRead=0 on first request.`
    : firstRequestMiss === null
      ? `${agentId}: no cost events yet, cache-miss status unknown`
      : `${agentId}: cache warm (cacheRead > 0)`;

  return { detected, reasons, detail };
}

/** Prompt-cache TTL constant — exported for tests. */
export { CACHE_TTL_MS, PROACTIVE_MISS_THRESHOLD_MS };
