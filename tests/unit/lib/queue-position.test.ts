/**
 * Tests for PAN-366: queue position utilities and startup stale cleanup logic.
 *
 * Coverage:
 *  - ordinalSuffix: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 101st
 *  - formatQueueLabel: position 1 → "Queued", 2+ → "Queued (Nth)"
 *  - computeQueuePositionFromStatus: reviewing/testing/merging → pos=0, null status → null
 *  - findPositionInQueue: found/not-found, case-insensitive
 */

import { describe, it, expect } from 'vitest';
import {
  ordinalSuffix,
  formatQueueLabel,
  computeQueuePositionFromStatus,
  findPositionInQueue,
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
// ordinalSuffix
// ---------------------------------------------------------------------------

describe('ordinalSuffix', () => {
  it('returns st for 1', () => expect(ordinalSuffix(1)).toBe('st'));
  it('returns nd for 2', () => expect(ordinalSuffix(2)).toBe('nd'));
  it('returns rd for 3', () => expect(ordinalSuffix(3)).toBe('rd'));
  it('returns th for 4-10', () => {
    for (const n of [4, 5, 6, 7, 8, 9, 10]) {
      expect(ordinalSuffix(n)).toBe('th');
    }
  });
  it('returns th for 11, 12, 13 (teens exception)', () => {
    expect(ordinalSuffix(11)).toBe('th');
    expect(ordinalSuffix(12)).toBe('th');
    expect(ordinalSuffix(13)).toBe('th');
  });
  it('returns st for 21, 31, 101', () => {
    expect(ordinalSuffix(21)).toBe('st');
    expect(ordinalSuffix(31)).toBe('st');
    expect(ordinalSuffix(101)).toBe('st');
  });
  it('returns nd for 22, 32', () => {
    expect(ordinalSuffix(22)).toBe('nd');
    expect(ordinalSuffix(32)).toBe('nd');
  });
  it('returns rd for 23, 33', () => {
    expect(ordinalSuffix(23)).toBe('rd');
    expect(ordinalSuffix(33)).toBe('rd');
  });
  it('returns th for 111, 112, 113', () => {
    expect(ordinalSuffix(111)).toBe('th');
    expect(ordinalSuffix(112)).toBe('th');
    expect(ordinalSuffix(113)).toBe('th');
  });
});

// ---------------------------------------------------------------------------
// formatQueueLabel
// ---------------------------------------------------------------------------

describe('formatQueueLabel', () => {
  it('returns "Queued" for position 1', () => {
    expect(formatQueueLabel(1)).toBe('Queued');
  });

  it('returns "Queued (2nd)" for position 2', () => {
    expect(formatQueueLabel(2)).toBe('Queued (2nd)');
  });

  it('returns "Queued (3rd)" for position 3', () => {
    expect(formatQueueLabel(3)).toBe('Queued (3rd)');
  });

  it('returns "Queued (4th)" for position 4', () => {
    expect(formatQueueLabel(4)).toBe('Queued (4th)');
  });

  it('returns "Queued (11th)" for position 11', () => {
    expect(formatQueueLabel(11)).toBe('Queued (11th)');
  });

  it('returns "Queued (21st)" for position 21', () => {
    expect(formatQueueLabel(21)).toBe('Queued (21st)');
  });
});

// ---------------------------------------------------------------------------
// computeQueuePositionFromStatus
// ---------------------------------------------------------------------------

describe('computeQueuePositionFromStatus', () => {
  it('returns active position when reviewStatus is reviewing', () => {
    const result = computeQueuePositionFromStatus({
      reviewStatus: 'reviewing',
      testStatus: 'pending',
    });
    expect(result.queuePosition).toBe(SPECIALIST_ACTIVE_POSITION);
    expect(result.activeSpecialist).toBe('review');
  });

  it('returns active position when testStatus is testing', () => {
    const result = computeQueuePositionFromStatus({
      reviewStatus: 'passed',
      testStatus: 'testing',
    });
    expect(result.queuePosition).toBe(SPECIALIST_ACTIVE_POSITION);
    expect(result.activeSpecialist).toBe('test');
  });

  it('returns active position when mergeStatus is merging', () => {
    const result = computeQueuePositionFromStatus({
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'merging',
    });
    expect(result.queuePosition).toBe(SPECIALIST_ACTIVE_POSITION);
    expect(result.activeSpecialist).toBe('merge');
  });

  it('returns null when all statuses are idle/done', () => {
    const result = computeQueuePositionFromStatus({
      reviewStatus: 'pending',
      testStatus: 'pending',
    });
    expect(result.queuePosition).toBeNull();
    expect(result.activeSpecialist).toBeNull();
  });

  it('returns null for null status', () => {
    const result = computeQueuePositionFromStatus(null);
    expect(result.queuePosition).toBeNull();
    expect(result.activeSpecialist).toBeNull();
  });

  it('reviewing takes precedence when both reviewing and testing would apply', () => {
    // In practice both can't be true simultaneously, but the function should
    // prioritise reviewing first per the evaluation order.
    const result = computeQueuePositionFromStatus({
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
    expect(findPositionInQueue('PAN-366', items)).toBe(3);
  });

  it('returns 1 when issueId is first in queue', () => {
    const items: HookItem[] = [makeItem('PAN-366'), makeItem('PAN-200')];
    expect(findPositionInQueue('PAN-366', items)).toBe(1);
  });

  it('returns -1 when issueId is not in queue', () => {
    const items: HookItem[] = [makeItem('PAN-100'), makeItem('PAN-200')];
    expect(findPositionInQueue('PAN-366', items)).toBe(-1);
  });

  it('is case-insensitive', () => {
    const items: HookItem[] = [makeItem('pan-366')];
    expect(findPositionInQueue('PAN-366', items)).toBe(1);
    expect(findPositionInQueue('pan-366', items)).toBe(1);
  });

  it('returns -1 for empty queue', () => {
    expect(findPositionInQueue('PAN-366', [])).toBe(-1);
  });

  it('handles items with no issueId in payload', () => {
    const items: HookItem[] = [
      { id: 'x', type: 'task', priority: 'normal', source: 'test', payload: {}, createdAt: '' },
      makeItem('PAN-366'),
    ];
    expect(findPositionInQueue('PAN-366', items)).toBe(2);
  });
});
