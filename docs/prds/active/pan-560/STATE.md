# State: PAN-560 Planning

## Issue
**PAN-560:** RallyClient Effect service crashes on dashboard startup in v0.6.0

## Root Cause

`RallyClientOptionalLive` at `src/dashboard/server/services/rally-client.ts:147`:

```typescript
return yield* RallyClient.pipe(Effect.provide(RallyClientLive));
```

`RallyClient` is a `ServiceMap.Service` tag (a class), NOT an `Effect`. Calling `.pipe(Effect.provide(RallyClientLive))` on a Service tag is invalid — the Fiber runtime receives a raw Service object where it expects a valid Effect, causing:

```
Error: Fiber.runLoop: Not a valid effect: { "_id": "Service", "key": "overdeck/dashboard/RallyClient" }
```

## Fix

Replace `Layer.effect` + broken delegation with `Layer.unwrap` + `Effect.gen`, which properly handles conditional Layer returns:

```typescript
export const RallyClientOptionalLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = getRallyConfig();
    if (!config) {
      const fail = Effect.fail(new TrackerNotConfigured({ tracker: 'rally' }));
      return Layer.succeed(RallyClient, {
        getIssue: () => fail,
        updateState: () => fail,
        addComment: () => fail,
      } satisfies RallyClientShape);
    }
    // Config exists — delegate to RallyClientLive
    return RallyClientLive;
  }),
);
```

**Why this works:**
- `Layer.unwrap(Effect<Layer<A>>)` unwraps an Effect returning a Layer into a Layer
- `Effect.gen` allows conditional logic returning different Layers
- `Layer.succeed(ServiceTag, impl)` creates a Layer that provides the implementation directly
- No more broken `yield* Service.pipe(Effect.provide(...))` anti-pattern

## Affected File
- `src/dashboard/server/services/rally-client.ts`

## Acceptance Criteria
1. Dashboard starts without `Fiber.runLoop` crash
2. When Rally is not configured, the service returns `TrackerNotConfigured` errors (not crash)
3. Existing rally-client tests continue to pass

## Difficulty: Simple
Single file bug fix, obvious correct change.
