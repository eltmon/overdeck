import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect, Layer } from 'effect';

import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../tests/helpers/overdeck-test-db.js';
import { CostArchive, EventBus } from '../infra.js';
import { CostWriter, CostWriterLive } from '../cost.js';

function makeWriterLayer(odb: OverdeckTestDb) {
  const busLayer = Layer.succeed(EventBus, EventBus.of({
    emit: () => Effect.sync(() => 0),
    readFrom: () => Effect.succeed([]),
    getLatestSequence: Effect.succeed(0),
    stream: undefined as never,
  }));
  const archiveLayer = Layer.succeed(CostArchive, CostArchive.of({ append: () => Effect.sync(() => undefined) }));
  return CostWriterLive.pipe(Layer.provide(odb.dbLayer), Layer.provide(busLayer), Layer.provide(archiveLayer));
}

const jsonl = (entries: readonly object[]): string => entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';

function writeGrokTranscript(home: string): string {
  const agentDir = join(home, 'agents', 'agent-pan-5078');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'state.json'), JSON.stringify({ issueId: 'PAN-5078', role: 'work', harness: 'grok' }));
  const transcript = join(agentDir, 'acp-session.jsonl');
  writeFileSync(transcript, jsonl([
    { timestamp: '2026-11-10T12:00:00.000Z', role: 'system', content: 'first', sessionId: 'grok-session-1', promptId: 'prompt-1', event: 'prompt_queued' },
    { timestamp: '2026-11-10T12:00:05.000Z', role: 'system', content: '', sessionId: 'grok-session-1', source: 'agent', promptId: 'prompt-1', event: 'turn_completed', stopReason: 'end_turn',
      usage: { model: 'grok/grok-4.6', inputTokens: 31153, outputTokens: 32, cacheReadTokens: 640, cacheWriteTokens: 0, reasoningTokens: 31, costUsd: 0.062818 } },
    { timestamp: '2026-11-10T12:01:05.000Z', role: 'system', content: '', sessionId: 'grok-session-1', source: 'agent', promptId: 'prompt-2', event: 'turn_completed', stopReason: 'end_turn',
      usage: { model: 'grok/grok-4.7-build-fast', inputTokens: 1000, outputTokens: 100, cacheReadTokens: 2000, cacheWriteTokens: 0 } },
  ]));
  // A Kimi ACP transcript carries no usage and imports nothing.
  const kimiDir = join(home, 'agents', 'agent-pan-4000');
  mkdirSync(kimiDir, { recursive: true });
  writeFileSync(join(kimiDir, 'acp-session.jsonl'), jsonl([
    { timestamp: '2026-11-10T12:00:05.000Z', role: 'system', content: '', sessionId: 'kimi-session', source: 'agent', promptId: 'prompt-k', event: 'turn_completed', stopReason: 'end_turn' },
  ]));
  return transcript;
}

describe('CostWriter.reconcile — grok (PAN-5078 WI-20)', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => {
    odb = setupOverdeckTestDb();
  });

  afterEach(() => {
    teardownOverdeckTestDb(odb);
  });

  it('imports each Grok turn once and a second run imports 0', async () => {
    const transcript = writeGrokTranscript(odb.home);
    const layer = makeWriterLayer(odb);

    const first = await Effect.runPromise(CostWriter.use((w) => w.reconcile({ source: 'grok' })).pipe(Effect.provide(layer)));
    expect(first).toMatchObject({ imported: 2, eventsImported: 2, duplicatesSkipped: 0, sessionsScanned: 2, errors: [] });
    const rows = odb.raw().prepare('SELECT * FROM cost_events ORDER BY id').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      issue_id: 'PAN-5078',
      agent_id: 'agent-pan-5078',
      session_type: 'grok',
      provider: 'custom',
      model: 'grok/grok-4.6',
      input: 31153,
      output: 32,
      cache_read: 640,
      request_id: 'grok:grok-session-1:prompt-1',
      source_file: transcript,
    });
    expect(rows[0]!.cost).toBeCloseTo(0.062818, 6);
    // No reported cost: the table prices grok-4.7-build-fast at $4 in / $1 cached / $12 out per M.
    expect(rows[1]).toMatchObject({ model: 'grok/grok-4.7-build-fast', request_id: 'grok:grok-session-1:prompt-2' });
    expect(rows[1]!.cost).toBeCloseTo(0.004 + 0.002 + 0.0012, 8);

    const second = await Effect.runPromise(CostWriter.use((w) => w.reconcile({ source: 'grok' })).pipe(Effect.provide(layer)));
    expect(second).toMatchObject({ imported: 0, eventsImported: 0, duplicatesSkipped: 2 });
    expect(odb.raw().prepare('SELECT COUNT(*) AS n FROM cost_events').get()).toEqual({ n: 2 });
  });
});
