import { describe, expect, it } from 'vitest';
import { evaluateReviewConvoyLiveness } from '../review-convoy-liveness.js';

const now = Date.parse('2026-07-15T16:00:00.000Z');

describe('evaluateReviewConvoyLiveness', () => {
  it('expires a numeric epoch-millis review timestamp', () => {
    const result = evaluateReviewConvoyLiveness('PAN-2735', {
      reviewSpawnedAt: now - 46 * 60 * 1000,
      updatedAt: '2026-07-15T15:59:00.000Z',
    }, [{
      id: 'agent-pan-2735-review',
      issueId: 'PAN-2735',
      role: 'review',
      status: 'running',
      lastActivity: '2026-07-15T15:59:00.000Z',
    }], now);

    expect(result).toEqual({ active: false, reason: 'review watchdog expired' });
  });

  it('treats a stopped coordinator as authoritative over running sub-reviewers', () => {
    const result = evaluateReviewConvoyLiveness('PAN-2735', {
      reviewSpawnedAt: '2026-07-15T15:55:00.000Z',
      updatedAt: '2026-07-15T15:55:00.000Z',
    }, [
      { id: 'agent-pan-2735-review', issueId: 'PAN-2735', role: 'review', status: 'stopped' },
      { id: 'agent-pan-2735-review-security', issueId: 'PAN-2735', role: 'review', status: 'running' },
    ], now);

    expect(result).toEqual({ active: false, reason: 'coordinator stopped' });
  });
});
