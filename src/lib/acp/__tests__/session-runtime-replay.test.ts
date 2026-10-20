import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";

import { AcpSessionRuntime, layer } from "../session-runtime.js";
import { createAcpReplaySpawner } from "../replay-spawner.js";
import type { ProtocolFixture } from "../../harness-replay/fixture.js";

const fixturesDir = NodePath.join(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "fixtures/replay",
);

function loadFixture(name: string): ProtocolFixture {
  const filePath = NodePath.join(fixturesDir, `${name}.json`);
  return JSON.parse(NodeFS.readFileSync(filePath, "utf-8")) as ProtocolFixture;
}

const runReplayRuntime = <A>(
  fixture: ProtocolFixture,
  use: (runtime: AcpSessionRuntime["Service"]) => Effect.Effect<A, unknown>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* AcpSessionRuntime;
      return yield* use(runtime);
    }).pipe(
      Effect.provide(
        layer({
          spawn: {
            command: "dummy-replay-binary",
            args: [],
          },
          cwd: "/workspace",
          clientInfo: { name: "overdeck-test", version: "0.0.0" },
          authMethodId: "test",
        }),
      ),
      Effect.scoped,
      Effect.provide(createAcpReplaySpawner(fixture)),
      Effect.provide(NodeServices.layer),
    ),
  );

describe("ACP session-runtime replay integration tests (PAN-4563)", () => {
  it("replays turn completion with session updates and stopReason: end_turn", async () => {
    const fixture = loadFixture("acp-turn-completed");
    const result = await runReplayRuntime(fixture, (runtime) =>
      Effect.gen(function* () {
        const started = yield* runtime.start();
        const promptResult = yield* runtime.prompt({
          prompt: [{ type: "text", text: "Hello ACP agent" }],
        });
        const events = Array.from(
          yield* Stream.runCollect(Stream.take(runtime.getEvents(), 3)),
        );
        return { started, promptResult, events };
      }),
    );

    expect(result.started.sessionId).toBe("acp-session-001");
    expect(result.promptResult).toEqual({ stopReason: "end_turn" });
    expect(result.events.map((e) => e._tag)).toEqual([
      "PlanUpdated",
      "AssistantItemStarted",
      "ContentDelta",
    ]);
    expect(result.events[2]).toMatchObject({
      _tag: "ContentDelta",
      text: "Hello from recorded ACP",
    });
  });

  it("replays interrupt/cancellation during an active prompt", async () => {
    const fixture = loadFixture("acp-interrupt");
    const result = await runReplayRuntime(fixture, (runtime) =>
      Effect.gen(function* () {
        const started = yield* runtime.start();
        const promptFiber = yield* runtime
          .prompt({
            prompt: [
              { type: "text", text: "Run long task that will be cancelled" },
            ],
          })
          .pipe(Effect.forkChild({ startImmediately: true }));
        // Wait for the first event so prompt is underway
        yield* Stream.runHead(runtime.getEvents());
        // Issue cancellation
        yield* runtime.cancel;
        const promptResult = yield* Fiber.join(promptFiber);
        return { started, promptResult };
      }),
    );

    expect(result.started.sessionId).toBe("acp-session-001");
    expect(result.promptResult).toEqual({ stopReason: "cancelled" });
  });
});
