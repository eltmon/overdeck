import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
import { INPUT_PURGE_MAX_CHARS } from "../../channels/injection-budget.js";
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
  readonly promptErrorCount?: number;
  readonly promptStarted?: Deferred.Deferred<void>;
  readonly promptGate?: Deferred.Deferred<void>;
  readonly setModelStarted?: Deferred.Deferred<void>;
  readonly setModelGate?: Deferred.Deferred<void>;
}

interface StubRuntime {
  readonly runtime: AcpHostRuntime;
  readonly prompts: EffectAcpSchema.PromptRequest["prompt"][];
  readonly order: string[];
  readonly setModels: string[];
  readonly startCalls: () => number;
  readonly requestPermission: (
    request: EffectAcpSchema.RequestPermissionRequest,
  ) => Promise<EffectAcpSchema.RequestPermissionResponse>;
}

async function makeStubRuntime(options: StubRuntimeOptions = {}): Promise<StubRuntime> {
  const events = await Effect.runPromise(Queue.unbounded<AcpSessionRuntimeEvent>());
  const prompts: EffectAcpSchema.PromptRequest["prompt"][] = [];
  const order: string[] = [];
  const setModels: string[] = [];
  let starts = 0;
  let remainingPromptErrors = options.promptErrorCount ?? (options.promptError ? Number.POSITIVE_INFINITY : 0);
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
        if (options.promptError && remainingPromptErrors > 0) {
          remainingPromptErrors -= 1;
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
    setModel: (model) =>
      Effect.gen(function* () {
        order.push("set-model");
        setModels.push(model);
        if (options.setModelStarted) {
          yield* Deferred.succeed(options.setModelStarted, undefined);
        }
        if (options.setModelGate) {
          yield* Deferred.await(options.setModelGate);
        }
      }),
  };

  return {
    runtime,
    prompts,
    order,
    setModels,
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
  return postSocketBody(socketPath, token, JSON.stringify(body));
}

function postSocketBody(
  socketPath: string,
  token: string,
  body: string,
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
    client.end(body);
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

  it("publishes readiness only after replacing stale state and binding the current socket", async () => {
    const overdeckHome = await makeHome();
    const agentId = "agent-generation-safe";
    const agentDir = join(overdeckHome, "agents", agentId);
    const socketDir = join(overdeckHome, "sockets");
    const sessionIdPath = join(agentDir, "acp-session-id");
    const socketPath = join(socketDir, `acp-${agentId}.sock`);
    await mkdir(agentDir, { recursive: true });
    await mkdir(socketDir, { recursive: true });
    await writeFile(sessionIdPath, "stale-session\n", "utf-8");
    await writeFile(socketPath, "stale-socket", "utf-8");

    const setModelStarted = await Effect.runPromise(Deferred.make<void>());
    const setModelGate = await Effect.runPromise(Deferred.make<void>());
    const stub = await makeStubRuntime({ setModelStarted, setModelGate });
    const host = new AcpHost({
      agentId,
      provider: "kimi",
      workspace: process.cwd(),
      model: "kimi-k2.6",
      overdeckHome,
      runtime: stub.runtime,
    });
    hosts.push(host);

    const starting = host.start();
    await Effect.runPromise(Deferred.await(setModelStarted));
    try {
      await expect(readFile(sessionIdPath, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(socketPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await Effect.runPromise(Deferred.succeed(setModelGate, undefined));
    }
    await starting;

    const token = (await readFile(join(agentDir, "acp-token"), "utf-8")).trim();
    await expect(postSocket(socketPath, token, { op: "status" })).resolves.toEqual({
      status: 200,
      body: expect.objectContaining({ state: "ready", sessionId: "acp-session-1" }),
    });
    await expect(readFile(sessionIdPath, "utf-8")).resolves.toBe("acp-session-1\n");
  });

  it("translates Overdeck kimi model ids to kimi-code session-config values at setModel", async () => {
    const overdeckHome = await makeHome();
    const stub = await makeStubRuntime();
    const host = new AcpHost({
      agentId: "agent-model-translate",
      provider: "kimi",
      workspace: process.cwd(),
      model: "k3[1m]",
      overdeckHome,
      runtime: stub.runtime,
    });
    hosts.push(host);

    await host.start();

    expect(stub.setModels).toEqual(["kimi-code/k3"]);
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
    expect(accepted).toEqual({ status: 202, body: { accepted: true, promptId: expect.any(String) } });
    await host.waitForIdle();

    expect(stub.prompts).toEqual([[{ type: "text", text: "hello agent" }]]);
    const transcript = (await readFile(join(agentDir, "acp-session.jsonl"), "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(transcript).toEqual([
      expect.objectContaining({
        role: "system",
        content: "hello agent",
        sessionId: "acp-session-1",
        source: "orchestrator",
        event: "prompt_queued",
      }),
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
      expect.objectContaining({
        role: "system",
        content: "",
        sessionId: "acp-session-1",
        source: "agent",
        event: "turn_completed",
        stopReason: "end_turn",
      }),
    ]);
    expect(output.text()).toContain("[user] hello agent");
    expect(output.text()).toContain("[assistant] hello from kimi");
  });

  it("injects materialized Overdeck context into the first fresh prompt only", async () => {
    const overdeckHome = await makeHome();
    const stub = await makeStubRuntime();
    const host = new AcpHost({
      agentId: "agent-context",
      provider: "kimi",
      workspace: process.cwd(),
      overdeckHome,
      context: "ACP guardrail: never bypass review.",
      runtime: stub.runtime,
    });
    hosts.push(host);
    await host.start();

    const agentDir = join(overdeckHome, "agents", "agent-context");
    const socketPath = join(overdeckHome, "sockets", "acp-agent-context.sock");
    const token = (await readFile(join(agentDir, "acp-token"), "utf-8")).trim();
    await postSocket(socketPath, token, { op: "message", content: "first" });
    await postSocket(socketPath, token, { op: "message", content: "second" });
    await host.waitForIdle();

    expect(stub.prompts).toEqual([
      [{
        type: "text",
        text: "<overdeck-context>\nACP guardrail: never bypass review.\n</overdeck-context>\n\nfirst",
      }],
      [{ type: "text", text: "second" }],
    ]);
  });

  it("retries Overdeck context when the first fresh prompt fails", async () => {
    const overdeckHome = await makeHome();
    const stub = await makeStubRuntime({
      promptError: new Error("first prompt failed"),
      promptErrorCount: 1,
    });
    const host = new AcpHost({
      agentId: "agent-context-retry",
      provider: "kimi",
      workspace: process.cwd(),
      overdeckHome,
      context: "ACP guardrail: preserve context on retry.",
      runtime: stub.runtime,
    });
    hosts.push(host);
    await host.start();

    const agentDir = join(overdeckHome, "agents", "agent-context-retry");
    const socketPath = join(overdeckHome, "sockets", "acp-agent-context-retry.sock");
    const token = (await readFile(join(agentDir, "acp-token"), "utf-8")).trim();
    await postSocket(socketPath, token, { op: "message", content: "first" });
    await host.waitForIdle();
    await postSocket(socketPath, token, { op: "message", content: "retry" });
    await host.waitForIdle();

    expect(stub.prompts).toEqual([
      [{
        type: "text",
        text: "<overdeck-context>\nACP guardrail: preserve context on retry.\n</overdeck-context>\n\nfirst",
      }],
      [{
        type: "text",
        text: "<overdeck-context>\nACP guardrail: preserve context on retry.\n</overdeck-context>\n\nretry",
      }],
    ]);
  });

  it("rejects authenticated request bodies above the delivery limit", async () => {
    const overdeckHome = await makeHome();
    const stub = await makeStubRuntime();
    const host = new AcpHost({
      agentId: "agent-request-limit",
      provider: "kimi",
      workspace: process.cwd(),
      overdeckHome,
      runtime: stub.runtime,
    });
    hosts.push(host);
    await host.start();

    const agentDir = join(overdeckHome, "agents", "agent-request-limit");
    const socketPath = join(overdeckHome, "sockets", "acp-agent-request-limit.sock");
    const token = (await readFile(join(agentDir, "acp-token"), "utf-8")).trim();

    await expect(
      postSocketBody(socketPath, token, "x".repeat(INPUT_PURGE_MAX_CHARS + 1)),
    ).resolves.toEqual({
      status: 413,
      body: { error: "request body too large" },
    });
    expect(stub.prompts).toEqual([]);
  });

  it("acknowledges queue acceptance before session/prompt completes", async () => {
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
    const response = postSocket(socketPath, token, {
      op: "message",
      content: "wait for the provider",
    });

    await expect(response).resolves.toEqual({ status: 202, body: { accepted: true, promptId: expect.any(String) } });
    const afterAcceptance = await readFile(join(agentDir, "acp-session.jsonl"), "utf-8");
    expect(afterAcceptance).toContain('"content":"wait for the provider"');
    expect(afterAcceptance).toContain('"event":"prompt_queued"');
    expect(afterAcceptance).not.toContain('"event":"turn_completed"');
    await Effect.runPromise(Deferred.await(promptStarted));

    await Effect.runPromise(Deferred.succeed(promptGate, undefined));
    await host.waitForIdle();
  });

  it("writes one ordered completion boundary for each successful prompt", async () => {
    const overdeckHome = await makeHome();
    const stub = await makeStubRuntime({ assistantResponse: "done" });
    const host = new AcpHost({
      agentId: "agent-multiple-turns",
      provider: "kimi",
      workspace: process.cwd(),
      overdeckHome,
      runtime: stub.runtime,
    });
    hosts.push(host);
    await host.start();

    const agentDir = join(overdeckHome, "agents", "agent-multiple-turns");
    const socketPath = join(overdeckHome, "sockets", "acp-agent-multiple-turns.sock");
    const token = (await readFile(join(agentDir, "acp-token"), "utf-8")).trim();

    await expect(postSocket(socketPath, token, { op: "message", content: "first" }))
      .resolves.toEqual({ status: 202, body: { accepted: true, promptId: expect.any(String) } });
    await expect(postSocket(socketPath, token, { op: "message", content: "second" }))
      .resolves.toEqual({ status: 202, body: { accepted: true, promptId: expect.any(String) } });
    await host.waitForIdle();

    const transcript = (await readFile(join(agentDir, "acp-session.jsonl"), "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      transcript
        .filter((entry) => entry.event !== "prompt_queued")
        .map((entry) => [entry.role, entry.event]),
    ).toEqual([
      ["user", undefined],
      ["assistant", undefined],
      ["system", "turn_completed"],
      ["user", undefined],
      ["assistant", undefined],
      ["system", "turn_completed"],
    ]);
    expect(
      transcript
        .filter((entry) => entry.event === "prompt_queued")
        .map((entry) => entry.content),
    ).toEqual(["first", "second"]);
    expect(transcript.filter((entry) => entry.event === "turn_completed")).toEqual([
      expect.objectContaining({ stopReason: "end_turn" }),
      expect.objectContaining({ stopReason: "end_turn" }),
    ]);
  });

  it("records an asynchronous session/prompt failure after accepting delivery", async () => {
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

    expect(response).toEqual({ status: 202, body: { accepted: true, promptId: expect.any(String) } });
    await host.waitForIdle();
    expect(output.text()).toContain("[error] provider rejected prompt");
    const transcript = await readFile(join(agentDir, "acp-session.jsonl"), "utf-8");
    expect(transcript).toContain('"content":"provider rejected prompt"');
    expect(transcript).not.toContain('"event":"turn_completed"');
  });

  it("replays durable prompts that lack a terminal record when resuming", async () => {
    const overdeckHome = await makeHome();
    const agentId = "agent-replay-owed";
    const agentDir = join(overdeckHome, "agents", agentId);
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "acp-session.jsonl"), [
      JSON.stringify({
        timestamp: "2026-07-18T10:00:00.000Z",
        role: "system",
        content: "already completed",
        promptId: "prompt-complete",
        event: "prompt_queued",
      }),
      JSON.stringify({
        timestamp: "2026-07-18T10:00:01.000Z",
        role: "system",
        content: "",
        promptId: "prompt-complete",
        event: "turn_completed",
      }),
      JSON.stringify({
        timestamp: "2026-07-18T10:00:02.000Z",
        role: "system",
        content: "still owed",
        promptId: "prompt-owed",
        event: "prompt_queued",
      }),
      JSON.stringify({
        timestamp: "2026-07-18T10:00:03.000Z",
        role: "user",
        content: "still owed",
        promptId: "prompt-owed",
      }),
    ].join("\n") + "\n");
    const stub = await makeStubRuntime({ assistantResponse: "replayed" });
    const host = new AcpHost({
      agentId,
      provider: "kimi",
      workspace: process.cwd(),
      overdeckHome,
      resumeSessionId: "persisted-session",
      runtime: stub.runtime,
    });
    hosts.push(host);

    await host.start();
    await host.waitForIdle();

    expect(stub.prompts).toEqual([[{ type: "text", text: "still owed" }]]);
    const transcript = (await readFile(join(agentDir, "acp-session.jsonl"), "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(transcript.filter((entry) => entry.promptId === "prompt-owed")).toEqual([
      expect.objectContaining({ event: "prompt_queued", content: "still owed" }),
      expect.objectContaining({ role: "user", content: "still owed" }),
      expect.objectContaining({ event: "turn_completed" }),
    ]);
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
    await expect(readFile(
      join(overdeckHome, "agents", "agent-auth", "acp-launch-error"),
      "utf-8",
    )).resolves.toContain("/login");
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
