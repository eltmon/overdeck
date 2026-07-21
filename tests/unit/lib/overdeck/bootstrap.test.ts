/**
 * Tests for workspace-m9n4j — Server bootstrap layer.
 *
 * AC1: BootstrapObservabilityLive boots with all domain layers; getSnapshot
 *      returns a complete snapshot (issues + agents) seeded from resolvers.
 * AC2: Read-model updates flow from EventBus events — not direct store polling.
 *      After an emit, the snapshot sequence advances without explicit DB reads.
 * AC3: FullOverdeckApi exposes all five API groups (issues, agents, merge,
 *      settings, config); ObservabilityRpcGroup exposes all three RPC methods.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Duration, Effect, Layer } from 'effect';

import { createOverdeckDatabase } from '../../../../scripts/create-overdeck-db.js';
import {
  EventBus,
  EventBusLive,
  makeDbLive,
  Records,
  Tmux,
} from '../../../../src/lib/overdeck/infra.js';
import { AgentsDomainLayer } from '../../../../src/lib/overdeck/agents.js';
import { IssuesResolverLive } from '../../../../src/lib/overdeck/issues.js';
import {
  Observability,
  type ObservabilityServiceShape,
  ObservabilityRpcGroup,
  GetSnapshotRpc,
  SubscribeDomainEventsRpc,
  ReplayEventsRpc,
} from '../../../../src/lib/overdeck/observability.js';
import {
  BootstrapObservabilityLive,
  FullOverdeckApi,
} from '../../../../src/lib/overdeck/bootstrap.js';

// ── Temp-dir helpers ──────────────────────────────────────────────────────────

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pan-overdeck-bootstrap-'));
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

// ── Minimal fake infra layers ─────────────────────────────────────────────────

/** Records fake — no git infra required for read-path tests. */
const FakeRecordsLayer = Layer.succeed(Records, Records.of({
  writeIssue:        () => Effect.succeed(join(tmpdir(), 'noop.json')),
  readIssue:         () => Effect.succeed(null),
  readSpec:          () => Effect.succeed(null),
  writeAgentIdentity: () => Effect.succeed(undefined),
}));

/** Tmux fake — no live sessions; all methods are no-ops. */
const FakeTmuxLayer = Layer.succeed(Tmux, Tmux.of({
  sessionExists:   (_id) => Effect.succeed(false),
  killSession:     (_id) => Effect.succeed(undefined),
  readRuntimeJson: (_id) => Effect.succeed(null),
  listSessions:    ()    => Effect.succeed([]),
}));

/**
 * Build a fully-wired test layer for BootstrapObservabilityLive.
 *
 * Layer topology (dependency order matters — EventBusLive needs Db):
 *   dbLayer      — makeDbLive
 *   busLayer     — EventBusLive ← Db
 *   baseInfra    — Db + Records + Tmux + EventBus (all available)
 *   domainLayer  — IssuesResolver + AgentsDomain ← baseInfra
 *   obsLayer     — BootstrapObservabilityLive ← domain + baseInfra
 *   testLayer    — mergeAll(obsLayer, domainLayer, baseInfra)
 */
function makeBootstrapTestLayer(dbPath: string) {
  const dbLayer      = makeDbLive(dbPath);
  const busLayer     = EventBusLive.pipe(Layer.provide(dbLayer));
  const baseInfra    = Layer.mergeAll(dbLayer, FakeRecordsLayer, FakeTmuxLayer, busLayer);
  const domainLayer  = Layer.mergeAll(IssuesResolverLive, AgentsDomainLayer).pipe(
    Layer.provide(baseInfra),
  );
  const obsLayer = BootstrapObservabilityLive.pipe(
    Layer.provide(Layer.mergeAll(domainLayer, baseInfra)),
  );
  return Layer.mergeAll(obsLayer, domainLayer, baseInfra);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('overdeck bootstrap layer', () => {
  it('AC1: BootstrapObservabilityLive seeds getSnapshot from resolvers on boot', async () => {
    const dbPath = makeDbPath();

    const snapshot = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const observability = yield* Observability;
          return yield* observability.getSnapshot;
        }),
      ).pipe(Effect.provide(makeBootstrapTestLayer(dbPath))),
    );

    expect(snapshot.sequence).toBeGreaterThanOrEqual(0);
    expect(snapshot.generatedAt).toBeInstanceOf(Date);
    expect(Array.isArray(snapshot.issues)).toBe(true);
    expect(Array.isArray(snapshot.agents)).toBe(true);
  });

  it('AC2: snapshot sequence advances when EventBus emits — no direct store polling', async () => {
    const dbPath = makeDbPath();

    const { before, after } = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const bus           = yield* EventBus;
          const observability = yield* Observability;

          const before = yield* observability.getSnapshot;

          // Emit an event — the background fiber (not a polling loop) should pick this up
          // via bus.stream, call resolvers, and update the SubscriptionRef.
          yield* bus.emit({ type: 'issue.advanced', payload: { issueId: 'PAN-1', from: 'todo', to: 'planning' } });

          const after = yield* waitForSnapshotSequence(observability, 1);
          return { before, after };
        }),
      ).pipe(Effect.provide(makeBootstrapTestLayer(dbPath))),
    );

    expect(before.sequence).toBe(0);
    expect(after.sequence).toBeGreaterThan(0);
    expect(Array.isArray(after.issues)).toBe(true);
    expect(Array.isArray(after.agents)).toBe(true);
  });

  it('AC3: FullOverdeckApi exposes all five domain groups', () => {
    // HttpApi stores groups as a plain object keyed by group name.
    const groups = (FullOverdeckApi as unknown as { groups: Record<string, unknown> }).groups;
    const groupNames = Object.keys(groups);
    expect(groupNames).toContain('issues');
    expect(groupNames).toContain('agents');
    expect(groupNames).toContain('merge');
    expect(groupNames).toContain('settings');
    expect(groupNames).toContain('config');
  });

  it('AC3: ObservabilityRpcGroup defines all three RPC methods', () => {
    // RpcGroup.requests is a Map<string, Rpc>.
    const requests = (ObservabilityRpcGroup as unknown as { requests: Map<string, unknown> }).requests;
    const keys = [...requests.keys()];
    expect(keys).toContain('pan.getSnapshot');
    expect(keys).toContain('pan.subscribeDomainEvents');
    expect(keys).toContain('pan.replayEvents');

    // Individual RPCs must also be exported so callers can register handlers.
    expect(GetSnapshotRpc).toBeDefined();
    expect(SubscribeDomainEventsRpc).toBeDefined();
    expect(ReplayEventsRpc).toBeDefined();
  });
});

function waitForSnapshotSequence(
  observability: ObservabilityServiceShape,
  minSequence: number,
) {
  return Effect.gen(function* () {
    let snapshot = yield* observability.getSnapshot;
    for (let attempt = 0; attempt < 20 && snapshot.sequence < minSequence; attempt++) {
      yield* Effect.sleep(Duration.millis(10));
      snapshot = yield* observability.getSnapshot;
    }
    return snapshot;
  });
}
