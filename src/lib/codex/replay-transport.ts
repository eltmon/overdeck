/**
 * Codex app-server replay transport (PAN-4563).
 *
 * Implements AppServerTransport backed by recorded fixture frames, enabling
 * integration testing of CodexAppServerManager and CodexAppServerHost
 * against real provider protocol timings and event orderings without spawning
 * any child processes or network connections.
 */
import { ReplayEngine } from "../harness-replay/replay-engine.js";
import type { ProtocolFixture } from "../harness-replay/fixture.js";
import type { AppServerTransport } from "./app-server-transport.js";

export interface CodexReplayTransport extends AppServerTransport {
  readonly engine: ReplayEngine;
}

export interface CodexReplayOptions {
  readonly strict?: boolean;
}

/**
 * Creates an AppServerTransport that replays frames from a recorded fixture.
 */
export function createCodexReplayTransport(
  fixture: ProtocolFixture,
  options: CodexReplayOptions = {},
): CodexReplayTransport {
  let messageHandler: ((text: string) => void) | undefined;
  let closeHandler: ((reason: string) => void) | undefined;
  let closed = false;

  const engine = new ReplayEngine(fixture, {
    strict: options.strict ?? false,
    onIncoming(message) {
      if (closed) return;
      const text =
        typeof message === "string" ? message : JSON.stringify(message);
      if (messageHandler) {
        messageHandler(text);
      }
    },
    onFinish() {
      // Replay completed
    },
  });

  const transport: CodexReplayTransport = {
    engine,
    send(message) {
      if (closed)
        throw new Error(
          "Cannot write to codex app-server: replay transport is closed.",
        );
      engine.handleOutgoing(message);
    },
    onMessage(handler) {
      messageHandler = handler;
      // Start flushing initial frames if any
      engine.start();
    },
    onClose(handler) {
      closeHandler = handler;
    },
    close() {
      if (closed) return;
      closed = true;
      closeHandler?.("replay closed");
    },
  };

  return transport;
}
