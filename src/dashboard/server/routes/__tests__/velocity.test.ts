/**
 * Fixture tests for the velocity transition counter (PAN-3491).
 *
 * PAN-3917: the counter reads events that record something that HAPPENED — a
 * reviewer started, a review landed, a merge became ready — instead of
 * re-derived status tuples. The PAN-3447 regression (88 `review.status_changed`
 * writes for ~6 real transitions) cannot recur, because an unchanged write is
 * not an event any more; what these cases pin is that each act counts once and
 * buckets to the right stage.
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

describe('computeTransitions', () => {
  it('counts each review act once and buckets it to review', () => {
    const events = [
      event('review.reviewer_started', { issueId: 'PAN-1' }, IN(50)),
      event('review.reviewer_started', { issueId: 'PAN-1' }, IN(45)),
      event('review.approved', { issueId: 'PAN-1' }, IN(20)),
      event('merge.ready', { issueId: 'PAN-1' }, IN(5)),
    ];
    const { transitions, byStage } = computeTransitions(events, WINDOW_START, NOW);
    expect(transitions).toBe(4);
    expect(byStage).toEqual({ plan: 0, work: 0, review: 3, merge: 1 });
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

  it('events outside the window never count', () => {
    const events = [
      event('review.approved', { issueId: 'PAN-2' }, OUT(75)),
      event('merge.ready', { issueId: 'PAN-2' }, OUT(90)),
    ];
    const { transitions } = computeTransitions(events, WINDOW_START, NOW);
    expect(transitions).toBe(0);
  });

  it('ignores event types that record no stage movement', () => {
    const events = [
      event('agent.output_received', { agentId: 'agent-pan-4' }, IN(30)),
      event('issue.transitioned', { issueId: 'PAN-4', state: 'backlog' }, IN(25)),
      event('issue.statusChanged', { issueId: 'PAN-4', status: 'To Do' }, IN(20)),
    ];
    const { transitions, byStage } = computeTransitions(events, WINDOW_START, NOW);
    expect(transitions).toBe(0);
    expect(byStage).toEqual({ plan: 0, work: 0, review: 0, merge: 0 });
  });
});
