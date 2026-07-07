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

describe('CostWriter.reconcile — codex per-turn update-on-growth', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => {
    odb = setupOverdeckTestDb();
  });

  afterEach(() => {
    teardownOverdeckTestDb(odb);
  });

  it('imports each gpt-5.5 token_count once and appends only the new turn when the rollout grows', async () => {
    const rolloutFile = seedCodexAgent(odb, { input: 12000, cached: 4000, output: 800 });
    const layer = makeWriterLayer(odb);

    const first = await Effect.runPromise(
      CostWriter.use((w) => w.reconcile({ source: 'codex' })).pipe(Effect.provide(layer)),
    );
    expect(first).toMatchObject({ imported: 1, eventsImported: 1, duplicatesSkipped: 0, skipped: [] });
    let rows = readRows(odb);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      issue_id: 'PAN-9999',
      agent_id: 'agent-pan-9999',
      session_id: 'thread-pan-9999',
      session_type: 'codex',
      model: 'gpt-5.5',
      input: 12000,
      output: 800,
      cache_read: 4000,
      request_id: 'codex:thread-pan-9999:0',
      source_file: rolloutFile,
    });
    expect(rows[0]!.cost).toBeGreaterThan(0);

    const unchanged = await Effect.runPromise(
      CostWriter.use((w) => w.reconcile({ source: 'codex' })).pipe(Effect.provide(layer)),
    );
    expect(unchanged).toMatchObject({ imported: 0, eventsImported: 0, duplicatesSkipped: 1, skipped: [] });
    expect(readRows(odb)).toHaveLength(1);

    appendTokenCount(rolloutFile, { input: 18000, cached: 6000, output: 1500 });
    const grown = await Effect.runPromise(
      CostWriter.use((w) => w.reconcile({ source: 'codex' })).pipe(Effect.provide(layer)),
    );
    expect(grown).toMatchObject({ imported: 1, eventsImported: 1, duplicatesSkipped: 1, skipped: [] });
    rows = readRows(odb);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      request_id: 'codex:thread-pan-9999:1',
      input: 6000,
      output: 700,
      cache_read: 2000,
    });
    expect(rows[1]!.cost).toBeGreaterThan(0);
  });
});

function makeWriterLayer(odb: OverdeckTestDb) {
  const busLayer = Layer.succeed(
    EventBus,
    EventBus.of({
      emit: () => Effect.sync(() => 0),
      readFrom: () => Effect.succeed([]),
      getLatestSequence: Effect.succeed(0),
      stream: undefined as never,
    }),
  );
  const archiveLayer = Layer.succeed(
    CostArchive,
    CostArchive.of({ append: () => Effect.sync(() => undefined) }),
  );
  return CostWriterLive.pipe(
    Layer.provide(odb.dbLayer),
    Layer.provide(busLayer),
    Layer.provide(archiveLayer),
  );
}

function seedCodexAgent(odb: OverdeckTestDb, usage: { input: number; cached: number; output: number }): string {
  const agentDir = join(odb.home, 'agents', 'agent-pan-9999');
  const dayDir = join(agentDir, 'codex-home', 'sessions', '2026', '07', '05');
  mkdirSync(dayDir, { recursive: true });
  writeFileSync(join(agentDir, 'state.json'), JSON.stringify({ issueId: 'PAN-9999', role: 'work' }), 'utf8');
  const rolloutFile = join(dayDir, 'rollout-2026-07-05T14-11-25-thread-pan-9999.jsonl');
  writeFileSync(
    rolloutFile,
    [
      JSON.stringify({ timestamp: '2026-07-05T14:11:25.000Z', type: 'session_meta', payload: { type: 'session_meta', id: 'thread-pan-9999' } }),
      JSON.stringify({ timestamp: '2026-07-05T14:11:25.100Z', type: 'turn_context', payload: { type: 'turn_context', model: 'gpt-5.5' } }),
      JSON.stringify({ timestamp: '2026-07-05T14:11:30.000Z', type: 'event_msg', payload: { type: 'agent_message', message: '[redacted]' } }),
      tokenCountLine(usage),
    ].join('\n') + '\n',
    'utf8',
  );
  return rolloutFile;
}

function appendTokenCount(file: string, usage: { input: number; cached: number; output: number }): void {
  writeFileSync(file, tokenCountLine(usage) + '\n', { flag: 'a', encoding: 'utf8' });
}

function tokenCountLine(usage: { input: number; cached: number; output: number }): string {
  return JSON.stringify({
    timestamp: '2026-07-05T14:11:38.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: usage.input,
          cached_input_tokens: usage.cached,
          output_tokens: usage.output,
          total_tokens: usage.input + usage.output,
        },
      },
    },
  });
}

function readRows(odb: OverdeckTestDb): Array<Record<string, any>> {
  return odb.raw().prepare('SELECT * FROM cost_events ORDER BY id').all() as Array<Record<string, any>>;
}
