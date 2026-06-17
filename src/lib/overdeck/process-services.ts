import { Cause, Context, Effect, Layer, Schema } from 'effect';

import {
  deliverAgentMessage,
  deliverAgentPermissionDecision,
  type DeliveryResult,
} from '../agents.js';
import { getCloisterService, type CloisterStatus } from '../cloister/service.js';
import { EventBus, type StoredOverdeckEvent } from './infra.js';

export const AgentId = Schema.String.pipe(Schema.brand('AgentId'));
export type AgentId = typeof AgentId.Type;

export const PermissionRequestId = Schema.String.pipe(Schema.brand('PermissionRequestId'));
export type PermissionRequestId = typeof PermissionRequestId.Type;

export const PermissionBehavior = Schema.Literals(['allow', 'deny']);
export type PermissionBehavior = typeof PermissionBehavior.Type;

export const PermissionRequest = Schema.Struct({
  requestId: PermissionRequestId,
  agentId: AgentId,
  issueId: Schema.NullOr(Schema.String),
  toolName: Schema.String,
  description: Schema.String,
  inputPreview: Schema.String,
  createdAt: Schema.Date,
});
export type PermissionRequest = typeof PermissionRequest.Type;

export const PermissionDecision = Schema.Struct({
  requestId: PermissionRequestId,
  agentId: AgentId,
  issueId: Schema.NullOr(Schema.String),
  behavior: PermissionBehavior,
  resolvedAt: Schema.Date,
});
export type PermissionDecision = typeof PermissionDecision.Type;

export class PermissionRequestConflict extends Schema.TaggedErrorClass<PermissionRequestConflict>()(
  'PermissionRequestConflict',
  {
    requestId: PermissionRequestId,
    message: Schema.String,
  },
) {}

export class PermissionRequestNotFound extends Schema.TaggedErrorClass<PermissionRequestNotFound>()(
  'PermissionRequestNotFound',
  { requestId: PermissionRequestId },
) {}

export class WrongAgentPermissionResponse extends Schema.TaggedErrorClass<WrongAgentPermissionResponse>()(
  'WrongAgentPermissionResponse',
  {
    requestId: PermissionRequestId,
    expectedAgentId: AgentId,
    actualAgentId: AgentId,
  },
) {}

export class PermissionPersistenceFailed extends Schema.TaggedErrorClass<PermissionPersistenceFailed>()(
  'PermissionPersistenceFailed',
  {
    requestId: PermissionRequestId,
    message: Schema.String,
  },
) {}

export class PermissionDeliveryFailed extends Schema.TaggedErrorClass<PermissionDeliveryFailed>()(
  'PermissionDeliveryFailed',
  {
    requestId: PermissionRequestId,
    message: Schema.String,
  },
) {}

export type AgentPermissionsError =
  | PermissionRequestConflict
  | PermissionRequestNotFound
  | WrongAgentPermissionResponse
  | PermissionPersistenceFailed
  | PermissionDeliveryFailed;

export interface PermissionRequestInput {
  readonly requestId: PermissionRequestId;
  readonly agentId: AgentId;
  readonly issueId?: string | null;
  readonly toolName: string;
  readonly description: string;
  readonly inputPreview?: string;
}

export interface PermissionResolveInput {
  readonly agentId: AgentId;
  readonly requestId: PermissionRequestId;
  readonly behavior: PermissionBehavior;
}

export interface PermissionResolveResult {
  readonly ok: true;
  readonly duplicate: boolean;
}

export interface DeliveryServiceShape {
  readonly tell: (
    agentId: AgentId,
    message: string,
    caller?: string,
    deliveryMethod?: 'auto' | 'supervisor' | 'channels' | 'tmux',
  ) => Effect.Effect<DeliveryResult, Error>;
  readonly poke: (agentId: AgentId, message?: string) => Effect.Effect<DeliveryResult, Error>;
  readonly permissionDecision: (
    agentId: AgentId,
    requestId: PermissionRequestId,
    behavior: PermissionBehavior,
  ) => Effect.Effect<void, Error>;
}

export class DeliveryService extends Context.Service<DeliveryService, DeliveryServiceShape>()(
  'overdeck/DeliveryService',
) {}

const defaultPokeMessage =
  "You seem to have been inactive for a while. If you're stuck:\n"
  + '1. Check your current task in continue.vbrief.json\n'
  + '2. Try an alternative approach if blocked\n'
  + '3. Ask for help if needed\n\n'
  + "What's your current status?";

export const DeliveryServiceLive = Layer.succeed(
  DeliveryService,
  DeliveryService.of({
    tell: (agentId, message, caller = 'overdeck', deliveryMethod) =>
      Effect.tryPromise({
        try: () => deliverAgentMessage(agentId, message, caller, deliveryMethod),
        catch: (error) => error instanceof Error ? error : new Error(String(error)),
      }),
    poke: (agentId, message = defaultPokeMessage) =>
      Effect.tryPromise({
        try: () => deliverAgentMessage(agentId, message, 'overdeck.poke'),
        catch: (error) => error instanceof Error ? error : new Error(String(error)),
      }),
    permissionDecision: (agentId, requestId, behavior) =>
      Effect.tryPromise({
        try: () => deliverAgentPermissionDecision(agentId, requestId, behavior),
        catch: (error) => error instanceof Error ? error : new Error(String(error)),
      }),
  }),
);

export interface ConversationRuntimeShape {
  readonly spawn: (name: string) => Effect.Effect<void, Error>;
  readonly stop: (name: string) => Effect.Effect<void, Error>;
  readonly resume: (name: string) => Effect.Effect<void, Error>;
  readonly restart: (name: string) => Effect.Effect<void, Error>;
  readonly deliver: (name: string, message: string) => Effect.Effect<void, Error>;
  readonly setDeliveryMethod: (name: string, method: string) => Effect.Effect<void, Error>;
  readonly approve: (name: string, requestId: string, behavior: PermissionBehavior) => Effect.Effect<void, Error>;
  readonly planAction: (name: string, action: string, message?: string) => Effect.Effect<void, Error>;
  readonly stageAttachment: (name: string, filePath: string) => Effect.Effect<void, Error>;
  readonly removeAttachment: (name: string, filePath: string) => Effect.Effect<void, Error>;
  readonly pendingInput: () => Effect.Effect<ReadonlyArray<unknown>, Error>;
}

export class ConversationRuntime extends Context.Service<ConversationRuntime, ConversationRuntimeShape>()(
  'overdeck/ConversationRuntime',
) {}

export interface ConversationRuntimeDeps {
  readonly spawn: (name: string) => Promise<void>;
  readonly stop: (name: string) => Promise<void>;
  readonly resume: (name: string) => Promise<void>;
  readonly restart: (name: string) => Promise<void>;
  readonly deliver: (name: string, message: string) => Promise<void>;
  readonly setDeliveryMethod: (name: string, method: string) => Promise<void>;
  readonly approve: (name: string, requestId: string, behavior: PermissionBehavior) => Promise<void>;
  readonly planAction: (name: string, action: string, message?: string) => Promise<void>;
  readonly stageAttachment: (name: string, filePath: string) => Promise<void>;
  readonly removeAttachment: (name: string, filePath: string) => Promise<void>;
  readonly pendingInput: () => Promise<ReadonlyArray<unknown>>;
}

export function makeConversationRuntimeLive(deps: ConversationRuntimeDeps): Layer.Layer<ConversationRuntime> {
  const wrap = <A>(run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (error) => error instanceof Error ? error : new Error(String(error)),
    });

  return Layer.succeed(
    ConversationRuntime,
    ConversationRuntime.of({
      spawn: (name) => wrap(() => deps.spawn(name)),
      stop: (name) => wrap(() => deps.stop(name)),
      resume: (name) => wrap(() => deps.resume(name)),
      restart: (name) => wrap(() => deps.restart(name)),
      deliver: (name, message) => wrap(() => deps.deliver(name, message)),
      setDeliveryMethod: (name, method) => wrap(() => deps.setDeliveryMethod(name, method)),
      approve: (name, requestId, behavior) => wrap(() => deps.approve(name, requestId, behavior)),
      planAction: (name, action, message) => wrap(() => deps.planAction(name, action, message)),
      stageAttachment: (name, filePath) => wrap(() => deps.stageAttachment(name, filePath)),
      removeAttachment: (name, filePath) => wrap(() => deps.removeAttachment(name, filePath)),
      pendingInput: () => wrap(() => deps.pendingInput()),
    }),
  );
}

export interface CloisterRuntimeShape {
  readonly start: Effect.Effect<void, Error>;
  readonly stop: Effect.Effect<void, Error>;
  readonly resumeSpawns: Effect.Effect<void, Error>;
  readonly isSpawnPaused: Effect.Effect<boolean, Error>;
  readonly getStatus: Effect.Effect<CloisterStatus, Error>;
}

export class CloisterRuntime extends Context.Service<CloisterRuntime, CloisterRuntimeShape>()(
  'overdeck/CloisterRuntime',
) {}

export const CloisterRuntimeLive = Layer.succeed(
  CloisterRuntime,
  CloisterRuntime.of({
    start: Effect.tryPromise({
      try: () => getCloisterService().start(),
      catch: (error) => error instanceof Error ? error : new Error(String(error)),
    }),
    stop: Effect.try({
      try: () => getCloisterService().stop(),
      catch: (error) => error instanceof Error ? error : new Error(String(error)),
    }),
    resumeSpawns: Effect.try({
      try: () => getCloisterService().resumeSpawns(),
      catch: (error) => error instanceof Error ? error : new Error(String(error)),
    }),
    isSpawnPaused: Effect.try({
      try: () => getCloisterService().isSpawnPaused(),
      catch: (error) => error instanceof Error ? error : new Error(String(error)),
    }),
    getStatus: Effect.try({
      try: () => getCloisterService().getStatus(),
      catch: (error) => error instanceof Error ? error : new Error(String(error)),
    }),
  }),
);

export interface AgentPermissionsShape {
  readonly request: (input: PermissionRequestInput) => Effect.Effect<PermissionRequest, AgentPermissionsError>;
  readonly resolve: (input: PermissionResolveInput) => Effect.Effect<PermissionResolveResult, AgentPermissionsError>;
  readonly pending: (agentId?: AgentId) => Effect.Effect<ReadonlyArray<PermissionRequest>>;
}

export class AgentPermissions extends Context.Service<AgentPermissions, AgentPermissionsShape>()(
  'overdeck/AgentPermissions',
) {}

function causeMessage(cause: Cause.Cause<unknown>): string {
  return Cause.pretty(cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function decodePermissionRequest(event: StoredOverdeckEvent): PermissionRequest | null {
  if (event.type !== 'agent.permission_requested' || !isRecord(event.payload)) {
    return null;
  }
  const payload = event.payload;
  const result = Schema.decodeUnknownResult(PermissionRequest)({
    requestId: payload['requestId'],
    agentId: payload['agentId'],
    issueId: payload['issueId'] ?? null,
    toolName: payload['toolName'],
    description: payload['description'],
    inputPreview: payload['inputPreview'] ?? '',
    createdAt: payload['createdAt'] ? new Date(String(payload['createdAt'])) : event.timestamp,
  });
  return result._tag === 'Success' ? result.success : null;
}

function decodePermissionDecision(event: StoredOverdeckEvent): PermissionDecision | null {
  if (event.type !== 'agent.permission_resolved' || !isRecord(event.payload)) {
    return null;
  }
  const payload = event.payload;
  const result = Schema.decodeUnknownResult(PermissionDecision)({
    requestId: payload['requestId'],
    agentId: payload['agentId'],
    issueId: payload['issueId'] ?? null,
    behavior: payload['behavior'],
    resolvedAt: payload['resolvedAt'] ? new Date(String(payload['resolvedAt'])) : event.timestamp,
  });
  return result._tag === 'Success' ? result.success : null;
}

function permissionState(events: ReadonlyArray<StoredOverdeckEvent>): {
  readonly pending: ReadonlyMap<string, PermissionRequest>;
  readonly resolved: ReadonlyMap<string, PermissionDecision>;
} {
  const pending = new Map<string, PermissionRequest>();
  const resolved = new Map<string, PermissionDecision>();

  for (const event of events) {
    const request = decodePermissionRequest(event);
    if (request) {
      pending.set(request.requestId, request);
      continue;
    }

    const decision = decodePermissionDecision(event);
    if (decision) {
      pending.delete(decision.requestId);
      resolved.set(decision.requestId, decision);
    }
  }

  return { pending, resolved };
}

function failPersistence(requestId: PermissionRequestId, cause: Cause.Cause<unknown>) {
  return Effect.fail(new PermissionPersistenceFailed({
    requestId,
    message: causeMessage(cause),
  }));
}

export const AgentPermissionsLive = Layer.effect(
  AgentPermissions,
  Effect.gen(function* () {
    const bus = yield* EventBus;
    const delivery = yield* DeliveryService;

    const readState = bus.readFrom(0).pipe(Effect.map(permissionState));

    const emit = (requestId: PermissionRequestId, event: { type: string; payload: unknown; timestamp?: Date }) =>
      bus.emit(event).pipe(
        Effect.catchCause((cause) => failPersistence(requestId, cause)),
      );

    const pending = (agentId?: AgentId) =>
      readState.pipe(
        Effect.map((state) =>
          Array.from(state.pending.values())
            .filter((request) => agentId === undefined || request.agentId === agentId),
        ),
      );

    const request = (input: PermissionRequestInput) =>
      Effect.gen(function* () {
        const state = yield* readState;
        const existing = state.pending.get(input.requestId);
        if (existing) {
          if (existing.agentId !== input.agentId) {
            return yield* Effect.fail(new PermissionRequestConflict({
              requestId: input.requestId,
              message: `permission request ${input.requestId} belongs to ${existing.agentId}`,
            }));
          }
          return existing;
        }

        const timestamp = new Date();
        const next = Schema.decodeUnknownSync(PermissionRequest)({
          requestId: input.requestId,
          agentId: input.agentId,
          issueId: input.issueId ?? null,
          toolName: input.toolName,
          description: input.description,
          inputPreview: input.inputPreview ?? '',
          createdAt: timestamp,
        });

        yield* emit(input.requestId, {
          type: 'agent.permission_requested',
          timestamp,
          payload: {
            requestId: next.requestId,
            agentId: next.agentId,
            issueId: next.issueId,
            toolName: next.toolName,
            description: next.description,
            inputPreview: next.inputPreview,
            createdAt: next.createdAt.toISOString(),
          },
        });
        yield* emit(input.requestId, {
          type: 'agent.waiting_started',
          timestamp,
          payload: {
            agentId: input.agentId,
            reason: 'tool_permission',
            message: `Waiting for permission: ${input.toolName} - ${input.description}`,
          },
        });

        return next;
      });

    const resolve = (input: PermissionResolveInput) =>
      Effect.gen(function* () {
        const state = yield* readState;
        const pendingRequest = state.pending.get(input.requestId);

        if (pendingRequest) {
          if (pendingRequest.agentId !== input.agentId) {
            return yield* Effect.fail(new WrongAgentPermissionResponse({
              requestId: input.requestId,
              expectedAgentId: pendingRequest.agentId,
              actualAgentId: input.agentId,
            }));
          }

          const timestamp = new Date();
          yield* emit(input.requestId, {
            type: 'agent.permission_resolved',
            timestamp,
            payload: {
              requestId: pendingRequest.requestId,
              agentId: pendingRequest.agentId,
              issueId: pendingRequest.issueId,
              behavior: input.behavior,
              resolvedAt: timestamp.toISOString(),
            },
          });
          yield* emit(input.requestId, {
            type: 'agent.waiting_cleared',
            timestamp,
            payload: {
              agentId: pendingRequest.agentId,
              clearedBy: 'tool_resumed',
            },
          });
          yield* delivery.permissionDecision(input.agentId, input.requestId, input.behavior).pipe(
            Effect.catchCause((cause) =>
              Effect.fail(new PermissionDeliveryFailed({
                requestId: input.requestId,
                message: causeMessage(cause),
              })),
            ),
          );
          return { ok: true as const, duplicate: false };
        }

        const resolved = state.resolved.get(input.requestId);
        if (!resolved) {
          return yield* Effect.fail(new PermissionRequestNotFound({ requestId: input.requestId }));
        }
        if (resolved.agentId !== input.agentId) {
          return yield* Effect.fail(new WrongAgentPermissionResponse({
            requestId: input.requestId,
            expectedAgentId: resolved.agentId,
            actualAgentId: input.agentId,
          }));
        }
        if (resolved.behavior !== input.behavior) {
          return yield* Effect.fail(new PermissionRequestConflict({
            requestId: input.requestId,
            message: `permission request ${input.requestId} was already ${resolved.behavior}`,
          }));
        }

        yield* delivery.permissionDecision(input.agentId, input.requestId, input.behavior).pipe(
          Effect.catchCause((cause) =>
            Effect.fail(new PermissionDeliveryFailed({
              requestId: input.requestId,
              message: causeMessage(cause),
            })),
          ),
        );
        return { ok: true as const, duplicate: true };
      });

    return AgentPermissions.of({ request, resolve, pending });
  }),
);

export const ProcessServicesLive = Layer.mergeAll(
  DeliveryServiceLive,
  CloisterRuntimeLive,
  AgentPermissionsLive,
);

export const emptyConversationRuntimeLive = makeConversationRuntimeLive({
  spawn: async () => {},
  stop: async () => {},
  resume: async () => {},
  restart: async () => {},
  deliver: async () => {},
  setDeliveryMethod: async () => {},
  approve: async () => {},
  planAction: async () => {},
  stageAttachment: async () => {},
  removeAttachment: async () => {},
  pendingInput: async () => [],
});

export const EmptyProcessServicesLive = Layer.mergeAll(
  ProcessServicesLive,
  emptyConversationRuntimeLive,
);
