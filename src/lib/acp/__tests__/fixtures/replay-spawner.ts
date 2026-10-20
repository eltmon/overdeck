/**
 * ACP replay harness (PAN-4563): a `ChildProcessSpawner` whose child plays a
 * recorded protocol fixture, so the real effect-acp client, AcpSessionRuntime,
 * Kimi runtime factory, and AcpHost run against recorded provider behavior
 * with no child process.
 */
import { fileURLToPath } from "node:url";
import type { Writable } from "node:stream";
import { Writable as WritableStream } from "node:stream";

import * as NodeServices from "@effect/platform-node/NodeServices";
import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { loadProtocolFixture, type ProtocolFixture } from "../../../protocol-capture/fixture.js";
import { createProtocolReplay, type ProtocolReplay } from "../../../protocol-capture/replay.js";
import { AcpHost } from "../../host.js";
import { makeKimiAcpRuntime } from "../../kimi.js";

/** The workspace every replay runs with; recorded paths are scrubbed to `<CWD>`. */
export const REPLAY_WORKSPACE = "/replay/cwd";

export function makeReplaySpawnerFromFixture(
  replay: ProtocolReplay,
): ChildProcessSpawner.ChildProcessSpawner["Service"] {
  return ChildProcessSpawner.make(() =>
    Effect.gen(function* () {
      const agentToRuntime = yield* Queue.unbounded<Uint8Array, Cause.Done<void>>();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      let buffered = "";
      replay.onServerLine((line) => {
        Queue.offerUnsafe(agentToRuntime, encoder.encode(`${line}\n`));
      });
      const acceptChunk = (chunk: Uint8Array) =>
        Effect.sync(() => {
          buffered += decoder.decode(chunk, { stream: true });
          for (;;) {
            const newline = buffered.indexOf("\n");
            if (newline < 0) break;
            const line = buffered.slice(0, newline);
            buffered = buffered.slice(newline + 1);
            if (line.trim() !== "") replay.acceptClientLine(line);
          }
        });
      replay.start();

      const stdout = Stream.fromQueue(agentToRuntime);
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.never,
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        stdin: Sink.forEach(acceptChunk),
        stdout,
        stderr: Stream.empty,
        all: stdout,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      });
    }),
  );
}

export function kimiFixturePath(fixtureName: string): string {
  return fileURLToPath(new URL(`./replay/${fixtureName}.jsonl`, import.meta.url));
}

export interface KimiReplay {
  replay: ProtocolReplay;
  host: AcpHost;
  /** Pane lines the host wrote to stdout. */
  lines: string[];
}

function captureLines(): { stdout: Writable; lines: string[] } {
  const lines: string[] = [];
  let buffer = "";
  const stdout = new WritableStream({
    write(chunk, _encoding, callback) {
      buffer += String(chunk);
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        lines.push(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      callback();
    },
  });
  return { stdout, lines };
}

/**
 * Load a fixture (by name under `fixtures/replay/`, or inline), build the real
 * Kimi ACP runtime over a replay spawner inside its own scope, and construct
 * the real AcpHost. The caller runs `host.start()` and `host.stop()`; stopping
 * the host closes the runtime scope.
 */
export async function startKimiReplay(
  fixture: string | ProtocolFixture,
  deps: { overdeckHome: string },
): Promise<KimiReplay> {
  const loaded = typeof fixture === "string" ? await loadProtocolFixture(kimiFixturePath(fixture)) : fixture;
  const replay = createProtocolReplay(loaded);
  const scope = await Effect.runPromise(Scope.make());
  let scopeClosed = false;
  const closeScope = async () => {
    if (scopeClosed) return;
    scopeClosed = true;
    await Effect.runPromise(Scope.close(scope, Exit.void));
  };
  const runtime = await Effect.runPromise(
    makeKimiAcpRuntime({
      childProcessSpawner: makeReplaySpawnerFromFixture(replay),
      cwd: REPLAY_WORKSPACE,
      clientInfo: { name: "overdeck", version: "replay" },
      kimiSettings: { binaryPath: "kimi" },
    }).pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.provide(NodeServices.layer),
    ),
  );
  const hostOptions = loaded.header.hostOptions ?? {};
  const { stdout, lines } = captureLines();
  const host = new AcpHost({
    agentId: "agent-replay",
    provider: "kimi",
    workspace: REPLAY_WORKSPACE,
    model: typeof hostOptions.model === "string" ? hostOptions.model : undefined,
    effort: typeof hostOptions.effort === "string" ? hostOptions.effort : undefined,
    overdeckHome: deps.overdeckHome,
    runtime,
    stdout,
    disposeRuntime: closeScope,
    turnStallTimeoutMs: 0,
  });
  return { replay, host, lines };
}
