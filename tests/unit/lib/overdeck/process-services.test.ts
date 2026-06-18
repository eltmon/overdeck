import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Effect, Layer, Stream } from 'effect';

import {
  EventBus,
  type OverdeckEventInput,
  type StoredOverdeckEvent,
} from '../../../../src/lib/overdeck/infra.js';
import {
  AgentPermissions,
  AgentPermissionsLive,
  DeliveryService,
  PermissionDeliveryFailed,
  PermissionPersistenceFailed,
  PermissionRequestConflict,
  WrongAgentPermissionResponse,
  type AgentId,
  type PermissionBehavior,
  type PermissionRequestId,
} from '../../../../src/lib/overdeck/process-services.js';

function agentId(value: string): AgentId {
  return value as AgentId;
}

function requestId(value: string): PermissionRequestId {
  return value as PermissionRequestId;
}

interface InMemoryEventBusFixture {
  readonly layer: Layer.Layer<EventBus>;
  readonly emitted: string[];
}

function makeEventBusFixture(options: { failOnType?: string } = {}): InMemoryEventBusFixture {
  const events: StoredOverdeckEvent[] = [];
  const emitted: string[] = [];

  return {
    emitted,
    layer: Layer.succeed(
      EventBus,
      EventBus.of({
        emit: (event: OverdeckEventInput) =>
          Effect.sync(() => {
            if (event.type === options.failOnType) {
              throw new Error(`failed ${event.type}`);
            }
            const timestamp = event.timestamp instanceof Date
              ? event.timestamp
              : new Date(event.timestamp ?? Date.now());
            const stored: StoredOverdeckEvent = {
              sequence: events.length + 1,
              type: event.type,
              timestamp,
              payload: event.payload ?? null,
            };
            events.push(stored);
            emitted.push(event.type);
            return stored.sequence;
          }),
        readFrom: (fromSequence) =>
          Effect.sync(() => events.filter((event) => event.sequence > fromSequence)),
        getLatestSequence: Effect.sync(() => events.at(-1)?.sequence ?? 0),
        stream: Stream.empty,
      }),
    ),
  };
}

function makeDeliveryLayer(options: {
  readonly order?: string[];
  readonly failPermissionDecision?: boolean;
} = {}): Layer.Layer<DeliveryService> {
  return Layer.succeed(
    DeliveryService,
    DeliveryService.of({
      tell: () => Effect.succeed({ ok: true, path: 'tmux' as const }),
      poke: () => Effect.succeed({ ok: true, path: 'tmux' as const }),
      permissionDecision: () =>
        options.failPermissionDecision
          ? Effect.fail(new Error('bridge offline'))
          : Effect.sync(() => {
            options.order?.push('deliver');
          }),
    }),
  );
}

function permissionProgram<A>(
  effect: Effect.Effect<A, unknown, AgentPermissions>,
  options: {
    readonly eventBus?: InMemoryEventBusFixture;
    readonly delivery?: Layer.Layer<DeliveryService>;
  } = {},
): Promise<A> {
  const eventBus = options.eventBus ?? makeEventBusFixture();
  const delivery = options.delivery ?? makeDeliveryLayer();
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(AgentPermissionsLive),
      Effect.provide(delivery),
      Effect.provide(eventBus.layer),
    ),
  );
}

describe('overdeck process services', () => {
  it('requests permissions through EventBus and exposes pending requests', async () => {
    const eventBus = makeEventBusFixture();

    const pending = await permissionProgram(
      Effect.gen(function* () {
        const permissions = yield* AgentPermissions;
        yield* permissions.request({
          agentId: agentId('agent-pan-1938'),
          requestId: requestId('perm-1'),
          issueId: 'PAN-1938',
          toolName: 'Bash',
          description: 'run tests',
          inputPreview: 'npm test',
        });
        return yield* permissions.pending(agentId('agent-pan-1938'));
      }),
      { eventBus },
    );

    expect(eventBus.emitted).toEqual([
      'agent.permission_requested',
      'agent.waiting_started',
    ]);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.toolName).toBe('Bash');
  });

  it('persists permission resolution events before delivering to the agent', async () => {
    const eventBus = makeEventBusFixture();
    const order = eventBus.emitted;

    const result = await permissionProgram(
      Effect.gen(function* () {
        const permissions = yield* AgentPermissions;
        yield* permissions.request({
          agentId: agentId('agent-pan-1938'),
          requestId: requestId('perm-1'),
          toolName: 'Bash',
          description: 'run tests',
        });
        return yield* permissions.resolve({
          agentId: agentId('agent-pan-1938'),
          requestId: requestId('perm-1'),
          behavior: 'allow' as PermissionBehavior,
        });
      }),
      { eventBus, delivery: makeDeliveryLayer({ order }) },
    );

    expect(result).toEqual({ ok: true, duplicate: false });
    expect(order).toEqual([
      'agent.permission_requested',
      'agent.waiting_started',
      'agent.permission_resolved',
      'agent.waiting_cleared',
      'deliver',
    ]);
  });

  it('redelivers duplicate matching permission responses idempotently', async () => {
    const eventBus = makeEventBusFixture();

    const result = await permissionProgram(
      Effect.gen(function* () {
        const permissions = yield* AgentPermissions;
        yield* permissions.request({
          agentId: agentId('agent-pan-1938'),
          requestId: requestId('perm-1'),
          toolName: 'Bash',
          description: 'run tests',
        });
        yield* permissions.resolve({
          agentId: agentId('agent-pan-1938'),
          requestId: requestId('perm-1'),
          behavior: 'allow' as PermissionBehavior,
        });
        return yield* permissions.resolve({
          agentId: agentId('agent-pan-1938'),
          requestId: requestId('perm-1'),
          behavior: 'allow' as PermissionBehavior,
        });
      }),
      { eventBus },
    );

    expect(result).toEqual({ ok: true, duplicate: true });
  });

  it('fails conflicting duplicate responses without redelivery', async () => {
    const eventBus = makeEventBusFixture();

    const failure = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const permissions = yield* AgentPermissions;
        yield* permissions.request({
          agentId: agentId('agent-pan-1938'),
          requestId: requestId('perm-1'),
          toolName: 'Bash',
          description: 'run tests',
        });
        yield* permissions.resolve({
          agentId: agentId('agent-pan-1938'),
          requestId: requestId('perm-1'),
          behavior: 'allow' as PermissionBehavior,
        });
        return yield* permissions.resolve({
          agentId: agentId('agent-pan-1938'),
          requestId: requestId('perm-1'),
          behavior: 'deny' as PermissionBehavior,
        });
      }).pipe(
        Effect.provide(AgentPermissionsLive),
        Effect.provide(makeDeliveryLayer()),
        Effect.provide(eventBus.layer),
      ),
    );

    expect(failure._tag).toBe('Failure');
    if (failure._tag === 'Failure') {
      expect(String(failure.cause)).toContain(PermissionRequestConflict.name);
    }
  });

  it('fails wrong-agent permission responses', async () => {
    const eventBus = makeEventBusFixture();

    const failure = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const permissions = yield* AgentPermissions;
        yield* permissions.request({
          agentId: agentId('agent-pan-1938'),
          requestId: requestId('perm-1'),
          toolName: 'Bash',
          description: 'run tests',
        });
        return yield* permissions.resolve({
          agentId: agentId('agent-other'),
          requestId: requestId('perm-1'),
          behavior: 'allow' as PermissionBehavior,
        });
      }).pipe(
        Effect.provide(AgentPermissionsLive),
        Effect.provide(makeDeliveryLayer()),
        Effect.provide(eventBus.layer),
      ),
    );

    expect(failure._tag).toBe('Failure');
    if (failure._tag === 'Failure') {
      expect(String(failure.cause)).toContain(WrongAgentPermissionResponse.name);
    }
  });

  it('fails persistence before delivery when resolution events cannot be appended', async () => {
    const eventBus = makeEventBusFixture({ failOnType: 'agent.permission_resolved' });
    const order: string[] = [];

    const failure = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const permissions = yield* AgentPermissions;
        yield* permissions.request({
          agentId: agentId('agent-pan-1938'),
          requestId: requestId('perm-1'),
          toolName: 'Bash',
          description: 'run tests',
        });
        return yield* permissions.resolve({
          agentId: agentId('agent-pan-1938'),
          requestId: requestId('perm-1'),
          behavior: 'allow' as PermissionBehavior,
        });
      }).pipe(
        Effect.provide(AgentPermissionsLive),
        Effect.provide(makeDeliveryLayer({ order })),
        Effect.provide(eventBus.layer),
      ),
    );

    expect(failure._tag).toBe('Failure');
    if (failure._tag === 'Failure') {
      expect(String(failure.cause)).toContain(PermissionPersistenceFailed.name);
    }
    expect(order).toEqual([]);
  });

  it('fails delivery after resolution events persist', async () => {
    const eventBus = makeEventBusFixture();

    const failure = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const permissions = yield* AgentPermissions;
        yield* permissions.request({
          agentId: agentId('agent-pan-1938'),
          requestId: requestId('perm-1'),
          toolName: 'Bash',
          description: 'run tests',
        });
        return yield* permissions.resolve({
          agentId: agentId('agent-pan-1938'),
          requestId: requestId('perm-1'),
          behavior: 'allow' as PermissionBehavior,
        });
      }).pipe(
        Effect.provide(AgentPermissionsLive),
        Effect.provide(makeDeliveryLayer({ failPermissionDecision: true })),
        Effect.provide(eventBus.layer),
      ),
    );

    expect(failure._tag).toBe('Failure');
    if (failure._tag === 'Failure') {
      expect(String(failure.cause)).toContain(PermissionDeliveryFailed.name);
    }
    expect(eventBus.emitted).toContain('agent.permission_resolved');
    expect(eventBus.emitted).toContain('agent.waiting_cleared');
  });

  it('does not import Db in the process service module', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/lib/overdeck/process-services.ts'),
      'utf-8',
    );

    expect(source).not.toMatch(/\bDb\b/);
    expect(source).not.toMatch(/from ['"]\.\/infra\.js['"].*\bDb\b/s);
  });
});
