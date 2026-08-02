/**
 * Pipeline velocity (PAN-3485 phase 6 / PAN-3491).
 *
 * The dashboard's visible signals measure agent tool-call rate, not issue
 * advancement — 34k of 40k daily events are hook noise, and
 * review.status_changed fires on every status WRITE, not every transition
 * (PAN-3447 logged 88 events for ~6 real changes). This module counts the
 * thing the operator actually means by "is anything moving": real stage
 * transitions per hour, deduped against unchanged writes, bucketed by stage,
 * alongside the parked census from the one resolver door.
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
  test: number;
  verify: number;
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
  return { plan: 0, work: 0, review: 0, test: 0, verify: 0, merge: 0 };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/**
 * Count real stage transitions inside [windowStartMs, nowMs]. Events may
 * include history before the window — that history seeds per-issue prior
 * state so a change that lands INSIDE the window counts even when its "from"
 * side sits outside it. Unchanged writes never count (the PAN-3447 rule).
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

  // Per-issue prior verdict tuple, seeded from history and walked forward.
  const priorByIssue = new Map<string, { review?: string; test?: string; merge?: string }>();
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);

  for (const event of sorted) {
    const payload = asRecord(event.payload);
    const issueId = typeof payload['issueId'] === 'string' ? payload['issueId'] : null;

    if (event.type === 'issue.transitioned') {
      const state = String(payload['state'] ?? '');
      if (inWindow(event.timestamp)) {
        if (state === 'in_planning') { byStage.plan++; transitions++; }
        else if (state === 'in_progress' || state === 'in_work') { byStage.work++; transitions++; }
      }
      continue;
    }

    if (event.type === 'issue.statusChanged') {
      const status = String(payload['status'] ?? '');
      if (inWindow(event.timestamp) && status === 'Planned') { byStage.plan++; transitions++; }
      continue;
    }

    if (event.type !== 'review.status_changed' || !issueId) continue;

    const status = asRecord(payload['status']);
    const review = typeof status['reviewStatus'] === 'string' ? status['reviewStatus'] : undefined;
    const test = typeof status['testStatus'] === 'string' ? status['testStatus'] : undefined;
    const merge = typeof status['mergeStatus'] === 'string' ? status['mergeStatus'] : undefined;
    const prior = priorByIssue.get(issueId) ?? {};
    const changed = inWindow(event.timestamp);

    if (changed && review !== undefined && review !== prior.review) {
      if (review === 'reviewing' || review === 'passed') { byStage.review++; transitions++; }
    }
    if (changed && test !== undefined && test !== prior.test) {
      if (test === 'testing' || test === 'passed') { byStage.test++; transitions++; }
    }
    if (changed && merge !== undefined && merge !== prior.merge) {
      if (merge === 'verifying') { byStage.verify++; transitions++; }
      else if (merge === 'merging' || merge === 'queued' || merge === 'merged') { byStage.merge++; transitions++; }
    }
    priorByIssue.set(issueId, {
      ...(review !== undefined ? { review } : prior.review !== undefined ? { review: prior.review } : {}),
      ...(test !== undefined ? { test } : prior.test !== undefined ? { test: prior.test } : {}),
      ...(merge !== undefined ? { merge } : prior.merge !== undefined ? { merge: prior.merge } : {}),
    });
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
    // Pull enough of each type to seed per-issue prior state beyond the window;
    // review.status_changed is the high-volume one (~100/hour fleet-wide).
    const [transitions, statusChanges, reviewChanges] = yield* Effect.all([
      eventStore.queryByType('issue.transitioned', 200),
      eventStore.queryByType('issue.statusChanged', 200),
      eventStore.queryByType('review.status_changed', 500),
    ]);
    const events = [...transitions, ...statusChanges, ...reviewChanges] as StoredEventLike[];
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
