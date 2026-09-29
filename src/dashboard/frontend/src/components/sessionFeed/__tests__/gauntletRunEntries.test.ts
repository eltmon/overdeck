import { describe, expect, it } from 'vitest';
import { groupGauntletRuns } from '../gauntletRunEntries';
import type { ConversationFeedRow } from '../useConversationFeed';

const NOW = Date.parse('2026-09-28T12:00:00.000Z');
const at = (minutesBeforeNow: number) => new Date(NOW - minutesBeforeNow * 60_000).toISOString();

function lane(id: number, overrides: Partial<ConversationFeedRow> = {}): ConversationFeedRow {
  return {
    id,
    name: `conv-lane-${id}`,
    createdAt: at(60),
    lastAttachedAt: null,
    lastActivityAt: at(1),
    issueId: null,
    title: null,
    archivedAt: null,
    status: 'active',
    sessionAlive: true,
    isWorking: true,
    pendingInputCount: 0,
    projectKey: 'lexerra',
    gauntletRun: 'india',
    laneKey: `key-${id}`,
    laneRole: 'builder',
    laneIteration: 1,
    parentConversationId: 2884,
    parentConversationName: 'conv-2884',
    ...overrides,
  };
}

const orchestratorRow: ConversationFeedRow = {
  id: 2884,
  name: 'conv-2884',
  createdAt: at(120),
  lastAttachedAt: null,
  issueId: null,
  title: 'Lexerra gauntlet',
};

function sixBuilders(overrides: Partial<ConversationFeedRow> = {}): ConversationFeedRow[] {
  return [1, 2, 3, 4, 5, 6].map((id) => lane(id, overrides));
}

describe('groupGauntletRuns', () => {
  it('returns one run card for six working builders of one run', () => {
    const lanes = sixBuilders();

    const entries = groupGauntletRuns(lanes, [orchestratorRow, ...lanes], NOW);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'gauntlet_run',
      id: 'gauntlet-run:lexerra:india',
      run: 'india',
      projectKey: 'lexerra',
      issueId: null,
      workspaceId: null,
      countsLine: '6 builders · 6 working',
      state: 'working',
      orchestratorName: 'conv-2884',
      orchestratorTitle: 'Lexerra gauntlet',
      anyAlive: true,
      laneConversationIds: [1, 2, 3, 4, 5, 6],
    });
    expect(entries[0]?.timestamp).toBe(entries[0]?.latest.at);
  });

  it('keeps the card timestamp when only lastActivityAt moves', () => {
    const before = groupGauntletRuns(sixBuilders(), [], NOW);
    const after = groupGauntletRuns(sixBuilders({ lastActivityAt: at(-4) }), [], NOW);

    expect(after[0]?.timestamp).toBe(before[0]?.timestamp);
  });

  it('dates the card by the newest lane report', () => {
    const reportedAt = at(5);
    const lanes = [...sixBuilders().slice(0, 5), lane(6, { laneKey: 'foxtrot', laneReport: { seq: 1, at: reportedAt, status: 'done' } })];

    const [entry] = groupGauntletRuns(lanes, [], NOW);

    expect(entry?.latest.text).toContain('foxtrot');
    expect(entry?.latest.text).toContain('reported done');
    expect(entry?.timestamp).toBe(reportedAt);
  });

  it('formats a judged report with its iteration and verdict', () => {
    const lanes = [lane(1, { laneKey: 'alpha' }), lane(2, {
      laneKey: 'alpha',
      laneRole: 'critic',
      laneIteration: 2,
      criticOfConversationId: 1,
      laneReport: { seq: 3, at: at(2), status: 'done', verdict: 'pass' },
    })];

    const [entry] = groupGauntletRuns(lanes, [], NOW);

    expect(entry?.latest.text).toBe('alpha critic i2 reported done · verdict pass');
  });

  it('omits the iteration when laneIteration is null', () => {
    const [entry] = groupGauntletRuns([lane(1, { laneKey: 'alpha', laneIteration: null, laneReport: { seq: 1, at: at(2), status: 'blocked' } })], [], NOW);

    expect(entry?.latest.text).toBe('alpha builder reported blocked');
  });

  it('breaks a same-instant tie in favour of the report over the launch', () => {
    const [entry] = groupGauntletRuns([lane(1, { laneKey: 'alpha', createdAt: at(3), laneReport: { seq: 1, at: at(3), status: 'done' } })], [], NOW);

    expect(entry?.latest.text).toBe('alpha builder i1 reported done');
  });

  it('dates an ended lane by endedAt', () => {
    const [entry] = groupGauntletRuns([lane(1, { laneKey: 'alpha', status: 'ended', endedAt: at(4), sessionAlive: false })], [], NOW);

    expect(entry).toMatchObject({ latest: { text: 'alpha builder ended', at: at(4) }, state: 'stopped', anyAlive: false });
  });

  it('counts a lane waiting on input as needs you and marks the run needs-you', () => {
    const lanes = [lane(1, { pendingInputCount: 1 }), ...sixBuilders().slice(1)];

    const [entry] = groupGauntletRuns(lanes, [], NOW);

    expect(entry?.countsLine).toBe('6 builders · 1 needs you · 5 working');
    expect(entry?.state).toBe('needs-you');
  });

  it('counts a spawn failure as failed to start and marks the run failed', () => {
    const lanes = [lane(1, { spawnError: 'no binary', sessionAlive: false, isWorking: false }), lane(2)];

    const [entry] = groupGauntletRuns(lanes, [], NOW);

    expect(entry?.countsLine).toBe('2 builders · 1 failed to start · 1 working');
    expect(entry?.state).toBe('failed');
  });

  it('keeps the same run key in two projects as two cards', () => {
    const lanes = [lane(1), lane(2, { projectKey: 'overdeck', createdAt: at(30) })];

    const entries = groupGauntletRuns(lanes, [], NOW);

    expect(entries.map((entry) => entry.id)).toEqual(['gauntlet-run:overdeck:india', 'gauntlet-run:lexerra:india']);
  });

  it('orders each builder before the critics that judge it, then the rest by role and key', () => {
    const lanes = [
      lane(10, { laneKey: 'play-1', laneRole: 'play', criticOfConversationId: null }),
      lane(11, { laneKey: 'bravo', laneRole: 'critic', criticOfConversationId: 2 }),
      lane(2, { laneKey: 'bravo' }),
      lane(12, { laneKey: 'alpha', laneRole: 'verifier', criticOfConversationId: 1, createdAt: at(10) }),
      lane(13, { laneKey: 'alpha', laneRole: 'critic', criticOfConversationId: 1, createdAt: at(20) }),
      lane(1, { laneKey: 'alpha' }),
    ];

    const [entry] = groupGauntletRuns(lanes, [], NOW);

    expect(entry?.lanes.map((row) => row.id)).toEqual([1, 13, 12, 2, 11, 10]);
    expect(entry?.countsLine).toBe('2 builders · 2 critics · 1 verifier · 1 play · 6 working');
  });

  it('picks the orchestrator shared by the most lanes, ties to the smaller id, ignoring parents inside the run', () => {
    const lanes = [
      lane(1, { parentConversationId: 900, parentConversationName: 'conv-900' }),
      lane(2, { parentConversationId: 800, parentConversationName: 'conv-800' }),
      lane(3, { parentConversationId: 1, parentConversationName: 'conv-lane-1' }),
    ];

    const [entry] = groupGauntletRuns(lanes, [], NOW);

    expect(entry?.orchestratorName).toBe('conv-800');
    expect(entry?.orchestratorTitle).toBeNull();
  });

  it('returns a null orchestrator when no lane has an outside parent', () => {
    const [entry] = groupGauntletRuns([lane(1, { parentConversationId: null, parentConversationName: null })], [], NOW);

    expect(entry?.orchestratorName).toBeNull();
  });

  it('sorts runs newest latest event first', () => {
    const lanes = [
      lane(1, { gauntletRun: 'older', createdAt: at(50) }),
      lane(2, { gauntletRun: 'newer', createdAt: at(5) }),
    ];

    expect(groupGauntletRuns(lanes, [], NOW).map((entry) => entry.run)).toEqual(['newer', 'older']);
  });
});
