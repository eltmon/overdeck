// UI command hub (PAN-5349 O-D4): an in-memory channel from the server to
// open dashboard tabs. Commands are never stored and never replayed: a
// subscriber receives only what is published after its stream starts.
//
// Module-level on purpose (no Effect layer), so `server.ts` needs no wiring.
// Not to be confused with the `PanOpen` service in `services/open.ts`, which
// opens files in an external editor or browser.
import { Effect, PubSub, Stream } from 'effect';
import type { UiCommand } from '@overdeck/contracts';

const pubsub = Effect.runSync(PubSub.unbounded<UiCommand>());
let subscribers = 0;

/** Publish a command to every live subscriber; returns how many there were. */
export function publishUiCommand(cmd: UiCommand): number {
  const delivered = subscribers;
  PubSub.publishUnsafe(pubsub, cmd);
  return delivered;
}

/** The number of streams subscribed right now. */
export function uiCommandSubscriberCount(): number {
  return subscribers;
}

/** A stream of the commands published while it runs (`pan.subscribeUiCommands`). */
export function uiCommandStream(): Stream.Stream<UiCommand> {
  return Stream.unwrap(
    Effect.gen(function* () {
      // Subscribe first, then count, so a publish that sees this subscriber also reaches it.
      const subscription = yield* PubSub.subscribe(pubsub);
      subscribers += 1;
      yield* Effect.addFinalizer(() => Effect.sync(() => { subscribers -= 1; }));
      return Stream.fromSubscription(subscription);
    }),
  );
}
