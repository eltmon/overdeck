import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Effect, Stream } from 'effect';

import { createOverdeckDatabase } from '../../../../scripts/create-overdeck-db.js';
import {
  EventBus,
  EventBusLive,
  makeDbLive,
} from '../../../../src/lib/overdeck/infra.js';
import {
  Observability,
  ObservabilityLive,
  ObservabilityRpcGroup,
  ReplayEventsRpc,
  SubscribeDomainEventsRpc,
} from '../../../../src/lib/overdeck/observability.js';

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pan-overdeck-observability-'));
  tempDirs.push(dir);
  return dir;
}

function makeDbPath(): string {
  const dbPath = join(makeTempDir(), 'overdeck.db');
  createOverdeckDatabase({ dbPath });
  return dbPath;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('overdeck Observability RPC surface', () => {
  it('subscribes to domain events emitted through EventBus', async () => {
    const dbPath = makeDbPath();

    const eventTypes = await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        const observability = yield* Observability;
        const takeOne = Stream.runCollect(Stream.take(observability.subscribeDomainEvents, 1));
        yield* bus.emit({ type: 'issue.advanced', payload: { issueId: 'PAN-1938' } });
        const events = yield* takeOne;
        return Array.from(events).map((event) => event.type);
      }).pipe(
        Effect.provide(ObservabilityLive),
        Effect.provide(EventBusLive),
        Effect.provide(makeDbLive(dbPath)),
      ),
    );

    expect(eventTypes).toEqual(['issue.advanced']);
  });

  it('replays gap-fill events from the events transport', async () => {
    const dbPath = makeDbPath();

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        const observability = yield* Observability;
        const first = yield* bus.emit({ type: 'agent.started', payload: { agentId: 'agent-1' } });
        yield* bus.emit({ type: 'agent.stopped', payload: { agentId: 'agent-1' } });
        const replayed = yield* observability.replayEvents(first);
        const snapshot = yield* observability.getSnapshot;
        return { replayed, snapshot };
      }).pipe(
        Effect.provide(ObservabilityLive),
        Effect.provide(EventBusLive),
        Effect.provide(makeDbLive(dbPath)),
      ),
    );

    expect(result.replayed.map((event) => event.type)).toEqual(['agent.stopped']);
    expect(result.snapshot.sequence).toBe(2);
  });

  it('declares the RPC group over snapshot, subscribe, and replay methods', () => {
    expect(ObservabilityRpcGroup).toBeDefined();
    expect(SubscribeDomainEventsRpc).toBeDefined();
    expect(ReplayEventsRpc).toBeDefined();
  });
});
