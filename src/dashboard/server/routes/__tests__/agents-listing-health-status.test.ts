/**
 * PAN-3070 — GET /api/agents reported `status: healthy` for any agent with a
 * live tmux session, including one frozen for hours on an unanswered
 * tool-permission prompt. The Decisions surface called the same agent
 * "NEEDS YOU — Permission pending" at the same moment; an operator scanning for
 * trouble saw `healthy` and moved on.
 */
import { describe, expect, it } from 'vitest';
import { liveAgentHealthStatus } from '../agents/listing.js';

describe('liveAgentHealthStatus', () => {
  it('does NOT report an agent parked on a permission prompt as healthy', () => {
    expect(liveAgentHealthStatus({
      hasPendingQuestion: true,
      pendingQuestionReason: 'tool_permission',
    })).toBe('warning');
  });

  it('flags every other answerable blocking prompt too', () => {
    for (const reason of ['user_question', 'session_resume', 'rate_limit', 'planning_done']) {
      expect(liveAgentHealthStatus({ hasPendingQuestion: true, pendingQuestionReason: reason })).toBe('warning');
    }
  });

  it('reports a working agent as healthy', () => {
    expect(liveAgentHealthStatus({ hasPendingQuestion: false })).toBe('healthy');
  });

  // PAN-1591 — the generic `other` fallback carries no answerable prompt, so it
  // must not drag working agents into the warning bucket.
  it('reports the generic `other` fallback as healthy', () => {
    expect(liveAgentHealthStatus({ hasPendingQuestion: true, pendingQuestionReason: 'other' })).toBe('healthy');
  });
});
