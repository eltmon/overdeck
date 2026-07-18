import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpSchema from "effect-acp/schema";

import { BRIDGE_TOKEN_HEADER } from "../bridge-token.js";
import { renderAcpHostEvent, stripAcpPaneControl } from "./host-render.js";
import { resolveAcpProviderSupport } from "./providers.js";
import {
  AcpSessionRuntime,
  type AcpSessionRuntimeEvent,
  type AcpSessionRuntimeStartResult,
} from "./session-runtime.js";
import { AcpTranscriptWriter } from "./transcript.js";

const FILE_MODE = 0o600;
type JsonRecord = Record<string, unknown>;

export type AcpHostRuntime = Pick<
  AcpSessionRuntime["Service"],
  | "handleRequestPermission"
  | "handleSessionUpdate"
  | "start"
  | "getEvents"
  | "drainEvents"
  | "prompt"
  | "cancel"
  | "setModel"
>;

export interface AcpHostOptions {
  readonly agentId: string;
  readonly provider: string;
  readonly workspace: string;
  readonly model?: string;
  readonly overdeckHome?: string;
  readonly runtime: AcpHostRuntime;
  readonly stdout?: Writable;
  readonly disposeRuntime?: () => Promise<void>;
}

interface HostOpResult {
  readonly status: number;
  readonly body: JsonRecord;
}

export class AcpHost {
  private readonly overdeckHome: string;
  private readonly transcript: AcpTranscriptWriter;
  private server: Server | undefined;
  private token: string | undefined;
  private sessionId: string | undefined;
  private eventFiber: Fiber.Fiber<void, never> | undefined;
  private promptQueue: Promise<void> = Promise.resolve();
  private state: "starting" | "ready" | "closed" = "starting";
  private observedSessionUpdates = 0;

  constructor(private readonly options: AcpHostOptions) {
    this.overdeckHome =
      options.overdeckHome ?? process.env.OVERDECK_HOME ?? join(homedir(), ".overdeck");
    this.transcript = new AcpTranscriptWriter(this.transcriptPath());
  }

  async start(): Promise<void> {
    await mkdir(this.agentDir(), { recursive: true });
    await mkdir(this.socketDir(), { recursive: true });
    this.token = randomUUID();
    await writeFile(this.tokenPath(), `${this.token}\n`, { mode: FILE_MODE });
    await chmod(this.tokenPath(), FILE_MODE);

    await Effect.runPromise(
      this.options.runtime.handleSessionUpdate((notification) =>
        Effect.sync(() => {
          this.observedSessionUpdates += 1;
          this.sessionId = notification.sessionId;
        }),
      ),
    );
    await Effect.runPromise(
      this.options.runtime.handleRequestPermission((request) =>
        Effect.succeed(selectAutomaticPermission(request)),
      ),
    );
    this.startEventPump();

    let started: AcpSessionRuntimeStartResult;
    try {
      started = await Effect.runPromise(this.options.runtime.start());
    } catch (error) {
      if (this.options.provider === "kimi" && isAuthenticationFailure(error)) {
        this.writePaneLine(
          "[error] kimi authentication is required. Run /login in Kimi Code CLI, then retry.",
        );
      }
      await this.stop();
      throw error;
    }

    this.sessionId = started.sessionId;
    await writeFile(this.sessionIdPath(), `${started.sessionId}\n`, { mode: FILE_MODE });
    await chmod(this.sessionIdPath(), FILE_MODE);
    if (this.options.model) {
      await Effect.runPromise(this.options.runtime.setModel(this.options.model));
    }
    await this.listen();
    this.state = "ready";
  }

  async stop(): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closed";
    await Effect.runPromise(this.options.runtime.cancel).catch(() => undefined);
    if (this.eventFiber) {
      await Effect.runPromise(Fiber.interrupt(this.eventFiber));
      this.eventFiber = undefined;
    }
    await this.closeServer();
    await this.transcript.flush();
    await this.options.disposeRuntime?.();
  }

  status(): JsonRecord {
    return {
      state: this.state,
      provider: this.options.provider,
      sessionId: this.sessionId,
      observedSessionUpdates: this.observedSessionUpdates,
    };
  }

  async waitForIdle(): Promise<void> {
    await this.promptQueue;
    await Effect.runPromise(this.options.runtime.drainEvents);
    await this.transcript.flush();
  }

  async handleOp(op: unknown): Promise<HostOpResult> {
    const body = asRecord(op);
    const name = typeof body.op === "string" ? body.op : "";
    try {
      if (name === "status") return { status: 200, body: this.status() };
      if (name === "message") return await this.handleMessageOp(body);
      if (name === "interrupt") return await this.handleInterruptOp();
      return {
        status: 400,
        body: { error: `unsupported ACP host op: ${name || "<missing>"}` },
      };
    } catch (error) {
      return { status: 500, body: { error: errorMessage(error) } };
    }
  }

  private async handleMessageOp(op: JsonRecord): Promise<HostOpResult> {
    const content = typeof op.content === "string" ? op.content : "";
    if (!content) {
      return { status: 400, body: { error: "message content is required" } };
    }
    await this.transcript.append({
      role: "user",
      content,
      sessionId: this.sessionId,
      source: "orchestrator",
    });
    this.writePaneLine(`[user] ${content}`);
    this.promptQueue = this.promptQueue
      .then(async () => {
        await Effect.runPromise(
          this.options.runtime.prompt({ prompt: [{ type: "text", text: content }] }),
        );
      })
      .catch(async (error) => {
        const message = errorMessage(error);
        this.writePaneLine(`[error] ${message}`);
        await this.transcript.append({
          role: "system",
          content: message,
          sessionId: this.sessionId,
          source: "agent",
        });
      });
    return { status: 202, body: { ok: true, queued: true } };
  }

  private async handleInterruptOp(): Promise<HostOpResult> {
    await Effect.runPromise(this.options.runtime.cancel);
    return { status: 200, body: { ok: true } };
  }

  private startEventPump(): void {
    this.eventFiber = Effect.runFork(
      Stream.runForEach(this.options.runtime.getEvents(), (event) =>
        Effect.promise(() =>
          this.handleRuntimeEvent(event).catch((error) => {
            this.writePaneLine(`[error] ${errorMessage(error)}`);
          }),
        ),
      ),
    );
  }

  private async handleRuntimeEvent(event: AcpSessionRuntimeEvent): Promise<void> {
    if (event._tag === "EventStreamBarrier") {
      await Effect.runPromise(Deferred.succeed(event.acknowledge, undefined));
      return;
    }
    for (const line of renderAcpHostEvent(event)) this.writePaneLine(line);
    if (event._tag === "ContentDelta") {
      await this.transcript.append({
        role: "assistant",
        content: event.text,
        sessionId: this.sessionId,
        source: "agent",
      });
      return;
    }
    if (event._tag === "ToolCallUpdated") {
      await this.transcript.append({
        role: "tool",
        content: event.toolCall.detail ?? event.toolCall.title ?? event.toolCall.kind ?? "Tool call",
        sessionId: this.sessionId,
        toolCalls: [event.toolCall],
        source: "agent",
      });
      return;
    }
    if (event._tag === "PlanUpdated") {
      const plan = event.payload.plan
        .map((entry) => `${entry.status}: ${entry.step}`)
        .join("\n");
      await this.transcript.append({
        role: "system",
        content: [event.payload.explanation, plan].filter(Boolean).join("\n"),
        sessionId: this.sessionId,
        source: "agent",
      });
    }
  }

  private writePaneLine(line: string): void {
    this.options.stdout?.write(`${stripAcpPaneControl(line)}\n`);
  }

  private async listen(): Promise<void> {
    await rm(this.socketPath(), { force: true });
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        if (!response.headersSent) sendJson(response, 500, { error: errorMessage(error) });
        else response.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.socketPath(), () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
    await chmod(this.socketPath(), FILE_MODE);
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    if (request.headers[BRIDGE_TOKEN_HEADER] !== this.token) {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    } catch {
      sendJson(response, 400, { error: "invalid JSON body" });
      return;
    }
    const result = await this.handleOp(payload);
    sendJson(response, result.status, result.body);
  }

  private async closeServer(): Promise<void> {
    if (this.server) {
      const server = this.server;
      this.server = undefined;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await rm(this.socketPath(), { force: true });
  }

  private agentDir(): string {
    return join(this.overdeckHome, "agents", this.options.agentId);
  }

  private socketDir(): string {
    return join(this.overdeckHome, "sockets");
  }

  private socketPath(): string {
    return join(this.socketDir(), `acp-${this.options.agentId}.sock`);
  }

  private tokenPath(): string {
    return join(this.agentDir(), "acp-token");
  }

  private sessionIdPath(): string {
    return join(this.agentDir(), "acp-session-id");
  }

  private transcriptPath(): string {
    return join(this.agentDir(), "acp-session.jsonl");
  }
}

function selectAutomaticPermission(
  request: EffectAcpSchema.RequestPermissionRequest,
): EffectAcpSchema.RequestPermissionResponse {
  const selected =
    request.options.find((option) => option.kind === "allow_always") ??
    request.options.find((option) => option.kind === "allow_once");
  return selected
    ? { outcome: { outcome: "selected", optionId: selected.optionId } }
    : { outcome: { outcome: "cancelled" } };
}

function sendJson(response: ServerResponse, status: number, body: JsonRecord): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAuthenticationFailure(error: unknown): boolean {
  const detail = error instanceof Error
    ? `${error.name} ${error.message} ${String(error.cause ?? "")}`
    : String(error);
  return /authenticat|credential|login required/i.test(detail);
}

interface AcpHostArgs {
  readonly agentId: string;
  readonly provider: string;
  readonly workspace: string;
  readonly resumeSessionId?: string;
  readonly model?: string;
}

export function parseAcpHostArgs(argv: ReadonlyArray<string>): AcpHostArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    values.set(argument, value);
    index += 1;
  }
  const agentId = values.get("--agent");
  const provider = values.get("--provider");
  const workspace = values.get("--workspace");
  if (!agentId || !provider || !workspace) {
    throw new Error("ACP host requires --agent, --provider, and --workspace");
  }
  return {
    agentId,
    provider,
    workspace,
    ...(values.get("--resume") ? { resumeSessionId: values.get("--resume") } : {}),
    ...(values.get("--model") ? { model: values.get("--model") } : {}),
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseAcpHostArgs(argv);
  const support = resolveAcpProviderSupport(args.provider);
  const scope = await Effect.runPromise(Scope.make());
  let scopeClosed = false;
  const closeScope = async () => {
    if (scopeClosed) return;
    scopeClosed = true;
    await Effect.runPromise(Scope.close(scope, Exit.void));
  };
  try {
    const runtime = await Effect.runPromise(
      Effect.gen(function* () {
        const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        return yield* support.makeRuntime({
          childProcessSpawner,
          cwd: args.workspace,
          resumeSessionId: args.resumeSessionId,
          clientInfo: {
            name: "overdeck",
            version: process.env.npm_package_version ?? "development",
          },
          environment: process.env,
        });
      }).pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.provide(NodeServices.layer),
      ),
    );
    const host = new AcpHost({
      agentId: args.agentId,
      provider: args.provider,
      workspace: args.workspace,
      model: args.model,
      runtime,
      stdout: process.stdout,
      disposeRuntime: closeScope,
    });
    await host.start();
    const stop = () => {
      void host.stop().catch((error) => {
        console.error(errorMessage(error));
        process.exitCode = 1;
      });
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  } catch (error) {
    await closeScope();
    throw error;
  }
}

export async function readPersistedAcpSessionId(
  overdeckHome: string,
  agentId: string,
): Promise<string | undefined> {
  try {
    return (await readFile(join(overdeckHome, "agents", agentId, "acp-session-id"), "utf-8")).trim() || undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

if (basename(fileURLToPath(import.meta.url)) === basename(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
