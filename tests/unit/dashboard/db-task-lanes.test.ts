import { describe, expect, it } from 'vitest';

import {
  type DashboardDbOperation,
  workerLane,
} from '../../../src/dashboard/server/services/dashboard-db-task.js';

describe('dashboard database worker lanes', () => {
  it.each([
    'listSessionsFeed',
    'getSessionsFeedFacets',
    'getConversationByName',
    'getDiscoveredSessionById',
  ] satisfies DashboardDbOperation[])('routes interactive operation %s to read', operation => {
    expect(workerLane(operation)).toBe('read');
  });

  it.each([
    'scanConversations',
    'enrichSessions',
    'embedSessions',
    'listSubstrateBugWeights',
    'costReconcileSweep',
  ] satisfies DashboardDbOperation[])('routes bulk operation %s to long', operation => {
    expect(workerLane(operation)).toBe('long');
  });

  it('routes semantic search to its dedicated lane', () => {
    expect(workerLane('searchSessionsSemantic')).toBe('semantic');
  });
});
