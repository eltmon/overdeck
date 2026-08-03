/**
 * Fixture tests for the velocity transition counter (PAN-3491).
 * The regression shape: PAN-3447's 88 review.status_changed events for ~6
 * real transitions — unchanged writes must never count as movement.
 */
import { describe, expect, it } from 'vitest';
import { computeTransitions } from '../velocity.js';

const NOW = Date.parse('2026-08-02T14:00:00.000Z');
const WINDOW_START = NOW - 60 * 60_000;

let sequence = 0;
function event(type: string, payload: Record<string, unknown>, isoTimestamp: string): { sequence: number; type: string; timestamp: string; payload: unknown } {
  sequence += 1;
  return { sequence, type, timestamp: isoTimestamp, payload };
}

const IN = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const OUT = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

function reviewChanged(issueId: string, reviewStatus: string, testStatus: string, mergeStatus: string, iso: string) {
  return event('review.status_changed', { issueId, status: { issueId, reviewStatus, testStatus, mergeStatus } }, iso);
}

describe('computeTransitions', () => {
  it('counts only real verdict changes inside the window', () => {
    const events = [
      // History: PAN-1 was reviewing before the window (seeds prior state).
      reviewChanged('PAN-1', 'reviewing', 'pending', 'pending', OUT(90)),
      // Inside: review passed (counts), then identical writes (do not).
      reviewChanged('PAN-1', 'passed', 'pending', 'pending', IN(50)),
      reviewChanged('PAN-1', 'passed', 'pending', 'pending', IN(45)),
      reviewChanged('PAN-1', 'passed', 'pending', 'pending', IN(40)),
      // test starts + passes (two transitions).
      reviewChanged('PAN-1', 'passed', 'testing', 'pending', IN(30)),
      reviewChanged('PAN-1', 'passed', 'passed', 'pending', IN(20)),
      // merge verifying + merged (verify + merge buckets).
      reviewChanged('PAN-1', 'passed', 'passed', 'verifying', IN(10)),
      reviewChanged('PAN-1', 'passed', 'passed', 'merged', IN(5)),
    ];
    const { transitions, byStage } = computeTransitions(events, WINDOW_START, NOW);
    expect(transitions).toBe(5);
    expect(byStage).toEqual({ plan: 0, work: 0, review: 1, test: 2, verify: 1, merge: 1 });
  });

  it('the PAN-3447 shape: 88 writes, 6 transitions', () => {
    const events = [
      reviewChanged('PAN-3447', 'pending', 'pending', 'pending', OUT(200)),
      reviewChanged('PAN-3447', 'reviewing', 'pending', 'pending', IN(59)),
      ...Array.from({ length: 40 }, (_, index) => reviewChanged('PAN-3447', 'reviewing', 'pending', 'pending', IN(58 - index))),
      reviewChanged('PAN-3447', 'passed', 'pending', 'pending', IN(15)),
      ...Array.from({ length: 40 }, (_, index) => reviewChanged('PAN-3447', 'passed', 'pending', 'pending', IN(14 - index * 0.2))),
      reviewChanged('PAN-3447', 'passed', 'passed', 'merged', IN(2)),
    ];
    const { transitions, byStage } = computeTransitions(events, WINDOW_START, NOW);
    // review×2 (pending→reviewing→passed) + test×1 + merge×1 — the 84
    // unchanged writes between them count for nothing.
    expect(transitions).toBe(4);
    expect(byStage.review).toBe(2);
    expect(byStage.test).toBe(1);
    expect(byStage.merge).toBe(1);
  });

  it('planning and tracker transitions bucket to plan/work', () => {
    const events = [
      event('issue.transitioned', { issueId: 'PAN-9', state: 'in_planning' }, IN(55)),
      event('issue.statusChanged', { issueId: 'PAN-9', status: 'Planned' }, IN(50)),
      event('issue.transitioned', { issueId: 'PAN-9', state: 'in_progress' }, IN(45)),
    ];
    const { transitions, byStage } = computeTransitions(events, WINDOW_START, NOW);
    expect(transitions).toBe(3);
    expect(byStage.plan).toBe(2);
    expect(byStage.work).toBe(1);
  });

  it('events outside the window seed state but never count', () => {
    const events = [
      reviewChanged('PAN-2', 'reviewing', 'pending', 'pending', OUT(75)),
      // Same tuple re-written inside the window — zero movement.
      reviewChanged('PAN-2', 'reviewing', 'pending', 'pending', IN(30)),
    ];
    const { transitions } = computeTransitions(events, WINDOW_START, NOW);
    expect(transitions).toBe(0);
  });

  it('a transition whose "from" side is missing counts on first sight inside the window', () => {
    // Cold start: no history for PAN-3 — its first in-window event establishes
    // the tuple AND counts if it is itself an advancing verdict.
    const events = [reviewChanged('PAN-3', 'passed', 'pending', 'pending', IN(20))];
    const { transitions, byStage } = computeTransitions(events, WINDOW_START, NOW);
    expect(transitions).toBe(1);
    expect(byStage.review).toBe(1);
  });
});
