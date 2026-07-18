import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import type * as EffectAcpSchema from "effect-acp/schema";
import { afterEach, describe, expect, it } from "vitest";

import { AcpHost, type AcpHostRuntime } from "../host.js";
import { selectAutoPermissionOutcome } from "../permissions.js";
import type { AcpSessionRuntimeEvent } from "../session-runtime.js";

const homes: string[] = [];
const hosts: AcpHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true })));
});

function permissionRequest(
  options: ReadonlyArray<Record<string, string>>,
): EffectAcpSchema.RequestPermissionRequest {
  return {
    sessionId: "acp-session-1",
    toolCall: { toolCallId: "tool-1" },
    options,
  } as unknown as EffectAcpSchema.RequestPermissionRequest;
}

async function makePermissionHost(): Promise<{
  host: AcpHost;
  requestPermission: (
    request: EffectAcpSchema.RequestPermissionRequest,
  ) => Promise<EffectAcpSchema.RequestPermissionResponse>;
  output: () => string;
  transcriptPath: string;
}> {
  const overdeckHome = await mkdtemp(join(tmpdir(), "overdeck-acp-permissions-"));
  homes.push(overdeckHome);
  const events = await Effect.runPromise(Queue.unbounded<AcpSessionRuntimeEvent>());
  let permissionHandler:
    | Parameters<AcpHostRuntime["handleRequestPermission"]>[0]
    | undefined;
  let pane = "";
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      pane += chunk.toString();
      callback();
    },
  });
  const runtime: AcpHostRuntime = {
    handleSessionUpdate: () => Effect.void,
    handleRequestPermission: (handler) =>
      Effect.sync(() => {
        permissionHandler = handler;
      }),
    start: () =>
      Effect.succeed({
        sessionId: "acp-session-1",
        modes: [],
        models: [],
        mcpServers: [],
      }),
    getEvents: () => Stream.fromQueue(events),
    drainEvents: Effect.gen(function* () {
      const acknowledge = yield* Deferred.make<void>();
      yield* Queue.offer(events, { _tag: "EventStreamBarrier", acknowledge });
      yield* Deferred.await(acknowledge);
    }),
    prompt: () => Effect.succeed({ stopReason: "end_turn" as const }),
    cancel: Effect.void,
    setModel: () => Effect.void,
  };
  const host = new AcpHost({
    agentId: "agent-permissions",
    provider: "kimi",
    workspace: process.cwd(),
    overdeckHome,
    runtime,
    stdout,
  });
  hosts.push(host);
  await host.start();

  return {
    host,
    requestPermission: (request) =>
      Effect.runPromise(permissionHandler!(request)),
    output: () => pane,
    transcriptPath: join(
      overdeckHome,
      "agents",
      "agent-permissions",
      "acp-session.jsonl",
    ),
  };
}

describe("selectAutoPermissionOutcome", () => {
  it("prefers Cursor-style session and one-shot allow IDs", () => {
    expect(
      selectAutoPermissionOutcome(
        permissionRequest([
          { optionId: "allow-once", name: "Allow once" },
          { optionId: "allow-always", name: "Allow for this session" },
          { optionId: "reject-once", name: "Reject" },
        ]),
      ),
    ).toEqual({ outcome: "selected", optionId: "allow-always" });
  });

  it("uses ACP kinds before unfamiliar option IDs and names", () => {
    expect(
      selectAutoPermissionOutcome(
        permissionRequest([
          { optionId: "opaque-1", name: "First", kind: "allow_once" },
          { optionId: "opaque-2", name: "Second", kind: "allow_always" },
        ]),
      ),
    ).toEqual({ outcome: "selected", optionId: "opaque-2" });
  });

  it("selects an offered reject and returns null without a recognized option", () => {
    expect(
      selectAutoPermissionOutcome(
        permissionRequest([
          { optionId: "no", name: "No", kind: "reject_once" },
        ]),
      ),
    ).toEqual({ outcome: "selected", optionId: "no" });
    expect(selectAutoPermissionOutcome(permissionRequest([]))).toBeNull();
  });
});

describe("ACP host permission handling", () => {
  it("warns on declines and cancellations and records every request and outcome", async () => {
    const testHost = await makePermissionHost();

    await expect(
      testHost.requestPermission(
        permissionRequest([
          { optionId: "deny-tool", name: "Deny", kind: "reject_once" },
        ]),
      ),
    ).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "deny-tool" },
    });
    await expect(
      testHost.requestPermission(permissionRequest([])),
    ).resolves.toEqual({ outcome: { outcome: "cancelled" } });

    const records = (await readFile(testHost.transcriptPath, "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { content: string })
      .map((record) => JSON.parse(record.content) as Record<string, unknown>);
    expect(records).toEqual([
      {
        type: "permission_request",
        toolCallId: "tool-1",
        offeredOptionIds: ["deny-tool"],
      },
      {
        type: "permission_outcome",
        outcome: "selected",
        offeredOptionIds: ["deny-tool"],
        chosenOptionId: "deny-tool",
      },
      {
        type: "permission_request",
        toolCallId: "tool-1",
        offeredOptionIds: [],
      },
      {
        type: "permission_outcome",
        outcome: "cancelled",
        offeredOptionIds: [],
        chosenOptionId: null,
      },
    ]);
    expect(testHost.output()).toContain(
      "[warning] ACP permission declined with option deny-tool.",
    );
    expect(testHost.output()).toContain(
      "[warning] ACP permission request cancelled",
    );
  });
});
