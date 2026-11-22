import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect, Layer } from 'effect';

import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../tests/helpers/overdeck-test-db.js';
import { calculateCost, getPricing } from '../../cost.js';
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

/** The tool-using turn from the PRD's finding 5 (agy 1.5.14), as the host records it (D12). */
const TOOL_TURN_USAGE = { model: 'gemini-4-argon', source: 'antigravity', inputTokens: 12101, outputTokens: 117, cacheReadTokens: 7739, cacheWriteTokens: 0, reasoningTokens: 0 };

function writeAntigravityTranscript(home: string): string {
  const agentDir = join(home, 'agents', 'agent-pan-5587');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'state.json'), JSON.stringify({ issueId: 'PAN-5587', role: 'work', harness: 'antigravity' }));
  const transcript = join(agentDir, 'acp-session.jsonl');
  writeFileSync(transcript, jsonl([
    { timestamp: '2026-11-21T12:00:00.000Z', role: 'system', content: 'first', sessionId: 'agy-session-1', promptId: 'prompt-1', event: 'prompt_queued' },
    { timestamp: '2026-11-21T12:00:05.000Z', role: 'system', content: '', sessionId: 'agy-session-1', source: 'agent', promptId: 'prompt-1', event: 'turn_completed', stopReason: 'end_turn',
      usage: TOOL_TURN_USAGE },
    { timestamp: '2026-11-21T12:01:05.000Z', role: 'system', content: '', sessionId: 'agy-session-1', source: 'agent', promptId: 'prompt-2', event: 'turn_completed', stopReason: 'end_turn',
      usage: TOOL_TURN_USAGE },
    // A turn without usage (agy's bad-key turn, finding 3) produces no cost event.
    { timestamp: '2026-11-21T12:02:05.000Z', role: 'system', content: '', sessionId: 'agy-session-1', source: 'agent', promptId: 'prompt-3', event: 'turn_completed', stopReason: 'end_turn' },
  ]));
  // A Grok turn belongs to the grok source and imports nothing here.
  const grokDir = join(home, 'agents', 'agent-pan-5078');
  mkdirSync(grokDir, { recursive: true });
  writeFileSync(join(grokDir, 'acp-session.jsonl'), jsonl([
    { timestamp: '2026-11-21T12:00:05.000Z', role: 'system', content: '', sessionId: 'grok-session', source: 'agent', promptId: 'prompt-g', event: 'turn_completed', stopReason: 'end_turn',
      usage: { model: 'grok/grok-4.6', inputTokens: 1000, outputTokens: 32, cacheReadTokens: 640, cacheWriteTokens: 0, costUsd: 0.01 } },
  ]));
  return transcript;
}

describe('CostWriter.reconcile — antigravity (PAN-5587 D12)', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => {
    odb = setupOverdeckTestDb();
  });

  afterEach(() => {
    teardownOverdeckTestDb(odb);
  });

  it('imports each Antigravity turn once at Google list prices and a second run imports 0', async () => {
    const transcript = writeAntigravityTranscript(odb.home);
    const layer = makeWriterLayer(odb);

    const first = await Effect.runPromise(CostWriter.use((w) => w.reconcile({ source: 'antigravity' })).pipe(Effect.provide(layer)));
    expect(first).toMatchObject({ imported: 2, eventsImported: 2, duplicatesSkipped: 0, sessionsScanned: 2, errors: [] });
    const rows = odb.raw().prepare('SELECT * FROM cost_events ORDER BY id').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      issue_id: 'PAN-5587',
      agent_id: 'agent-pan-5587',
      session_type: 'antigravity',
      provider: 'google',
      model: 'gemini-4-argon',
      input: 12101,
      output: 117,
      cache_read: 7739,
      request_id: 'antigravity:agy-session-1:prompt-1',
      source_file: transcript,
    });
    const pricing = getPricing('google', 'gemini-4-argon');
    expect(pricing).not.toBeNull();
    const expectedCost = calculateCost({ inputTokens: 12101, outputTokens: 117, cacheReadTokens: 7739, cacheWriteTokens: 0 }, pricing!);
    expect(expectedCost).toBeGreaterThan(0);
    expect(rows[0]!.cost).toBeCloseTo(expectedCost, 8);
    expect(rows[1]).toMatchObject({ request_id: 'antigravity:agy-session-1:prompt-2' });

    const second = await Effect.runPromise(CostWriter.use((w) => w.reconcile({ source: 'antigravity' })).pipe(Effect.provide(layer)));
    expect(second).toMatchObject({ imported: 0, eventsImported: 0, duplicatesSkipped: 2 });
    expect(odb.raw().prepare('SELECT COUNT(*) AS n FROM cost_events').get()).toEqual({ n: 2 });
  });
});
