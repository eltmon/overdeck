/**
 * PAN-4223 WI-10 step 2: the pure Command Deck conversation tree.
 */
import { describe, expect, it } from 'vitest';

import type { Conversation } from '../ConversationList';
import { buildConversationTree, groupSummary, type ConversationTreeNode } from '../conversation-tree';

let clock = Date.parse('2026-09-26T10:00:00.000Z');

function conv(id: number, extra: Partial<Conversation> = {}): Conversation {
  clock += 60_000;
  return {
    id,
    name: `c${id}`,
    tmuxSession: `conv-c${id}`,
    status: 'ended',
    cwd: '/p',
    issueId: null,
    createdAt: new Date(clock).toISOString(),
    endedAt: null,
    lastAttachedAt: null,
    sessionAlive: false,
    parentConversationId: null,
    laneKey: null,
    ...extra,
  };
}

function lane(id: number, parent: number, key: string, extra: Partial<Conversation> = {}): Conversation {
  return conv(id, { parentConversationId: parent, gauntletRun: 'hotel', laneKey: key, laneRole: 'builder', ...extra });
}

function successor(id: number, parent: number, extra: Partial<Conversation> = {}): Conversation {
  return conv(id, { parentConversationId: parent, ...extra });
}

/** Flattened render order: [id, depth] per rendered row. */
function rendered(tree: ConversationTreeNode[]): Array<[number, number]> {
  return tree.flatMap((node) => [[node.conv.id, node.depth] as [number, number], ...node.descendants.map((child) => [child.conv.id, child.depth] as [number, number])]);
}

describe('buildConversationTree', () => {
  it('nests lanes under a present parent, an orchestrator lane\'s builders at depth 2, and keeps orphans top level', () => {
    const root = conv(1);
    const orch = lane(2, 1, 'north', { laneRole: 'orchestrator' });
    const builder = lane(3, 2, 'n1');
    const orphan = lane(4, 99, 'lost');
    const tree = buildConversationTree([root, orch, builder, orphan]);
    expect(rendered(tree)).toEqual([[1, 0], [2, 1], [3, 2], [4, 0]]);
    expect(tree[1]?.orphanOf).toBe(99);
    expect(tree[0]?.orphanOf).toBeNull();
  });

  it('nests a successor under its present predecessor, and keeps an absent predecessor\'s successor top level', () => {
    const tree = buildConversationTree([conv(1), successor(2, 1), successor(3, 50)]);
    expect(rendered(tree)).toEqual([[1, 0], [2, 1], [3, 0]]);
    expect(tree[1]).toMatchObject({ orphanOf: 50, descendants: [] });
  });

  it('keeps an orchestrator\'s lanes under it after a handoff (D6)', () => {
    const rows = [conv(1), lane(2, 1, 'l1'), lane(3, 1, 'l2'), successor(4, 1), lane(5, 4, 'm1')];
    expect(rendered(buildConversationTree(rows))).toEqual([[1, 0], [2, 1], [3, 1], [4, 1], [5, 2]]);
  });

  it('flattens a chain deeper than two levels and marks the real parent (D22)', () => {
    const tree = buildConversationTree([conv(1), successor(2, 1), successor(3, 2), successor(4, 3)]);
    expect(rendered(tree)).toEqual([[1, 0], [2, 1], [3, 2], [4, 2]]);
    expect(tree[0]?.descendants.map((node) => node.flattenedFrom)).toEqual([null, null, 3]);
    expect(tree[0]?.descendants[2]?.naturalDepth).toBe(3);
  });

  it('renders the D22 example in the stated order and depths', () => {
    const o = conv(10);
    const l1 = lane(11, 10, 'l1');
    const l2 = lane(12, 10, 'l2');
    const o2 = successor(13, 10);
    const m1 = lane(14, 13, 'm1');
    const o3 = successor(15, 13);
    const n1 = lane(16, 15, 'n1');
    const tree = buildConversationTree([n1, o3, m1, o2, l2, l1, o]);
    expect(rendered(tree)).toEqual([[10, 0], [11, 1], [12, 1], [13, 1], [14, 2], [15, 2], [16, 2]]);
    expect(tree[0]?.descendants.find((node) => node.conv.id === 16)?.flattenedFrom).toBe(15);
  });

  it('ranks a group by its best member (FR-28) and orders live siblings first', () => {
    const predecessor = conv(1);
    const liveSuccessor = successor(2, 1, { sessionAlive: true, status: 'active' });
    const otherActive = conv(3, { sessionAlive: true, status: 'active' });
    const endedLane = lane(4, 1, 'old');
    // Flat order: active (successor, then the other active row), then inactive.
    const tree = buildConversationTree([liveSuccessor, otherActive, predecessor, endedLane]);
    expect(tree.map((node) => node.conv.id)).toEqual([1, 3]);
    expect(tree[0]?.descendants.map((node) => node.conv.id)).toEqual([2, 4]);
  });

  it('renders every row of a parent cycle exactly once', () => {
    const rows = [successor(1, 3), successor(2, 1), successor(3, 2), conv(4)];
    const ids = rendered(buildConversationTree(rows)).map(([id]) => id);
    expect([...ids].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('groupSummary', () => {
  it('counts lanes, successors, working, needs-you and reported over flattened rows too', () => {
    const rows = [
      conv(1),
      lane(2, 1, 'a', { isWorking: true, laneReport: { seq: 1, at: 'x', status: 'done' } }),
      lane(3, 1, 'b', { pendingInputCount: 1 }),
      successor(4, 1),
      successor(5, 4),
      lane(6, 5, 'deep', { isWorking: true, laneReport: { seq: 2, at: 'y', status: 'blocked' } }),
    ];
    const [group] = buildConversationTree(rows);
    expect(group?.descendants.find((node) => node.conv.id === 6)?.flattenedFrom).toBe(5);
    expect(groupSummary(group!)).toEqual({ lanes: 3, successors: 2, working: 2, needsYou: 1, reported: 2 });
  });
});
