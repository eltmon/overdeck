/**
 * Pipeline velocity (PAN-3485 phase 6 / PAN-3491).
 *
 * The dashboard's visible signals measure agent tool-call rate, not issue
 * advancement — 34k of 40k daily events are hook noise. This module counts the
 * thing the operator actually means by "is anything moving": real stage
 * transitions per hour, bucketed by stage, alongside the parked census from
 * the one resolver door.
 *
 * PAN-3917: `review.status_changed` is gone with the status door it wrote for.
 * Stage transitions now come from events that survive because they record an
 * ACT, not a stored status: a reviewer starting, a review being approved, a
 * merge becoming ready. `test` and `verify` had no surviving event source and
 * are folded into `review` — gate results are check runs and workspace
 * artifacts now (FR-8), not a counted status write.
 *
 * The pure counter is fixture-tested offline; the Effect wrapper is a thin
 * read through EventStoreService (queryByType only — no new SQL).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { resolveParkedPopulation } from '../../../lib/parked/resolver.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { EventStoreService } from '../services/domain-services.js';

export interface VelocityStageCounts {
  plan: number;
  work: number;
  review: number;
  merge: number;
}

export interface VelocityReport {
  windowMinutes: number;
  transitions: number;
  transitionsPerHour: number;
  byStage: VelocityStageCounts;
  parkedTotal: number | null;
  parkedByOrbit: Record<string, number> | null;
}

interface StoredEventLike {
  sequence: number;
  type: string;
  timestamp: string;
  payload: unknown;
}

function emptyCounts(): VelocityStageCounts {
  return { plan: 0, work: 0, review: 0, merge: 0 };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/**
 * Count real stage transitions inside [windowStartMs, nowMs]. Every counted
 * event records something that happened once, so there is no unchanged-write
 * class left to dedupe against (the PAN-3447 rule is satisfied by the event
 * choice rather than by prior-state tracking).
 */
export function computeTransitions(
  events: readonly StoredEventLike[],
  windowStartMs: number,
  nowMs: number,
): { transitions: number; byStage: VelocityStageCounts } {
  const byStage = emptyCounts();
  let transitions = 0;
  const inWindow = (timestamp: string): boolean => {
    const ms = Date.parse(timestamp);
    return Number.isFinite(ms) && ms >= windowStartMs && ms <= nowMs;
  };

  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);

  for (const event of sorted) {
    if (!inWindow(event.timestamp)) continue;
    const payload = asRecord(event.payload);

    if (event.type === 'issue.transitioned') {
      const state = String(payload['state'] ?? '');
      if (state === 'in_planning') { byStage.plan++; transitions++; }
      else if (state === 'in_progress' || state === 'in_work') { byStage.work++; transitions++; }
      continue;
    }

    if (event.type === 'issue.statusChanged') {
      if (String(payload['status'] ?? '') === 'Planned') { byStage.plan++; transitions++; }
      continue;
    }

    // A reviewer starting and a review landing are each one real act.
    if (event.type === 'review.reviewer_started' || event.type === 'review.approved') {
      byStage.review++; transitions++;
      continue;
    }

    if (event.type === 'merge.ready') {
      byStage.merge++; transitions++;
      continue;
    }
  }

  return { transitions, byStage };
}

const VELOCITY_WINDOW_MINUTES = 60;

const getVelocityRoute = HttpRouter.add(
  'GET',
  '/api/velocity',
  httpHandler(Effect.gen(function* () {
    const eventStore = yield* EventStoreService;
    const now = Date.now();
    const windowStart = now - VELOCITY_WINDOW_MINUTES * 60_000;
    const [transitions, statusChanges, reviewerStarts, approvals, mergeReady] = yield* Effect.all([
      eventStore.queryByType('issue.transitioned', 200),
      eventStore.queryByType('issue.statusChanged', 200),
      eventStore.queryByType('review.reviewer_started', 200),
      eventStore.queryByType('review.approved', 200),
      eventStore.queryByType('merge.ready', 200),
    ]);
    const events = [
      ...transitions, ...statusChanges, ...reviewerStarts, ...approvals, ...mergeReady,
    ] as StoredEventLike[];
    const { transitions: count, byStage } = computeTransitions(events, windowStart, now);

    let parkedTotal: number | null = null;
    let parkedByOrbit: Record<string, number> | null = null;
    try {
      const rows = yield* Effect.promise(() => resolveParkedPopulation());
      parkedTotal = new Set(rows.map((row) => row.issueId)).size;
      parkedByOrbit = {};
      for (const row of rows) parkedByOrbit[row.orbit] = (parkedByOrbit[row.orbit] ?? 0) + 1;
    } catch {
      // Parked resolver failure must never break the velocity read — the
      // honesty contract renders — for the missing slice, not a fabricated zero.
    }

    const report: VelocityReport = {
      windowMinutes: VELOCITY_WINDOW_MINUTES,
      transitions: count,
      transitionsPerHour: Math.round((count / VELOCITY_WINDOW_MINUTES) * 60 * 10) / 10,
      byStage,
      parkedTotal,
      parkedByOrbit,
    };
    return jsonResponse(report);
  })),
);

export const velocityRouteLayer = Layer.mergeAll(getVelocityRoute);

export default velocityRouteLayer;
