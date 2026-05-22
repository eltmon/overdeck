/**
 * Tests for PAN-366: queue position utilities.
 *
 * Coverage:
 *  - computeQueuePositionFromStatus: reviewing/testing/merging → pos=0, null status → null
 *  - findPositionInQueue: found/not-found, case-insensitive
 *
 * Note: ordinal formatting is tested via InspectorPanel.test.tsx (getReviewButtonState),
 * as the ordinal helpers live inside InspectorPanel.tsx for frontend-only use.
 */

import { describe, it, expect } from 'vitest';
import {
  computeQueuePositionFromStatusSync,
  findPositionInQueueSync,
  SPECIALIST_ACTIVE_POSITION,
} from '../../../src/lib/queue-position.js';
import type { HookItem } from '../../../src/lib/hooks.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(issueId: string, idx = 0): HookItem {
  return {
    id: `item-${idx}`,
    type: 'task',
    priority: 'normal',
    source: 'test',
    payload: { issueId },
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// computeQueuePositionFromStatus
// ---------------------------------------------------------------------------

describe('computeQueuePositionFromStatus', () => {
  it('returns active position when reviewStatus is reviewing', () => {
    const result = computeQueuePositionFromStatusSync({
      reviewStatus: 'reviewing',
      testStatus: 'pending',
    });
    expect(result.queuePosition).toBe(SPECIALIST_ACTIVE_POSITION);
    expect(result.activeSpecialist).toBe('review');
  });

  it('returns active position when testStatus is testing', () => {
    const result = computeQueuePositionFromStatusSync({
      reviewStatus: 'passed',
      testStatus: 'testing',
    });
    expect(result.queuePosition).toBe(SPECIALIST_ACTIVE_POSITION);
    expect(result.activeSpecialist).toBe('test');
  });

  it('returns active position when mergeStatus is merging', () => {
    const result = computeQueuePositionFromStatusSync({
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'merging',
    });
    expect(result.queuePosition).toBe(SPECIALIST_ACTIVE_POSITION);
    expect(result.activeSpecialist).toBe('merge');
  });

  it('returns null when all statuses are idle/done', () => {
    const result = computeQueuePositionFromStatusSync({
      reviewStatus: 'pending',
      testStatus: 'pending',
    });
    expect(result.queuePosition).toBeNull();
    expect(result.activeSpecialist).toBeNull();
  });

  it('returns null for null status', () => {
    const result = computeQueuePositionFromStatusSync(null);
    expect(result.queuePosition).toBeNull();
    expect(result.activeSpecialist).toBeNull();
  });

  it('reviewing takes precedence when both reviewing and testing are set', () => {
    const result = computeQueuePositionFromStatusSync({
      reviewStatus: 'reviewing',
      testStatus: 'testing',
    });
    expect(result.activeSpecialist).toBe('review');
  });
});

// ---------------------------------------------------------------------------
// findPositionInQueue
// ---------------------------------------------------------------------------

describe('findPositionInQueue', () => {
  it('returns 1-based position when issueId is found', () => {
    const items: HookItem[] = [
      makeItem('PAN-100', 0),
      makeItem('PAN-200', 1),
      makeItem('PAN-366', 2),
    ];
    expect(findPositionInQueueSync('PAN-366', items)).toBe(3);
  });

  it('returns 1 when issueId is first in queue', () => {
    const items: HookItem[] = [makeItem('PAN-366'), makeItem('PAN-200')];
    expect(findPositionInQueueSync('PAN-366', items)).toBe(1);
  });

  it('returns -1 when issueId is not in queue', () => {
    const items: HookItem[] = [makeItem('PAN-100'), makeItem('PAN-200')];
    expect(findPositionInQueueSync('PAN-366', items)).toBe(-1);
  });

  it('is case-insensitive', () => {
    const items: HookItem[] = [makeItem('pan-366')];
    expect(findPositionInQueueSync('PAN-366', items)).toBe(1);
    expect(findPositionInQueueSync('pan-366', items)).toBe(1);
  });

  it('returns -1 for empty queue', () => {
    expect(findPositionInQueueSync('PAN-366', [])).toBe(-1);
  });

  it('handles items with no issueId in payload', () => {
    const items: HookItem[] = [
      { id: 'x', type: 'task', priority: 'normal', source: 'test', payload: {}, createdAt: '' },
      makeItem('PAN-366'),
    ];
    expect(findPositionInQueueSync('PAN-366', items)).toBe(2);
  });
});
