import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as AcpAgent from "effect-acp/agent";
import * as EffectAcpErrors from "effect-acp/errors";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AcpSessionRuntime, layer } from "../session-runtime.js";

const fixturePath = NodePath.join(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "fixtures/acp-mock-peer.ts",
);

const runtimeOptions = (env: NodeJS.ProcessEnv = {}) => ({
  spawn: {
    command: process.execPath,
    args: ["--import", "tsx", fixturePath],
    env,
  },
  cwd: process.cwd(),
  clientInfo: { name: "overdeck-test", version: "0.0.0" },
  authMethodId: "test",
});

const runRuntime = <A>(
  env: NodeJS.ProcessEnv,
  use: (runtime: AcpSessionRuntime["Service"]) => Effect.Effect<A, EffectAcpErrors.AcpError>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* AcpSessionRuntime;
      return yield* use(runtime);
    }).pipe(
      Effect.provide(layer(runtimeOptions(env))),
      Effect.scoped,
      Effect.provide(NodeServices.layer),
    ),
  );

const makeReplaySpawner = (onReplaySent: () => void) =>
  Effect.gen(function* () {
    const runtimeToAgent = yield* Queue.unbounded<Uint8Array, Cause.Done<void>>();
    const agentToRuntime = yield* Queue.unbounded<Uint8Array, Cause.Done<void>>();
    const encoder = new TextEncoder();

    const stdio = Stdio.make({
      args: Effect.succeed([]),
      stdin: Stream.fromQueue(runtimeToAgent),
      stdout: () =>
        Sink.forEach((chunk: string | Uint8Array) =>
          Queue.offer(
            agentToRuntime,
            typeof chunk === "string" ? encoder.encode(chunk) : chunk,
          ),
        ),
      stderr: () => Sink.drain,
    });

    return ChildProcessSpawner.make(() =>
      Effect.gen(function* () {
        const context = yield* Layer.build(AcpAgent.layer(stdio));
        yield* Effect.gen(function* () {
          const agent = yield* AcpAgent.AcpAgent;
          yield* agent.handleInitialize(() =>
            Effect.succeed({
              protocolVersion: 1,
              agentCapabilities: { loadSession: true },
              agentInfo: { name: "in-memory-acp-mock", version: "0.0.0" },
            }),
          );
          yield* agent.handleAuthenticate(() => Effect.succeed({}));
          yield* agent.handleLoadSession((request) =>
            Effect.gen(function* () {
              yield* agent.client.sessionUpdate({
                _meta: { isReplay: true },
                sessionId: request.sessionId,
                update: {
                  sessionUpdate: "tool_call",
                  toolCallId: "replay-tool-1",
                  title: "Replay tool",
                  kind: "search",
                  status: "completed",
                },
              });
              yield* agent.client.sessionUpdate({
                sessionId: request.sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "replayed assistant text" },
                },
              });
              yield* Effect.sync(onReplaySent);
              return yield* Effect.never;
            }),
          );
          yield* agent.handlePrompt((request) =>
            Effect.gen(function* () {
              yield* agent.client.sessionUpdate({
                sessionId: request.sessionId,
                update: {
                  sessionUpdate: "plan",
                  entries: [
                    {
                      content: "Continue after replay",
                      priority: "high",
                      status: "completed",
                    },
                  ],
                },
              });
              yield* agent.client.sessionUpdate({
                sessionId: request.sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "hello after replay" },
                },
              });
              return { stopReason: "end_turn" as const };
            }),
          );
        }).pipe(Effect.provide(context));

        const stdout = Stream.fromQueue(agentToRuntime);
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.never,
          isRunning: Effect.succeed(true),
          kill: () => Effect.void,
          stdin: Sink.forEach((chunk: Uint8Array) => Queue.offer(runtimeToAgent, chunk)),
          stdout,
          stderr: Stream.empty,
          all: stdout,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        });
      }),
    );
  });

describe("AcpSessionRuntime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts, prompts, and emits parsed session updates through a subprocess", async () => {
    const result = await runRuntime({}, (runtime) =>
      Effect.gen(function* () {
        const started = yield* runtime.start();
        const promptResult = yield* runtime.prompt({
          prompt: [{ type: "text", text: "hello" }],
        });
        const events = Array.from(
          yield* Stream.runCollect(Stream.take(runtime.getEvents(), 4)),
        );
        return { started, promptResult, events };
      }),
    );

    expect(result.started.sessionId).toBe("mock-session-1");
    expect(result.promptResult).toEqual({ stopReason: "end_turn" });
    expect(result.events.map((event) => event._tag)).toEqual([
      "PlanUpdated",
      "AssistantItemStarted",
      "ContentDelta",
      "AssistantItemCompleted",
    ]);
    expect(result.events[2]).toMatchObject({
      _tag: "ContentDelta",
      text: "hello from mock",
    });
  });

  it("suppresses load replay updates and resolves the replay-idle gate with fake timers", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-07-18T00:00:00.000Z"));

    let replaySeenResolve!: () => void;
    const replaySeen = new Promise<void>((resolve) => {
      replaySeenResolve = resolve;
    });
    const options = {
      ...runtimeOptions(),
      resumeSessionId: "mock-session-1",
      sessionLoadReplayIdleGap: "50 millis",
      sessionLoadTimeout: "1 second",
    };

    const resultPromise = Effect.runPromise(
      Effect.gen(function* () {
        const spawner = yield* makeReplaySpawner(replaySeenResolve);
        return yield* Effect.gen(function* () {
          const runtime = yield* AcpSessionRuntime;
          const started = yield* runtime.start();
          const promptResult = yield* runtime.prompt({
            prompt: [{ type: "text", text: "after replay" }],
          });
          const events = Array.from(
            yield* Stream.runCollect(Stream.take(runtime.getEvents(), 4)),
          );
          return { started, promptResult, events };
        }).pipe(
          Effect.provide(layer(options)),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );

    await replaySeen;
    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result.started.sessionSetupResult._meta).toMatchObject({
      t3SessionLoadReady: "replay_idle",
    });
    expect(result.promptResult).toEqual({ stopReason: "end_turn" });
    expect(result.events.map((event) => event._tag)).toEqual([
      "PlanUpdated",
      "AssistantItemStarted",
      "ContentDelta",
      "AssistantItemCompleted",
    ]);
    expect(result.events.some((event) => event._tag === "ToolCallUpdated")).toBe(false);
  });

  it("returns cancelled when an active prompt is interrupted", async () => {
    const result = await runRuntime({ ACP_MOCK_HANG_PROMPT: "1" }, (runtime) =>
      Effect.gen(function* () {
        yield* runtime.start();
        const promptFiber = yield* runtime
          .prompt({ prompt: [{ type: "text", text: "wait" }] })
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Stream.runHead(runtime.getEvents());
        yield* runtime.cancel;
        return yield* Fiber.join(promptFiber);
      }),
    );

    expect(result).toEqual({ stopReason: "cancelled" });
  });

  it("maps process exit during a pending prompt to AcpProcessExitedError", async () => {
    const error = await runRuntime({ ACP_MOCK_EXIT_DURING_PROMPT_CODE: "17" }, (runtime) =>
      Effect.gen(function* () {
        yield* runtime.start();
        return yield* runtime
          .prompt({ prompt: [{ type: "text", text: "crash" }] })
          .pipe(Effect.flip);
      }),
    );

    expect(error).toBeInstanceOf(EffectAcpErrors.AcpTransportError);
    const rpcClientError = error.cause as {
      readonly reason?: { readonly cause?: unknown };
    };
    expect(rpcClientError.reason?.cause).toBeInstanceOf(
      EffectAcpErrors.AcpProcessExitedError,
    );
    expect(rpcClientError.reason?.cause).toMatchObject({ code: 17 });
  });
});
