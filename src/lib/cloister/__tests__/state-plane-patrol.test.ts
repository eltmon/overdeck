import { describe, expect, it, vi } from 'vitest';

import type { PanIssueRecord } from '../../pan-dir/record.js';
import type { ProjectConfig } from '../../projects.js';
import {
  reconcileProjectStatePlanes,
  statePlaneReconcileEveryCycles,
  type StatePlanePatrolDeps,
} from '../state-plane-patrol.js';

const project: ProjectConfig = { name: 'Test project', path: '/project' };

function record(closedOut: boolean): PanIssueRecord {
  return {
    issueId: 'PAN-3513',
    schemaVersion: 2,
    pipeline: {
      issueId: 'PAN-3513',
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: false,
      closedOut,
      closedOutAt: closedOut ? '2026-07-18T00:00:00.000Z' : undefined,
      updatedAt: '2026-07-18T00:00:00.000Z',
    },
    closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'main' },
  };
}

function deps(overrides: Partial<StatePlanePatrolDeps> = {}): StatePlanePatrolDeps {
  return {
    listRecords: vi.fn(async () => [record(true)]),
    readTrackerState: vi.fn(async () => 'open'),
    clearClosedOut: vi.fn(async () => true),
    reconcileDrift: vi.fn(async () => ({ committed: false })),
    now: vi.fn(() => '2026-08-03T00:00:00.000Z'),
    ...overrides,
  };
}

describe('state-plane reconciliation cadence', () => {
  it('runs no more often than hourly', () => {
    expect(statePlaneReconcileEveryCycles(60_000)).toBe(60);
    expect(statePlaneReconcileEveryCycles(10 * 60_000)).toBe(6);
    expect(statePlaneReconcileEveryCycles(2 * 60 * 60_000)).toBe(1);
  });
});

describe('PAN-3513 reopened issue reconciliation', () => {
  it('clears a poisoned closedOut record when the live tracker is active', async () => {
    const injected = deps();

    const actions = await reconcileProjectStatePlanes([{ config: project }], injected);

    expect(injected.clearClosedOut).toHaveBeenCalledWith(
      project,
      'PAN-3513',
      '2026-08-03T00:00:00.000Z',
    );
    expect(actions).toContainEqual({
      message: 'Cleared stale closedOut state for reopened PAN-3513 at 2026-08-03T00:00:00.000Z',
      level: 'action',
    });
  });

  it('leaves closedOut intact when the live tracker is terminal', async () => {
    const injected = deps({ readTrackerState: vi.fn(async () => 'closed') });

    const actions = await reconcileProjectStatePlanes([{ config: project }], injected);

    expect(injected.clearClosedOut).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('preserves closedOut and reports the tracker failure when state is unknown', async () => {
    const injected = deps({
      readTrackerState: vi.fn(async () => {
        throw new Error('tracker unavailable');
      }),
    });

    const actions = await reconcileProjectStatePlanes([{ config: project }], injected);

    expect(injected.clearClosedOut).not.toHaveBeenCalled();
    expect(actions).toEqual([{
      message: 'Preserved closedOut state for PAN-3513: live tracker reconciliation failed: tracker unavailable',
      level: 'warn',
    }]);
  });
});
