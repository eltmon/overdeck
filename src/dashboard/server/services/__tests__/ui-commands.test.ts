import { describe, expect, it } from 'vitest';
import { Effect, Fiber, Stream } from 'effect';
import type { UiCommand } from '@overdeck/contracts';
import { publishUiCommand, uiCommandStream, uiCommandSubscriberCount } from '../ui-commands.js';

function command(id: string): UiCommand {
  return { id, type: 'open-path', resolution: { projectKey: 'p', rootId: 'project:p', relPath: 'docs', kind: 'dir' } };
}

/** Wait until `n` streams have subscribed (each subscribe happens on its forked fiber). */
const awaitSubscribers = (n: number) =>
  Effect.gen(function* () {
    while (uiCommandSubscriberCount() < n) yield* Effect.yieldNow;
  });

describe('ui command hub', () => {
  it('delivers a command to every running stream and returns the subscriber count', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const a = yield* Stream.runCollect(Stream.take(uiCommandStream(), 1)).pipe(Effect.forkChild);
        const b = yield* Stream.runCollect(Stream.take(uiCommandStream(), 1)).pipe(Effect.forkChild);
        yield* awaitSubscribers(2);
        const delivered = publishUiCommand(command('c1'));
        const got = [yield* Fiber.join(a), yield* Fiber.join(b)];
        return { delivered, got };
      }),
    );
    expect(result.delivered).toBe(2);
    expect(result.got).toEqual([[command('c1')], [command('c1')]]);
    expect(uiCommandSubscriberCount()).toBe(0);
  });

  it('drops the count when one of two streams is interrupted', async () => {
    const count = await Effect.runPromise(
      Effect.gen(function* () {
        const a = yield* Stream.runDrain(uiCommandStream()).pipe(Effect.forkChild);
        const b = yield* Stream.runDrain(uiCommandStream()).pipe(Effect.forkChild);
        yield* awaitSubscribers(2);
        yield* Fiber.interrupt(a);
        const after = uiCommandSubscriberCount();
        yield* Fiber.interrupt(b);
        return after;
      }),
    );
    expect(count).toBe(1);
    expect(uiCommandSubscriberCount()).toBe(0);
  });

  it('never replays a command published before the stream started', async () => {
    expect(publishUiCommand(command('early'))).toBe(0);
    const got = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Stream.runCollect(Stream.take(uiCommandStream(), 1)).pipe(Effect.forkChild);
        yield* awaitSubscribers(1);
        publishUiCommand(command('late'));
        return yield* Fiber.join(fiber);
      }),
    );
    expect(got).toEqual([command('late')]);
  });
});
