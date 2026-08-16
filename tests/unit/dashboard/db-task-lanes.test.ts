import { describe, expect, it } from 'vitest';

import {
  type DashboardDbOperation,
  runDashboardDbJob,
  workerLane,
} from '../../../src/dashboard/server/services/dashboard-db-task.js';
import { parsePiConversationMessages } from '../../../src/dashboard/server/services/pi-conversation-parser.js';

const piFixture = new URL(
  '../../../src/dashboard/server/services/__tests__/pi-conversation-parser.fixture.jsonl',
  import.meta.url,
);

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

  it('routes transcript parsing to its dedicated lane', () => {
    expect(workerLane('parseTranscriptSnapshot')).toBe('parse');
  });

  it('dispatches transcript parsing through the job surface', async () => {
    const expected = await parsePiConversationMessages(piFixture.pathname);

    await expect(runDashboardDbJob('parseTranscriptSnapshot', {
      sessionFile: piFixture.pathname,
      parser: 'pi',
    })).resolves.toEqual(expected);
  });

  it('rejects unknown transcript parsers', async () => {
    await expect(runDashboardDbJob('parseTranscriptSnapshot', {
      sessionFile: piFixture.pathname,
      parser: 'unknown',
    })).rejects.toThrow('Unknown transcript parser: unknown');
  });
});
