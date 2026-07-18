/**
 * Optional integration check against a real `kimi acp` installation.
 * Enable with:
 * KIMI_ACP_PROBE=1 VITEST_INCLUDE_SLOW=1 npx vitest run --configLoader runner src/lib/acp/__tests__/kimi-probe.slow.test.ts
 *
 * The probe requires an authenticated Kimi Code CLI installation. Run `kimi`
 * and complete `/login` before enabling it.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";
import { describe, expect, it } from "vitest";

import { makeKimiAcpRuntime } from "../kimi.js";

const probeEnabled = process.env.KIMI_ACP_PROBE === "1";

const terminateChild = (
  childHandle: Ref.Ref<ChildProcessSpawner.ChildProcessHandle | null>,
) =>
  Effect.gen(function* () {
    const handle = yield* Ref.get(childHandle);
    if (handle === null || !(yield* handle.isRunning)) return;

    const terminated = yield* handle.kill().pipe(
      Effect.as(true),
      Effect.timeoutOrElse({
        duration: "5 seconds",
        orElse: () => Effect.succeed(false),
      }),
    );
    if (terminated) return;

    yield* Effect.sync(() => {
      const pid = Number(handle.pid);
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
    });
    yield* handle.exitCode.pipe(
      Effect.ignore,
      Effect.timeoutOrElse({
        duration: "5 seconds",
        orElse: () =>
          Effect.die(new Error(`Kimi ACP process ${handle.pid} did not exit`)),
      }),
    );
  });

const runProbe = Effect.gen(function* () {
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const childHandle = yield* Ref.make<
    ChildProcessSpawner.ChildProcessHandle | null
  >(null);
  const trackedChildProcessSpawner = ChildProcessSpawner.make((command) =>
    childProcessSpawner.spawn(command).pipe(
      Effect.tap((handle) => Ref.set(childHandle, handle)),
    ),
  );
  const runtime = yield* makeKimiAcpRuntime({
    childProcessSpawner: trackedChildProcessSpawner,
    kimiSettings: { binaryPath: "kimi" },
    environment: process.env,
    cwd: process.cwd(),
    clientInfo: { name: "overdeck-kimi-probe", version: "0.0.0" },
  });
  const assistantText = yield* Ref.make("");

  return yield* Effect.gen(function* () {
    const eventFiber = yield* runtime.getEvents().pipe(
      Stream.runForEach((event) => {
        if (event._tag === "EventStreamBarrier") {
          return Deferred.succeed(event.acknowledge, undefined);
        }
        if (event._tag === "ContentDelta") {
          return Ref.update(assistantText, (current) => current + event.text);
        }
        return Effect.void;
      }),
      Effect.forkScoped,
    );

    const started = yield* runtime.start();
    const promptResult = yield* runtime.prompt({
      prompt: [{ type: "text", text: "Reply with the single word pong." }],
    });
    yield* runtime.drainEvents;
    yield* Fiber.interrupt(eventFiber);

    return {
      started,
      promptResult,
      assistantText: yield* Ref.get(assistantText),
    };
  }).pipe(Effect.ensuring(terminateChild(childHandle)));
});

describe.skipIf(!probeEnabled)("Kimi ACP CLI probe", () => {
  it(
    "completes a real prompt round-trip and preserves the resume session id",
    { timeout: 120_000 },
    async () => {
      const result = await Effect.runPromise(
        runProbe.pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
      );

      expect(result.started.initializeResult).toBeDefined();
      expect(result.started.sessionId.trim()).not.toBe("");
      expect(result.promptResult.stopReason).toBe("end_turn");
      expect(result.assistantText.trim().toLowerCase()).toContain("pong");
    },
  );
});
