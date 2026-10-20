/**
 * ACP replay spawner layer (PAN-4563).
 *
 * Provides a ChildProcessSpawner layer backed by a recorded ACP protocol fixture,
 * allowing AcpSessionRuntime to execute against realistic provider event timing,
 * session updates, and stop reasons without any external process or network.
 */
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ReplayEngine } from "../harness-replay/replay-engine.js";
import type { ProtocolFixture } from "../harness-replay/fixture.js";

export interface AcpReplayOptions {
  readonly strict?: boolean;
}

export function createAcpReplaySpawner(
  fixture: ProtocolFixture,
  options: AcpReplayOptions = {},
): Layer.Layer<ChildProcessSpawner.ChildProcessSpawner> {
  return Layer.effect(
    ChildProcessSpawner.ChildProcessSpawner,
    Effect.gen(function* () {
      const agentToRuntime = yield* Queue.unbounded<
        Uint8Array,
        Cause.Done<void>
      >();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      let buffer = "";

      const engine = new ReplayEngine(fixture, {
        strict: options.strict ?? false,
        onIncoming(message) {
          const line =
            (typeof message === "string" ? message : JSON.stringify(message)) +
            "\n";
          Effect.runSync(Queue.offer(agentToRuntime, encoder.encode(line)));
        },
      });

      engine.start();

      const stdout = Stream.fromQueue(agentToRuntime);

      return ChildProcessSpawner.make(() =>
        Effect.succeed(
          ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(1),
            exitCode: Effect.never,
            isRunning: Effect.succeed(true),
            kill: () => Effect.void,
            stdin: Sink.forEach((chunk: Uint8Array) =>
              Effect.sync(() => {
                buffer += decoder.decode(chunk, { stream: true });
                for (;;) {
                  const newline = buffer.indexOf("\n");
                  if (newline < 0) break;
                  const line = buffer.slice(0, newline).trim();
                  buffer = buffer.slice(newline + 1);
                  if (line) {
                    try {
                      const message = JSON.parse(line);
                      engine.handleOutgoing(message);
                    } catch {
                      engine.handleOutgoing(line);
                    }
                  }
                }
              }),
            ),
            stdout,
            stderr: Stream.empty,
            all: stdout,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
            unref: Effect.succeed(Effect.void),
          }),
        ),
      );
    }),
  );
}
