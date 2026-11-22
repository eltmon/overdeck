import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectAcpTurnUsageCostEvents } from '../acp-turn-usage-collector.js';

const jsonl = (entries: readonly object[]): string => entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';

let home: string;
const originalHome = process.env.OVERDECK_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'acp-turn-usage-'));
  process.env.OVERDECK_HOME = home;
  const agentDir = join(home, 'agents', 'agent-pan-5587');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'acp-session.jsonl'), jsonl([
    { timestamp: '2026-11-21T12:00:00.000Z', event: 'prompt_queued', sessionId: 's1', promptId: 'p1' },
    { timestamp: '2026-11-21T12:00:05.000Z', event: 'turn_completed', sessionId: 's1', promptId: 'p1',
      usage: { model: 'match/a', inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0 } },
    { timestamp: '2026-11-21T12:00:06.000Z', event: 'turn_completed', sessionId: 's1', promptId: 'p2',
      usage: { model: 'other/b', inputTokens: 99, outputTokens: 9, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    { timestamp: '2026-11-21T12:00:07.000Z', event: 'turn_completed', sessionId: 's1',
      usage: { model: 'match/c', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    'not json',
  ]));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
});

describe('collectAcpTurnUsageCostEvents (PAN-5587 WI-18)', () => {
  it('emits events only for turn_completed usage the predicate matches, priced by the caller', async () => {
    const result = await collectAcpTurnUsageCostEvents({
      home,
      matches: (usage) => usage.model.startsWith('match/'),
      sessionType: 'test',
      requestIdPrefix: 'test',
      provider: 'custom',
      price: (usage) => usage.inputTokens / 100,
    });
    expect(result.scanned).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.events).toEqual([expect.objectContaining({
      agentId: 'agent-pan-5587',
      issueId: 'PAN-5587',
      sessionId: 's1',
      sessionType: 'test',
      provider: 'custom',
      model: 'match/a',
      input: 10,
      output: 2,
      cacheRead: 3,
      cacheWrite: 0,
      cost: 0.1,
      requestId: 'test:s1:p1',
    })]);
  });

  it('skips a matching entry without a promptId with reason no-request-id', async () => {
    const result = await collectAcpTurnUsageCostEvents({
      home,
      matches: (usage) => usage.model.startsWith('match/'),
      sessionType: 'test',
      requestIdPrefix: 'test',
      provider: 'custom',
      price: () => 0,
    });
    expect(result.skipped).toEqual([{ file: join(home, 'agents', 'agent-pan-5587', 'acp-session.jsonl'), reason: 'no-request-id' }]);
  });

  it('returns nothing when the agents directory does not exist', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'acp-turn-usage-empty-'));
    try {
      await expect(collectAcpTurnUsageCostEvents({
        home: empty, matches: () => true, sessionType: 'test', requestIdPrefix: 'test', provider: 'custom', price: () => 0,
      })).resolves.toEqual({ events: [], skipped: [], errors: [], scanned: 0 });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
