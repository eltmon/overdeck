import { describe, expect, it } from 'vitest';
import {
  decodeFlywheelDerivedStatus,
  shippedCardCount,
} from '../../../packages/contracts/src/flywheel-derived.js';

const base = {
  run: 'running',
  conversation: null,
  lastTick: null,
  freshness: null,
  policies: { auto_pickup_backlog: true, require_uat_before_merge: false, merge_train_enabled: true },
  inFlight: [
    { issueId: 'PAN-1', title: 'One', state: 'working', liveAgents: 0, inTick: true, lastJournal: null },
  ],
  agents: [],
  inFlightSource: 'tick',
  orderBook: null,
  projectRoot: '/repo',
  generatedAt: '2026-11-14T12:00:00.000Z',
};

const merge = {
  sha: 'a'.repeat(40),
  at: '2026-11-14T10:00:00.000Z',
  subject: 'feat: thing (#5100)',
  prNumber: 5100,
  prUrl: 'https://github.com/o/r/pull/5100',
  issueId: 'PAN-5100',
  title: 'Thing',
  deployed: false,
};

const full = {
  ...base,
  lastTick: {
    tick: 3,
    pick: null,
    phase: 'watch',
    inFlight: ['PAN-1'],
    needsYou: 'approve X',
    at: '2026-11-14T11:00:00.000Z',
    needsYouItems: [
      { text: 'approve X', firstRaisedTick: 2, firstRaisedAt: '2026-11-14T10:30:00.000Z', context: 'why it matters' },
    ],
  },
  inFlight: [
    {
      ...base.inFlight[0],
      stage: 'checks',
      stageSince: '2026-11-14T11:30:00.000Z',
      owner: { kind: 'conversation', name: '20261114-d9c5', title: 'Handoff' },
      agent: { role: 'handoff', model: 'opus', harness: 'claude-code', state: 'waiting', conversationName: '20261114-d9c5' },
      blocker: { kind: 'start-failed', severity: 'needs-you', text: 'auto-start failed', action: 'start-issue' },
      cost: 4.12,
      lastActivity: { at: '2026-11-14T11:30:00.000Z', label: 'checks started' },
    },
  ],
  health: {
    mainCi: { conclusion: 'success', sha: 'b'.repeat(40), url: null, at: '2026-11-14T11:00:00.000Z' },
    deployed: { buildCommit: 'c'.repeat(40), behindVerdict: 2 },
    gateQueue: { running: 0, queued: 9, slots: 2, oldestWaitSince: '2026-11-14T11:00:00.000Z' },
    nextBatch: { name: 'uat/pan-train-1', status: 'assembling', members: ['PAN-1'], createdAt: '2026-11-14T11:00:00.000Z' },
    batchingPausedUntil: null,
    lastRelease: { tag: 'v0.85.0', at: '2026-11-14T09:00:00.000Z', url: null },
  },
  shipped: {
    merges: [merge],
    events: [
      { kind: 'merge', at: merge.at, merge },
      { kind: 'deploy', at: '2026-11-14T10:10:00.000Z', trigger: 'pan reload', issueId: null, initiator: null },
      { kind: 'release', at: '2026-11-14T09:00:00.000Z', tag: 'v0.85.0', url: null },
    ],
  },
};

describe('FlywheelDerivedStatus board contract (PAN-5283 WI-1)', () => {
  it('decodes a payload with none of the new fields', () => {
    const decoded = decodeFlywheelDerivedStatus(base);
    expect(decoded.inFlight[0]!.stage).toBeUndefined();
    expect(decoded.health).toBeUndefined();
    expect(decoded.shipped).toBeUndefined();
  });

  it('decodes a payload carrying every new field unchanged', () => {
    const decoded = decodeFlywheelDerivedStatus(full);
    expect(decoded).toEqual(full);
  });

  it('shippedCardCount counts shipped merges and is 0 when shipped is absent', () => {
    expect(shippedCardCount(decodeFlywheelDerivedStatus(full))).toBe(1);
    expect(shippedCardCount(decodeFlywheelDerivedStatus(base))).toBe(0);
    expect(shippedCardCount({ shipped: { merges: [merge, { ...merge, sha: 'd'.repeat(40) }], events: [] } })).toBe(2);
  });
});
