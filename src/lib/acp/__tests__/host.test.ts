import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import type * as EffectAcpSchema from "effect-acp/schema";
import { afterEach, describe, expect, it } from "vitest";

import { BRIDGE_TOKEN_HEADER } from "../../bridge-token.js";
import {
  AcpHost,
  type AcpHostRuntime,
  parseAcpHostArgs,
  readPersistedAcpSessionId,
} from "../host.js";
import type { AcpSessionRuntimeEvent } from "../session-runtime.js";

interface StubRuntimeOptions {
  readonly sessionId?: string;
  readonly assistantResponse?: string;
  readonly updateDuringStart?: string;
  readonly startError?: Error;
  readonly promptError?: Error;
  readonly promptStarted?: Deferred.Deferred<void>;
  readonly promptGate?: Deferred.Deferred<void>;
}

interface StubRuntime {
  readonly runtime: AcpHostRuntime;
  readonly prompts: EffectAcpSchema.PromptRequest["prompt"][];
  readonly order: string[];
  readonly startCalls: () => number;
  readonly requestPermission: (
    request: EffectAcpSchema.RequestPermissionRequest,
  ) => Promise<EffectAcpSchema.RequestPermissionResponse>;
}

async function makeStubRuntime(options: StubRuntimeOptions = {}): Promise<StubRuntime> {
  const events = await Effect.runPromise(Queue.unbounded<AcpSessionRuntimeEvent>());
  const prompts: EffectAcpSchema.PromptRequest["prompt"][] = [];
  const order: string[] = [];
  let starts = 0;
  let sessionUpdateHandler:
    | Parameters<AcpHostRuntime["handleSessionUpdate"]>[0]
    | undefined;
  let permissionHandler:
    | Parameters<AcpHostRuntime["handleRequestPermission"]>[0]
    | undefined;
  const sessionId = options.sessionId ?? "acp-session-1";

  const runtime: AcpHostRuntime = {
    handleSessionUpdate: (handler) =>
      Effect.sync(() => {
        order.push("session-handler");
        sessionUpdateHandler = handler;
      }),
    handleRequestPermission: (handler) =>
      Effect.sync(() => {
        order.push("permission-handler");
        permissionHandler = handler;
      }),
    start: () =>
      Effect.gen(function* () {
        starts += 1;
        order.push("start");
        if (options.startError) return yield* Effect.fail(options.startError);
        if (options.updateDuringStart) {
          yield* sessionUpdateHandler!({
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: options.updateDuringStart },
            },
          });
          yield* Queue.offer(events, {
            _tag: "ContentDelta",
            itemId: "assistant-1",
            text: options.updateDuringStart,
            rawPayload: {},
          });
        }
        return {
          sessionId,
          modes: [],
          models: [],
          mcpServers: [],
        };
      }),
    getEvents: () => Stream.fromQueue(events),
    drainEvents: Effect.gen(function* () {
      const acknowledge = yield* Deferred.make<void>();
      yield* Queue.offer(events, { _tag: "EventStreamBarrier", acknowledge });
      yield* Deferred.await(acknowledge);
    }),
    prompt: (payload) =>
      Effect.gen(function* () {
        prompts.push(payload.prompt);
        if (options.promptStarted) {
          yield* Deferred.succeed(options.promptStarted, undefined);
        }
        if (options.promptGate) {
          yield* Deferred.await(options.promptGate);
        }
        if (options.promptError) {
          return yield* Effect.fail(options.promptError);
        }
        if (options.assistantResponse) {
          yield* Queue.offer(events, {
            _tag: "ContentDelta",
            itemId: "assistant-2",
            text: options.assistantResponse,
            rawPayload: {},
          });
        }
        return { stopReason: "end_turn" as const };
      }),
    cancel: Effect.void,
    setModel: () => Effect.void,
  };

  return {
    runtime,
    prompts,
    order,
    startCalls: () => starts,
    requestPermission: (permissionRequest) =>
      Effect.runPromise(permissionHandler!(permissionRequest)),
  };
}

interface SocketResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

function postSocket(
  socketPath: string,
  token: string,
  body: Record<string, unknown>,
): Promise<SocketResponse> {
  return new Promise((resolve, reject) => {
    const client = request(
      {
        socketPath,
        path: "/",
        method: "POST",
        headers: {
          "content-type": "application/json",
          [BRIDGE_TOKEN_HEADER]: token,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf-8")),
          });
        });
      },
    );
    client.once("error", reject);
    client.end(JSON.stringify(body));
  });
}

function makeOutput(): { readonly writable: Writable; readonly text: () => string } {
  let output = "";
  return {
    writable: new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    }),
    text: () => output,
  };
}

const hosts: AcpHost[] = [];
const tempHomes: string[] = [];

async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "overdeck-acp-host-"));
  tempHomes.push(home);
  return home;
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
  await Promise.all(tempHomes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("AcpHost", () => {
  it("binds its socket and writes mode-0600 token and session files", async () => {
    const overdeckHome = await makeHome();
    const stub = await makeStubRuntime();
    const host = new AcpHost({
      agentId: "agent-pan-2858",
      provider: "kimi",
      workspace: process.cwd(),
      overdeckHome,
      runtime: stub.runtime,
    });
    hosts.push(host);

    await host.start();

    const agentDir = join(overdeckHome, "agents", "agent-pan-2858");
    const socketPath = join(overdeckHome, "sockets", "acp-agent-pan-2858.sock");
    expect((await stat(join(agentDir, "acp-token"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(agentDir, "acp-session-id"))).mode & 0o777).toBe(0o600);
    expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
    expect(await readPersistedAcpSessionId(overdeckHome, "agent-pan-2858")).toBe(
      "acp-session-1",
    );
  });

  it("authenticates delivery, forwards prompts, and records both sides of the turn", async () => {
    const overdeckHome = await makeHome();
    const stub = await makeStubRuntime({ assistantResponse: "hello from kimi" });
    const output = makeOutput();
    const host = new AcpHost({
      agentId: "agent-delivery",
      provider: "kimi",
      workspace: process.cwd(),
      overdeckHome,
      runtime: stub.runtime,
      stdout: output.writable,
    });
    hosts.push(host);
    await host.start();

    const agentDir = join(overdeckHome, "agents", "agent-delivery");
    const socketPath = join(overdeckHome, "sockets", "acp-agent-delivery.sock");
    const token = (await readFile(join(agentDir, "acp-token"), "utf-8")).trim();
    const unauthorized = await postSocket(socketPath, "wrong-token", {
      op: "message",
      content: "do not forward",
    });
    expect(unauthorized.status).toBe(401);
    expect(stub.prompts).toEqual([]);

    const accepted = await postSocket(socketPath, token, {
      op: "message",
      content: "hello agent",
    });
    expect(accepted).toEqual({ status: 200, body: { ok: true } });
    await host.waitForIdle();

    expect(stub.prompts).toEqual([[{ type: "text", text: "hello agent" }]]);
    const transcript = (await readFile(join(agentDir, "acp-session.jsonl"), "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(transcript).toEqual([
      expect.objectContaining({
        role: "user",
        content: "hello agent",
        sessionId: "acp-session-1",
        source: "orchestrator",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "hello from kimi",
        sessionId: "acp-session-1",
        source: "agent",
      }),
    ]);
    expect(output.text()).toContain("[user] hello agent");
    expect(output.text()).toContain("[assistant] hello from kimi");
  });

  it("withholds delivery success until session/prompt completes", async () => {
    const overdeckHome = await makeHome();
    const promptStarted = await Effect.runPromise(Deferred.make<void>());
    const promptGate = await Effect.runPromise(Deferred.make<void>());
    const stub = await makeStubRuntime({ promptStarted, promptGate });
    const host = new AcpHost({
      agentId: "agent-prompt-pending",
      provider: "kimi",
      workspace: process.cwd(),
      overdeckHome,
      runtime: stub.runtime,
    });
    hosts.push(host);
    await host.start();

    const agentDir = join(overdeckHome, "agents", "agent-prompt-pending");
    const socketPath = join(overdeckHome, "sockets", "acp-agent-prompt-pending.sock");
    const token = (await readFile(join(agentDir, "acp-token"), "utf-8")).trim();
    let settled = false;
    const response = postSocket(socketPath, token, {
      op: "message",
      content: "wait for the provider",
    }).finally(() => {
      settled = true;
    });

    await Effect.runPromise(Deferred.await(promptStarted));
    expect(settled).toBe(false);
    await Effect.runPromise(Deferred.succeed(promptGate, undefined));
    await expect(response).resolves.toEqual({ status: 200, body: { ok: true } });
  });

  it("returns a caller-visible failure when session/prompt fails", async () => {
    const overdeckHome = await makeHome();
    const stub = await makeStubRuntime({ promptError: new Error("provider rejected prompt") });
    const output = makeOutput();
    const host = new AcpHost({
      agentId: "agent-prompt-failure",
      provider: "kimi",
      workspace: process.cwd(),
      overdeckHome,
      runtime: stub.runtime,
      stdout: output.writable,
    });
    hosts.push(host);
    await host.start();

    const agentDir = join(overdeckHome, "agents", "agent-prompt-failure");
    const socketPath = join(overdeckHome, "sockets", "acp-agent-prompt-failure.sock");
    const token = (await readFile(join(agentDir, "acp-token"), "utf-8")).trim();
    const response = await postSocket(socketPath, token, {
      op: "message",
      content: "this will fail",
    });

    expect(response).toEqual({
      status: 500,
      body: { error: "provider rejected prompt" },
    });
    expect(output.text()).toContain("[error] provider rejected prompt");
    const transcript = await readFile(join(agentDir, "acp-session.jsonl"), "utf-8");
    expect(transcript).toContain('"content":"provider rejected prompt"');
  });

  it("registers handlers and captures session updates before startup completes", async () => {
    const overdeckHome = await makeHome();
    const stub = await makeStubRuntime({ updateDuringStart: "initializing" });
    const host = new AcpHost({
      agentId: "agent-startup",
      provider: "kimi",
      workspace: process.cwd(),
      overdeckHome,
      runtime: stub.runtime,
    });
    hosts.push(host);

    await host.start();
    await host.waitForIdle();

    expect(stub.order).toEqual(["session-handler", "permission-handler", "start"]);
    expect(host.status()).toMatchObject({
      sessionId: "acp-session-1",
      observedSessionUpdates: 1,
    });
    const transcript = await readFile(
      join(overdeckHome, "agents", "agent-startup", "acp-session.jsonl"),
      "utf-8",
    );
    expect(transcript).toContain('"content":"initializing"');

    const permission = await stub.requestPermission({
      sessionId: "acp-session-1",
      toolCall: { toolCallId: "tool-1" },
      options: [
        { optionId: "once", kind: "allow_once", name: "Allow once" },
        { optionId: "always", kind: "allow_always", name: "Always allow" },
      ],
    });
    expect(permission).toEqual({
      outcome: { outcome: "selected", optionId: "always" },
    });
  });

  it("prints Kimi login remediation and does not retry authentication failures", async () => {
    const overdeckHome = await makeHome();
    const stub = await makeStubRuntime({
      startError: new Error("authentication required"),
    });
    const output = makeOutput();
    const host = new AcpHost({
      agentId: "agent-auth",
      provider: "kimi",
      workspace: process.cwd(),
      overdeckHome,
      runtime: stub.runtime,
      stdout: output.writable,
    });

    await expect(host.start()).rejects.toThrow("authentication required");

    expect(stub.startCalls()).toBe(1);
    expect(output.text().toLowerCase()).toContain("kimi");
    expect(output.text()).toContain("/login");
  });

  it("parses a persisted session ID for a resumed runtime", async () => {
    const overdeckHome = await makeHome();
    const stub = await makeStubRuntime({ sessionId: "persisted-session" });
    const host = new AcpHost({
      agentId: "agent-resume",
      provider: "kimi",
      workspace: process.cwd(),
      overdeckHome,
      runtime: stub.runtime,
    });
    hosts.push(host);
    await host.start();

    const persisted = await readPersistedAcpSessionId(overdeckHome, "agent-resume");
    expect(persisted).toBe("persisted-session");
    expect(
      parseAcpHostArgs([
        "--agent",
        "agent-resume",
        "--provider",
        "kimi",
        "--workspace",
        process.cwd(),
        "--binary-path",
        "/opt/kimi/bin/kimi",
        "--resume",
        persisted!,
      ]),
    ).toMatchObject({
      binaryPath: "/opt/kimi/bin/kimi",
      resumeSessionId: "persisted-session",
    });
  });
});
