import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
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

const FIXTURE = join(import.meta.dirname, '../../../../tests/fixtures/prime-agent/session.jsonl');

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

describe('CostWriter.reconcile — prime-agent (PAN-3668 WI-19)', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => {
    odb = setupOverdeckTestDb();
  });

  afterEach(() => {
    teardownOverdeckTestDb(odb);
  });

  it('imports each assistant usage once and a second run imports 0', async () => {
    const agentDir = join(odb.home, 'agents', 'agent-pan-3668');
    mkdirSync(join(agentDir, 'prime-sessions'), { recursive: true });
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({ issueId: 'PAN-3668', role: 'work', harness: 'prime-agent' }));
    const sessionFile = join(agentDir, 'prime-sessions', '01a0e000.jsonl');
    copyFileSync(FIXTURE, sessionFile);
    const layer = makeWriterLayer(odb);

    const first = await Effect.runPromise(CostWriter.use((w) => w.reconcile({ source: 'prime-agent' })).pipe(Effect.provide(layer)));
    expect(first).toMatchObject({ imported: 2, eventsImported: 2, duplicatesSkipped: 0, sessionsScanned: 1, errors: [] });
    const rows = odb.raw().prepare('SELECT * FROM cost_events ORDER BY id').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      issue_id: 'PAN-3668',
      agent_id: 'agent-pan-3668',
      session_type: 'prime-agent',
      model: 'gpt-5.5',
      input: 1300,
      request_id: 'prime-agent:01a0e000-0000-7000-8000-00000000abcd:a0000001',
      source_file: sessionFile,
    });

    const second = await Effect.runPromise(CostWriter.use((w) => w.reconcile({ source: 'prime-agent' })).pipe(Effect.provide(layer)));
    expect(second).toMatchObject({ imported: 0, eventsImported: 0, duplicatesSkipped: 2 });
    expect(odb.raw().prepare('SELECT COUNT(*) AS n FROM cost_events').get()).toEqual({ n: 2 });
  });
});
