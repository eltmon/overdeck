#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as AcpAgent from "effect-acp/agent";

const sessionId = "mock-session-1";
const exitImmediatelyCode = process.env.ACP_MOCK_EXIT_IMMEDIATELY_CODE;
const exitDuringPromptCode = process.env.ACP_MOCK_EXIT_DURING_PROMPT_CODE;
const hangPrompt = process.env.ACP_MOCK_HANG_PROMPT === "1";
const hangLoadAfterReplay = process.env.ACP_MOCK_HANG_LOAD_AFTER_REPLAY === "1";

if (exitImmediatelyCode !== undefined) {
  process.exit(Number(exitImmediatelyCode));
}

const program = Effect.gen(function* () {
  const agent = yield* AcpAgent.AcpAgent;

  yield* agent.handleInitialize(() =>
    Effect.succeed({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
      agentInfo: { name: "overdeck-acp-mock", version: "0.0.0" },
    }),
  );
  yield* agent.handleAuthenticate(() => Effect.succeed({}));
  yield* agent.handleCreateSession(() => Effect.succeed({ sessionId }));
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
      if (hangLoadAfterReplay) {
        return yield* Effect.never;
      }
      return {};
    }),
  );
  yield* agent.handleCancel(() => Effect.void);
  yield* agent.handlePrompt((request) =>
    Effect.gen(function* () {
      if (exitDuringPromptCode !== undefined) {
        yield* agent.client.sessionUpdate({
          sessionId: request.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "prompt started before exit" },
          },
        });
        return yield* Effect.sync(() => process.exit(Number(exitDuringPromptCode)));
      }

      if (hangPrompt) {
        yield* agent.client.sessionUpdate({
          sessionId: request.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "prompt started" },
          },
        });
        return yield* Effect.never;
      }

      yield* agent.client.sessionUpdate({
        sessionId: request.sessionId,
        update: {
          sessionUpdate: "plan",
          entries: [
            {
              content: "Exercise the ACP runtime",
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
          content: { type: "text", text: "hello from mock" },
        },
      });
      return { stopReason: "end_turn" as const };
    }),
  );

  return yield* Effect.never;
});

program.pipe(
  Effect.provide(Layer.provide(AcpAgent.layerStdio(), NodeServices.layer)),
  NodeRuntime.runMain,
);
